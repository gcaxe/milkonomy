<script lang="ts" setup>
import { ref } from "vue"
import { Close, Delete, FullScreen, Plus, ZoomIn, ZoomOut } from "@element-plus/icons-vue"
import { ElMessageBox } from "element-plus"
import GameInfo from "@/pages/dashboard/components/GameInfo.vue"
import ActionConfig from "@/pages/dashboard/components/ActionConfig.vue"
import PriceStatusSelect from "@/pages/dashboard/components/PriceStatusSelect.vue"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import UpupPanel from "./components/UpupPanel.vue"
import NodeCanvas from "./components/NodeCanvas.vue"
import { useMultistepGraph } from "./composables/useMultistepGraph"

const { t } = useI18n()
const onPriceStatusChange = usePriceStatus("multistep-price-status")
const graph = useMultistepGraph()
// 蓝图全屏（CSS 铺满视口，非浏览器原生全屏，便于保留工具栏）
const fullscreen = ref(false)

/** 清空全部节点与连线（二次确认） */
function onClearAll() {
  ElMessageBox.confirm(t('确定清空全部节点与连线吗？'), t('清空'), {
    confirmButtonText: t('确定'),
    cancelButtonText: t('取消'),
    type: "warning"
  }).then(() => {
    graph.clearAll()
  }).catch(() => {
    // 取消清空
  })
}
</script>

<template>
  <div class="app-container">
    <!-- [顶端] toptop：与首页相同，但不含 计算税率 / 多步产量修正 两个 checkbox -->
    <div class="game-info">
      <GameInfo />
      <div><ActionConfig /></div>
      <PriceStatusSelect @change="onPriceStatusChange" />
    </div>

    <!-- [上部] upup -->
    <UpupPanel :graph="graph" />

    <!-- [中部] zhongzhong -->
    <el-card
      class="mt-5 zhongzhong-card"
      :class="{ 'zhongzhong-fullscreen': fullscreen }"
    >
      <template #header>
        <div class="zhongzhong-header">
          <span class="title">{{ t('可拖动结点图') }}</span>
          <div class="toolbar">
            <!-- 「不显示平凡产物」勾选项 + 四个图例：红=输入 蓝=继续处理 绿=叶子出售 紫=处理方式 -->
            <el-checkbox v-model="graph.hideMundane.value" class="legend">{{ t('不显示平凡产物') }}</el-checkbox>
            <el-tag type="danger" class="legend">{{ t('输入') }}</el-tag>
            <el-tag type="primary" class="legend">{{ t('继续处理') }}</el-tag>
            <el-tag type="success" class="legend">{{ t('叶子出售') }}</el-tag>
            <el-tag class="legend purple">{{ t('处理方式') }}</el-tag>
            <el-button-group>
              <el-button :icon="ZoomOut" @click="graph.zoomBy(-0.1)" />
              <el-button style="pointer-events:none">{{ Math.round(graph.zoom.value * 100) }}%</el-button>
              <el-button :icon="ZoomIn" @click="graph.zoomBy(0.1)" />
              <el-button :icon="Delete" @click="onClearAll">{{ t('清空') }}</el-button>
            </el-button-group>
            <el-button v-if="!fullscreen" :icon="FullScreen" @click="fullscreen = true">{{ t('全屏') }}</el-button>
          </div>
        </div>
      </template>

      <!-- 全屏时右上角工具栏 -->
      <div v-if="fullscreen" class="fullscreen-toolbar">
        <el-button :icon="Close" @click="fullscreen = false">{{ t('退出全屏') }}</el-button>
        <el-button :icon="Plus" type="danger" plain @click="graph.addRow(true)">{{ t('添加红色节点') }}</el-button>
        <el-button :icon="Plus" plain class="purple-btn" @click="graph.addFuncNode()">{{ t('添加处理方式') }}</el-button>
      </div>

      <NodeCanvas :graph="graph" />
    </el-card>

    <!-- 使用指南（与结点图平行层级） -->
    <el-card class="mt-5">
      <template #header>
        <span class="title">{{ t('使用指南') }}</span>
      </template>
      <div>{{ t('连完线后，点击自动配平') }}</div>
      <div>{{ t('平凡产物是该行动的精华、箱子类物品、精通之油类物品，但利润还是正常算。') }}</div>
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.game-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.zhongzhong-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  .title { font-weight: 600; }
  .desc { color: var(--el-text-color-secondary); font-size: 13px; }
  .toolbar { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .legend { cursor: default; }
  .legend.purple { border-color: #a855f7; color: #a855f7; background: rgba(168, 85, 247, 0.08); }
}
.zhongzhong-card { position: relative; }
/* CSS 全屏：铺满视口 */
.zhongzhong-fullscreen {
  position: fixed !important;
  inset: 0;
  /* 低于 Element Plus 浮层默认层级（2000+），保证节点下拉菜单/确认框/消息提示可用 */
  z-index: 1900;
  margin: 0 !important;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-radius: 0;
  :deep(.el-card__body) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  :deep(.node-canvas-wrap) {
    flex: 1;
    height: auto;
    min-height: 400px;
  }
}
.fullscreen-toolbar {
  position: absolute;
  /* 位于卡片头部下方，避免遮挡标题与图例；右移留出滚动条宽度 */
  top: 76px;
  right: 32px;
  z-index: 3200;
  display: flex;
  gap: 8px;
  background: var(--el-bg-color);
  padding: 6px;
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
}
.purple-btn {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.08);
  color: #a855f7;
}
</style>
