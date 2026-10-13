<template>
  <div class="pageShell">
    <cruioHeader />

    <main v-if="project" class="projectMain">
      <nav class="breadcrumb" aria-label="面包屑">
        <router-link to="/projects">项目</router-link>
        <span>/</span>
        <span>{{ project.name }}</span>
      </nav>

      <section class="projectHero">
        <div>
          <p class="eyebrow">项目空间</p>
          <h1>{{ project.name }}</h1>
        </div>
        <dl>
          <div><dt>成片</dt><dd>{{ project.works.length }}</dd></div>
          <div><dt>工作流</dt><dd>{{ project.workflows.length }}</dd></div>
          <div><dt>最近更新</dt><dd>{{ formatDate(project.updatedAt) }}</dd></div>
        </dl>
      </section>

      <section class="projectCanvasEntry" aria-labelledby="projectCanvasHeading">
        <div>
          <p class="eyebrow">Canvas</p>
          <h2 id="projectCanvasHeading">项目画布</h2>
          <p>整理这个项目的创作内容；工作流图在独立的工作流库中编辑。</p>
        </div>
        <button class="primaryButton" type="button" @click="router.push(`/projects/${projectId}/canvas`)">打开项目画布</button>
      </section>

      <section v-if="tasks.length || loadingTasks || taskMessage || tasksLoaded" class="contentSection taskSection" aria-labelledby="tasksHeading">
        <div class="sectionHeading">
          <div><p class="eyebrow">Runs</p><h2 id="tasksHeading">生成任务</h2></div>
          <button class="secondaryButton" type="button" :disabled="loadingTasks" @click="loadTasks">{{ loadingTasks ? "正在刷新…" : "刷新任务" }}</button>
        </div>
        <article v-for="task in tasks" :key="task.taskId" class="projectTask">
          <div class="projectTaskHeading">
            <strong>{{ task.modelSnapshot?.label ?? task.modelSnapshot?.modelId ?? task.operation }}</strong>
            <span>{{ taskStatusLabel(task.status) }}</span>
          </div>
          <p>{{ formatDate(task.createdAt) }} · {{ task.taskId }}</p>
          <div v-for="result in task.results ?? []" :key="result.resultId" class="projectTaskResult">
            <img v-if="result.mediaType === 'image'" :src="result.previewUrl" alt="生成结果" />
            <video v-else-if="result.mediaType === 'video'" :src="result.previewUrl" controls aria-label="生成结果" />
            <a :href="result.downloadUrl" download>下载结果</a>
            <span v-if="result.saved || savedResults.has(result.resultId)">已保存为作品</span>
            <template v-else-if="task.status === 'delivered'">
              <input v-model="workTitles[result.resultId]" class="workTitleInput" maxlength="160" :placeholder="project.name" :aria-label="`作品名称：${project.name}`" />
              <button class="secondaryButton" type="button" :disabled="savingTaskId === task.taskId" @click="saveWork(task, result.resultId)">{{ savingTaskId === task.taskId ? "正在保存…" : "保存为作品" }}</button>
            </template>
          </div>
          <p v-if="task.failure" class="errorMessage">{{ task.failure }}</p>
        </article>
        <p v-if="loadingTasks" class="taskNotice">正在读取项目任务…</p>
        <p v-else-if="tasksLoaded && !taskMessage && !tasks.length" class="taskNotice">当前项目暂无生成任务。</p>
        <p v-if="taskMessage" class="errorMessage">{{ taskMessage }}</p>
      </section>

      <section class="contentSection" aria-labelledby="works-heading">
        <div class="sectionHeading">
          <div>
            <p class="eyebrow">Deliverables</p>
            <h2 id="works-heading">成片</h2>
          </div>
          <p>从可靠交付结果中主动保存的图片与视频会集中在这里。</p>
        </div>

        <div v-if="project.works.length" class="worksGrid">
          <article v-for="work in project.works" :key="work.id" class="workCard">
            <img v-if="work.mediaType === 'image'" :src="work.previewUrl" :alt="work.title" />
            <video v-else :src="work.previewUrl" controls :aria-label="work.title" />
            <div><h3>{{ work.title }}</h3><p>{{ formatDate(work.createdAt) }}</p></div>
            <div class="workActions">
              <a class="secondaryButton" :href="`/api/works/${encodeURIComponent(work.id)}/download`" download>下载作品</a>
              <button class="secondaryButton" type="button" :disabled="deletingWorkId === work.id" @click="deleteWork(work)">{{ deletingWorkId === work.id ? "正在删除…" : "删除作品" }}</button>
            </div>
          </article>
        </div>
        <div v-else class="worksEmpty">
          <span>暂无成片</span>
          <p>生成结果不会自动成为作品。之后由你选择值得长期保存的版本。</p>
        </div>
        <p v-if="workMessage" class="errorMessage">{{ workMessage }}</p>
      </section>

      <section class="contentSection workflowSection" aria-labelledby="workflows-heading">
        <div class="sectionHeading">
          <div>
            <p class="eyebrow">Workflows</p>
            <h2 id="workflows-heading">工作流</h2>
          </div>
          <button class="primaryButton" type="button" @click="showCreator = true">引入工作流</button>
        </div>

        <form v-if="showCreator" class="workflowCreator" @submit.prevent="bindWorkflow">
          <div>
            <p class="eyebrow">工作流库</p>
            <h3>引入已有工作流</h3>
            <p>当前最新版本会固定在本项目。源工作流之后更新，不会自动改动本项目的引用。</p>
          </div>
          <div class="creatorFields">
            <select v-model="selectedWorkflowId" aria-label="选择工作流">
              <option value="" disabled>选择工作流</option>
              <option v-for="item in availableWorkflows" :key="item.id" :value="item.id">{{ item.name }} · v{{ item.version }}</option>
            </select>
            <button class="primaryButton" type="submit" :disabled="working || !selectedWorkflowId">引入</button>
            <button class="secondaryButton" type="button" @click="cancelCreate">取消</button>
          </div>
          <router-link to="/workflows">去工作流库新建</router-link>
        </form>

        <div v-if="project.workflows.length" class="workflowList">
          <article v-for="(workflow, index) in project.workflows" :key="workflow.id">
            <button class="workflowMainButton" type="button" @click="openWorkflow(workflow.id)">
              <span class="workflowIndex">{{ String(index + 1).padStart(2, "0") }}</span>
              <span class="workflowTitle">
                <strong>{{ workflow.name }}</strong>
                <small>{{ workflow.nodeCount }} 个节点 · 项目引用 v{{ workflow.version }}</small>
              </span>
              <span class="workflowDate">{{ formatDate(workflow.updatedAt) }}</span>
              <span class="workflowOpen">编辑源工作流</span>
            </button>
            <button
              v-if="workflow.latestVersion > workflow.version"
              class="upgradeButton"
              type="button"
              :disabled="working"
              @click="upgradeWorkflow(workflow.id)"
            >将项目引用升级到 v{{ workflow.latestVersion }}</button>
          </article>
        </div>
        <div v-else-if="!showCreator" class="workflowEmpty">
          <div>
            <p class="eyebrow">从这里开始</p>
            <h3>这个项目还没有引入工作流</h3>
            <p>从工作流库选择已有工作流，也可以先创建一个。</p>
          </div>
          <button class="primaryButton" type="button" @click="showCreator = true">引入工作流</button>
        </div>
      </section>

      <p v-if="message" class="errorMessage">{{ message }}</p>
    </main>

    <main v-else-if="loading" class="loadingState">正在打开项目…</main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type WorkflowSummary = {
  id: string;
  name: string;
  version: number;
  latestVersion: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
};
type Work = { id: string; title: string; mediaType: "image" | "video"; previewUrl: string; createdAt: string };
type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  workflows: WorkflowSummary[];
  works: Work[];
};
type GenerationResult = { resultId: string; mediaType: "image" | "video"; previewUrl: string; downloadUrl: string; saved?: boolean };
type GenerationTask = { taskId: string; nodeId?: string; status: string; operation: string; createdAt: string; modelSnapshot?: { modelId?: string; label?: string }; results?: GenerationResult[]; failure?: string };

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const project = ref<Project | null>(null);
const loading = ref(true);
const working = ref(false);
const showCreator = ref(false);
const selectedWorkflowId = ref("");
const availableWorkflows = computed(() => libraryWorkflows.value.filter(
  ({ id }) => !project.value?.workflows.some((workflow) => workflow.id === id),
));
const libraryWorkflows = ref<WorkflowSummary[]>([]);
const message = ref("");
const tasks = ref<GenerationTask[]>([]);
const loadingTasks = ref(false);
const savingTaskId = ref("");
const taskMessage = ref("");
const savedResults = ref(new Set<string>());
const workTitles = ref<Record<string, string>>({});
const tasksLoaded = ref(false);
const deletingWorkId = ref("");
const workMessage = ref("");
const projectId = String(route.params.projectId);

onMounted(async () => {
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  await loadProject();
  await Promise.all([loadTasks(), loadWorkflowLibrary()]);
});

async function loadWorkflowLibrary() {
  try {
    libraryWorkflows.value = (await api<{ workflows: WorkflowSummary[] }>("/api/workflows")).workflows;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法加载工作流库。";
  }
}

async function loadTasks() {
  loadingTasks.value = true;
  taskMessage.value = "";
  try {
    tasks.value = (await api<{ tasks: GenerationTask[] }>(`/api/generation/tasks?projectId=${encodeURIComponent(projectId)}`)).tasks;
    tasksLoaded.value = true;
  } catch (error) {
    taskMessage.value = error instanceof Error ? error.message : "无法读取生成任务。";
  } finally {
    loadingTasks.value = false;
  }
}

async function saveWork(task: GenerationTask, resultId: string) {
  if (task.status !== "delivered") return;
  savingTaskId.value = task.taskId;
  taskMessage.value = "";
  try {
    const title = workTitles.value[resultId]?.trim() || project.value?.name || "我的作品";
    await api("/api/works", { method: "POST", body: JSON.stringify({ taskId: task.taskId, resultIds: [resultId], title }) });
    savedResults.value = new Set(savedResults.value).add(resultId);
    await Promise.all([loadProject(), loadTasks()]);
  } catch (error) {
    taskMessage.value = error instanceof Error ? error.message : "作品保存失败。";
  } finally {
    savingTaskId.value = "";
  }
}

async function deleteWork(work: Work) {
  if (deletingWorkId.value) return;
  deletingWorkId.value = work.id;
  workMessage.value = "";
  try {
    await api(`/api/works/${encodeURIComponent(work.id)}`, { method: "DELETE" });
    if (project.value) project.value = { ...project.value, works: project.value.works.filter(item => item.id !== work.id) };
  } catch (error) {
    workMessage.value = error instanceof Error ? error.message : "作品删除失败。";
  } finally {
    deletingWorkId.value = "";
  }
}

function taskStatusLabel(status: string) {
  return ({ queued: "排队中", running: "生成中", succeeded: "正在保存结果", delivered: "结果可用", failed: "生成失败", unknown: "状态待核查" } as Record<string, string>)[status] ?? "处理中";
}

async function loadProject() {
  loading.value = true;
  message.value = "";
  try {
    project.value = (await api<{ project: Project }>(`/api/projects/${projectId}`)).project;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法打开项目。";
    await router.replace("/projects");
  } finally {
    loading.value = false;
  }
}

async function bindWorkflow() {
  working.value = true;
  message.value = "";
  try {
    await api(`/api/projects/${projectId}/workflowBindings`, {
      method: "POST",
      body: JSON.stringify({ workflowId: selectedWorkflowId.value }),
    });
    showCreator.value = false;
    selectedWorkflowId.value = "";
    await loadProject();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "引入工作流失败。";
  } finally {
    working.value = false;
  }
}

function cancelCreate() {
  showCreator.value = false;
  selectedWorkflowId.value = "";
}

async function openWorkflow(workflowId: string) {
  await router.push(`/workflows/${workflowId}`);
}

async function upgradeWorkflow(workflowId: string) {
  working.value = true;
  message.value = "";
  try {
    await api(`/api/projects/${projectId}/workflowBindings/${workflowId}`, { method: "PUT" });
    await loadProject();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "升级项目引用失败。";
  } finally {
    working.value = false;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
</script>

<style scoped lang="scss">
.pageShell {
  min-height: 100dvh;
  overflow-x: hidden;
  color: var(--cr-text-primary);
  background: var(--cr-page-background);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;

  .projectMain { width: min(100% - 48px, 1320px); margin: 0 auto; padding: 24px 0 24px; }
  .breadcrumb { display: flex; gap: 8px; color: var(--cr-text-muted); font-size: 12px; }
  .breadcrumb a { color: var(--cr-brand-primary); text-decoration: none; }
  .projectHero { margin-top: 24px; padding-bottom: 24px; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(360px, .8fr); gap: 24px; align-items: end; border-bottom: 1px solid var(--cr-border-subtle); }
  .eyebrow { margin: 0 0 8px; color: var(--cr-brand-primary); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .projectHero h1 { margin: 0; overflow-wrap: anywhere; color: var(--cr-text-primary); font-size: 20px; font-weight: 600; line-height: 1.4; }
  dl { margin: 0; display: grid; grid-template-columns: .7fr .8fr 1.5fr; }
  dl div { min-width: 0; padding: 0 16px; border-left: 1px solid var(--cr-border-subtle); }
  dt { margin-bottom: 8px; color: var(--cr-text-muted); font-size: 12px; }
  dd { margin: 0; color: var(--cr-text-primary); font-size: 20px; font-variant-numeric: tabular-nums; }

  .projectCanvasEntry { margin-top: 16px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
  .projectCanvasEntry h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .projectCanvasEntry p:last-child { margin: 8px 0 0; color: var(--cr-text-muted); font-size: 14px; }
  .contentSection { padding: 24px 0; border-bottom: 1px solid var(--cr-border-subtle); }
  .taskSection { padding-top: 24px; }
  .taskNotice { margin-top: 12px; color: var(--cr-text-muted); font-size: 14px; }
  .sectionHeading { display: grid; grid-template-columns: minmax(240px, .8fr) minmax(0, 1.2fr); gap: 24px; align-items: end; }
  .sectionHeading h2 { margin: 0; color: var(--cr-text-primary); font-size: 20px; font-weight: 600; }
  .sectionHeading > p { max-width: 520px; justify-self: end; margin: 0; color: var(--cr-text-muted); font-size: 14px; line-height: 1.5; }
  .sectionHeading > button { justify-self: end; }
  .worksEmpty { min-height: 160px; margin-top: 16px; padding: 16px; display: grid; place-content: center; justify-items: center; border: 1px dashed var(--cr-border-strong); border-radius: 8px; background: var(--cr-surface-subtle); text-align: center; }
  .worksEmpty span { color: var(--cr-text-primary); font-size: 16px; font-weight: 600; }
  .worksEmpty p { max-width: 500px; margin: 8px 0 0; color: var(--cr-text-muted); font-size: 14px; line-height: 1.5; }
  .worksGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .workCard { min-width: 0; padding: 8px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
  .workCard img, .workCard video { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 6px; background: var(--cr-surface-subtle); }
  .workCard h3 { margin: 8px 0 4px; color: var(--cr-text-primary); font-size: 14px; }
  .workCard p { margin: 0; color: var(--cr-text-muted); font-size: 12px; }
  .workActions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
  .workActions .secondaryButton { padding: 8px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; text-decoration: none; cursor: pointer; }
  .workActions .secondaryButton:disabled { cursor: wait; }

  .projectTask { margin-top: 12px; padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
  .projectTaskHeading { display: flex; justify-content: space-between; gap: 16px; color: var(--cr-text-primary); font-size: 14px; }
  .projectTaskHeading span, .projectTask > p { color: var(--cr-text-muted); font-size: 12px; }
  .projectTaskResult { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .workTitleInput { width: min(240px, 100%); min-height: 36px; padding: 8px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; }
  .workTitleInput:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
  .projectTaskResult img, .projectTaskResult video { width: min(360px, 100%); max-height: 240px; object-fit: contain; border-radius: 6px; background: var(--cr-surface-subtle); }
  .projectTaskResult a { color: var(--cr-brand-primary); font-size: 14px; }
  .projectTaskResult span { color: var(--cr-status-success); font-size: 12px; }

  .workflowSection { border-bottom: 0; }
  .workflowCreator { margin-top: 16px; padding: 16px; display: grid; grid-template-columns: minmax(0, .8fr) minmax(360px, 1.2fr); gap: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
  .workflowCreator h3 { margin: 0; font-size: 16px; }
  .workflowCreator p { color: var(--cr-text-muted); font-size: 14px; line-height: 1.5; }
  .workflowCreator > a { color: var(--cr-brand-primary); font-size: 14px; }
  .creatorFields { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-content: start; }
  .creatorFields select { min-width: 0; padding: 8px; grid-column: 1 / -1; border: 1px solid var(--cr-border-subtle); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; }
  .workflowList { margin-top: 24px; border-top: 1px solid var(--cr-border-subtle); }
  .workflowList article { border-bottom: 1px solid var(--cr-border-subtle); }
  .workflowList .workflowMainButton { width: 100%; min-width: 0; padding: 12px 8px; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto auto; gap: 12px; align-items: center; border: 0; color: var(--cr-text-primary); background: transparent; text-align: left; cursor: pointer; }
  .workflowList .workflowMainButton:hover { background: var(--cr-surface-hover); }
  .workflowList .upgradeButton { margin: 0 0 12px 48px; padding: 8px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; color: var(--cr-brand-primary); background: var(--cr-surface); font: inherit; font-size: 12px; cursor: pointer; }
  .workflowIndex { color: var(--cr-text-muted); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .workflowTitle { min-width: 0; display: grid; gap: 4px; }
  .workflowTitle strong { overflow: hidden; color: var(--cr-text-primary); font-size: 14px; font-weight: 600; text-overflow: ellipsis; }
  .workflowTitle small, .workflowDate { color: var(--cr-text-muted); font-size: 12px; }
  .workflowOpen { padding: 8px; border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface-hover); font-size: 12px; font-weight: 600; }
  .workflowEmpty { min-height: 160px; margin-top: 16px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border: 1px dashed var(--cr-border-strong); border-radius: 8px; background: var(--cr-surface-subtle); }
  .workflowEmpty h3 { margin: 0; color: var(--cr-text-primary); font-size: 16px; }
  .workflowEmpty p { color: var(--cr-text-muted); font-size: 14px; }
  .primaryButton, .secondaryButton { min-height: 36px; padding: 8px 12px; border-radius: 6px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .primaryButton { border: 0; color: var(--cr-text-primary); background: var(--cr-gradient); box-shadow: 0 2px 8px color-mix(in srgb, var(--cr-brand-primary) 25%, transparent); }
  .secondaryButton { border: 1px solid var(--cr-border-subtle); color: var(--cr-text-primary); background: var(--cr-surface); }
  .secondaryButton:hover { background: var(--cr-surface-hover); }
  .primaryButton:focus-visible, .secondaryButton:focus-visible, a:focus-visible, button:focus-visible, select:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
  .errorMessage { color: var(--cr-status-danger); font-size: 14px; }
  .loadingState { min-height: calc(100dvh - 56px); display: grid; place-items: center; color: var(--cr-text-muted); }
}

@media (max-width: 1319px) {
  .pageShell .projectMain { width: min(100% - 40px, 1100px); }
  .pageShell .worksGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 1155px) {
  .pageShell {
    .projectMain { width: min(100% - 32px, 900px); }
    .projectHero, .sectionHeading, .workflowCreator { grid-template-columns: minmax(0, 1fr); }
    .projectHero { margin-top: 24px; padding-bottom: 24px; }
    .sectionHeading > p, .sectionHeading > button { justify-self: start; }
    .projectCanvasEntry { align-items: flex-start; flex-direction: column; }
    .creatorFields { grid-template-columns: minmax(0, 1fr) auto auto; }
  }
}

@media (max-width: 600px) {
  .pageShell {
    .projectMain { width: calc(100% - 24px); }
    .worksGrid { grid-template-columns: minmax(0, 1fr); }
    dl { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 0; }
    dl div:last-child { grid-column: 1 / -1; }
    .workflowList .workflowMainButton { grid-template-columns: 28px minmax(0, 1fr); gap: 8px; }
    .workflowDate, .workflowOpen { grid-column: 2; }
    .workflowEmpty { align-items: flex-start; flex-direction: column; }
    .creatorFields { grid-template-columns: minmax(0, 1fr) auto; }
  }
}
</style>
