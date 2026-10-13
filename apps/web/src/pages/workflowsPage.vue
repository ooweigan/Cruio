<template>
  <div class="pageShell">
    <cruioHeader />

    <main v-if="ready" class="workflowMain">
      <div class="pageHeading">
        <div class="headingCopy">
          <h1>工作流</h1>
          <p>管理可在不同项目中使用的工作流。</p>
        </div>
        <button ref="createTrigger" class="primaryButton" type="button" @click="openCreator">新建工作流</button>
      </div>

      <section class="workflowLibrary" aria-labelledby="workflowListHeading">
        <div class="libraryHeader">
          <div class="libraryTitle">
            <h2 id="workflowListHeading">{{ query ? "搜索结果" : "我的工作流" }}</h2>
            <span>{{ filteredWorkflows.length }} 个</span>
          </div>
          <label class="searchField">
            <span class="srOnly">搜索工作流</span>
            <input ref="searchInput" v-model.trim="query" type="search" placeholder="搜索工作流" />
            <kbd>⌘ K</kbd>
          </label>
        </div>

        <div v-if="loading" class="workflowGrid" aria-label="正在加载工作流">
          <div v-for="index in 3" :key="index" class="skeletonCard" />
        </div>

        <div v-else-if="filteredWorkflows.length" class="workflowGrid">
          <article v-for="workflow in filteredWorkflows" :key="workflow.id" class="workflowCard">
            <button type="button" :aria-label="`打开工作流：${workflow.name}`" @click="openWorkflow(workflow.id)">
              <span class="cardContent">
                <span class="cardTitle">{{ workflow.name }}</span>
                <span class="cardMeta">{{ workflow.nodeCount }} 个节点 <span aria-hidden="true">·</span> 版本 {{ workflow.version }}</span>
                <span class="cardFooter">
                  <span>更新于 {{ formatDate(workflow.updatedAt) }}</span>
                  <strong>打开画布 <span aria-hidden="true">→</span></strong>
                </span>
              </span>
            </button>
          </article>
        </div>

        <div v-else-if="!message" class="emptyState">
          <h2>{{ query ? "没有匹配的工作流" : "还没有工作流" }}</h2>
          <p>{{ query ? "试试其他关键词。" : "新建一个工作流，开始编排创作步骤。" }}</p>
        </div>
      </section>

      <p v-if="message" class="errorMessage" role="alert">{{ message }}</p>
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
            aria-labelledby="createWorkflowHeading"
            aria-describedby="createWorkflowDescription"
            @keydown="trapDialogFocus"
          >
            <div class="dialogHeading">
              <h2 id="createWorkflowHeading">创建工作流</h2>
              <p id="createWorkflowDescription">输入名称后打开画布。</p>
            </div>
            <form @submit.prevent="createWorkflow">
              <label for="workflowName">工作流名称</label>
              <input
                id="workflowName"
                ref="workflowNameInput"
                v-model.trim="newWorkflowName"
                maxlength="120"
                placeholder="例如：主视觉生成"
                autocomplete="off"
              />
              <div class="creatorActions">
                <button class="textButton" type="button" :disabled="working" @click="cancelCreate">取消</button>
                <button class="primaryButton" type="submit" :disabled="working || !newWorkflowName">
                  {{ working ? "创建中…" : "创建并打开" }}
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type WorkflowSummary = {
  id: string;
  name: string;
  version: number;
  nodeCount: number;
  updatedAt: string;
};

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const workflows = ref<WorkflowSummary[]>([]);
const query = ref("");
const searchInput = ref<HTMLInputElement>();
const newWorkflowName = ref("");
const showCreator = ref(false);
const workflowNameInput = ref<HTMLInputElement>();
const createTrigger = ref<HTMLButtonElement>();
const ready = ref(false);
const loading = ref(true);
const working = ref(false);
const message = ref("");

const filteredWorkflows = computed(() => {
  const value = query.value.toLocaleLowerCase();
  return value ? workflows.value.filter(({ name }) => name.toLocaleLowerCase().includes(value)) : workflows.value;
});

onMounted(async () => {
  window.addEventListener("keydown", handleKeyboardShortcut);
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  ready.value = true;
  try {
    workflows.value = (await api<{ workflows: WorkflowSummary[] }>("/api/workflows")).workflows;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法加载工作流。";
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => window.removeEventListener("keydown", handleKeyboardShortcut));

async function createWorkflow() {
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ workflow: WorkflowSummary }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name: newWorkflowName.value }),
    });
    await router.push(`/workflows/${result.workflow.id}`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建工作流失败。";
  } finally {
    working.value = false;
  }
}

async function openCreator() {
  showCreator.value = true;
  await nextTick();
  workflowNameInput.value?.focus();
}

async function cancelCreate() {
  if (working.value) return;
  showCreator.value = false;
  newWorkflowName.value = "";
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

async function openWorkflow(workflowId: string) {
  await router.push(`/workflows/${workflowId}`);
}

function handleKeyboardShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
</script>

<style scoped lang="scss">
.pageShell {
  min-height: 100dvh;
  color: var(--cr-text-primary);
  background: var(--cr-page-background);
}

.workflowMain {
  width: min(100% - 48px, 1180px);
  margin: 0 auto;
  padding: 24px 0 24px;
}

.pageHeading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;

  h1 { margin: 0; font-size: 20px; font-weight: 620; letter-spacing: -.02em; line-height: 1.5; }
  p { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; }
}

.primaryButton, .textButton {
  border: 0;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  transition: transform .18s, box-shadow .18s, background .18s;
}

.primaryButton {
  padding: 12px 16px;
  border-radius: 6px;
  color: var(--cr-text-primary);
  background: var(--cr-gradient);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--cr-brand-primary) 25%, transparent);

  &:hover { box-shadow: 0 3px 8px color-mix(in srgb, var(--cr-brand-primary) 22%, transparent); transform: translateY(-1px); }
  &:active { transform: translateY(1px); }
  &:disabled { opacity: .48; cursor: default; box-shadow: none; transform: none; }
}

.textButton {
  padding: 8px 12px;
  border-radius: 6px;
  color: var(--cr-brand-primary);
  background: transparent;

  &:hover { background: var(--cr-surface-hover); }
  &:disabled { opacity: .48; cursor: default; }
}

.workflowLibrary { margin-top: 24px; }
.libraryHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--cr-border-subtle);
}
.libraryTitle {
  display: flex;
  align-items: baseline;
  gap: 12px;

  h2 { margin: 0; font-size: 20px; font-weight: 620; }
  span { color: var(--cr-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
}
.searchField {
  position: relative;
  display: flex;
  align-items: center;

  input { width: min(35vw, 260px); padding: 8px 58px 8px 12px; border: 1px solid var(--cr-border-strong); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; }
  input::placeholder { color: var(--cr-text-muted); }
  input:focus { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; border-color: var(--cr-border-focus); box-shadow: var(--cr-selection-ring); }
  kbd { position: absolute; right: 10px; color: var(--cr-text-muted); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; pointer-events: none; }
}
.srOnly { width: 1px; height: 1px; position: absolute; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

.workflowGrid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(275px, 1fr));
  gap: 16px;
}
.workflowCard {
  min-width: 0;

  button { width: 100%; height: 100%; padding: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--cr-border-subtle); border-radius: 8px; color: var(--cr-text-primary); background: var(--cr-surface); text-align: left; cursor: pointer; box-shadow: 0 1px 3px color-mix(in srgb, var(--cr-text-primary) 6%, transparent); transition: transform .2s, border-color .2s, box-shadow .2s; }
  button:hover { border-color: var(--cr-border-strong); box-shadow: 0 4px 12px color-mix(in srgb, var(--cr-text-primary) 10%, transparent); transform: translateY(-2px); }
  button:active { transform: translateY(-1px); }

}
.cardContent { min-height: 120px; flex: 1; padding: 16px; display: flex; flex-direction: column; }
.cardTitle { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 14px; font-weight: 600; line-height: 1.5; }
.cardMeta { margin-top: 8px; color: var(--cr-text-secondary); font-size: 12px; }
.cardMeta span { padding: 0 4px; }
.cardFooter { margin-top: auto; padding-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--cr-text-muted); font-size: 12px; }
.cardFooter strong { color: var(--cr-brand-primary); font-size: 12px; font-weight: 690; white-space: nowrap; }
.cardFooter strong span { margin-left: 4px; }

.skeletonCard { height: 120px; border-radius: 8px; background: linear-gradient(90deg, var(--cr-surface-hover), var(--cr-surface-subtle), var(--cr-surface-hover)); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
.emptyState { min-height: 300px; display: grid; place-content: center; justify-items: center; text-align: center; }
.emptyState h2 { margin: 0; font-size: 20px; font-weight: 620; }
.emptyState p { margin: 8px 0 16px; color: var(--cr-text-secondary); font-size: 14px; }
.errorMessage { margin-top: 24px; color: var(--cr-danger); font-size: 12px; }

.dialogBackdrop { position: fixed; z-index: 80; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, var(--cr-text-primary) 34%, transparent); backdrop-filter: blur(3px); }
.createDialog { width: min(100%, 470px); padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; color: var(--cr-text-primary); background: var(--cr-surface); box-shadow: 0 4px 12px color-mix(in srgb, var(--cr-text-primary) 10%, transparent); }
.dialogHeading h2 { margin: 0; font-size: 20px; font-weight: 620; }
.dialogHeading p { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; }
.createDialog form { margin-top: 16px; display: grid; gap: 8px; }
.createDialog label { font-size: 14px; font-weight: 600; }
.createDialog input { width: 100%; padding: 8px 12px; border: 1px solid var(--cr-border-strong); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; }
.createDialog input::placeholder { color: var(--cr-text-muted); }
.createDialog input:focus { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; box-shadow: var(--cr-selection-ring); }
.creatorActions { margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; }
.dialogFade-enter-active, .dialogFade-leave-active { transition: opacity .2s ease; }
.dialogFade-enter-from, .dialogFade-leave-to { opacity: 0; }

@keyframes shimmer { to { background-position: -200% 0; } }

@media (max-width: 640px) {
  .workflowMain { width: min(100% - 24px, 1180px); padding-top: 24px; }
  .pageHeading { align-items: flex-start; gap: 12px; }
  .pageHeading h1 { font-size: 20px; }
  .pageHeading .primaryButton { flex: 0 0 auto; padding: 8px 12px; }
  .workflowLibrary { margin-top: 24px; }
  .libraryHeader { align-items: stretch; flex-direction: column; gap: 12px; }
  .searchField input { width: 100%; }
  .searchField kbd { display: none; }
  .workflowGrid { grid-template-columns: 1fr; }
  .createDialog { padding: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .primaryButton, .textButton, .workflowCard button, .dialogFade-enter-active, .dialogFade-leave-active { transition: none; }
  .primaryButton:hover, .primaryButton:active, .workflowCard button:hover, .workflowCard button:active { transform: none; }
  .dialogFade-enter-from .createDialog, .dialogFade-leave-to .createDialog { transform: none; }
  .skeletonCard { animation: none; }
}
</style>
