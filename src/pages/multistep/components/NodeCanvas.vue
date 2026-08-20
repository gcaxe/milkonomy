<script lang="ts" setup>
import { reactive, ref, watchEffect } from "vue"
import { ElMessage } from "element-plus"
import type { useMultistepGraph } from "../composables/useMultistepGraph"
import type { GraphNode } from "../types"
import GraphNodeComp from "./GraphNode.vue"
import PurpleNode from "./PurpleNode.vue"

const props = defineProps<{ graph: ReturnType<typeof useMultistepGraph> }>()

const wrapRef = ref<HTMLElement>()
// 滚动时强制重算连线锚点
const scrollTick = ref(0)

// —— 坐标换算：client → 画布（未缩放）坐标 ——
function clientToCanvas(x: number, y: number) {
  const wrap = wrapRef.value!
  const wrapRect = wrap.getBoundingClientRect()
  return {
    x: (x - wrapRect.left + wrap.scrollLeft) / props.graph.zoom.value,
    y: (y - wrapRect.top + wrap.scrollTop) / props.graph.zoom.value
  }
}

// —— 节点拖动（指针捕获实现，不引入任何拖拽库） ——
function onDragStart(node: GraphNode, ev: PointerEvent) {
  const startX = ev.clientX, startY = ev.clientY
  const originX = node.x, originY = node.y
  const zoom = props.graph.zoom.value
  const onMove = (e: PointerEvent) => {
    node.x = originX + (e.clientX - startX) / zoom
    node.y = originY + (e.clientY - startY) / zoom
  }
  const onUp = () => {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    props.graph.persistPositions()
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
}

// —— 拖线：pin 按下 → 临时线跟随 → pin 抬起落点 ——
const tempWire = ref<{ x1: number, y1: number, x2: number, y2: number } | null>(null)

// 连线锚点表：post-flush 读取 DOM（DOM patch 完成后），
// 节点移动/滚动/缩放变化时自动重算，线实时跟随
const anchors = reactive(new Map<string, { x: number, y: number }>())
watchEffect(() => {
  // 建立响应式依赖：节点坐标、连线集合、缩放、滚动
  for (const n of props.graph.nodes.value) { void n.x; void n.y }
  void props.graph.wires.value.length
  void props.graph.zoom.value
  void scrollTick.value
  const wrap = wrapRef.value
  if (!wrap) return
  const wrapRect = wrap.getBoundingClientRect()
  const map = new Map<string, { x: number, y: number }>()
  wrap.querySelectorAll<HTMLElement>("[data-pin-id]").forEach((el) => {
    const pinId = el.dataset.pinId
    if (!pinId) return
    const rect = el.getBoundingClientRect()
    map.set(pinId, {
      x: (rect.left + rect.width / 2 - wrapRect.left + wrap.scrollLeft) / props.graph.zoom.value,
      y: (rect.top + rect.height / 2 - wrapRect.top + wrap.scrollTop) / props.graph.zoom.value
    })
  })
  anchors.clear()
  map.forEach((v, k) => anchors.set(k, v))
}, { flush: "post" })

/** pin 中心在画布（未缩放）坐标系中的锚点 */
function pinAnchor(pinId: string) {
  return anchors.get(pinId) ?? { x: 0, y: 0 }
}

function onPinDragStart(pinId: string, ev: PointerEvent) {
  const start = pinAnchor(pinId)
  tempWire.value = { x1: start.x, y1: start.y, x2: start.x, y2: start.y }
  const onMove = (e: PointerEvent) => {
    const pos = clientToCanvas(e.clientX, e.clientY)
    tempWire.value = { x1: start.x, y1: start.y, x2: pos.x, y2: pos.y }
  }
  const onUp = (e: PointerEvent) => {
    const target = (e.target as HTMLElement)?.closest?.("[data-pin-id]") as HTMLElement | null
    const targetPinId = target?.dataset.pinId
    if (targetPinId && targetPinId !== pinId) {
      const err = props.graph.tryConnect(pinId, targetPinId)
      err && ElMessage.error(err)
    }
    tempWire.value = null
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
}

/** UE5 蓝图式贝塞尔曲线（竖直切线） */
function wirePath(from: { x: number, y: number }, to: { x: number, y: number }) {
  const dy = Math.max(40, Math.abs(to.y - from.y) * 0.5)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`
}
</script>

<template>
  <div ref="wrapRef" class="node-canvas-wrap" @scroll="scrollTick++">
    <div
      class="node-canvas"
      :style="{
        width: `${graph.canvasSize.value.width}px`,
        height: `${graph.canvasSize.value.height}px`,
        transform: `scale(${graph.zoom.value})`
      }"
    >
      <svg class="edges">
        <!-- 已存在连线：单击删除 -->
        <g v-for="w in graph.wires.value" :key="w.id" class="wire-group">
          <path :d="wirePath(pinAnchor(w.fromPinId), pinAnchor(w.toPinId))" fill="none"
                stroke="var(--el-border-color-darker)" stroke-width="2" class="wire-path" />
          <path :d="wirePath(pinAnchor(w.fromPinId), pinAnchor(w.toPinId))" fill="none"
                stroke="transparent" stroke-width="14" class="wire-hit" @click="graph.deleteWire(w.id)" />
        </g>
        <!-- 拖线中的临时线 -->
        <path v-if="tempWire" :d="wirePath({ x: tempWire.x1, y: tempWire.y1 }, { x: tempWire.x2, y: tempWire.y2 })"
              fill="none" stroke="#ffd04b" stroke-width="2" stroke-dasharray="6 4" />
      </svg>

      <GraphNodeComp
        v-for="n in graph.nodes.value.filter(x => x.kind === 'var')"
        :key="n.id"
        :node="n"
        :result="graph.nodeResults.value.get(n.id) ?? null"
        :gather-actions="graph.getGatherActionsOf(n.hrid)"
        @drag-start="onDragStart"
        @pin-drag-start="onPinDragStart"
        @delete="(n) => graph.deleteNode(n.id)"
      />
      <PurpleNode
        v-for="n in graph.nodes.value.filter(x => x.kind === 'func')"
        :key="n.id"
        :node="n"
        :pins="graph.pins.value.filter(p => p.nodeId === n.id)"
        :alchemy-options="n.mainItemHrid ? graph.getAlchemyActionOptionsOf(n.mainItemHrid) : []"
        :result="graph.nodeResults.value.get(n.id) ?? null"
        @drag-start="onDragStart"
        @pin-drag-start="onPinDragStart"
        @set-class="(node, cls) => node.funcClass = cls"
        @set-action="(node, key) => { node.actionHrid = `/actions/alchemy/${key}`; graph.resolveFuncB(node) }"
        @set-catalyst="(node, rank) => { node.catalystRank = rank; graph.resolveFuncB(node) }"
        @delete="(n) => graph.deleteNode(n.id)"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.node-canvas-wrap {
  overflow: auto;
  height: 560px;
  border-radius: 8px;
  // 点状背景（径向渐变重复），与参考图一致
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 24px 24px;
}
.node-canvas {
  position: relative;
  transform-origin: 0 0;
}
.edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.wire-hit { pointer-events: all; cursor: pointer; }
.wire-group:hover .wire-path { stroke: #ffd04b; stroke-width: 3; }
</style>
