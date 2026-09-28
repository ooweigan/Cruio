<template>
  <main class="appShell">
    <header class="topBar">
      <div>
        <span class="wordmark">CRUIO</span>
        <span class="phase">V1 · CP1 画布基座</span>
      </div>
      <button type="button" class="primaryAction" @click="addNode">添加节点</button>
    </header>

    <section class="workspace">
      <aside class="sidePanel" aria-label="画布说明与节点属性">
        <p class="eyebrow">创作工作区</p>
        <h1>把想法放到画布上</h1>
        <p class="lede">拖动节点、连接端口，或选中节点修改标题。此阶段只验证 Vue Flow Web 画布基座。</p>

        <label v-if="selectedNode" class="fieldLabel">
          节点标题
          <input v-model="selectedNode.data.label" class="textInput" aria-label="节点标题" />
        </label>
        <p v-else class="selectionHint">选择一个节点后可编辑标题。</p>
      </aside>

      <div class="canvasPanel" aria-label="Cruio 创作画布">
        <vue-flow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :fitViewOnInit="true"
          :minZoom="0.25"
          :maxZoom="2"
          @connect="onConnect"
          @nodeClick="onNodeClick"
          @paneClick="selectedNodeId = null"
        >
          <background :gap="24" patternColor="#d8d4ca" />
          <mini-map pannable zoomable />
        </vue-flow>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Background } from "@vue-flow/background";
import { VueFlow, type Connection } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";

type CanvasNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label: string };
};

type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

const nodes = ref<CanvasNode[]>([
  { id: "brief", type: "input", position: { x: 80, y: 120 }, data: { label: "创作意图" } },
  { id: "shot", position: { x: 360, y: 230 }, data: { label: "镜头草稿" } },
  { id: "result", type: "output", position: { x: 650, y: 120 }, data: { label: "结果候选" } },
]);
const edges = ref<CanvasEdge[]>([
  { id: "brief-shot", source: "brief", target: "shot" },
  { id: "shot-result", source: "shot", target: "result" },
]);
const selectedNodeId = ref<string | null>(null);
const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value));

function addNode() {
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    position: { x: 160 + index * 32, y: 100 + index * 28 },
    data: { label: `创作节点 ${index}` },
  });
}

function onConnect(connection: Connection) {
  edges.value.push({ id: crypto.randomUUID(), ...connection });
}

function onNodeClick(event: { node: { id: string } }) {
  selectedNodeId.value = event.node.id;
}
</script>

<style scoped lang="scss">
.appShell {
  min-height: 100vh;
  color: #1d211b;
  background: #efede7;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.topBar {
  height: 68px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #d8d4ca;
  background: rgba(248, 247, 242, 0.92);
}

.wordmark {
  margin-right: 14px;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.phase {
  color: #6c7067;
  font-size: 0.82rem;
}

.primaryAction {
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  color: #f7f6ef;
  background: #1f5d42;
  cursor: pointer;
}

.workspace {
  height: calc(100vh - 68px);
  display: grid;
  grid-template-columns: minmax(240px, 310px) 1fr;
}

.sidePanel {
  padding: 44px 30px;
  border-right: 1px solid #d8d4ca;
  background: #f8f7f2;
}

.eyebrow {
  margin: 0 0 12px;
  color: #1f5d42;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2rem, 3vw, 3rem);
  font-weight: 500;
  line-height: 0.98;
}

.lede,
.selectionHint {
  color: #6c7067;
  line-height: 1.65;
}

.lede {
  margin: 22px 0 38px;
}

.fieldLabel {
  display: grid;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 700;
}

.textInput {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid #c9c4b8;
  border-radius: 8px;
  background: #fff;
  font: inherit;
}

.canvasPanel {
  min-width: 0;
  background: #f4f2ec;
}

.vue-flow {
  height: 100%;
}

:deep(.vue-flow__node) {
  min-width: 150px;
  padding: 13px 16px;
  border: 1px solid #b7b1a4;
  border-radius: 10px;
  color: #1d211b;
  background: #fffef9;
  box-shadow: 0 8px 24px rgba(50, 46, 38, 0.08);
}

:deep(.vue-flow__node.selected) {
  border-color: #1f5d42;
  box-shadow: 0 0 0 2px rgba(31, 93, 66, 0.14);
}

@media (max-width: 760px) {
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(520px, 1fr);
  }

  .sidePanel {
    padding: 24px;
    border-right: 0;
    border-bottom: 1px solid #d8d4ca;
  }

  .lede {
    margin-bottom: 18px;
  }
}
</style>
