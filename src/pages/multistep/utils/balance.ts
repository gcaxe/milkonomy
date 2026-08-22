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

/** 单次传播的结果 */
interface PassResult {
  nodeQ: Map<string, number>
  funcActions: Map<string, { actions: number, calc: ReturnType<typeof buildFuncCalculator> }>
  gatherTime: number
}

/**
 * 自动配平：以第一行用户填写数量为基准，其余数量按配方期望值传播。
 * 传播是双向的：变量 → 消费紫节点（正向），变量 → 生产紫节点（按产量反推）。
 * 存在三角回流连接（防环）时：回流源的数量加回驱动节点重新传播，至多迭代 3 轮。
 */
export function balanceAndMutate(nodes: GraphNode[], wires: GraphWire[], rows: UpupItemRow[]): BalanceResult {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const nodeInfo = new Map<string, NodeCalcResult>()
  const funcInfo = new Map<string, { actions: number, timeCost: number, hiddenCost: number }>()

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
  // 闭包内 TS 收窄失效，这里固定为非空引用
  const driverNode: GraphNode = driver

  // 以第一行用户填写的数量为配平基准（不再固定 100）
  const baseQ = rows[0]?.count ?? 100

  /** 纯传播一轮：返回节点数量、函数动作次数与采集耗时，不写回也不结算 */
  function runPass(base: number): PassResult {
    const nodeQ = new Map<string, number>()
    nodeQ.set(driverNode.id, base)
    const funcActions = new Map<string, { actions: number, calc: ReturnType<typeof buildFuncCalculator> }>()
    const processedFuncs = new Set<string>()
    const visited = new Set<string>()
    const queue: GraphNode[] = [driverNode]
    let gatherTime = 0

    /** 处理一个紫节点的配方：传播其他输入输出数量 */
    function processFunc(func: GraphNode, calc: ReturnType<typeof buildFuncCalculator>, actions: number) {
      processedFuncs.add(func.id)
      funcActions.set(func.id, { actions, calc })
      // 其他输入变量
      for (const iw of wires.filter(x => x.toPinId.startsWith(`${func.id}:`) && x.toPinId !== `${func.id}:in:main`)) {
        const src = nodeMap.get(iw.fromPinId.split(":")[0])
        if (!src || src.kind !== "var") continue
        if (nodeQ.has(src.id)) continue
        const entry = calc.ingredientList.find(i => i.hrid === src.hrid)
        if (!entry) continue
        const qIn = actions * entry.count
        nodeQ.set(src.id, qIn)
        queue.push(src)
      }
      // 主输入变量（触发线可能来自红/蓝节点）
      for (const iw of wires.filter(x => x.toPinId === `${func.id}:in:main`)) {
        const src = nodeMap.get(iw.fromPinId.split(":")[0])
        if (!src || src.kind !== "var" || nodeQ.has(src.id)) continue
        const entry = calc.ingredientList.find(i => i.hrid === src.hrid)
        if (!entry) continue
        const qIn = actions * entry.count
        nodeQ.set(src.id, qIn)
        queue.push(src)
      }
      // 输出变量（期望 = count × rate × 成功率；炼金失败时什么都不给）
      for (const ow of wires.filter(x => x.fromPinId.startsWith(`${func.id}:`))) {
        const tgt = nodeMap.get(ow.toPinId.split(":")[0])
        if (!tgt || tgt.kind !== "var") continue
        const entry = calc.productList.find(p => p.hrid === tgt.hrid)
        if (!entry) continue
        const qOut = actions * entry.count * (entry.rate ?? 1) * calc.successRate
        nodeQ.set(tgt.id, qOut)
        queue.push(tgt)
      }
    }

    while (queue.length) {
      const v = queue.shift()!
      if (visited.has(v.id)) continue
      visited.add(v.id)
      const q = nodeQ.get(v.id) ?? 0

      // 红节点三采集：累计采集耗时
      if (v.kind === "var" && v.varKind === "red" && v.hrid && v.obtain === "gather") {
        const gatherAction = getGatherActionsOf(v.hrid)[0]
        if (gatherAction) {
          const action = gatherAction.split("/")[2] as Action
          const g = new GatherCalculator({ hrid: v.hrid, project: getTrans("处理方式"), action })
          const yieldPerAction = g.productList.find(p => p.hrid === v.hrid)?.count || 1
          gatherTime += (q / yieldPerAction) * g.timeCost
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
            // 反推同样折算成功率：每动作期望产出 = count × rate × successRate
            processFunc(func, calc, q / (outEntry.count * (outEntry.rate ?? 1) * calc.successRate))
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
    return { nodeQ, funcActions, gatherTime }
  }

  // 三角回流迭代：
  // 基线轮 A=用户值；随后每轮以「回流源（C）上一轮的数量」作为 A 重新传播，结果累加。
  // 总共至多计算 3 轮（基线 1 轮 + 回流 2 轮）；小于 0.001 的回流忽略（3 位小数精度）。
  const triWire0 = wires.find(w => w.toPinId === `${driverNode.id}:in:tri`)
  const triSourceId = triWire0?.fromPinId.split(":")[0] ?? null

  const accumulateQ = new Map<string, number>()
  const accumulateFuncActions = new Map<string, { actions: number, calc: ReturnType<typeof buildFuncCalculator> }>()
  let accumulateGatherTime = 0

  function mergePass(p: PassResult) {
    for (const [id, q] of p.nodeQ) {
      accumulateQ.set(id, (accumulateQ.get(id) ?? 0) + q)
    }
    for (const [id, fa] of p.funcActions) {
      const cur = accumulateFuncActions.get(id)
      accumulateFuncActions.set(id, cur ? { actions: cur.actions + fa.actions, calc: fa.calc } : { ...fa })
    }
    accumulateGatherTime += p.gatherTime
  }

  let nodeQ: Map<string, number>
  let funcActions: Map<string, { actions: number, calc: ReturnType<typeof buildFuncCalculator> }>
  let gatherTime: number

  if (triSourceId) {
    // 存在三角回流：迭代累加，驱动保持用户值，与驱动同物品的节点（回流载体 B/C）归零
    let pass = runPass(baseQ)
    mergePass(pass)
    let reflux = pass.nodeQ.get(triSourceId) ?? 0
    for (let round = 0; round < 2; round++) {
      if (reflux < 0.001) break
      pass = runPass(reflux)
      mergePass(pass)
      reflux = pass.nodeQ.get(triSourceId) ?? 0
    }
    nodeQ = new Map<string, number>()
    for (const [id, q] of accumulateQ) {
      const n = nodeMap.get(id)
      if (!n) continue
      if (id === driverNode.id) nodeQ.set(id, baseQ)
      else if (n.hrid === driverNode.hrid) nodeQ.set(id, 0)
      else nodeQ.set(id, q)
    }
    funcActions = accumulateFuncActions
    gatherTime = accumulateGatherTime
  } else {
    // 无三角回流：单轮传播直接结算。
    // 与驱动同物品的产物按配方自然取值：转化自产的 B 由计算器 sameItem 逻辑为 0，
    // 下游转化得到的 C 正常算出正数（无需三角连线）
    const pass = runPass(baseQ)
    nodeQ = pass.nodeQ
    funcActions = pass.funcActions
    gatherTime = pass.gatherTime
  }

  // —— 结算：按累计结果汇总成本/耗时/收入并回写节点数量 ——
  let totalTime = gatherTime
  let totalCost = 0
  let startItemCost = 0
  let income = 0

  for (const v of nodes) {
    if (v.kind !== "var") continue
    // 仅三角回流模式下，与驱动同物品的节点（回流载体）固定归零
    if (triSourceId && v.hrid === driverNode.hrid && v.id !== driverNode.id) {
      v.count = 0
      continue
    }
    const q = nodeQ.get(v.id)
    if (q == null) continue
    v.count = Math.round(q * 1000) / 1000
  }
  driverNode.count = Math.round((nodeQ.get(driverNode.id) ?? baseQ) * 1000) / 1000
  if (rows[0]) rows[0].count = driverNode.count

  for (const v of nodes) {
    if (v.kind !== "var") continue
    const q = nodeQ.get(v.id)
    if (q == null) continue
    // 购买红节点计入成本
    if (v.varKind === "red" && v.hrid) {
      if (v.obtain === "gather") continue
      const cost = q * getPriceOf(v.hrid).ask
      totalCost += cost
      if (v.id === driverNode.id) startItemCost = cost
    }
    // 绿色叶子计入税后收入：单价取生产计算器条目的 marketPrice（点金金币 = 卖价×5×bulk 等特例靠它）
    if (v.varKind === "green" && v.hrid) {
      let price = getPriceOf(v.hrid).bid
      const producerWire = wires.find(w => w.toPinId === `${v.id}:in:main`)
      const producer = producerWire ? nodeMap.get(producerWire.fromPinId.split(":")[0]) : undefined
      if (producer && producer.kind === "func") {
        const fa = funcActions.get(producer.id)
        const entry = fa?.calc.productList.find(p => p.hrid === v.hrid)
        if (entry) price = entry.marketPrice
      }
      const pre = q * price
      const after = pre * 0.95
      income += after
      nodeInfo.set(v.id, { actions: null, timeCost: null, extraCost: null, preTaxIncome: pre, tax: pre - after, afterTaxIncome: after })
    }
  }

  for (const [funcId, fa] of funcActions) {
    const func = nodeMap.get(funcId)
    if (!func) continue
    const { actions, calc } = fa
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
      // 单价取计算器条目自带 marketPrice（转化/分解的金币成本是特例价，不是 1）
      hiddenCost += actions * e.count * e.marketPrice
    }
    funcInfo.set(func.id, { actions, timeCost, hiddenCost })
    totalTime += actions * timeCost
    totalCost += hiddenCost
    nodeInfo.set(func.id, {
      actions,
      timeCost: actions * timeCost,
      extraCost: hiddenCost,
      preTaxIncome: null,
      tax: null,
      afterTaxIncome: null
    })
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
