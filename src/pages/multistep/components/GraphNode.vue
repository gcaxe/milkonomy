<script lang="ts" setup>
import { computed } from "vue"
import { Delete } from "@element-plus/icons-vue"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { getItemDetailOf } from "@/common/apis/game"
import { getTrans } from "@/locales"
import * as Format from "@@/utils/format"
import type { GraphNode, NodeCalcResult } from "../types"

const props = defineProps<{
  node: GraphNode
  result?: NodeCalcResult | null
  /** 该物品可用的三采集动作（空=只能购买） */
  gatherActions: string[]
}>()
const emit = defineEmits<{
  (e: "drag-start", node: GraphNode, ev: PointerEvent): void
  (e: "pin-drag-start", pinId: string, ev: PointerEvent): void
  (e: "delete", node: GraphNode): void
}>()
const { t } = useI18n()

const itemName = computed(() => getTrans(getItemDetailOf(props.node.hrid)?.name ?? ""))
const kindLabel = computed(() => ({
  red: t("输入"),
  blue: t("继续处理"),
  green: t("叶子出售")
}[props.node.varKind!]))
function onPinPointerDown(pinId: string, ev: PointerEvent) {
  ev.stopPropagation()
  emit("pin-drag-start", pinId, ev)
}
</script>

<template>
  <div
    class="graph-node"
    :class="[`kind-${node.varKind}`]"
    :style="{ left: `${node.x}px`, top: `${node.y}px` }"
    @pointerdown="emit('drag-start', node, $event)"
  >
    <!-- 输入 pin（上） -->
    <div
      class="pin in"
      :data-pin-id="`${node.id}:in:main`"
      :title="t('输入引脚')"
      @pointerdown="onPinPointerDown(`${node.id}:in:main`, $event)"
    />

    <div class="head">
      <ItemIcon v-if="node.hrid" :hrid="node.hrid" :width="26" :height="26" />
      <div class="names">
        <div class="name">{{ node.hrid ? itemName : t('未选择物品') }}</div>
        <div class="kind">{{ kindLabel }}</div>
      </div>
      <div class="count">× {{ Format.number(node.count ?? 1, 3) }}</div>
      <!-- 红节点：小垃圾桶删除按钮 -->
      <el-button
        v-if="node.varKind === 'red'"
        class="del"
        size="small"
        text
        :icon="Delete"
        @click.stop="emit('delete', node)"
      />
    </div>

    <!-- 红节点：获取方式下拉（购买默认；有三采集动作时可选） -->
    <el-select
      v-if="node.varKind === 'red' && node.hrid"
      :model-value="node.obtain ?? 'buy'"
      size="small"
      style="width: 100%; margin-top: 6px"
      @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => node.obtain = (val as string) as any"
    >
      <el-option :label="t('购买')" value="buy" />
      <el-option v-if="gatherActions.length" :label="t('三采集')" value="gather" />
    </el-select>

    <div class="metrics">
      <template v-if="node.varKind === 'green'">
        <span>{{ t('税前收入') }} <b>{{ result?.preTaxIncome == null ? '--' : Format.money(result.preTaxIncome) }}</b></span>
        <span>{{ t('税后收入') }} <b>{{ result?.afterTaxIncome == null ? '--' : Format.money(result.afterTaxIncome) }}</b></span>
      </template>
      <template v-else-if="node.varKind === 'blue'">
        <span>{{ t('工时占比') }} <b>--</b></span>
      </template>
    </div>

    <!-- 输出 pin（下） -->
    <div
      class="pin out"
      :data-pin-id="`${node.id}:out:main`"
      :title="t('输出引脚')"
      @pointerdown="onPinPointerDown(`${node.id}:out:main`, $event)"
    />
  </div>
</template>

<style lang="scss" scoped>
.graph-node {
  position: absolute;
  width: 220px;
  padding: 10px;
  border-radius: 8px;
  border: 2px solid;
  background: var(--el-bg-color-overlay);
  cursor: grab;
  user-select: none;
  &.kind-red { border-color: #f56c6c; background: rgba(245, 108, 108, 0.08); }
  &.kind-blue { border-color: #409eff; background: rgba(64, 158, 255, 0.08); }
  &.kind-green { border-color: #67c23a; background: rgba(103, 194, 58, 0.08); }
  .head { display: flex; gap: 8px; align-items: center; }
  .names { flex: 1; min-width: 0; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kind { font-size: 11px; color: var(--el-text-color-secondary); }
  .count { font-size: 12px; color: var(--el-text-color-secondary); }
  .del { color: #f56c6c; }
  .metrics { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--el-text-color-secondary); }
  /* 引脚：上下居中圆点，悬停放大高亮 */
  .pin {
    position: absolute;
    left: 50%;
    width: 14px; height: 14px;
    margin-left: -7px;
    border-radius: 50%;
    border: 2px solid var(--el-border-color-darker);
    background: #fff;
    cursor: crosshair;
    z-index: 1;
    &.in { top: -8px; }
    &.out { bottom: -8px; }
    &:hover { transform: scale(1.4); border-color: #ffd04b; }
  }
}
</style>
