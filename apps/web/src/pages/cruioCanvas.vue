<template>
  <main v-if="workflow" class="canvasShell">
    <header class="canvasHeader">
      <button class="brandButton" type="button" @click="router.push('/projects')">
        <span class="brandMark">C</span><span>CRUIO</span>
      </button>
      <div class="workflowIdentity">
        <button type="button" @click="goBack">{{ isProjectCanvas ? "项目" : "工作流库" }}</button>
        <span>/</span>
        <strong>{{ workflow.name }}</strong>
      </div>
      <div class="canvasActions">
        <span class="saveStatus" :class="saveState">{{ saveLabel }}</span>
        <button v-if="saveState === 'error'" class="textButton" type="button" @click="saveCanvas(changeRevision)">重试保存</button>
        <div ref="nodePickerAnchor" class="nodePickerAnchor">
          <button ref="nodePickerTrigger" class="primaryButton" type="button" aria-haspopup="dialog" :aria-expanded="showNodePicker" aria-controls="nodePicker" @click="toggleNodePicker">添加节点</button>
          <section v-if="showNodePicker" id="nodePicker" class="nodePicker" role="dialog" aria-label="选择节点类型">
            <div class="pickerHeading">
              <div><span>节点库</span><h2>添加到画布</h2></div>
              <button class="pickerClose" type="button" aria-label="关闭节点库" @click="closeNodePicker">×</button>
            </div>
            <template v-if="pickerView === 'types'">
              <button class="nodeChoice" type="button" @click="addNode">
                <span class="choiceMark">T</span>
                <span><strong>创作节点</strong><small>记录想法和创作步骤，不会发起生成</small></span>
                <span class="choiceArrow">↗</span>
              </button>
              <button v-if="isProjectCanvas" class="nodeChoice" type="button" @click="showWorkflowChoices">
                <span class="choiceMark referenceMark">◇</span>
                <span><strong>工作流引用</strong><small>把项目已引入的工作流放入画布</small></span>
                <span class="choiceArrow">›</span>
              </button>
              <p class="pickerFootnote">其他节点类型将在对应能力接入后开放。</p>
            </template>
            <template v-else>
              <button class="pickerBack" type="button" @click="showNodeTypes">← 返回节点类型</button>
              <div v-if="bindings.length" class="workflowChoices">
                <button v-for="binding in bindings" :key="binding.id" type="button" @click="addWorkflowReference(binding.id)">
                  <strong>{{ binding.name }}</strong><small>项目引用 v{{ binding.version }}</small>
                </button>
              </div>
              <div v-else class="pickerEmpty">
                <p>这个项目还没有引入工作流。</p>
                <button type="button" @click="router.push(`/projects/${projectId}`)">返回项目引入工作流</button>
              </div>
            </template>
          </section>
        </div>
      </div>
    </header>

    <section class="workspace">
      <aside class="toolPanel" aria-label="画布与节点属性">
        <button class="backButton" type="button" @click="goBack">{{ isProjectCanvas ? "返回项目" : "返回工作流库" }}</button>
        <p class="eyebrow">{{ isProjectCanvas ? "项目画布" : "工作流图" }}</p>
        <h1>{{ workflow.name }}</h1>
        <p class="lede">{{ isProjectCanvas ? "在这里整理项目内容。工作流在独立的工作流库中编辑。" : "在这里编排可供多个项目引入的节点和连接。保存后形成新版本。" }}</p>

        <div class="panelRule" />
        <template v-if="selectedNode">
          <p class="eyebrow">节点属性</p>
          <div v-if="selectedNode.type === 'workflowReference'" class="referenceDetails">
            <strong>{{ bindingFor(selectedNode.data.workflowId)?.name ?? selectedNode.data.label }}</strong>
            <span>项目引用 v{{ bindingFor(selectedNode.data.workflowId)?.version ?? "?" }}</span>
            <button v-if="bindingFor(selectedNode.data.workflowId)" class="linkButton" type="button" @click="openSourceWorkflow(selectedNode.data.workflowId)">编辑源工作流</button>
          </div>
          <label v-else class="fieldLabel">
            节点标题
            <input v-model="selectedNode.data.label" class="textInput" aria-label="节点标题" />
          </label>
          <button class="dangerButton" type="button" @click="removeSelectedNode">移除节点</button>
        </template>
        <template v-else-if="selectedEdgeId">
          <p class="eyebrow">连接</p>
          <p class="selectionHint">已选中一条连接。</p>
          <button class="dangerButton" type="button" @click="removeSelectedEdge">移除连接</button>
        </template>
        <div v-else class="selectionHint">
          <span>未选择节点</span>
          <p>点击画布上的节点后，可在这里修改基础信息。</p>
        </div>
        <p v-if="message" class="errorMessage">{{ message }}</p>
      </aside>

      <div class="canvasPanel" :aria-label="isProjectCanvas ? 'Cruio 项目画布' : 'Cruio 工作流图'">
        <vue-flow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :minZoom="0.25"
          :maxZoom="2"
          @connect="onConnect"
          @nodesInitialized="frameCanvas"
          @nodeClick="onNodeClick"
          @edgeClick="onEdgeClick"
          @paneClick="clearSelection"
        >
          <template #node-workflowReference="{ data }">
            <div class="workflowReferenceNode">
              <handle type="target" :position="Position.Left" />
              <span>工作流引用</span>
              <strong>{{ bindingFor(data.workflowId)?.name ?? data.label }}</strong>
              <small>项目引用 v{{ bindingFor(data.workflowId)?.version ?? "?" }}</small>
              <handle type="source" :position="Position.Right" />
            </div>
          </template>
          <template #node-basicNode="{ data }">
            <div class="basicNode">
              <handle type="target" :position="Position.Left" />
              <span>{{ data.label }}</span>
              <handle type="source" :position="Position.Right" />
            </div>
          </template>
          <background :gap="24" patternColor="#d5d0c5" />
          <mini-map pannable zoomable />
          <div v-if="nodes.length === 0" class="canvasEmpty">
            <p class="eyebrow">{{ isProjectCanvas ? "空项目画布" : "空工作流" }}</p>
            <h2>从第一个节点开始</h2>
            <p>先选择节点类型，再放入画布。</p>
            <button class="primaryButton" type="button" @pointerdown.stop @click="openNodePicker">选择节点</button>
          </div>
        </vue-flow>
      </div>
    </section>
  </main>
  <main v-else class="loadingState">正在打开画布…</main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { Background } from "@vue-flow/background";
import { Handle, Position, VueFlow, useVueFlow, type Connection } from "@vue-flow/core";
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
  data: { label: string; workflowId?: string };
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
  name: string;
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  version: number;
  updatedAt: string;
};
type WorkflowBinding = { id: string; name: string; version: number };

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const { fitView } = useVueFlow();
const isProjectCanvas = computed(() => route.name === "project-canvas");
const projectId = computed(() => String(route.params.projectId ?? ""));
const workflowId = computed(() => String(route.params.workflowId ?? ""));
const workflow = ref<Workflow | null>(null);
const bindings = ref<WorkflowBinding[]>([]);
const showNodePicker = ref(false);
const pickerView = ref<"types" | "workflows">("types");
const nodePickerAnchor = ref<HTMLElement | null>(null);
const nodePickerTrigger = ref<HTMLButtonElement | null>(null);
const nodes = ref<CanvasNode[]>([]);
const edges = ref<CanvasEdge[]>([]);
const selectedNodeId = ref<string | null>(null);
const selectedEdgeId = ref<string | null>(null);
const message = ref("");
const saveState = ref<"saved" | "saving" | "dirty" | "error">("saved");
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrating = true;
let changeRevision = 0;
let loadRevision = 0;
let ready = false;

const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value));
const canvasSnapshot = computed(() => JSON.stringify({
  nodes: nodes.value.map((node) => ({
    id: node.id,
    ...(node.type ? { type: node.type } : {}),
    position: node.position,
    data: node.data,
  })),
  edges: edges.value.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
  })),
}));
const saveLabel = computed(() => ({
  saved: "已保存",
  saving: "正在保存…",
  dirty: "等待保存…",
  error: "保存失败",
})[saveState.value]);

onMounted(async () => {
  document.addEventListener("pointerdown", closePickerOutside);
  window.addEventListener("keydown", closePickerOnEscape);
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  ready = true;
  await loadCanvas();
});

watch(() => route.fullPath, () => {
  if (ready) void loadCanvas();
});

async function guardCanvasNavigation() {
  if (saveState.value === "dirty") await saveCanvas(changeRevision);
  if (saveState.value !== "saved") {
    message.value = "画布尚未保存，请等待保存完成或重试后再离开。";
    return false;
  }
  return true;
}

onBeforeRouteUpdate(guardCanvasNavigation);
onBeforeRouteLeave(guardCanvasNavigation);

async function loadCanvas() {
  const revision = ++loadRevision;
  if (saveTimer) clearTimeout(saveTimer);
  closeNodePicker();
  hydrating = true;
  workflow.value = null;
  bindings.value = [];
  nodes.value = [];
  edges.value = [];
  clearSelection();
  saveState.value = "saved";
  message.value = "";
  try {
    const result = isProjectCanvas.value
      ? await api<{ project: Workflow & { workflows: WorkflowBinding[] } }>(`/api/projects/${projectId.value}`)
      : await api<{ workflow: Workflow }>(`/api/workflows/${workflowId.value}`);
    if (revision !== loadRevision) return;
    const document = "project" in result ? result.project : result.workflow;
    bindings.value = "project" in result ? result.project.workflows : [];
    workflow.value = document;
    nodes.value = document.canvas.nodes;
    edges.value = document.canvas.edges;
    window.setTimeout(() => { if (revision === loadRevision) hydrating = false; }, 250);
  } catch (error) {
    if (revision !== loadRevision) return;
    message.value = error instanceof Error ? error.message : "无法打开画布。";
    await router.replace(isProjectCanvas.value ? `/projects/${projectId.value}` : "/workflows");
  }
}

function goBack() {
  void router.push(isProjectCanvas.value ? `/projects/${projectId.value}` : "/workflows");
}

function frameCanvas() {
  void nextTick().then(() => fitView({ padding: 0.2, maxZoom: 1 }));
}

function openNodePicker() {
  pickerView.value = "types";
  showNodePicker.value = true;
  void nextTick().then(() => nodePickerAnchor.value?.querySelector<HTMLButtonElement>(".nodeChoice")?.focus());
}

function closeNodePicker() {
  showNodePicker.value = false;
  pickerView.value = "types";
}

function toggleNodePicker() {
  if (showNodePicker.value) closeNodePicker();
  else openNodePicker();
}

function showWorkflowChoices() {
  pickerView.value = "workflows";
  void nextTick().then(() => nodePickerAnchor.value?.querySelector<HTMLButtonElement>(".workflowChoices button, .pickerBack")?.focus());
}

function showNodeTypes() {
  pickerView.value = "types";
  void nextTick().then(() => nodePickerAnchor.value?.querySelector<HTMLButtonElement>(".nodeChoice")?.focus());
}

function closePickerOutside(event: PointerEvent) {
  if (showNodePicker.value && !nodePickerAnchor.value?.contains(event.target as Node)) closeNodePicker();
}

function closePickerOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !showNodePicker.value) return;
  closeNodePicker();
  nodePickerTrigger.value?.focus();
}

function addNode() {
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    type: "basicNode",
    position: { x: 140 + (index % 4) * 260, y: 110 + Math.floor(index / 4) * 160 },
    data: { label: `创作节点 ${index}` },
  });
  closeNodePicker();
}

function addWorkflowReference(id: string) {
  const binding = bindingFor(id);
  if (!binding) return;
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    type: "workflowReference",
    position: { x: 140 + (index % 4) * 260, y: 110 + Math.floor(index / 4) * 160 },
    data: { label: binding.name, workflowId: binding.id },
  });
  closeNodePicker();
}

function bindingFor(id?: string) {
  return bindings.value.find((binding) => binding.id === id);
}

function openSourceWorkflow(id?: string) {
  if (id && bindingFor(id)) void router.push(`/workflows/${id}`);
}

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target || connection.source === connection.target) return;
  if (edges.value.some((edge) => edge.source === connection.source && edge.target === connection.target &&
    edge.sourceHandle === connection.sourceHandle && edge.targetHandle === connection.targetHandle)) return;
  edges.value.push({ id: crypto.randomUUID(), ...connection });
}

function onNodeClick(event: { node: { id: string } }) {
  selectedNodeId.value = event.node.id;
  selectedEdgeId.value = null;
}

function onEdgeClick(event: { edge: { id: string } }) {
  selectedEdgeId.value = event.edge.id;
  selectedNodeId.value = null;
}

function clearSelection() {
  selectedNodeId.value = null;
  selectedEdgeId.value = null;
}

function removeSelectedNode() {
  const id = selectedNodeId.value;
  if (!id) return;
  nodes.value = nodes.value.filter((node) => node.id !== id);
  edges.value = edges.value.filter((edge) => edge.source !== id && edge.target !== id);
  clearSelection();
}

function removeSelectedEdge() {
  edges.value = edges.value.filter((edge) => edge.id !== selectedEdgeId.value);
  clearSelection();
}

async function saveCanvas(revision: number) {
  if (!workflow.value || saveState.value === "saving") {
    scheduleSave();
    return;
  }
  const currentWorkflow = workflow.value;
  const endpoint = isProjectCanvas.value ? `/api/projects/${projectId.value}/canvas` : `/api/workflows/${workflowId.value}/canvas`;
  saveState.value = "saving";
  try {
    const result = await api<{ project: Workflow } | { workflow: Workflow }>(
      endpoint,
      {
        method: "PUT",
        body: JSON.stringify({ canvas: JSON.parse(canvasSnapshot.value), version: currentWorkflow.version }),
      },
    );
    if (workflow.value !== currentWorkflow) return;
    const saved = "project" in result ? result.project : result.workflow;
    workflow.value.version = saved.version;
    workflow.value.updatedAt = saved.updatedAt;
    if (changeRevision > revision) {
      saveState.value = "dirty";
      scheduleSave();
    } else {
      saveState.value = "saved";
    }
  } catch (error) {
    if (workflow.value !== currentWorkflow) return;
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
  canvasSnapshot,
  () => {
    if (hydrating || !workflow.value) return;
    changeRevision += 1;
    saveState.value = "dirty";
    scheduleSave();
  },
);

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  document.removeEventListener("pointerdown", closePickerOutside);
  window.removeEventListener("keydown", closePickerOnEscape);
});
</script>

<style scoped lang="scss">
.canvasShell, .loadingState { min-height: 100dvh; color: var(--cr-ink); background: var(--cr-paper); }
.canvasHeader { position: relative; z-index: 5; height: 68px; padding: 0 20px; display: grid; grid-template-columns: 210px minmax(0, 1fr) auto; align-items: center; border-bottom: 1px solid var(--cr-line); background: rgba(248,247,242,.94); }
.brandButton { width: fit-content; display: flex; align-items: center; gap: 9px; border: 0; color: var(--cr-ink); background: transparent; font: inherit; font-size: .8rem; font-weight: 800; letter-spacing: .14em; cursor: pointer; }
.brandMark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px 7px 7px 2px; color: #28222f; background: var(--cr-gradient); font-family: Georgia, serif; font-size: 1rem; letter-spacing: 0; }
.workflowIdentity { min-width: 0; display: flex; justify-content: center; gap: 9px; color: var(--cr-muted); font-size: .78rem; }
.workflowIdentity button { overflow: hidden; max-width: 220px; border: 0; color: var(--cr-muted); background: transparent; font: inherit; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.workflowIdentity strong { overflow: hidden; max-width: 260px; color: var(--cr-ink); text-overflow: ellipsis; white-space: nowrap; }
.canvasActions { display: flex; align-items: center; gap: 14px; }
.saveStatus { color: var(--cr-muted); font-size: .72rem; }
.saveStatus.saved { color: #4d6755; }
.saveStatus.error { color: var(--cr-danger); }
.textButton { padding: 6px 0; border: 0; color: var(--cr-violet); background: transparent; font: inherit; font-size: .76rem; font-weight: 680; cursor: pointer; }
.primaryButton { padding: 10px 15px; border: 0; border-radius: 8px; color: #28222f; background: var(--cr-gradient); font: inherit; font-size: .78rem; font-weight: 730; cursor: pointer; transition: transform .2s, filter .2s; }
.primaryButton:hover { filter: saturate(1.08) brightness(.98); transform: translateY(-1px); }
.primaryButton:active { transform: translateY(1px); }
.nodePickerAnchor { position: relative; }
.nodePicker { position: absolute; top: calc(100% + 12px); right: 0; width: min(350px, calc(100vw - 24px)); padding: 16px; border: 1px solid var(--cr-line); border-radius: 14px; background: #fff; box-shadow: 0 18px 46px rgba(52, 49, 76, .13); }
.pickerHeading { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.pickerHeading span { color: var(--cr-violet); font-size: .65rem; font-weight: 750; letter-spacing: .12em; }
.pickerHeading h2 { margin: 4px 0 0; font-size: 1.05rem; font-weight: 700; }
.pickerClose { width: 28px; height: 28px; border: 0; border-radius: 7px; color: var(--cr-muted); background: transparent; font: inherit; font-size: 1.3rem; line-height: 1; cursor: pointer; }
.pickerClose:hover, .pickerBack:hover { background: #f4f2f8; }
.nodeChoice { width: 100%; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 11px; margin-top: 4px; padding: 11px 9px; border: 0; border-radius: 9px; color: var(--cr-ink); background: transparent; font: inherit; text-align: left; cursor: pointer; transition: background .18s, transform .18s; }
.nodeChoice:hover, .workflowChoices button:hover { background: #f5f4fb; }
.nodeChoice:active, .workflowChoices button:active { transform: scale(.99); }
.nodeChoice strong, .nodeChoice small, .workflowChoices strong, .workflowChoices small { display: block; }
.nodeChoice strong, .workflowChoices strong { font-size: .79rem; font-weight: 700; }
.nodeChoice small, .workflowChoices small { margin-top: 3px; color: var(--cr-muted); font-size: .69rem; line-height: 1.4; }
.choiceMark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; color: #655d52; background: #f8f0d9; font-family: Georgia, serif; font-size: .9rem; }
.choiceMark.referenceMark { color: #6259cc; background: #eeecff; font-family: inherit; }
.choiceArrow { color: var(--cr-muted); font-size: .95rem; }
.pickerFootnote { margin: 14px 4px 2px; color: var(--cr-muted); font-size: .68rem; line-height: 1.5; }
.pickerBack { width: 100%; margin: 0 0 8px; padding: 8px; border: 0; border-radius: 7px; color: var(--cr-violet); background: transparent; font: inherit; font-size: .74rem; text-align: left; cursor: pointer; }
.workflowChoices { max-height: 270px; overflow: auto; }
.workflowChoices button { width: 100%; padding: 11px 10px; border: 0; border-radius: 9px; color: var(--cr-ink); background: transparent; font: inherit; text-align: left; cursor: pointer; transition: background .18s, transform .18s; }
.pickerEmpty { padding: 8px; color: var(--cr-muted); font-size: .76rem; }
.pickerEmpty button { padding: 8px 0; border: 0; color: var(--cr-violet); background: transparent; font: inherit; font-size: .74rem; font-weight: 700; cursor: pointer; }
.nodePicker :is(button, select):focus-visible, .primaryButton:focus-visible { outline: 3px solid rgba(122,115,253,.28); outline-offset: 2px; }
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
.referenceDetails { display: grid; gap: 7px; font-size: .84rem; }
.referenceDetails span { color: var(--cr-muted); font-size: .75rem; }
.linkButton { justify-self: start; padding: 7px 0; border: 0; color: var(--cr-violet); background: transparent; font: inherit; font-size: .76rem; font-weight: 680; cursor: pointer; }
.dangerButton { margin-top: 20px; padding: 8px 11px; border: 1px solid #d9b9b6; border-radius: 8px; color: var(--cr-danger); background: transparent; font: inherit; font-size: .76rem; font-weight: 680; cursor: pointer; }
.errorMessage { color: var(--cr-danger); font-size: .8rem; line-height: 1.5; }
.canvasPanel { min-width: 0; background: #f4f2ec; }
.vue-flow { height: 100%; }
.canvasEmpty { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; justify-items: center; pointer-events: none; text-align: center; }
.canvasEmpty h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.5rem; font-weight: 500; letter-spacing: -.04em; }
.canvasEmpty p:not(.eyebrow) { margin: 14px 0 22px; color: var(--cr-muted); }
.canvasEmpty button { pointer-events: auto; }
:deep(.vue-flow__node) { min-width: 150px; padding: 13px 16px; border: 1px solid #b8b2a7; border-radius: 9px 9px 9px 3px; color: var(--cr-ink); background: #fffef9; box-shadow: 0 10px 30px rgba(72,64,52,.08); }
:deep(.vue-flow__node.selected) { border-color: var(--cr-violet); box-shadow: 0 0 0 3px rgba(122,115,253,.13); }
:deep(.vue-flow__node-workflowReference) { border-color: #a9a4e2; background: #f8f7ff; }
.workflowReferenceNode { min-width: 170px; display: grid; gap: 7px; }
.workflowReferenceNode > span { color: var(--cr-violet); font-size: .64rem; font-weight: 760; letter-spacing: .08em; }
.workflowReferenceNode > strong { font-size: .88rem; line-height: 1.3; }
.workflowReferenceNode > small { color: var(--cr-muted); font-size: .7rem; }
.basicNode { min-width: 170px; font-size: .85rem; font-weight: 680; line-height: 1.3; }
.loadingState { display: grid; place-items: center; color: var(--cr-muted); }

@media (max-width: 760px) {
  .canvasHeader { grid-template-columns: 1fr auto; }
  .workflowIdentity { display: none; }
  .workspace { height: auto; min-height: calc(100dvh - 68px); grid-template-columns: 1fr; grid-template-rows: auto minmax(560px, 1fr); }
  .toolPanel { border-right: 0; border-bottom: 1px solid var(--cr-line); }
}
</style>
