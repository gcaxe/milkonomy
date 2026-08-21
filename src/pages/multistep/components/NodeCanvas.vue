<script lang="ts" setup>
import { computed, reactive, ref, watchEffect } from "vue"
import { ElMessage } from "element-plus"
import type { useMultistepGraph } from "../composables/useMultistepGraph"
import type { GraphNode } from "../types"
import { getTradableItemOptions } from "../utils/items"
import GraphNodeComp from "./GraphNode.vue"
import PurpleNode from "./PurpleNode.vue"

const props = defineProps<{ graph: ReturnType<typeof useMultistepGraph> }>()

const wrapRef = ref<HTMLElement>()
// 滚动时强制重算连线锚点
const scrollTick = ref(0)

// 红节点内选择物品的选项（与 [上部] 共用同一来源）
const itemOptions = computed(() => getTradableItemOptions())

// 「不显示平凡产物」：过滤隐藏节点与其连线
const hiddenNodeIds = computed(() => props.graph.hiddenMundaneIds.value)
const visibleWires = computed(() => props.graph.wires.value.filter(w =>
  !hiddenNodeIds.value.has(w.fromPinId.split(":")[0]) && !hiddenNodeIds.value.has(w.toPinId.split(":")[0])))
const visibleVarNodes = computed(() => props.graph.nodes.value.filter(n => n.kind === "var" && !hiddenNodeIds.value.has(n.id)))
const visibleFuncNodes = computed(() => props.graph.nodes.value.filter(n => n.kind === "func"))

// —— 坐标换算：client → 画布（未缩放）坐标 ——
function clientToCanvas(x: number, y: number) {
  const wrap = wrapRef.value!
  const wrapRect = wrap.getBoundingClientRect()
  return {
    x: (x - wrapRect.left + wrap.scrollLeft) / props.graph.zoom.value,
    y: (y - wrapRect.top + wrap.scrollTop) / props.graph.zoom.value
  }
}

// —— 框选 ——
const selecting = ref<{ x1: number, y1: number, x2: number, y2: number } | null>(null)
const selectedIds = ref<string[]>([])

/** 节点与框选矩形的相交判定（按节点近似尺寸） */
function intersectsSelection(n: GraphNode, r: { x1: number, y1: number, x2: number, y2: number }) {
  const w = n.kind === "func" ? 260 : 220
  const h = 110
  return n.x + w >= r.x1 && n.x <= r.x2 && n.y + h >= r.y1 && n.y <= r.y2
}

/** 画布空白处按下：开始框选（点在节点/pin/线上则忽略） */
function onCanvasPointerDown(ev: PointerEvent) {
  const target = ev.target as HTMLElement
  if (target.closest(".graph-node, .func-node, .pin, .el-select, .el-button, .wire-hit, .el-input")) return
  const start = clientToCanvas(ev.clientX, ev.clientY)
  selecting.value = { x1: start.x, y1: start.y, x2: start.x, y2: start.y }
  const onMove = (e: PointerEvent) => {
    const pos = clientToCanvas(e.clientX, e.clientY)
    selecting.value = {
      x1: Math.min(start.x, pos.x), y1: Math.min(start.y, pos.y),
      x2: Math.max(start.x, pos.x), y2: Math.max(start.y, pos.y)
    }
  }
  const onUp = () => {
    const rect = selecting.value
    if (rect) {
      const hit = props.graph.nodes.value.filter(n => intersectsSelection(n, rect))
      // 框选太小（相当于点击空白）→ 清空选择
      selectedIds.value = (rect.x2 - rect.x1 < 5 && rect.y2 - rect.y1 < 5) ? [] : hit.map(n => n.id)
    }
    selecting.value = null
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
}

// —— 节点拖动（指针捕获实现；选中多节点时整体移动，连线按 pin 自动跟随不断开） ——
function onDragStart(node: GraphNode, ev: PointerEvent) {
  const startX = ev.clientX, startY = ev.clientY
  const zoom = props.graph.zoom.value
  // 未框选的节点单独拖动时，只移动它自己
  const moving = selectedIds.value.includes(node.id)
    ? props.graph.nodes.value.filter(n => selectedIds.value.includes(n.id))
    : (selectedIds.value = [node.id], [node])
  const origins = moving.map(n => ({ n, ox: n.x, oy: n.y }))
  const onMove = (e: PointerEvent) => {
    const dx = (e.clientX - startX) / zoom
    const dy = (e.clientY - startY) / zoom
    for (const { n, ox, oy } of origins) {
      n.x = ox + dx
      n.y = oy + dy
    }
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
      @pointerdown="onCanvasPointerDown"
    >
      <svg class="edges">
        <!-- 已存在连线：单击删除 -->
        <g v-for="w in visibleWires" :key="w.id" class="wire-group">
          <path :d="wirePath(pinAnchor(w.fromPinId), pinAnchor(w.toPinId))" fill="none"
                stroke="var(--el-border-color-darker)" stroke-width="2" class="wire-path" />
          <path :d="wirePath(pinAnchor(w.fromPinId), pinAnchor(w.toPinId))" fill="none"
                stroke="transparent" stroke-width="14" class="wire-hit" @click="graph.deleteWire(w.id)" />
        </g>
        <!-- 拖线中的临时线 -->
        <path v-if="tempWire" :d="wirePath({ x: tempWire.x1, y: tempWire.y1 }, { x: tempWire.x2, y: tempWire.y2 })"
              fill="none" stroke="#ffd04b" stroke-width="2" stroke-dasharray="6 4" />
      </svg>

      <!-- 框选矩形 -->
      <div
        v-if="selecting"
        class="selection-rect"
        :style="{
          left: `${selecting.x1}px`, top: `${selecting.y1}px`,
          width: `${selecting.x2 - selecting.x1}px`, height: `${selecting.y2 - selecting.y1}px`
        }"
      />

      <GraphNodeComp
        v-for="n in visibleVarNodes"
        :key="n.id"
        :node="n"
        :class="{ selected: selectedIds.includes(n.id) }"
        :result="graph.nodeResults.value.get(n.id) ?? null"
        :gather-actions="graph.getGatherActionsOf(n.hrid)"
        :item-options="itemOptions"
        @drag-start="onDragStart"
        @pin-drag-start="onPinDragStart"
        @delete="(n) => graph.deleteNode(n.id)"
        @set-item="(n, hrid) => graph.setRowItem(n.rowUid!, hrid)"
      />
      <PurpleNode
        v-for="n in visibleFuncNodes"
        :key="n.id"
        :node="n"
        :class="{ selected: selectedIds.includes(n.id) }"
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
.selection-rect {
  position: absolute;
  border: 1px dashed #ffd04b;
  background: rgba(255, 208, 75, 0.08);
  pointer-events: none;
  z-index: 10;
}
:deep(.selected) {
  outline: 2px solid #ffd04b;
  outline-offset: 2px;
}
</style>
