<template>
  <main v-if="booting" class="centeredState">正在连接 Cruio…</main>

  <main v-else-if="!user" class="authShell">
    <section class="authCard">
      <p class="wordmark">CRUIO</p>
      <p class="eyebrow">V1 · 本地开发环境</p>
      <h1>{{ authMode === "login" ? "继续你的创作" : "建立本地账户" }}</h1>
      <p class="lede">账户、项目与画布将保存至 Cruio 的本地 PostgreSQL。</p>
      <form class="authForm" @submit.prevent="submitAuth">
        <label>
          邮箱
          <input v-model.trim="authEmail" type="email" autocomplete="email" required />
        </label>
        <label>
          密码
          <input
            v-model="authPassword"
            type="password"
            :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
            minlength="8"
            required
          />
        </label>
        <p v-if="message" class="message errorMessage">{{ message }}</p>
        <button class="primaryAction" type="submit" :disabled="working">
          {{ working ? "请稍候…" : authMode === "login" ? "登录" : "创建账户" }}
        </button>
      </form>
      <button class="textAction" type="button" @click="toggleAuthMode">
        {{ authMode === "login" ? "没有账户？创建一个" : "已有账户？返回登录" }}
      </button>
    </section>
  </main>

  <main v-else class="appShell">
    <header class="topBar">
      <div>
        <span class="wordmark">CRUIO</span>
        <span class="phase">V1 · CP2 持久化画布</span>
      </div>
      <div class="accountArea">
        <span>{{ user.email }}</span>
        <button type="button" class="textAction" @click="logout">退出</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="sidePanel" aria-label="项目与节点属性">
        <p class="eyebrow">个人项目</p>
        <form class="newProjectForm" @submit.prevent="createProject">
          <input v-model.trim="newProjectName" maxlength="120" placeholder="新项目名称" aria-label="新项目名称" />
          <button type="submit" class="smallAction" :disabled="working || !newProjectName">创建</button>
        </form>

        <nav class="projectList" aria-label="项目列表">
          <button
            v-for="projectItem in projects"
            :key="projectItem.id"
            type="button"
            :class="{ active: projectItem.id === project?.id }"
            @click="openProject(projectItem.id)"
          >
            <strong>{{ projectItem.name }}</strong>
            <span>v{{ projectItem.version }}</span>
          </button>
          <p v-if="projects.length === 0" class="selectionHint">创建第一个项目，开始一条可恢复的创作流程。</p>
        </nav>

        <template v-if="project">
          <div class="sectionRule" />
          <p class="eyebrow">当前项目</p>
          <h1>{{ project.name }}</h1>
          <p class="saveStatus" :class="saveState">{{ saveLabel }}</p>
          <button type="button" class="primaryAction fullWidth" @click="addNode">添加节点</button>

          <label v-if="selectedNode" class="fieldLabel">
            节点标题
            <input v-model="selectedNode.data.label" class="textInput" aria-label="节点标题" />
          </label>
          <p v-else class="selectionHint">选择一个节点后可编辑标题。</p>
        </template>
        <p v-if="message" class="message errorMessage">{{ message }}</p>
      </aside>

      <div v-if="project" class="canvasPanel" aria-label="Cruio 创作画布">
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
      <div v-else class="emptyCanvas">
        <p class="eyebrow">工作区就绪</p>
        <h2>选择或创建一个项目</h2>
        <p>画布内容会由服务端保存，不依赖浏览器内存作为事实来源。</p>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Background } from "@vue-flow/background";
import { VueFlow, type Connection } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";

type User = { id: string; email: string };
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
type Canvas = { nodes: CanvasNode[]; edges: CanvasEdge[] };
type ProjectSummary = { id: string; name: string; version: number; updatedAt: string };
type Project = ProjectSummary & { canvas: Canvas; createdAt: string };

const route = useRoute();
const router = useRouter();
const booting = ref(true);
const working = ref(false);
const user = ref<User | null>(null);
const projects = ref<ProjectSummary[]>([]);
const project = ref<Project | null>(null);
const nodes = ref<CanvasNode[]>([]);
const edges = ref<CanvasEdge[]>([]);
const selectedNodeId = ref<string | null>(null);
const authMode = ref<"login" | "register">("login");
const authEmail = ref("");
const authPassword = ref("");
const newProjectName = ref("");
const message = ref("");
const saveState = ref<"saved" | "saving" | "dirty" | "error">("saved");
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrating = false;

const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value));
const saveLabel = computed(() => ({
  saved: "已保存至 PostgreSQL",
  saving: "正在保存…",
  dirty: "等待保存…",
  error: "保存失败，请重试",
})[saveState.value]);

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.message ?? "请求失败。");
  return payload as T;
}

async function refreshProjects() {
  const result = await api<{ projects: ProjectSummary[] }>("/api/projects");
  projects.value = result.projects;
}

async function loadProject(projectId: string) {
  if (saveTimer) clearTimeout(saveTimer);
  message.value = "";
  hydrating = true;
  try {
    const result = await api<{ project: Project }>(`/api/projects/${projectId}`);
    project.value = result.project;
    nodes.value = result.project.canvas.nodes;
    edges.value = result.project.canvas.edges;
    selectedNodeId.value = null;
    saveState.value = "saved";
    await nextTick();
  } catch (error) {
    project.value = null;
    message.value = error instanceof Error ? error.message : "项目打开失败。";
  } finally {
    hydrating = false;
  }
}

async function submitAuth() {
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ user: User }>(`/api/auth/${authMode.value}`, {
      method: "POST",
      body: JSON.stringify({ email: authEmail.value, password: authPassword.value }),
    });
    user.value = result.user;
    authPassword.value = "";
    await refreshProjects();
    const projectId = typeof route.params.projectId === "string" ? route.params.projectId : projects.value[0]?.id;
    if (projectId) await openProject(projectId);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "登录失败。";
  } finally {
    working.value = false;
  }
}

function toggleAuthMode() {
  authMode.value = authMode.value === "login" ? "register" : "login";
  message.value = "";
}

async function logout() {
  if (saveState.value === "dirty") await saveCanvas();
  await api<null>("/api/auth/logout", { method: "POST" });
  user.value = null;
  projects.value = [];
  project.value = null;
  await router.replace("/");
}

function initialCanvas(): Canvas {
  return {
    nodes: [
      { id: "brief", type: "input", position: { x: 80, y: 120 }, data: { label: "创作意图" } },
      { id: "shot", position: { x: 360, y: 230 }, data: { label: "镜头草稿" } },
      { id: "result", type: "output", position: { x: 650, y: 120 }, data: { label: "结果候选" } },
    ],
    edges: [
      { id: "brief-shot", source: "brief", target: "shot" },
      { id: "shot-result", source: "shot", target: "result" },
    ],
  };
}

async function createProject() {
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: newProjectName.value, canvas: initialCanvas() }),
    });
    newProjectName.value = "";
    await refreshProjects();
    await openProject(result.project.id);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "项目创建失败。";
  } finally {
    working.value = false;
  }
}

async function openProject(projectId: string) {
  if (project.value?.id === projectId) return;
  await router.push(`/projects/${projectId}`);
}

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

async function saveCanvas() {
  if (!project.value || saveState.value === "saving") return;
  saveState.value = "saving";
  try {
    const result = await api<{ project: Project }>(`/api/projects/${project.value.id}/canvas`, {
      method: "PUT",
      body: JSON.stringify({
        canvas: { nodes: nodes.value, edges: edges.value },
        version: project.value.version,
      }),
    });
    project.value.version = result.project.version;
    project.value.updatedAt = result.project.updatedAt;
    const summary = projects.value.find(({ id }) => id === result.project.id);
    if (summary) Object.assign(summary, { version: result.project.version, updatedAt: result.project.updatedAt });
    saveState.value = "saved";
  } catch (error) {
    saveState.value = "error";
    message.value = error instanceof Error ? error.message : "保存失败。";
  }
}

watch(
  [nodes, edges],
  () => {
    if (hydrating || !project.value) return;
    saveState.value = "dirty";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveCanvas(), 600);
  },
  { deep: true },
);

watch(
  () => route.params.projectId,
  async (projectId) => {
    if (user.value && typeof projectId === "string" && projectId !== project.value?.id) {
      await loadProject(projectId);
    }
  },
);

onMounted(async () => {
  try {
    user.value = (await api<{ user: User }>("/api/auth/me")).user;
    await refreshProjects();
    const projectId = typeof route.params.projectId === "string" ? route.params.projectId : projects.value[0]?.id;
    if (projectId) {
      if (!route.params.projectId) await router.replace(`/projects/${projectId}`);
      await loadProject(projectId);
    }
  } catch {
    user.value = null;
  } finally {
    booting.value = false;
  }
});

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});
</script>

<style scoped lang="scss">
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; }

.appShell, .authShell, .centeredState {
  min-height: 100vh;
  color: #1d211b;
  background: #efede7;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.centeredState, .authShell { display: grid; place-items: center; }
.authShell { padding: 24px; background: radial-gradient(circle at 20% 10%, #dfe9d9, transparent 36%), #efede7; }
.authCard { width: min(440px, 100%); padding: 42px; border: 1px solid #d8d4ca; border-radius: 18px; background: #f8f7f2; box-shadow: 0 24px 80px rgba(50, 46, 38, .12); }
.authCard h1 { margin-top: 10px; }
.authForm { display: grid; gap: 16px; margin-top: 28px; }
.authForm label, .fieldLabel { display: grid; gap: 8px; font-size: .78rem; font-weight: 700; }
.authForm input, .newProjectForm input, .textInput { width: 100%; padding: 11px 12px; border: 1px solid #c9c4b8; border-radius: 8px; background: #fff; font: inherit; }

.topBar { height: 68px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #d8d4ca; background: rgba(248,247,242,.94); }
.wordmark { margin: 0 14px 0 0; font-size: 1.05rem; font-weight: 800; letter-spacing: .18em; }
.phase, .accountArea { color: #6c7067; font-size: .82rem; }
.accountArea { display: flex; align-items: center; gap: 14px; }
.workspace { height: calc(100vh - 68px); display: grid; grid-template-columns: minmax(260px, 320px) 1fr; }
.sidePanel { overflow-y: auto; padding: 30px; border-right: 1px solid #d8d4ca; background: #f8f7f2; }
.eyebrow { margin: 0 0 12px; color: #1f5d42; font-size: .72rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
h1, h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 500; line-height: 1; }
h1 { font-size: clamp(1.8rem, 3vw, 2.6rem); }
h2 { font-size: 2.4rem; }
.lede, .selectionHint, .emptyCanvas p { color: #6c7067; line-height: 1.65; }
.newProjectForm { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-bottom: 20px; }
.projectList { display: grid; gap: 7px; }
.projectList button { display: flex; justify-content: space-between; gap: 10px; padding: 11px; border: 1px solid transparent; border-radius: 8px; color: #3d4139; background: transparent; text-align: left; cursor: pointer; }
.projectList button:hover, .projectList button.active { border-color: #c9c4b8; background: #eeece5; }
.projectList button span { color: #84877f; font-size: .75rem; }
.sectionRule { height: 1px; margin: 28px 0; background: #d8d4ca; }
.primaryAction, .smallAction { padding: 10px 16px; border: 0; border-radius: 999px; color: #f7f6ef; background: #1f5d42; cursor: pointer; }
.primaryAction:disabled, .smallAction:disabled { opacity: .5; cursor: default; }
.smallAction { border-radius: 8px; }
.fullWidth { width: 100%; margin: 14px 0 26px; }
.textAction { padding: 7px 0; border: 0; color: #1f5d42; background: transparent; cursor: pointer; }
.authCard > .textAction { margin-top: 14px; }
.saveStatus { margin: 10px 0 0; color: #6c7067; font-size: .76rem; }
.saveStatus.saved { color: #1f5d42; }
.saveStatus.error, .errorMessage { color: #a24032; }
.message { line-height: 1.45; font-size: .82rem; }
.canvasPanel { min-width: 0; background: #f4f2ec; }
.vue-flow { height: 100%; }
.emptyCanvas { display: grid; place-content: center; padding: 40px; text-align: center; }
:deep(.vue-flow__node) { min-width: 150px; padding: 13px 16px; border: 1px solid #b7b1a4; border-radius: 10px; color: #1d211b; background: #fffef9; box-shadow: 0 8px 24px rgba(50,46,38,.08); }
:deep(.vue-flow__node.selected) { border-color: #1f5d42; box-shadow: 0 0 0 2px rgba(31,93,66,.14); }

@media (max-width: 760px) {
  .workspace { height: auto; min-height: calc(100vh - 68px); grid-template-columns: 1fr; grid-template-rows: auto minmax(540px, 1fr); }
  .sidePanel { border-right: 0; border-bottom: 1px solid #d8d4ca; }
  .accountArea > span { display: none; }
}
</style>
