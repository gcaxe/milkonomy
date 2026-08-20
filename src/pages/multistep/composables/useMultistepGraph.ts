import { computed, ref, toRaw, watch } from "vue"
import { ElMessage } from "element-plus"
import { getTrans } from "@/locales"
import type { GraphNode, GraphPin, GraphWire, MultistepPlan, UpupItemRow } from "../types"
import { findProducingActionOf, getAlchemyActionOptionsOf, getGatherActionsOf, resolveRecipeA, resolveRecipeB } from "../utils/recipes"
import { useMultistepCalc } from "./useMultistepCalc"

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

export function useMultistepGraph() {
  // —— 状态（暂不持久化：刷新页面即清空，保存功能之后再说） ——
  const rows = ref<UpupItemRow[]>([])
  const planName = ref("")
  const plans = ref<MultistepPlan[]>([])
  const positions = ref<Record<string, { x: number, y: number }>>({})

  const nodes = ref<GraphNode[]>([])
  const wires = ref<GraphWire[]>([])
  const zoom = ref(1)

  // —— 引脚：由 nodes 确定性派生（不持久化） ——
  const pins = computed<GraphPin[]>(() => {
    const list: GraphPin[] = []
    for (const n of nodes.value) {
      if (n.kind === "var") {
        list.push({ id: `${n.id}:in:main`, nodeId: n.id, side: "in", role: "normal", itemHrid: n.hrid })
        list.push({ id: `${n.id}:out:main`, nodeId: n.id, side: "out", role: "normal", itemHrid: n.hrid })
      } else {
        // 未解析函数：仅主 in / 主 out
        if (!isFuncResolved(n)) {
          list.push({ id: `${n.id}:in:main`, nodeId: n.id, side: "in", role: "main", itemHrid: n.mainItemHrid ?? "" })
          list.push({ id: `${n.id}:out:main`, nodeId: n.id, side: "out", role: "main", itemHrid: n.mainItemHrid ?? "" })
        } else {
          const recipe = resolveFuncRecipe(n)
          recipe.inputs.forEach((input, i) => list.push({
            id: `${n.id}:in:${i === 0 ? "main" : i}`,
            nodeId: n.id,
            side: "in",
            role: i === 0 ? "main" : "normal",
            itemHrid: input.hrid,
            auto: input.auto
          }))
          recipe.outputs.forEach((out, i) => list.push({
            id: `${n.id}:out:${i === 0 ? "main" : i}`,
            nodeId: n.id,
            side: "out",
            role: i === 0 ? "main" : "normal",
            itemHrid: out
          }))
        }
      }
    }
    return list
  })
  const pinById = (id: string) => pins.value.find(p => p.id === id)
  const nodeById = (id: string) => nodes.value.find(n => n.id === id)

  /** 紫节点是否已解析：A 类有动作即可；B 类需 主原料+动作+催化剂 三者齐备 */
  function isFuncResolved(n: GraphNode): boolean {
    return n.kind === "func" && !!n.actionHrid && (n.funcClass === "A" || n.catalystRank != null)
  }

  /** 缓存解析结果避免重复计算（key = nodeId + 配方参数） */
  const recipeCache = new Map<string, { inputs: { hrid: string, auto: boolean }[], outputs: string[] }>()
  function resolveFuncRecipe(n: GraphNode) {
    if (!isFuncResolved(n) || !n.actionHrid) return { inputs: [], outputs: [] }
    const actionHrid = n.actionHrid
    const key = `${n.id}-${actionHrid}-${n.catalystRank ?? 0}-${n.mainItemHrid ?? ""}`
    if (!recipeCache.has(key)) {
      recipeCache.set(key, n.funcClass === "A"
        ? resolveRecipeA(actionHrid)
        : resolveRecipeB(n.mainItemHrid!, actionHrid.split("/").pop() as any, n.catalystRank ?? 0))
    }
    return recipeCache.get(key)!
  }

  // ===================== 基础 CRUD =====================

  /** 把节点放到画布当前视口中央（含滚动/缩放换算），offsetIndex 用于错开多个新节点 */
  function placeInViewport(node: GraphNode, offsetIndex: number) {
    const wrap = document.querySelector<HTMLElement>(".node-canvas-wrap")
    if (!wrap) {
      node.x = 400
      node.y = 600
      return
    }
    const rect = wrap.getBoundingClientRect()
    const z = zoom.value || 1
    node.x = (rect.width / 2 + wrap.scrollLeft) / z - 110 + (offsetIndex % 5) * 30
    node.y = (rect.height / 2 + wrap.scrollTop) / z - 60 + (offsetIndex % 5) * 30
  }

  /** [上部] 添加物品行：同时创建红节点（购买）；viewport=true 时出现在用户视野中央 */
  function addRow(viewport: boolean = false) {
    const uid = ++seq
    const nodeId = nextId("red")
    const row: UpupItemRow = { uid, hrid: null, count: 1 }
    rows.value.push(row)
    const node: GraphNode = {
      id: nodeId, kind: "var", varKind: "red", hrid: "", count: 1,
      rowUid: uid, obtain: "buy",
      x: 40, y: 40
    }
    nodes.value.push(node)
    if (viewport) {
      placeInViewport(node, nodes.value.filter(n => n.kind === "var").length)
      // 记录为“手动”位置，避免 layout() 把它拽回网格
      positions.value[node.id] = { x: node.x, y: node.y }
    }
    layout()
    return { row, nodeId }
  }
  /** 行选中物品：红节点拿到物品名，获取方式重置为购买 */
  function setRowItem(uid: number, hrid: string) {
    const row = rows.value.find(r => r.uid === uid)
    const node = nodes.value.find(n => n.rowUid === uid)
    if (!row || !node) return
    row.hrid = hrid
    node.hrid = hrid
    node.obtain = "buy"
  }
  /** 删除行：级联删除对应红节点及其连线 */
  function removeRow(uid: number) {
    const node = nodes.value.find(n => n.rowUid === uid)
    rows.value = rows.value.filter(r => r.uid !== uid)
    if (node) deleteNode(node.id)
  }
  /** 添加紫色节点（未解析，尽量出现在用户当前视野中央） */
  function addFuncNode() {
    const node: GraphNode = {
      id: nextId("func"), kind: "func", hrid: "",
      x: 400, y: 600
    }
    placeInViewport(node, nodes.value.filter(n => n.kind === "func").length)
    nodes.value.push(node)
    // 记录为“手动”位置，避免 layout() 把它拽回网格
    positions.value[node.id] = { x: node.x, y: node.y }
    layout()
    return node
  }
  /** 删除节点：删除其全部连线；紫节点级联删除其自动生成的绿色节点（不删红色节点） */
  function deleteNode(nodeId: string) {
    const node = nodeById(nodeId)
    if (!node) return
    wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${nodeId}:`) && !w.toPinId.startsWith(`${nodeId}:`))
    // 紫节点：级联删除其自动生成的绿色节点（红节点保留，仅断线）
    if (node.kind === "func") {
      const children = nodes.value.filter(n => n.createdBy === nodeId)
      for (const c of children) {
        wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${c.id}:`) && !w.toPinId.startsWith(`${c.id}:`))
      }
      nodes.value = nodes.value.filter(n => !(n.createdBy === nodeId))
    }
    nodes.value = nodes.value.filter(n => n.id !== nodeId)
    if (node.rowUid != null) rows.value = rows.value.filter(r => r.uid !== node.rowUid)
    maintainInvariants()
    layout()
  }
  /** 删除连线：随后做全局一致性维护 */
  function deleteWire(wireId: string) {
    if (!wires.value.some(x => x.id === wireId)) return
    wires.value = wires.value.filter(x => x.id !== wireId)
    maintainInvariants()
    layout()
  }
  function resetFuncB(node: GraphNode) {
    node.mainItemHrid = undefined
    node.actionHrid = undefined
    node.catalystRank = undefined
  }

  /** 紫节点复原为未解析状态：清绿色节点、清自身连线、复位下拉（保留 A/B 类选择）。
   *  主产物节点的颜色/行恢复由 maintainInvariants 的通用 pin 占用规则处理 */
  function revertFunc(func: GraphNode) {
    // 删除该紫节点自动生成的绿色节点及其连线
    for (const c of nodes.value.filter(n => n.createdBy === func.id)) {
      wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${c.id}:`) && !w.toPinId.startsWith(`${c.id}:`))
    }
    nodes.value = nodes.value.filter(n => !(n.createdBy === func.id))
    // 清除紫节点自身全部连线（含与红/绿/蓝节点的连线）
    wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${func.id}:`) && !w.toPinId.startsWith(`${func.id}:`))
    // 复位为未解析状态
    func.actionHrid = undefined
    func.mainItemHrid = undefined
    func.catalystRank = undefined
  }

  /** 删除连线/节点后的全局一致性维护 */
  function maintainInvariants() {
    // 已解析紫节点：关键线（A 主产物 out:main / B 主原料 in:main）缺失 → 整体复原
    for (const func of nodes.value.filter(n => n.kind === "func" && isFuncResolved(n))) {
      const mainWireExists = func.funcClass === "A"
        ? wires.value.some(w => w.fromPinId === `${func.id}:out:main`)
        : wires.value.some(w => w.toPinId === `${func.id}:in:main`)
      if (!mainWireExists) revertFunc(func)
    }
    // 未解析/半配置 B：主输入线缺失 → 复位下拉
    for (const func of nodes.value.filter(n => n.kind === "func" && n.funcClass === "B" && !isFuncResolved(n))) {
      if (func.mainItemHrid && !wires.value.some(w => w.toPinId === `${func.id}:in:main`)) {
        resetFuncB(func)
      }
    }
    // 自动生成的绿节点若失去输入线 → 删除
    for (const g of nodes.value.filter(n => n.kind === "var" && n.varKind === "green" && n.createdBy)) {
      if (!wires.value.some(w => w.toPinId === `${g.id}:in:main`)) {
        wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${g.id}:`) && !w.toPinId.startsWith(`${g.id}:`))
        nodes.value = nodes.value.filter(n => n.id !== g.id)
      }
    }
    // 变量节点颜色由 pin 占用状态决定：双连=蓝，仅输入=绿，其余=红（来源购买，含双空）
    for (const v of nodes.value.filter(n => n.kind === "var")) {
      const hasIn = wires.value.some(w => w.toPinId === `${v.id}:in:main`)
      const hasOut = wires.value.some(w => w.fromPinId === `${v.id}:out:main`)
      if (hasIn && hasOut) {
        v.varKind = "blue"
      } else if (hasIn) {
        v.varKind = "green"
        // 兜底：带行的节点获得输入线时清除其 [上部] 行
        if (v.rowUid != null) {
          rows.value = rows.value.filter(r => r.uid !== v.rowUid)
          v.rowUid = undefined
        }
      } else if (v.varKind !== "red" || v.rowUid == null) {
        // 无输入线（仅输出或双空）：只能是红，来源变回购买并恢复 [上部] 行
        v.varKind = "red"
        v.obtain = "buy"
        if (v.rowUid == null) {
          const uid = ++seq
          rows.value.push({ uid, hrid: v.hrid, count: v.count ?? 1 })
          v.rowUid = uid
        }
      }
    }
  }

  // ===================== 连线交互 =====================

  /** 拖线落点判定：返回错误消息或执行动作 */
  function tryConnect(fromPinId: string, toPinId: string): string | null {
    const from = pinById(fromPinId), to = pinById(toPinId)
    if (!from || !to) return getTrans("引脚不存在")
    if (from.side === to.side) return getTrans("只能从输出连到输入")
    const outPin = from.side === "out" ? from : to
    const inPin = from.side === "in" ? from : to
    const outNode = nodeById(outPin.nodeId)!, inNode = nodeById(inPin.nodeId)!
    // 输入 pin 只能接一条线
    if (wires.value.some(w => w.toPinId === inPin.id)) return getTrans("该输入引脚已连接")

    // —— 变量 → 变量（仅允许：绿 → 红同名 合并） ——
    if (outNode.kind === "var" && inNode.kind === "var") {
      if (outNode.varKind === "green" && inNode.varKind === "red" && outNode.hrid && outNode.hrid === inNode.hrid) {
        mergeVarNodes(outNode, inNode)
        return null
      }
      if (outNode.varKind === "green" && inNode.varKind === "red") {
        return getTrans("仅同名绿色节点可连到红色输入引脚")
      }
      return getTrans("变量与函数必须交替连接")
    }

    // —— 变量输出 → 函数输入 ——
    if (outNode.kind === "var" && inNode.kind === "func") {
      if (!outNode.hrid) return getTrans("请先在[上部]选择物品")
      if (inPin.auto) return getTrans("该输入引脚不可连接")
      // 未解析 B 主输入：确立主要原料，解锁第二、三个下拉
      if (!isFuncResolved(inNode) && inPin.id.endsWith(":in:main")) {
        if (inNode.funcClass === "A") return getTrans("该输入引脚不可连接")
        inNode.funcClass = "B"
        inNode.mainItemHrid = outNode.hrid
      }
      // 未解析 A 的输入 pin 不接受连线（A 的输入在解析后才确定）
      if (!isFuncResolved(inNode) && inNode.funcClass === "A") return getTrans("该输入引脚不可连接")
      // 绿色节点输出一旦连上就变蓝（规则2）
      if (outNode.varKind === "green") outNode.varKind = "blue"
      wires.value.push({ id: nextId("wire"), fromPinId: outPin.id, toPinId: inPin.id })
      layout()
      return null
    }

    // —— 函数输出 → 变量输入（仅限未解析 A 的主产物 pin → 红节点） ——
    if (outNode.kind === "func" && inNode.kind === "var") {
      if (inNode.varKind !== "red") return getTrans("该输入引脚不可连接")
      if (!inNode.hrid) return getTrans("请先在[上部]选择物品")
      if (isFuncResolved(outNode) || outNode.funcClass !== "A" || !outPin.id.endsWith(":out:main")) {
        return getTrans("该输入引脚不可连接")
      }
      wires.value.push({ id: nextId("wire"), fromPinId: outPin.id, toPinId: inPin.id })
      resolveFuncA(outNode, inNode)
      return null
    }

    return getTrans("无法连接")
  }

  // ===================== 解析 =====================

  /** A 类解析：主产物唯一确定配方 */
  function resolveFuncA(func: GraphNode, targetVar: GraphNode) {
    const actionHrid = findProducingActionOf(targetVar.hrid)
    if (!actionHrid) {
      ElMessage.error(getTrans("未找到该产物的唯一配方"))
      // 回滚刚连的线
      wires.value = wires.value.filter(w => !(w.fromPinId === `${func.id}:out:main` && w.toPinId === `${targetVar.id}:in:main`))
      return
    }
    func.actionHrid = actionHrid
    func.mainItemHrid = targetVar.hrid
    func.funcClass = "A"
    applyResolvedRecipe(func)
    // 按 pin 占用规则定色：输出已连=蓝（继续处理），仅输入连=绿（叶子出售）
    const hasOut = wires.value.some(w => w.fromPinId === `${targetVar.id}:out:main`)
    targetVar.varKind = hasOut ? "blue" : "green"
    // 已变为自产，删除其 [上部] 行（已确认）
    if (targetVar.rowUid != null) {
      rows.value = rows.value.filter(r => r.uid !== targetVar.rowUid)
      targetVar.rowUid = undefined
    }
    layout()
  }

  /** B 类解析：主原料 + 动作 + 催化剂（三者齐备后触发） */
  function resolveFuncB(func: GraphNode) {
    if (!func.mainItemHrid || !func.actionHrid || func.catalystRank == null) return
    applyResolvedRecipe(func)
    layout()
  }

  /** 展开配方：重建输入输出 pin、自动生成红/绿节点并连线（金币/茶除外） */
  function applyResolvedRecipe(func: GraphNode) {
    const recipe = resolveFuncRecipe(func)
    // —— 输入侧 ——
    recipe.inputs.forEach((input, i) => {
      if (input.auto) return // 金币/茶：不生成 pin、不生成节点
      const pinId = `${func.id}:in:${i === 0 ? "main" : i}`
      // 主原料 pin 已被触发连线占用，跳过
      if (wires.value.some(w => w.toPinId === pinId)) return
      const { row, nodeId } = addRow()
      const varNode = nodeById(nodeId)!
      setRowItem(row.uid, input.hrid)
      varNode.createdBy = func.id
      wires.value.push({ id: nextId("wire"), fromPinId: `${varNode.id}:out:main`, toPinId: pinId })
    })
    // —— 输出侧 ——
    recipe.outputs.forEach((hrid, i) => {
      const pinId = `${func.id}:out:${i === 0 ? "main" : i}`
      // 主产物 pin 已被 A 触发连线占用，跳过
      if (wires.value.some(w => w.fromPinId === pinId)) return
      const green: GraphNode = {
        id: nextId("green"), kind: "var", varKind: "green", hrid,
        x: func.x, y: func.y + 200,
        createdBy: func.id
      }
      nodes.value.push(green)
      wires.value.push({ id: nextId("wire"), fromPinId: pinId, toPinId: `${green.id}:in:main` })
    })
  }

  // ===================== 合并（红+绿 → 蓝） =====================

  /** 红绿同名合并：记录信息 → 删两节点+红节点行 → 建蓝节点 → 重连 */
  function mergeVarNodes(greenNode: GraphNode, redNode: GraphNode) {
    // 1. 记录
    const hrid = greenNode.hrid
    const greenInputWire = wires.value.find(w => w.toPinId === `${greenNode.id}:in:main`)
    const redOutputWires = wires.value.filter(w => w.fromPinId === `${redNode.id}:out:main`)
    const redRowUid = redNode.rowUid
    // 2. 删除二者及所有相关连线与红节点 [上部] 行
    wires.value = wires.value.filter(w =>
      !w.fromPinId.startsWith(`${greenNode.id}:`) && !w.toPinId.startsWith(`${greenNode.id}:`)
      && !w.fromPinId.startsWith(`${redNode.id}:`) && !w.toPinId.startsWith(`${redNode.id}:`))
    nodes.value = nodes.value.filter(n => n.id !== greenNode.id && n.id !== redNode.id)
    rows.value = rows.value.filter(r => r.uid !== redRowUid)
    // 3. 创建蓝色节点（数量沿用绿色节点的产量折算）
    const blue: GraphNode = {
      id: nextId("blue"), kind: "var", varKind: "blue", hrid,
      count: greenNode.count,
      x: (greenNode.x + redNode.x) / 2, y: (greenNode.y + redNode.y) / 2
    }
    nodes.value.push(blue)
    // 4. 重连：蓝.in ← 绿的原生产连线；蓝.out → 红的原消耗连线
    if (greenInputWire) wires.value.push({ id: nextId("wire"), fromPinId: greenInputWire.fromPinId, toPinId: `${blue.id}:in:main` })
    for (const w of redOutputWires) wires.value.push({ id: nextId("wire"), fromPinId: `${blue.id}:out:main`, toPinId: w.toPinId })
    // 按 pin 占用规则定色（绿.in + 红.out 都在 → 蓝）
    maintainInvariants()
    layout()
  }

  // ===================== 布局（垂直组织：输入在紫节点上方、输出在下方） =====================
  const LEVEL_H = 140
  function layout() {
    const funcs = nodes.value.filter(n => n.kind === "func")
    const vars = nodes.value.filter(n => n.kind === "var")
    // 紫节点：每行 4 个换行，避免超出可滚动区域
    funcs.forEach((f, i) => {
      if (!positions.value[f.id]) {
        f.x = 400 + (i % 4) * 520
        f.y = 700 + Math.floor(i / 4) * 700
      } else {
        f.x = positions.value[f.id].x
        f.y = positions.value[f.id].y
      }
    })
    for (const v of vars) {
      // 手动拖过/手动放置的节点尊重其位置
      if (positions.value[v.id]) {
        v.x = positions.value[v.id].x
        v.y = positions.value[v.id].y
        continue
      }
      const producerWire = wires.value.find(w => w.toPinId === `${v.id}:in:main`)
      const producer = producerWire ? nodeById(pinById(producerWire.fromPinId)?.nodeId ?? "") : undefined
      const consumerWire = wires.value.find(w => w.fromPinId === `${v.id}:out:main`)
      const consumer = consumerWire ? nodeById(pinById(consumerWire.toPinId)?.nodeId ?? "") : undefined
      if (producer && producer.kind === "func") {
        // 输出节点：位于其生产紫节点下方
        const siblings = vars.filter(n => {
          const w = wires.value.find(x => x.toPinId === `${n.id}:in:main`)
          return w ? w.fromPinId.startsWith(`${producer.id}:`) : false
        })
        const idx = siblings.indexOf(v)
        v.x = producer.x
        v.y = producer.y + 200 + idx * LEVEL_H
      } else if (consumer && consumer.kind === "func") {
        // 输入节点：位于其消费紫节点上方
        const siblings = vars.filter(n => {
          const w = wires.value.find(x => x.fromPinId === `${n.id}:out:main`)
          return w ? w.toPinId.startsWith(`${consumer.id}:`) : false
        })
        const idx = siblings.indexOf(v)
        v.x = consumer.x
        v.y = consumer.y - 200 - idx * LEVEL_H
      } else {
        // 未连线红节点：最左列
        const idx = vars
          .filter(n => !wires.value.some(w => w.fromPinId.startsWith(`${n.id}:`) || w.toPinId.startsWith(`${n.id}:`)))
          .indexOf(v)
        v.x = 40
        v.y = 40 + idx * 150
      }
      // 不生成在可滚动区域外：坐标下限 40
      if (v.x < 40) v.x = 40
      if (v.y < 40) v.y = 40
    }
  }

  /** 画布尺寸：随节点分布动态扩展，保证所有节点都在可滚动区域内 */
  const canvasSize = computed(() => {
    let w = 4000
    let h = 2000
    for (const n of nodes.value) {
      w = Math.max(w, n.x + 320)
      h = Math.max(h, n.y + 220)
    }
    return { width: w, height: h }
  })
  function persistPositions() {
    const map: Record<string, { x: number, y: number }> = {}
    for (const n of nodes.value) map[n.id] = { x: n.x, y: n.y }
    positions.value = map
  }
  function resetLayout() { positions.value = {}; layout() }
  function zoomBy(delta: number) { zoom.value = Math.min(2, Math.max(0.2, zoom.value + delta)) }

  /** 保存方案骨架 */
  function savePlan() {
    const plan: MultistepPlan = {
      name: planName.value || `方案 ${plans.value.length + 1}`,
      rows: toRaw(rows.value),
      nodes: toRaw(nodes.value),
      wires: toRaw(wires.value),
      savedAt: Date.now()
    }
    const idx = plans.value.findIndex(p => p.name === plan.name)
    idx >= 0 ? (plans.value[idx] = plan) : plans.value.push(plan)
  }

  // 红节点数量与 [上部] 行保持同步
  watch(rows, () => {
    for (const n of nodes.value) {
      if (n.kind === "var" && n.rowUid != null) {
        const row = rows.value.find(r => r.uid === n.rowUid)
        if (row) n.count = row.count
      }
    }
  }, { deep: true })

  // 配平计算（快照驱动六卡片与节点指标）
  const { summary, nodeResults, balance } = useMultistepCalc(nodes, wires, rows)

  if (nodes.value.length) layout()

  return {
    rows, planName, plans, nodes, wires, pins, zoom, canvasSize, summary, nodeResults,
    pinById, nodeById, resolveFuncRecipe,
    addRow, setRowItem, removeRow, addFuncNode, deleteNode, deleteWire,
    tryConnect, resolveFuncB, mergeVarNodes, balance,
    getGatherActionsOf, getAlchemyActionOptionsOf, findProducingActionOf,
    layout, persistPositions, resetLayout, zoomBy, savePlan
  }
}
