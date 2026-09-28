<template>
  <div class="pageShell">
    <cruio-header />

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
          </article>
        </div>
        <div v-else class="worksEmpty">
          <span>暂无成片</span>
          <p>生成结果不会自动成为作品。之后由你选择值得长期保存的版本。</p>
        </div>
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
import CruioHeader from "@/components/cruioHeader.vue";
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
const projectId = String(route.params.projectId);

onMounted(async () => {
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  await loadProject();
  try {
    libraryWorkflows.value = (await api<{ workflows: WorkflowSummary[] }>("/api/workflows")).workflows;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法加载工作流库。";
  }
});

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
.pageShell { min-height: 100dvh; color: var(--cr-ink); background: var(--cr-paper); }
.projectMain { width: min(100% - 40px, 1320px); margin: 0 auto; padding: 30px 0 120px; }
.breadcrumb { display: flex; gap: 9px; color: var(--cr-muted); font-size: .76rem; }
.breadcrumb a { color: var(--cr-green); text-decoration: none; }
.projectHero { margin-top: 54px; padding-bottom: 58px; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(420px, .8fr); gap: 50px; align-items: end; border-bottom: 1px solid var(--cr-line); }
.projectCanvasEntry { margin-top: 38px; padding: 28px 32px; display: flex; align-items: center; justify-content: space-between; gap: 24px; border: 1px solid var(--cr-line); border-radius: 16px; background: #fff; }
.projectCanvasEntry h2 { margin: 0; font-size: 1.4rem; }
.projectCanvasEntry p:last-child { margin: 8px 0 0; color: var(--cr-muted); font-size: .84rem; }
.eyebrow { margin: 0 0 13px; color: var(--cr-violet); font-size: .68rem; font-weight: 760; letter-spacing: .14em; text-transform: uppercase; }
.projectHero h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(3.7rem, 8vw, 7.2rem); font-weight: 500; letter-spacing: -.06em; line-height: .88; text-wrap: balance; }
dl { margin: 0; display: grid; grid-template-columns: .7fr .8fr 1.5fr; }
dl div { padding: 0 18px; border-left: 1px solid var(--cr-line); }
dt { margin-bottom: 10px; color: var(--cr-muted); font-size: .7rem; }
dd { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.contentSection { padding: 72px 0 78px; border-bottom: 1px solid var(--cr-line); }
.sectionHeading { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.2fr); gap: 40px; align-items: end; }
.sectionHeading h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 3rem; font-weight: 500; letter-spacing: -.04em; }
.sectionHeading > p { max-width: 500px; justify-self: end; margin: 0; color: var(--cr-muted); line-height: 1.65; }
.sectionHeading > .primaryButton { justify-self: end; }
.worksEmpty { min-height: 220px; margin-top: 30px; display: grid; place-content: center; justify-items: center; border: 1px dashed #c9c4b8; border-radius: 14px 14px 14px 4px; text-align: center; }
.worksEmpty span { font-family: Georgia, "Times New Roman", serif; font-size: 2rem; }
.worksEmpty p { max-width: 500px; margin: 12px 0 0; color: var(--cr-muted); line-height: 1.6; }
.worksGrid { margin-top: 30px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.workCard img, .workCard video { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 10px 10px 3px 3px; background: var(--cr-soft); }
.workCard h3 { margin: 13px 0 4px; font-size: .9rem; }
.workCard p { margin: 0; color: var(--cr-muted); font-size: .72rem; }
.workflowSection { border-bottom: 0; }
.primaryButton, .secondaryButton { padding: 11px 16px; border: 0; border-radius: 8px; font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; transition: transform .2s, filter .2s; }
.primaryButton { color: #25212e; background: var(--cr-gradient); }
.primaryButton:hover { filter: saturate(1.08) brightness(.98); transform: translateY(-1px); }
.primaryButton:active, .secondaryButton:active { transform: translateY(1px); }
.primaryButton:disabled { opacity: .5; cursor: default; transform: none; }
.secondaryButton { color: var(--cr-ink); background: rgba(255,255,255,.58); }
.workflowCreator { margin-top: 30px; padding: 30px; display: grid; grid-template-columns: .9fr 1.1fr; gap: 50px; border-radius: 14px 14px 14px 4px; background: var(--cr-gradient-soft); }
.workflowCreator h3, .workflowEmpty h3 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2rem; font-weight: 500; }
.workflowCreator p:not(.eyebrow), .workflowEmpty p:not(.eyebrow) { max-width: 480px; margin: 12px 0 0; color: #5d5868; line-height: 1.55; }
.creatorFields { align-self: end; display: grid; grid-template-columns: minmax(160px, 1fr) auto auto; gap: 8px; }
.creatorFields input { min-width: 0; padding: 11px 13px; border: 1px solid rgba(71,62,89,.2); border-radius: 8px; color: var(--cr-ink); background: rgba(255,255,255,.68); font: inherit; }
.creatorFields select { min-width: 0; padding: 11px 13px; border: 1px solid rgba(71,62,89,.2); border-radius: 8px; color: var(--cr-ink); background: rgba(255,255,255,.68); font: inherit; }
.workflowCreator > a { color: var(--cr-violet); font-size: .82rem; }
.creatorFields input:focus { outline: 3px solid rgba(122,115,253,.18); border-color: var(--cr-violet); }
.workflowList { margin-top: 28px; border-top: 1px solid var(--cr-line); }
.workflowList article { border-bottom: 1px solid var(--cr-line); }
.workflowList .workflowMainButton { width: 100%; padding: 22px 4px; display: grid; grid-template-columns: 54px minmax(0, 1fr) auto auto; gap: 24px; align-items: center; border: 0; color: var(--cr-ink); background: transparent; text-align: left; cursor: pointer; transition: padding .2s, background .2s; }
.workflowList .workflowMainButton:hover { padding-left: 14px; padding-right: 14px; background: rgba(255,255,255,.6); }
.workflowList .upgradeButton { margin: 0 0 18px 58px; padding: 9px 13px; border: 1px solid var(--cr-line); border-radius: 8px; color: var(--cr-violet); background: #fff; font: inherit; font-size: .76rem; font-weight: 680; cursor: pointer; }
.workflowIndex { color: #9b968c; font-family: ui-monospace, SFMono-Regular, monospace; font-size: .68rem; }
.workflowTitle { display: grid; gap: 7px; }
.workflowTitle strong { font-family: Georgia, "Times New Roman", serif; font-size: 1.35rem; font-weight: 500; }
.workflowTitle small, .workflowDate { color: var(--cr-muted); font-size: .72rem; }
.workflowOpen { padding: 8px 11px; border-radius: 7px; color: #332d48; background: var(--cr-gradient-soft); font-size: .76rem; font-weight: 720; }
.workflowEmpty { min-height: 250px; margin-top: 30px; padding: 34px; display: flex; align-items: end; justify-content: space-between; gap: 32px; border-radius: 14px 14px 14px 4px; background: var(--cr-soft); }
.errorMessage { color: var(--cr-danger); font-size: .84rem; }
.loadingState { min-height: calc(100dvh - 76px); display: grid; place-items: center; color: var(--cr-muted); }

@media (max-width: 900px) {
  .projectHero, .sectionHeading, .workflowCreator { grid-template-columns: 1fr; }
  .projectCanvasEntry { align-items: flex-start; flex-direction: column; }
  .sectionHeading > p, .sectionHeading > .primaryButton { justify-self: start; }
  .creatorFields { grid-template-columns: 1fr 1fr; }
  .creatorFields input { grid-column: 1 / -1; }
}
@media (max-width: 650px) {
  .projectMain { width: min(100% - 24px, 1320px); }
  .projectHero { margin-top: 40px; }
  .projectHero h1 { font-size: 4rem; }
  dl { grid-template-columns: 1fr 1fr; row-gap: 24px; }
  dl div:last-child { grid-column: 1 / -1; }
  .worksGrid { grid-template-columns: 1fr; }
  .workflowList button { grid-template-columns: 34px minmax(0, 1fr); gap: 14px; }
  .workflowDate, .workflowOpen { grid-column: 2; }
  .workflowEmpty { align-items: start; flex-direction: column; }
}
</style>
