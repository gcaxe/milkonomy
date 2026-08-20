import type { Action } from "~/game"
import { CoinifyCalculator, DecomposeCalculator, TransmuteCalculator } from "@/calculator/alchemy"
import { GatherCalculator } from "@/calculator/gather"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getPriceOf } from "@/common/apis/game"
import { getTrans } from "@/locales"
import type { GraphNode, GraphWire, NodeCalcResult, UpupItemRow } from "../types"
import { getGatherActionsOf } from "./recipes"

/** 单批配平结果 */
export interface BalanceResult {
  /** 驱动节点（[上部] 第一行对应的红节点） */
  driver: GraphNode | null
  /** 每函数：单批动作次数 / 单次耗时(ns) / 隐藏输入（金币/茶）总成本 */
  funcInfo: Map<string, { actions: number, timeCost: number, hiddenCost: number }>
  /** 每节点计算结果（展示在节点上） */
  nodeInfo: Map<string, NodeCalcResult>
  /** 单批处理耗时（ns） */
  totalTime: number
  /** 单批成本 */
  totalCost: number
  /** 起始物品成本（驱动节点） */
  startItemCost: number
  /** 额外材料成本 */
  extraCost: number
  /** 单批税后收入 */
  income: number
  /** 市场税（收入/0.95×0.05） */
  tax: number
  profit: number
  profitRate: number
  hourlyProfit: number | null
  dailyProfit: number | null
  processNodeCount: number
  sellLeafCount: number
}

function emptyNodeCalc(): NodeCalcResult {
  return { actions: null, timeCost: null, extraCost: null, preTaxIncome: null, tax: null, afterTaxIncome: null }
}

/** 构造某紫节点对应的首页计算器实例（数量/耗时口径与首页一致） */
function buildFuncCalculator(n: GraphNode) {
  const cfg = { hrid: n.mainItemHrid!, project: getTrans("处理方式"), catalystRank: n.catalystRank ?? 0 }
  if (n.funcClass === "A") {
    const action = n.actionHrid!.split("/")[2] as Action
    return new ManufactureCalculator({ ...cfg, action })
  }
  const key = n.actionHrid!.split("/").pop()
  if (key === "coinify") return new CoinifyCalculator(cfg)
  if (key === "transmute") return new TransmuteCalculator(cfg)
  return new DecomposeCalculator(cfg)
}

function isFuncResolved(n: GraphNode): boolean {
  return n.kind === "func" && !!n.actionHrid && (n.funcClass === "A" || n.catalystRank != null)
}

/**
 * 自动配平：第一行物品数量 = 100，其余数量按配方期望值传播。
 * 传播是双向的：变量 → 消费紫节点（正向），变量 → 生产紫节点（按产量反推），
 * 保证所有连通的红/蓝/绿节点都得到数量。
 * 会回写 node.count（红/绿/蓝节点显示数量）与 rows[0].count；行数量由调用方同步。
 */
export function balanceAndMutate(nodes: GraphNode[], wires: GraphWire[], rows: UpupItemRow[]): BalanceResult {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const nodeQ = new Map<string, number>()
  const nodeInfo = new Map<string, NodeCalcResult>()
  const funcInfo = new Map<string, { actions: number, timeCost: number, hiddenCost: number }>()
  let totalTime = 0
  let totalCost = 0
  let startItemCost = 0
  let income = 0

  const empty = (): BalanceResult => ({
    driver: null, funcInfo, nodeInfo,
    totalTime: 0, totalCost: 0, startItemCost: 0, extraCost: 0,
    income: 0, tax: 0, profit: 0, profitRate: 0,
    hourlyProfit: null, dailyProfit: null,
    processNodeCount: nodes.filter(isFuncResolved).length,
    sellLeafCount: nodes.filter(n => n.kind === "var" && n.varKind === "green").length
  })

  const driver = nodes.find(n => n.kind === "var" && n.rowUid != null && rows[0] && n.rowUid === rows[0].uid) ?? null
  if (!driver || !driver.hrid) {
    for (const n of nodes) nodeInfo.set(n.id, emptyNodeCalc())
    return empty()
  }

  // 第一行 = 100
  driver.count = 100
  rows[0].count = 100
  nodeQ.set(driver.id, 100)

  const processedFuncs = new Set<string>()
  const visited = new Set<string>()
  const queue: GraphNode[] = [driver]

  /** 处理一个紫节点的配方：记耗时/隐藏成本，向其他输入输出传播数量 */
  function processFunc(func: GraphNode, calc: ReturnType<typeof buildFuncCalculator>, actions: number) {
    processedFuncs.add(func.id)
    const timeCost = calc.timeCost
    // 隐藏输入（金币/茶）= ingredientList 中没有变量连线的条目
    const wiredHrids = new Set<string>()
    for (const iw of wires.filter(x => x.toPinId.startsWith(`${func.id}:`))) {
      const src = nodeMap.get(iw.fromPinId.split(":")[0])
      if (src?.kind === "var") wiredHrids.add(src.hrid)
    }
    let hiddenCost = 0
    for (const e of calc.ingredientList) {
      if (wiredHrids.has(e.hrid)) continue
      hiddenCost += actions * e.count * getPriceOf(e.hrid).ask
    }
    funcInfo.set(func.id, { actions, timeCost, hiddenCost })
    totalTime += actions * timeCost
    totalCost += hiddenCost

    // 其他输入变量（如催化剂/原木等红节点）
    for (const iw of wires.filter(x => x.toPinId.startsWith(`${func.id}:`))) {
      const src = nodeMap.get(iw.fromPinId.split(":")[0])
      if (!src || src.kind !== "var") continue
      if (nodeQ.has(src.id)) continue
      const entry = calc.ingredientList.find(i => i.hrid === src.hrid)
      if (!entry) continue
      const qIn = actions * entry.count
      nodeQ.set(src.id, qIn)
      src.count = Math.round(qIn * 1000) / 1000
      queue.push(src)
    }
    // 输出变量（绿/蓝节点，期望 = count × rate）
    for (const ow of wires.filter(x => x.fromPinId.startsWith(`${func.id}:`))) {
      const tgt = nodeMap.get(ow.toPinId.split(":")[0])
      if (!tgt || tgt.kind !== "var") continue
      const entry = calc.productList.find(p => p.hrid === tgt.hrid)
      if (!entry) continue
      const qOut = actions * entry.count * (entry.rate ?? 1)
      nodeQ.set(tgt.id, qOut)
      tgt.count = Math.round(qOut * 1000) / 1000
      queue.push(tgt)
    }
    nodeInfo.set(func.id, {
      actions,
      timeCost: actions * timeCost,
      extraCost: hiddenCost,
      preTaxIncome: null,
      tax: null,
      afterTaxIncome: null
    })
  }

  while (queue.length) {
    const v = queue.shift()!
    if (visited.has(v.id)) continue
    visited.add(v.id)
    const q = nodeQ.get(v.id) ?? 0

    // 红节点：三采集 → 采集耗时；购买 → 计入单批成本
    if (v.kind === "var" && v.varKind === "red" && v.hrid) {
      if (v.obtain === "gather") {
        const gatherAction = getGatherActionsOf(v.hrid)[0]
        if (gatherAction) {
          const action = gatherAction.split("/")[2] as Action
          const g = new GatherCalculator({ hrid: v.hrid, project: getTrans("处理方式"), action })
          // 采集茶修正后的单次期望产量
          const yieldPerAction = g.productList.find(p => p.hrid === v.hrid)?.count || 1
          totalTime += (q / yieldPerAction) * g.timeCost
        }
      } else {
        const cost = q * getPriceOf(v.hrid).ask
        totalCost += cost
        if (v.id === driver.id) startItemCost = cost
      }
    }

    // 1) 上游：该变量的生产紫节点（in-wire 来源）——按产量反推动作次数
    const producerWire = wires.find(w => w.toPinId === `${v.id}:in:main`)
    if (producerWire) {
      const func = nodeMap.get(producerWire.fromPinId.split(":")[0])
      if (func && func.kind === "func" && isFuncResolved(func) && !processedFuncs.has(func.id)) {
        const calc = buildFuncCalculator(func)
        const outEntry = calc.productList.find(p => p.hrid === v.hrid)
        if (outEntry) {
          processFunc(func, calc, q / (outEntry.count * (outEntry.rate ?? 1)))
        }
      }
    }
    // 2) 下游：消费该变量的紫节点（out-wire 目标）——按消耗量正向传播
    for (const w of wires.filter(x => x.fromPinId === `${v.id}:out:main`)) {
      const func = nodeMap.get(w.toPinId.split(":")[0])
      if (!func || func.kind !== "func" || !isFuncResolved(func)) continue
      if (processedFuncs.has(func.id)) continue
      const calc = buildFuncCalculator(func)
      const inEntry = calc.ingredientList.find(i => i.hrid === v.hrid)
      if (inEntry) {
        processFunc(func, calc, q / inEntry.count)
      }
    }
  }

  // 收入：绿色叶子节点 × 卖价(bid，随 左价/右价+ 状态) × 0.95
  for (const n of nodes) {
    if (n.kind !== "var" || n.varKind !== "green" || !n.hrid) continue
    const q = nodeQ.get(n.id)
    if (q == null) continue
    const pre = q * getPriceOf(n.hrid).bid
    const after = pre * 0.95
    income += after
    nodeInfo.set(n.id, { actions: null, timeCost: null, extraCost: null, preTaxIncome: pre, tax: pre - after, afterTaxIncome: after })
  }

  const tax = income > 0 ? (income / 0.95) * 0.05 : 0
  const profit = income - totalCost
  const profitRate = totalCost > 0 ? profit / totalCost : 0
  const hourlyProfit = totalTime > 0 ? profit * ((3600 * 1e9) / totalTime) : null

  return {
    driver, funcInfo, nodeInfo,
    totalTime,
    totalCost,
    startItemCost,
    extraCost: totalCost - startItemCost,
    income,
    tax,
    profit,
    profitRate,
    hourlyProfit,
    dailyProfit: hourlyProfit != null ? hourlyProfit * 24 : null,
    processNodeCount: nodes.filter(isFuncResolved).length,
    sellLeafCount: nodes.filter(n => n.kind === "var" && n.varKind === "green").length
  }
}
