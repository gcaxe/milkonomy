<script lang="ts" setup>
import { computed } from "vue"
import { Delete, Plus } from "@element-plus/icons-vue"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { useGameStore } from "@/pinia/stores/game"
import { getTrans } from "@/locales"
import * as Format from "@@/utils/format"
import type { useMultistepGraph } from "../composables/useMultistepGraph"
import type { UpupItemRow } from "../types"

const props = defineProps<{ graph: ReturnType<typeof useMultistepGraph> }>()
const { t } = useI18n()

// 下拉可选物品：全部可交易物品，按名称排序
const itemOptions = computed(() => {
  const gameData = useGameStore().gameData
  if (!gameData) return []
  return Object.values(gameData.itemDetailMap)
    .filter(item => item.isTradable)
    .map(item => ({ hrid: item.hrid, label: getTrans(item.name) }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh"))
})

// 数量输入：只允许十进制正数（>=0），最多保留 3 位小数，非法输入回退为 0
function onCountInput(row: UpupItemRow, val: number | undefined) {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) {
    row.count = 0
    return
  }
  row.count = Math.round(n * 1000) / 1000
}

const summary = computed(() => props.graph.summary.value)
</script>

<template>
  <el-card class="mt-5 upup">
    <!-- 4.1 标题区：保留「多步利润计算」与说明文字；方案名称预留 -->
    <template #header>
      <div class="upup-header">
        <div class="upup-title">
          <div class="title">{{ t('多步利润计算') }}</div>
          <div class="desc">{{ t('多步利润计算说明') }}</div>
        </div>
        <div class="upup-plan">
          <el-button type="primary" plain @click="graph.balance()">{{ t('自动配平') }}</el-button>
          <el-input
            v-model="graph.planName.value"
            :placeholder="t('方案名称（可选）')"
            style="width: 220px"
            clearable
          />
          <el-button type="primary" @click="graph.savePlan()">{{ t('保存当前步骤') }}</el-button>
        </div>
      </div>
    </template>

    <!-- 4.2 起始物品行编辑器（允许同名物品，每行对应一个红节点） -->
    <div v-for="(row, index) in graph.rows.value" :key="row.uid" class="upup-row">
      <span class="row-index">{{ index + 1 }}</span>
      <!-- 选择前不渲染图标；选择后显示物品图标 -->
      <ItemIcon v-if="row.hrid" :hrid="row.hrid" :width="28" :height="28" />
      <el-select
        :model-value="row.hrid ?? undefined"
        :placeholder="t('请选择物品')"
        filterable
        style="width: 320px"
        @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => graph.setRowItem(row.uid, val as string)"
      >
        <el-option v-for="opt in itemOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
          <div class="option-item">
            <ItemIcon :hrid="opt.hrid" :width="24" :height="24" />
            <span>{{ opt.label }}</span>
          </div>
        </el-option>
      </el-select>
      <el-input-number
        :model-value="row.count"
        :min="0"
        :step="1"
        :precision="3"
        style="width: 160px"
        @update:model-value="(val) => onCountInput(row, val)"
      />
      <el-button :icon="Delete" plain @click="graph.removeRow(row.uid)" />
    </div>

    <div class="row-tools">
      <el-button :icon="Plus" plain @click="graph.addRow(true)">
        {{ t('添加物品') }}
      </el-button>
      <el-button :icon="Plus" plain type="warning" class="add-func" @click="graph.addFuncNode()">
        {{ t('添加紫色节点') }}
      </el-button>
    </div>

    <!-- 4.3 六个统计卡片：配平后显示真实数值，未配平显示 -- -->
    <el-row :gutter="16" class="summary-cards">
      <el-col :span="4"><div class="card">
        <div class="card-title">{{ t('单批税后收入') }}</div>
        <div class="card-value">{{ summary.leafAfterTaxIncome == null ? '--' : Format.money(summary.leafAfterTaxIncome) }}</div>
        <div class="card-sub">{{ t('仅出售节点计税', [summary.leafTax == null ? '--' : Format.money(summary.leafTax)]) }}</div>
      </div></el-col>
      <el-col :span="4"><div class="card">
        <div class="card-title">{{ t('单批成本') }}</div>
        <div class="card-value">{{ summary.totalCost == null ? '--' : Format.money(summary.totalCost) }}</div>
        <div class="card-sub">{{ t('起始物品额外材料', [summary.startItemCost == null ? '--' : Format.money(summary.startItemCost), summary.extraCost == null ? '--' : Format.money(summary.extraCost)]) }}</div>
      </div></el-col>
      <el-col :span="4"><div class="card">
        <div class="card-title">{{ t('单批利润') }}</div>
        <div class="card-value" :class="summary.batchProfit != null && summary.batchProfit < 0 ? 'negative' : 'positive'">
          {{ summary.batchProfit == null ? '--' : Format.money(summary.batchProfit) }}
        </div>
        <div class="card-sub">{{ t('利润率', [summary.profitRate == null ? '--' : Format.percent(summary.profitRate)]) }}</div>
      </div></el-col>
      <el-col :span="4"><div class="card">
        <div class="card-title">{{ t('单批处理耗时') }}</div>
        <div class="card-value">{{ summary.totalTime == null ? '--' : Format.costTime(summary.totalTime) }}</div>
        <div class="card-sub">{{ t('处理节点出售叶子', [summary.processNodeCount, summary.sellLeafCount]) }}</div>
      </div></el-col>
      <el-col :span="4"><div class="card">
        <div class="card-title">{{ t('小时收益') }}</div>
        <div class="card-value positive">{{ summary.hourlyProfit == null ? '--' : Format.money(summary.hourlyProfit) }}</div>
        <div class="card-sub">{{ t('按全部处理工时折算') }}</div>
      </div></el-col>
      <el-col :span="4"><div class="card">
        <div class="card-title">{{ t('天收益') }}</div>
        <div class="card-value positive">{{ summary.dailyProfit == null ? '--' : Format.money(summary.dailyProfit) }}</div>
        <div class="card-sub">{{ t('小时收益乘24') }}</div>
      </div></el-col>
    </el-row>
  </el-card>
</template>

<style lang="scss" scoped>
.upup-header { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.upup-title .title { font-weight: 600; font-size: 16px; }
.upup-title .desc { color: var(--el-text-color-secondary); font-size: 12px; max-width: 640px; }
.upup-plan { display: flex; gap: 8px; align-items: center; }
.upup-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.row-index { width: 16px; text-align: right; color: var(--el-text-color-secondary); }
.option-item { display: flex; align-items: center; gap: 8px; }
.row-tools { display: flex; gap: 10px; margin-bottom: 16px; }
.add-func { border-color: #a855f7; background: rgba(168, 85, 247, 0.08); color: #a855f7; }
.summary-cards .card {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 12px 16px;
  .card-title { color: var(--el-text-color-secondary); font-size: 13px; }
  .card-value { font-size: 24px; font-weight: 600; margin: 4px 0; }
  .card-sub { color: var(--el-text-color-secondary); font-size: 12px; }
  .positive { color: #67c23a; }
  .negative { color: #f56c6c; }
}
</style>
