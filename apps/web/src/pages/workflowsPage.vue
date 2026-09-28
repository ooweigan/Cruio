<template>
  <div class="pageShell">
    <cruioHeader />
    <main v-if="ready" class="workflowMain">
      <div class="pageHeading">
        <div>
          <h1>工作流</h1>
          <p>独立编排创作步骤，再将同一个版本引入需要它的项目。</p>
        </div>
        <button class="primaryButton" type="button" @click="showCreator = true">新建工作流</button>
      </div>

      <form v-if="showCreator" class="createForm" @submit.prevent="createWorkflow">
        <label for="workflowName">工作流名称</label>
        <div class="createFields">
          <input id="workflowName" v-model.trim="newWorkflowName" maxlength="120" placeholder="例如：主视觉生成" autofocus />
          <button class="primaryButton" type="submit" :disabled="working || !newWorkflowName">创建并打开</button>
          <button class="textButton" type="button" @click="cancelCreate">取消</button>
        </div>
      </form>

      <section aria-labelledby="workflowListHeading">
        <div class="sectionHeading">
          <h2 id="workflowListHeading">我的工作流</h2>
          <span>{{ workflows.length }} 个</span>
        </div>
        <div v-if="workflows.length" class="workflowGrid">
          <article v-for="workflow in workflows" :key="workflow.id" class="workflowCard">
            <button type="button" @click="router.push(`/workflows/${workflow.id}`)">
              <span class="cardAccent" />
              <span class="workflowName">{{ workflow.name }}</span>
              <span class="workflowMeta">{{ workflow.nodeCount }} 个节点 · 最新版本 {{ workflow.version }}</span>
              <span class="cardFooter"><span>更新于 {{ formatDate(workflow.updatedAt) }}</span><strong>打开图</strong></span>
            </button>
          </article>
        </div>
        <div v-else-if="!loading" class="emptyState">
          <h2>还没有工作流</h2>
          <p>建立工作流后，可以在不同项目中重复引入。</p>
        </div>
      </section>
      <p v-if="message" class="errorMessage">{{ message }}</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
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
const newWorkflowName = ref("");
const showCreator = ref(false);
const ready = ref(false);
const loading = ref(true);
const working = ref(false);
const message = ref("");

onMounted(async () => {
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

function cancelCreate() {
  showCreator.value = false;
  newWorkflowName.value = "";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}
</script>

<style scoped lang="scss">
.pageShell {
  min-height: 100dvh;
  background: var(--cr-page-background);
}

.workflowMain {
  width: min(100% - 48px, 1180px);
  margin: 0 auto;
  padding: 48px 0 96px;

  .pageHeading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;

    h1 { margin: 0; font-size: clamp(2rem, 4vw, 2.65rem); font-weight: 580; letter-spacing: -.025em; }
    p { margin: 8px 0 0; color: #5f6368; font-size: .93rem; }
  }

  .primaryButton, .textButton {
    padding: 11px 19px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-size: .84rem;
    font-weight: 650;
    cursor: pointer;
  }

  .primaryButton { color: #28242e; background: var(--cr-gradient); }
  .primaryButton:disabled { opacity: .48; cursor: default; }
  .textButton { color: #5f5bd7; background: transparent; }

  .createForm {
    margin-top: 30px;
    padding: 24px;
    border: 1px solid #e0e3e7;
    border-radius: 18px;
    background: white;

    label { display: block; margin-bottom: 10px; font-size: .82rem; font-weight: 650; }
    .createFields { display: flex; align-items: center; gap: 10px; }
    input { min-width: 0; flex: 1; padding: 12px 15px; border: 1px solid #c9cdd2; border-radius: 12px; font: inherit; }
  }

  section { margin-top: 60px; }
  .sectionHeading { display: flex; align-items: baseline; gap: 12px; }
  .sectionHeading h2 { margin: 0; font-size: 1.2rem; font-weight: 620; }
  .sectionHeading span { color: #777b82; font-size: .78rem; }

  .workflowGrid {
    margin-top: 22px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .workflowCard {
    min-height: 210px;

    button {
      width: 100%;
      height: 100%;
      padding: 0;
      display: grid;
      grid-template-rows: 7px 1fr auto auto;
      border: 1px solid #e0e3e7;
      border-radius: 18px;
      overflow: hidden;
      color: #202124;
      background: white;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(60, 64, 67, .06);
    }
    button:hover { box-shadow: 0 4px 12px rgba(60, 64, 67, .12); }
    .cardAccent { background: var(--cr-gradient); }
    .workflowName { align-self: end; padding: 24px 24px 7px; font-size: 1.08rem; font-weight: 620; }
    .workflowMeta { padding: 0 24px 20px; color: #74777c; font-size: .77rem; }
    .cardFooter { margin: 0 24px; padding: 15px 0 18px; display: flex; justify-content: space-between; border-top: 1px solid #eceef1; color: #74777c; font-size: .77rem; }
    .cardFooter strong { color: #5f5bd7; }
  }

  .emptyState { margin-top: 22px; padding: 58px 24px; border: 1px dashed #cdd0d5; border-radius: 18px; text-align: center; }
  .emptyState h2 { margin: 0; font-size: 1.35rem; }
  .emptyState p { color: #6f7277; }
  .errorMessage { color: var(--cr-danger); font-size: .84rem; }
}

@media (max-width: 800px) {
  .workflowMain .workflowGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .workflowMain { width: min(100% - 28px, 1180px); }
  .workflowMain .pageHeading { align-items: flex-start; }
  .workflowMain .workflowGrid { grid-template-columns: 1fr; }
  .workflowMain .createForm .createFields { align-items: stretch; flex-direction: column; }
}
</style>
