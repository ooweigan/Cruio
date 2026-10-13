<template>
  <div class="pageShell">
    <cruioHeader />

    <main v-if="ready" class="projectsMain">
      <section class="pageIntro">
        <div>
          <h1>项目</h1>
          <p>管理成片和工作流，继续最近一次创作。</p>
        </div>
        <button ref="createTrigger" class="primaryButton" type="button" @click="openCreator">新建项目</button>
      </section>

      <section class="projectSection" aria-labelledby="all-projects-heading">
        <div class="sectionHeader">
          <div>
            <h2 id="all-projects-heading">{{ query ? "搜索结果" : "最近的项目" }}</h2>
            <span>{{ filteredProjects.length }} 个项目</span>
          </div>
          <label class="searchField">
            <span class="srOnly">搜索项目</span>
            <input v-model.trim="query" type="search" placeholder="搜索项目" />
          </label>
        </div>

        <div v-if="loading" class="loadingGrid" aria-label="正在加载项目">
          <div v-for="index in 3" :key="index" class="skeletonCard" />
        </div>

        <div v-else-if="filteredProjects.length" class="projectGrid">
          <article v-for="project in filteredProjects" :key="project.id" class="projectCard">
            <button type="button" @click="openProject(project.id)">
              <span class="projectAccent" />
              <span class="cardBody">
                <span class="projectName">{{ project.name }}</span>
                <span class="projectMeta">
                  {{ project.workCount }} 个成片 · {{ project.workflowCount }} 个工作流
                </span>
              </span>
              <span class="cardFooter">
                <span>更新于 {{ formatDate(project.updatedAt) }}</span>
                <span class="openLabel">打开</span>
              </span>
            </button>
          </article>
        </div>

        <div v-else class="emptyState">
          <h2>{{ query ? "没有匹配的项目" : "创建第一个项目" }}</h2>
          <p>{{ query ? "项目仍安全保存在列表中。" : "项目里可以整理成片，也可以添加一个或多个工作流。" }}</p>
          <button v-if="!query" class="primaryButton" type="button" @click="openCreator">新建项目</button>
        </div>
      </section>

      <p v-if="message" class="errorMessage">{{ message }}</p>
    </main>

    <teleport to="body">
      <transition name="dialogFade">
        <div
          v-if="showCreator"
          class="dialogBackdrop"
          role="presentation"
          @click.self="cancelCreate"
          @keydown.esc="cancelCreate"
        >
          <section
            class="createDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-heading"
            aria-describedby="create-project-description"
            @keydown="trapDialogFocus"
          >
            <div class="dialogMark" aria-hidden="true">+</div>
            <div class="dialogHeading">
              <h2 id="create-project-heading">创建新项目</h2>
              <p id="create-project-description">输入一个名称开始创作，之后仍可修改。</p>
            </div>
            <form @submit.prevent="createProject">
              <label for="new-project-name">项目名称</label>
              <input
                id="new-project-name"
                ref="projectNameInput"
                v-model.trim="newProjectName"
                maxlength="120"
                placeholder="例如：秋季品牌短片"
                autocomplete="off"
              />
              <div class="creatorActions">
                <button class="textButton" type="button" :disabled="working" @click="cancelCreate">取消</button>
                <button class="primaryButton" type="submit" :disabled="working || !newProjectName">
                  {{ working ? "创建中…" : "创建" }}
                </button>
              </div>
            </form>
          </section>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
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
const projectNameInput = ref<HTMLInputElement>();
const createTrigger = ref<HTMLButtonElement>();
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

async function openCreator() {
  showCreator.value = true;
  await nextTick();
  projectNameInput.value?.focus();
}

async function cancelCreate() {
  if (working.value) return;
  showCreator.value = false;
  newProjectName.value = "";
  await nextTick();
  createTrigger.value?.focus();
}

function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget as HTMLElement;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter(element => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

async function openProject(projectId: string) {
  await router.push(`/projects/${projectId}`);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}
</script>


<style scoped lang="scss" src="./projectsPage.redesign.scss"></style>
