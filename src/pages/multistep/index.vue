<script lang="ts" setup>
import { RefreshLeft, ZoomIn, ZoomOut } from "@element-plus/icons-vue"
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
    <el-card class="mt-5">
      <template #header>
        <div class="zhongzhong-header">
          <span class="title">{{ t('可拖动结点图') }}</span>
          <span class="desc">{{ t('结点图说明') }}</span>
          <div class="toolbar">
            <!-- 四个图例：红=输入 蓝=继续处理 绿=叶子出售 紫=处理方式 -->
            <el-tag type="danger" class="legend">{{ t('输入') }}</el-tag>
            <el-tag type="primary" class="legend">{{ t('继续处理') }}</el-tag>
            <el-tag type="success" class="legend">{{ t('叶子出售') }}</el-tag>
            <el-tag class="legend purple">{{ t('处理方式') }}</el-tag>
            <el-button-group>
              <el-button :icon="ZoomOut" @click="graph.zoomBy(-0.1)" />
              <el-button style="pointer-events:none">{{ Math.round(graph.zoom.value * 100) }}%</el-button>
              <el-button :icon="ZoomIn" @click="graph.zoomBy(0.1)" />
              <el-button :icon="RefreshLeft" @click="graph.resetLayout()">{{ t('重置布局') }}</el-button>
            </el-button-group>
          </div>
        </div>
      </template>
      <NodeCanvas :graph="graph" />
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
  .toolbar { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .legend { cursor: default; }
  .legend.purple { border-color: #a855f7; color: #a855f7; background: rgba(168, 85, 247, 0.08); }
}
</style>
