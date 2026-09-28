<template>
  <main v-if="workflow" class="canvasShell">
    <header class="canvasHeader">
      <button class="brandButton" type="button" @click="router.push('/projects')">
        <span class="brandMark">C</span><span>CRUIO</span>
      </button>
      <div class="workflowIdentity">
        <button type="button" @click="backToProject">{{ projectName }}</button>
        <span>/</span>
        <strong>{{ workflow.name }}</strong>
      </div>
      <div class="canvasActions">
        <span class="saveStatus" :class="saveState">{{ saveLabel }}</span>
        <button class="primaryButton" type="button" @click="addNode">添加节点</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="toolPanel" aria-label="工作流与节点属性">
        <button class="backButton" type="button" @click="backToProject">返回项目</button>
        <p class="eyebrow">工作流画布</p>
        <h1>{{ workflow.name }}</h1>
        <p class="lede">在这里编排节点和连接。成片与其他工作流仍保留在项目详情中。</p>

        <div class="panelRule" />
        <template v-if="selectedNode">
          <p class="eyebrow">节点属性</p>
          <label class="fieldLabel">
            节点标题
            <input v-model="selectedNode.data.label" class="textInput" aria-label="节点标题" />
          </label>
        </template>
        <div v-else class="selectionHint">
          <span>未选择节点</span>
          <p>点击画布上的节点后，可在这里修改基础信息。</p>
        </div>
        <p v-if="message" class="errorMessage">{{ message }}</p>
      </aside>

      <div class="canvasPanel" aria-label="Cruio 工作流画布">
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
          <background :gap="24" patternColor="#d5d0c5" />
          <mini-map pannable zoomable />
          <div v-if="nodes.length === 0" class="canvasEmpty">
            <p class="eyebrow">空工作流</p>
            <h2>从第一个节点开始</h2>
            <p>节点类型和模型执行能力将在后续施工中接入。</p>
            <button class="primaryButton" type="button" @click="addNode">添加节点</button>
          </div>
        </vue-flow>
      </div>
    </section>
  </main>
  <main v-else class="loadingState">正在打开工作流…</main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Background } from "@vue-flow/background";
import { VueFlow, type Connection } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";
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
type Workflow = {
  id: string;
  projectId: string;
  name: string;
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  version: number;
  updatedAt: string;
};

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const projectId = String(route.params.projectId);
const workflowId = String(route.params.workflowId);
const projectName = ref("项目");
const workflow = ref<Workflow | null>(null);
const nodes = ref<CanvasNode[]>([]);
const edges = ref<CanvasEdge[]>([]);
const selectedNodeId = ref<string | null>(null);
const message = ref("");
const saveState = ref<"saved" | "saving" | "dirty" | "error">("saved");
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrating = true;
let changeRevision = 0;

const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value));
const saveLabel = computed(() => ({
  saved: "已保存",
  saving: "正在保存…",
  dirty: "等待保存…",
  error: "保存失败",
})[saveState.value]);

onMounted(async () => {
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  try {
    const [workflowResult, projectResult] = await Promise.all([
      api<{ workflow: Workflow }>(`/api/projects/${projectId}/workflows/${workflowId}`),
      api<{ project: { name: string } }>(`/api/projects/${projectId}`),
    ]);
    workflow.value = workflowResult.workflow;
    projectName.value = projectResult.project.name;
    nodes.value = workflowResult.workflow.canvas.nodes;
    edges.value = workflowResult.workflow.canvas.edges;
    window.setTimeout(() => { hydrating = false; }, 250);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法打开工作流。";
    await router.replace(`/projects/${projectId}`);
  }
});

function backToProject() {
  void router.push(`/projects/${projectId}`);
}

function addNode() {
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    position: { x: 140 + (index % 4) * 180, y: 110 + Math.floor(index / 4) * 140 },
    data: { label: `创作节点 ${index}` },
  });
}

function onConnect(connection: Connection) {
  edges.value.push({ id: crypto.randomUUID(), ...connection });
}

function onNodeClick(event: { node: { id: string } }) {
  selectedNodeId.value = event.node.id;
}

async function saveCanvas(revision: number) {
  if (!workflow.value || saveState.value === "saving") {
    scheduleSave();
    return;
  }
  saveState.value = "saving";
  try {
    const result = await api<{ workflow: Workflow }>(
      `/api/projects/${projectId}/workflows/${workflowId}/canvas`,
      {
        method: "PUT",
        body: JSON.stringify({ canvas: { nodes: nodes.value, edges: edges.value }, version: workflow.value.version }),
      },
    );
    workflow.value.version = result.workflow.version;
    workflow.value.updatedAt = result.workflow.updatedAt;
    if (changeRevision > revision) {
      saveState.value = "dirty";
      scheduleSave();
    } else {
      saveState.value = "saved";
    }
  } catch (error) {
    saveState.value = "error";
    message.value = error instanceof Error ? error.message : "保存失败。";
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  const revision = changeRevision;
  saveTimer = setTimeout(() => void saveCanvas(revision), 650);
}

watch(
  [nodes, edges],
  () => {
    if (hydrating || !workflow.value) return;
    changeRevision += 1;
    saveState.value = "dirty";
    scheduleSave();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});
</script>

<style scoped lang="scss">
.canvasShell, .loadingState { min-height: 100dvh; color: var(--cr-ink); background: var(--cr-paper); }
.canvasHeader { height: 68px; padding: 0 20px; display: grid; grid-template-columns: 210px minmax(0, 1fr) auto; align-items: center; border-bottom: 1px solid var(--cr-line); background: rgba(248,247,242,.94); }
.brandButton { width: fit-content; display: flex; align-items: center; gap: 9px; border: 0; color: var(--cr-ink); background: transparent; font: inherit; font-size: .8rem; font-weight: 800; letter-spacing: .14em; cursor: pointer; }
.brandMark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px 7px 7px 2px; color: #28222f; background: var(--cr-gradient); font-family: Georgia, serif; font-size: 1rem; letter-spacing: 0; }
.workflowIdentity { min-width: 0; display: flex; justify-content: center; gap: 9px; color: var(--cr-muted); font-size: .78rem; }
.workflowIdentity button { overflow: hidden; max-width: 220px; border: 0; color: var(--cr-muted); background: transparent; font: inherit; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.workflowIdentity strong { overflow: hidden; max-width: 260px; color: var(--cr-ink); text-overflow: ellipsis; white-space: nowrap; }
.canvasActions { display: flex; align-items: center; gap: 14px; }
.saveStatus { color: var(--cr-muted); font-size: .72rem; }
.saveStatus.saved { color: #4d6755; }
.saveStatus.error { color: var(--cr-danger); }
.primaryButton { padding: 10px 15px; border: 0; border-radius: 8px; color: #28222f; background: var(--cr-gradient); font: inherit; font-size: .78rem; font-weight: 730; cursor: pointer; transition: transform .2s, filter .2s; }
.primaryButton:hover { filter: saturate(1.08) brightness(.98); transform: translateY(-1px); }
.primaryButton:active { transform: translateY(1px); }
.workspace { height: calc(100dvh - 68px); display: grid; grid-template-columns: minmax(240px, 300px) 1fr; }
.toolPanel { overflow-y: auto; padding: 28px; border-right: 1px solid var(--cr-line); background: #f8f7f2; }
.backButton { margin: 0 0 38px; padding: 0; border: 0; color: var(--cr-violet); background: transparent; font: inherit; font-size: .76rem; font-weight: 680; cursor: pointer; }
.eyebrow { margin: 0 0 12px; color: var(--cr-violet); font-size: .67rem; font-weight: 760; letter-spacing: .13em; text-transform: uppercase; }
h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.35rem; font-weight: 500; letter-spacing: -.04em; line-height: .98; }
.lede, .selectionHint p { color: var(--cr-muted); font-size: .84rem; line-height: 1.65; }
.lede { margin: 18px 0 0; }
.panelRule { height: 1px; margin: 30px 0; background: var(--cr-line); }
.fieldLabel { display: grid; gap: 8px; font-size: .76rem; font-weight: 680; }
.textInput { width: 100%; padding: 11px 12px; border: 1px solid var(--cr-line); border-radius: 8px; color: var(--cr-ink); background: #fffef9; font: inherit; }
.textInput:focus { outline: 3px solid rgba(122,115,253,.16); border-color: var(--cr-violet); }
.selectionHint span { font-size: .8rem; font-weight: 700; }
.selectionHint p { margin: 8px 0 0; }
.errorMessage { color: var(--cr-danger); font-size: .8rem; line-height: 1.5; }
.canvasPanel { min-width: 0; background: #f4f2ec; }
.vue-flow { height: 100%; }
.canvasEmpty { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; justify-items: center; pointer-events: none; text-align: center; }
.canvasEmpty h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.5rem; font-weight: 500; letter-spacing: -.04em; }
.canvasEmpty p:not(.eyebrow) { margin: 14px 0 22px; color: var(--cr-muted); }
.canvasEmpty button { pointer-events: auto; }
:deep(.vue-flow__node) { min-width: 150px; padding: 13px 16px; border: 1px solid #b8b2a7; border-radius: 9px 9px 9px 3px; color: var(--cr-ink); background: #fffef9; box-shadow: 0 10px 30px rgba(72,64,52,.08); }
:deep(.vue-flow__node.selected) { border-color: var(--cr-violet); box-shadow: 0 0 0 3px rgba(122,115,253,.13); }
.loadingState { display: grid; place-items: center; color: var(--cr-muted); }

@media (max-width: 760px) {
  .canvasHeader { grid-template-columns: 1fr auto; }
  .workflowIdentity { display: none; }
  .workspace { height: auto; min-height: calc(100dvh - 68px); grid-template-columns: 1fr; grid-template-rows: auto minmax(560px, 1fr); }
  .toolPanel { border-right: 0; border-bottom: 1px solid var(--cr-line); }
}
</style>
