import type { Ref } from "vue"
import { computed, nextTick, ref, watch } from "vue"
import { ElMessage } from "element-plus"
import { getTrans } from "@/locales"
import type { GraphNode, GraphWire, NodeCalcResult, UpupItemRow, UpupSummary } from "../types"
import { balanceAndMutate, type BalanceResult } from "../utils/balance"

/**
 * 配平计算：点击「自动配平」后生成快照驱动六卡片与节点指标；
 * 图结构/数量变化 → 快照失效（卡片显示 --），拖动节点不失效。
 */
export function useMultistepCalc(nodes: Ref<GraphNode[]>, wires: Ref<GraphWire[]>, rows: Ref<UpupItemRow[]>) {
  const balanceResult = ref<BalanceResult | null>(null)
  let suppressReset = false

  // 结构签名：不含 x/y（拖动不触发失效），含 count（手动改数量触发失效）
  const structureSig = computed(() => JSON.stringify([
    nodes.value.map(n => [
      n.id, n.kind, n.varKind, n.hrid, n.count, n.obtain,
      n.funcClass, n.mainItemHrid, n.actionHrid, n.catalystRank, n.rowUid
    ]),
    wires.value.map(w => [w.fromPinId, w.toPinId]).sort()
  ]))
  watch(structureSig, (nv, ov) => {
    if (nv !== ov && !suppressReset) balanceResult.value = null
  })

  /** 自动配平入口：第一行=100，其余按配方期望传播 */
  function balance() {
    const driver = nodes.value.find(n => n.kind === "var" && n.rowUid != null && rows.value[0] && n.rowUid === rows.value[0].uid)
    if (!driver || !driver.hrid) {
      ElMessage.warning(getTrans("请先在第一行选择物品"))
      return
    }
    suppressReset = true
    const result = balanceAndMutate(nodes.value, wires.value, rows.value)
    // 红节点行数量同步（3 位小数）
    for (const n of nodes.value) {
      if (n.kind === "var" && n.rowUid != null && n.count != null) {
        const row = rows.value.find(r => r.uid === n.rowUid)
        if (row) row.count = Math.round(n.count * 1000) / 1000
      }
    }
    balanceResult.value = result
    nextTick(() => { suppressReset = false })
  }

  const summary = computed<UpupSummary>(() => {
    const r = balanceResult.value
    if (!r) {
      return {
        leafAfterTaxIncome: null,
        leafTax: null,
        totalCost: null,
        startItemCost: null,
        extraCost: null,
        batchProfit: null,
        profitRate: null,
        totalTime: null,
        processNodeCount: nodes.value.filter(n => n.kind === "func" && !!n.actionHrid && (n.funcClass === "A" || n.catalystRank != null)).length,
        sellLeafCount: nodes.value.filter(n => n.kind === "var" && n.varKind === "green").length,
        hourlyProfit: null,
        dailyProfit: null
      }
    }
    return {
      leafAfterTaxIncome: r.income,
      leafTax: r.tax,
      totalCost: r.totalCost,
      startItemCost: r.startItemCost,
      extraCost: r.extraCost,
      batchProfit: r.profit,
      profitRate: r.profitRate,
      totalTime: r.totalTime,
      processNodeCount: r.processNodeCount,
      sellLeafCount: r.sellLeafCount,
      hourlyProfit: r.hourlyProfit,
      dailyProfit: r.dailyProfit
    }
  })

  const nodeResults = computed(() => balanceResult.value?.nodeInfo ?? new Map<string, NodeCalcResult>())

  return { summary, nodeResults, balance }
}
