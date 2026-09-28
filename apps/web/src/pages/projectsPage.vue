<template>
  <div class="pageShell">
    <cruio-header />

    <main v-if="ready" class="projectsMain">
      <section class="pageIntro">
        <div>
          <p class="eyebrow">创作空间</p>
          <h1>你的项目</h1>
          <p>每个项目集中管理成片和工作流。先选项目，再决定要查看成果还是继续编排。</p>
        </div>
        <button class="primaryButton" type="button" @click="showCreator = true">新建项目</button>
      </section>

      <section v-if="showCreator" class="createStrip" aria-labelledby="create-project-heading">
        <div>
          <p class="eyebrow">新项目</p>
          <h2 id="create-project-heading">给这次创作一个名字</h2>
        </div>
        <form @submit.prevent="createProject">
          <input v-model.trim="newProjectName" maxlength="120" aria-label="项目名称" placeholder="例如：秋季品牌短片" autofocus />
          <button class="primaryButton" type="submit" :disabled="working || !newProjectName">创建并进入</button>
          <button class="secondaryButton" type="button" @click="cancelCreate">取消</button>
        </form>
      </section>

      <section class="projectSection" aria-labelledby="all-projects-heading">
        <div class="sectionHeader">
          <h2 id="all-projects-heading">全部项目 <span>{{ projects.length }}</span></h2>
          <label class="searchField">
            <span>搜索</span>
            <input v-model.trim="query" type="search" placeholder="输入项目名" />
          </label>
        </div>

        <div v-if="loading" class="loadingGrid" aria-label="正在加载项目">
          <div v-for="index in 3" :key="index" class="skeletonCard" />
        </div>

        <div v-else-if="filteredProjects.length" class="projectGrid">
          <article v-for="(project, index) in filteredProjects" :key="project.id" class="projectCard">
            <button type="button" @click="openProject(project.id)">
              <span class="cardIndex">{{ String(index + 1).padStart(2, "0") }}</span>
              <span class="cardBody">
                <span class="projectName">{{ project.name }}</span>
                <span class="projectMeta">
                  {{ project.workCount }} 个成片 · {{ project.workflowCount }} 个工作流
                </span>
              </span>
              <span class="cardFooter">
                <span>更新于 {{ formatDate(project.updatedAt) }}</span>
                <span class="openLabel">进入项目</span>
              </span>
            </button>
          </article>
        </div>

        <div v-else class="emptyState">
          <p class="eyebrow">{{ query ? "没有匹配结果" : "还没有项目" }}</p>
          <h2>{{ query ? "换一个关键词试试" : "先建立你的创作容器" }}</h2>
          <p>{{ query ? "项目仍安全保存在列表中。" : "项目里可以整理成片，也可以添加一个或多个工作流。" }}</p>
          <button v-if="!query" class="primaryButton" type="button" @click="showCreator = true">创建第一个项目</button>
        </div>
      </section>

      <p v-if="message" class="errorMessage">{{ message }}</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import CruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type ProjectSummary = {
  id: string;
  name: string;
  workflowCount: number;
  workCount: number;
  createdAt: string;
  updatedAt: string;
};

const router = useRouter();
const session = useCruioSession();
const projects = ref<ProjectSummary[]>([]);
const query = ref("");
const newProjectName = ref("");
const showCreator = ref(false);
const loading = ref(true);
const working = ref(false);
const ready = ref(false);
const message = ref("");

const filteredProjects = computed(() => {
  const value = query.value.toLocaleLowerCase();
  return value ? projects.value.filter(({ name }) => name.toLocaleLowerCase().includes(value)) : projects.value;
});

onMounted(async () => {
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: "/projects" } });
    return;
  }
  ready.value = true;
  await loadProjects();
});

async function loadProjects() {
  loading.value = true;
  message.value = "";
  try {
    projects.value = (await api<{ projects: ProjectSummary[] }>("/api/projects")).projects;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法加载项目。";
  } finally {
    loading.value = false;
  }
}

async function createProject() {
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: newProjectName.value }),
    });
    await router.push(`/projects/${result.project.id}`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "项目创建失败。";
  } finally {
    working.value = false;
  }
}

function cancelCreate() {
  showCreator.value = false;
  newProjectName.value = "";
}

async function openProject(projectId: string) {
  await router.push(`/projects/${projectId}`);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}
</script>

<style scoped lang="scss">
.pageShell { min-height: 100dvh; color: var(--cr-ink); background: var(--cr-paper); }
.projectsMain { width: min(100% - 40px, 1320px); margin: 0 auto; padding: 74px 0 110px; }
.pageIntro { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 40px; align-items: end; }
.pageIntro h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(4rem, 9vw, 8rem); font-weight: 500; letter-spacing: -.065em; line-height: .84; }
.pageIntro p:last-child { max-width: 590px; margin: 28px 0 0; color: var(--cr-muted); font-size: 1rem; line-height: 1.7; }
.eyebrow { margin: 0 0 14px; color: var(--cr-violet); font-size: .7rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.primaryButton, .secondaryButton { padding: 12px 18px; border: 0; border-radius: 8px; font: inherit; font-size: .84rem; font-weight: 700; cursor: pointer; transition: transform .2s, background .2s; }
.primaryButton { color: #28242e; background: var(--cr-gradient); }
.primaryButton:hover { filter: saturate(1.08) brightness(.98); transform: translateY(-1px); }
.primaryButton:active, .secondaryButton:active { transform: translateY(1px); }
.primaryButton:disabled { opacity: .5; cursor: default; transform: none; }
.secondaryButton { color: var(--cr-ink); background: var(--cr-soft); }
.createStrip { margin: 58px 0 0; padding: 28px; display: grid; grid-template-columns: .8fr 1.2fr; gap: 40px; align-items: end; border-radius: 14px 14px 14px 4px; color: #28242e; background: var(--cr-gradient); }
.createStrip .eyebrow { color: rgba(40,36,46,.62); }
.createStrip h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2rem; font-weight: 500; }
.createStrip form { display: grid; grid-template-columns: minmax(160px, 1fr) auto auto; gap: 9px; }
.createStrip input { min-width: 0; padding: 12px 14px; border: 1px solid rgba(40,36,46,.18); border-radius: 8px; color: var(--cr-ink); background: rgba(255,255,255,.52); font: inherit; }
.createStrip input::placeholder { color: rgba(40,36,46,.5); }
.createStrip input:focus { outline: 2px solid rgba(40,36,46,.3); outline-offset: 1px; }
.createStrip .primaryButton { color: #f5f1e8; background: #332d48; }
.createStrip .secondaryButton { color: #332d48; background: rgba(255,255,255,.38); }
.projectSection { margin-top: 88px; }
.sectionHeader { display: flex; align-items: end; justify-content: space-between; gap: 28px; padding-bottom: 18px; border-bottom: 1px solid var(--cr-line); }
.sectionHeader h2 { margin: 0; font-size: 1rem; font-weight: 720; }
.sectionHeader h2 span { margin-left: 7px; color: var(--cr-muted); font-variant-numeric: tabular-nums; }
.searchField { display: flex; align-items: center; gap: 10px; color: var(--cr-muted); font-size: .72rem; }
.searchField input { width: 190px; padding: 8px 0; border: 0; border-bottom: 1px solid var(--cr-line); outline: 0; color: var(--cr-ink); background: transparent; font: inherit; }
.searchField input:focus { border-color: var(--cr-green); }
.projectGrid, .loadingGrid { margin-top: 22px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.projectCard { min-height: 260px; }
.projectCard button { width: 100%; height: 100%; padding: 22px; display: grid; grid-template-rows: auto 1fr auto; border: 1px solid var(--cr-line); border-radius: 12px 12px 12px 3px; color: var(--cr-ink); background: rgba(255,254,249,.56); text-align: left; cursor: pointer; transition: transform .22s ease, border-color .22s, background .22s; }
.projectCard button:hover { transform: translateY(-4px); border-color: #a8ab9f; background: #fffef9; }
.projectCard button:focus-visible { outline: 3px solid rgba(36,85,61,.2); outline-offset: 3px; }
.cardIndex { justify-self: end; color: #a2a398; font-family: ui-monospace, SFMono-Regular, monospace; font-size: .68rem; font-variant-numeric: tabular-nums; }
.cardBody { align-self: center; display: grid; gap: 12px; }
.projectName { font-family: Georgia, "Times New Roman", serif; font-size: 1.8rem; letter-spacing: -.025em; line-height: 1.05; }
.projectMeta, .cardFooter { color: var(--cr-muted); font-size: .76rem; }
.cardFooter { display: flex; justify-content: space-between; gap: 14px; padding-top: 15px; border-top: 1px solid var(--cr-line); }
.openLabel { color: var(--cr-violet); font-weight: 700; }
.skeletonCard { height: 260px; border-radius: 12px 12px 12px 3px; background: linear-gradient(90deg, var(--cr-soft), #f4f2eb, var(--cr-soft)); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
.emptyState { min-height: 330px; display: grid; place-content: center; justify-items: center; text-align: center; }
.emptyState h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.4rem; font-weight: 500; letter-spacing: -.035em; }
.emptyState p:not(.eyebrow) { max-width: 480px; margin: 16px 0 24px; color: var(--cr-muted); line-height: 1.65; }
.errorMessage { color: var(--cr-danger); font-size: .84rem; }
@keyframes shimmer { to { background-position: -200% 0; } }

@media (max-width: 900px) {
  .projectGrid, .loadingGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .createStrip { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .projectsMain { width: min(100% - 24px, 1320px); padding-top: 48px; }
  .pageIntro { grid-template-columns: 1fr; align-items: start; }
  .pageIntro h1 { font-size: 4rem; }
  .createStrip form { grid-template-columns: 1fr 1fr; }
  .createStrip input { grid-column: 1 / -1; }
  .projectGrid, .loadingGrid { grid-template-columns: 1fr; }
  .sectionHeader { align-items: start; flex-direction: column; }
  .searchField, .searchField input { width: 100%; }
}
</style>
