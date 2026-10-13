<template>
  <div class="tasksPage">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading">
        <div><p class="eyebrow">创作记录</p><h1>生成任务</h1><p>每项操作都回到原任务查询或取回，不会自动创建新的生成任务。</p></div>
        <button class="secondaryButton" type="button" :disabled="loading" @click="loadTasks()">{{ loading ? "正在刷新…" : "刷新任务" }}</button>
      </header>
      <p v-if="pageError" class="feedback error" role="alert">{{ pageError }}</p>
      <p v-if="pageMessage" class="feedback success" role="status">{{ pageMessage }}</p>
      <p v-if="loading && !tasks.length" class="emptyState">正在读取任务…</p>
      <p v-else-if="!tasks.length" class="emptyState">暂无生成任务。</p>
      <section class="taskList" aria-label="本人生成任务">
        <article v-for="task in tasks" :key="task.taskId" class="taskCard">
          <div class="taskHeading">
            <div><p class="eyebrow">{{ operationLabel(task.operation) }}</p><h2>{{ task.modelSnapshot?.providerLabel ?? task.modelSnapshot?.modelId ?? "生成任务" }}</h2></div>
            <span class="statusBadge" :class="`status${task.status}`">{{ statusLabel(task.status) }}</span>
          </div>
          <p class="taskMeta">{{ formatDate(task.createdAt) }} · {{ task.taskId }}</p>
          <p v-if="task.credits" class="creditSummary">预占 {{ task.credits.reserved }} / 报价 {{ task.credits.quoted }} · 实结 {{ task.credits.settled }} · 释放 {{ task.credits.released }}<span v-if="task.credits.needsReview"> · 账本待核查</span></p>
          <p v-if="task.failure" class="safeFailure">{{ task.failure }}</p>
          <div v-if="task.results.length" class="resultList">
            <article v-for="result in task.results" :key="result.resultId" class="resultCard">
              <img v-if="result.mediaType === 'image'" :src="result.previewUrl" alt="任务结果" />
              <video v-else :src="result.previewUrl" controls aria-label="任务结果" />
              <div><strong>{{ result.mediaType === "image" ? "图片结果" : "视频结果" }}</strong><a :href="result.downloadUrl" download>下载结果</a></div>
            </article>
          </div>
          <div v-if="task.timeline.length" class="timeline">
            <h3>状态时间线</h3>
            <ol><li v-for="(event, index) in task.timeline" :key="`${task.taskId}-${index}`">
              <span class="timelineMark" aria-hidden="true"></span><div><strong>{{ eventLabel(event.type) }}</strong><p v-if="event.message">{{ event.message }}</p><time>{{ formatDate(event.createdAt) }}</time></div>
            </li></ol>
          </div>
          <div class="taskActions">
            <button class="secondaryButton" type="button" @click="contactSupport(task.taskId)">联系支持</button>
            <button v-if="['unknown', 'running'].includes(task.status)" class="secondaryButton" type="button" :disabled="busyTaskId === task.taskId" @click="runTaskAction(task, 'continueQuery')">继续查询原任务</button>
            <button v-if="['unknown', 'running'].includes(task.status)" class="secondaryButton" type="button" :disabled="busyTaskId === task.taskId" @click="runTaskAction(task, 'retrieveResult')">重新取得原结果</button>
            <button v-if="['queued', 'running', 'unknown'].includes(task.status)" class="textButton" type="button" :disabled="busyTaskId === task.taskId" @click="runTaskAction(task, 'requestCancel')">{{ task.status === "queued" ? "取消未提交任务" : "记录取消请求" }}</button>
            <small v-if="['running', 'unknown'].includes(task.status)" class="cancelNote">当前渠道没有已接入的自动取消命令；此操作只记录请求并继续核查，任务仍可能执行。</small>
          </div>
        </article>
      </section>
      <button v-if="taskCursor" class="secondaryButton loadMore" type="button" :disabled="loadingMoreTasks" @click="loadTasks(false)">{{ loadingMoreTasks ? "正在加载…" : "加载更多任务" }}</button>

      <section v-if="isModelOperator" class="operationsSection" aria-labelledby="reviewHeading">
        <header class="sectionHeading"><div><p class="eyebrow">受限岗位</p><h2 id="reviewHeading">异常任务核查</h2><p>只显示授权范围内的异常任务。最终无法交付需要两侧证据、结论依据和当前密码。</p></div><button class="secondaryButton" type="button" :disabled="loadingOperations" @click="loadOperations()">{{ loadingOperations ? "正在刷新…" : "刷新待办" }}</button></header>
        <p v-if="operationsError" class="feedback error" role="alert">{{ operationsError }}</p>
        <p v-if="!loadingOperations && !reviewTasks.length" class="emptyState">当前授权范围内没有待核查任务。</p>
        <article v-for="task in reviewTasks" :key="task.id" class="reviewCard">
          <div class="taskHeading"><div><p class="eyebrow">{{ task.status }} · 用户 {{ task.userId }}</p><h3>{{ task.modelId }}</h3></div><time>{{ formatDate(task.updatedAt) }}</time></div>
          <p class="taskMeta">任务 {{ task.id }} · 供应商状态 {{ task.providerStatus || "未知" }} · 原任务标识 {{ task.providerTaskId || "暂无" }}</p>
          <p v-if="task.safeError" class="safeFailure">{{ task.safeError }}</p>
          <ol v-if="task.timeline.length" class="operatorTimeline"><li v-for="(event, index) in task.timeline" :key="`${task.id}-operator-${index}`"><strong>{{ eventLabel(event.eventType) }}</strong><time>{{ formatDate(event.createdAt) }}</time><pre>{{ JSON.stringify(event.details, null, 2) }}</pre></li></ol>
          <div class="taskActions"><button class="secondaryButton" type="button" :disabled="busyOperationTaskId === task.id" @click="runOperationsAction(task, 'continueQuery')">继续查询原任务</button><button class="secondaryButton" type="button" :disabled="busyOperationTaskId === task.id" @click="runOperationsAction(task, 'retrieveResult')">重新取得原结果</button></div>
          <ol v-if="task.attempts.length" class="attemptList"><li v-for="attempt in task.attempts" :key="attempt.id"><strong>{{ eventLabel(attempt.phase) }} · {{ attempt.providerStatus || "无供应商状态" }}</strong><code>{{ attempt.id }}</code><p v-if="attempt.safeError">{{ attempt.safeError }}</p></li></ol>
          <form class="reviewForm" @submit.prevent="submitReview(task)">
            <label>供应商证据引用<input v-model="reviewInputs[task.id].supplierReference" required minlength="6" maxlength="256" :placeholder="task.providerTaskId || '无原任务ID时，以“未受理核查：”开头'" /></label>
            <label>供应商原任务证据<textarea v-model="reviewInputs[task.id].supplierEvidence" required minlength="20" maxlength="3000" placeholder="记录可复查的供应商原任务状态与证据摘要" /></label>
            <label>关联的平台失败尝试<select v-model="reviewInputs[task.id].platformAttemptId" required><option value="" disabled>选择有安全失败摘要的尝试</option><option v-for="attempt in eligibleAttempts(task)" :key="attempt.id" :value="attempt.id">{{ eventLabel(attempt.phase) }} · {{ formatDate(attempt.createdAt) }} · {{ attempt.id }}</option></select></label>
            <label>平台取得／访问失败证据<textarea v-model="reviewInputs[task.id].platformEvidence" required minlength="20" maxlength="3000" placeholder="说明所选服务端失败尝试对应的同一结果取得或访问失败" /></label>
            <label>最终结论依据<textarea v-model="reviewInputs[task.id].reason" required minlength="10" maxlength="1000" placeholder="说明为何已无法恢复交付" /></label>
            <label>当前密码<input v-model="reviewInputs[task.id].currentPassword" type="password" autocomplete="current-password" required /></label>
            <button class="dangerButton" type="submit" :disabled="reviewingTaskId === task.id">{{ reviewingTaskId === task.id ? "正在登记…" : "确认最终无法交付并释放预占" }}</button>
          </form>
        </article>
        <button v-if="operationsCursor" class="secondaryButton loadMore" type="button" :disabled="loadingOperations" @click="loadOperations(false)">{{ loadingOperations ? "正在加载…" : "加载更多待办" }}</button>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type TimelineEvent = { type: string; message?: string; createdAt: string };
type Task = {
  taskId: string; status: string; operation: string; createdAt: string; updatedAt: string; failure?: string;
  credits?: { quoted: number; reserved: number; settled: number; released: number; needsReview?: boolean };
  modelSnapshot?: { modelId?: string; providerLabel?: string }; results: { resultId: string; mediaType: string; previewUrl: string; downloadUrl: string }[];
  timeline: TimelineEvent[];
};
type ReviewTask = {
  id: string; userId: string; status: string; modelId: string; providerTaskId: string | null; providerStatus: string | null;
  safeError: string | null; updatedAt: string; timeline: { eventType: string; details: Record<string, unknown>; createdAt: string }[];
  attempts: { id: string; phase: string; safeError: string | null; providerTaskId: string | null; providerStatus: string | null; createdAt: string }[];
};
type ReviewInput = { supplierReference: string; supplierEvidence: string; platformAttemptId: string; platformEvidence: string; reason: string; currentPassword: string };

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const tasks = ref<Task[]>([]);
const reviewTasks = ref<ReviewTask[]>([]);
const reviewInputs = reactive<Record<string, ReviewInput>>({});
const actionKeys = reactive<Record<string, string>>({});
const reviewKeys = reactive<Record<string, string>>({});
const loading = ref(true);
const loadingOperations = ref(false);
const loadingMoreTasks = ref(false);
const busyTaskId = ref("");
const busyOperationTaskId = ref("");
const reviewingTaskId = ref("");
const taskCursor = ref<string | null>(null);
const operationsCursor = ref<string | null>(null);
const pageError = ref("");
const pageMessage = ref("");
const operationsError = ref("");
const isModelOperator = computed(() => session.user?.roles?.some(role => role.role === "modelOperator") ?? false);

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
function statusLabel(value: string) {
  return ({ queued: "排队中", running: "处理中", unknown: "待核查", failed: "未交付", cancelled: "已取消（未提交）", delivered: "已交付", succeeded: "待保存" } as Record<string, string>)[value] ?? "状态更新中";
}
function operationLabel(value: string) { return ({ "image.generate": "图片生成", "video.generate": "视频生成" } as Record<string, string>)[value] ?? "创作任务"; }
function eventLabel(value: string) {
  return ({ submitting: "开始提交", accepted: "供应商已受理", polling: "查询原任务", unknown: "状态待核查", continueQuery: "请求继续查询", retrieveResult: "请求重新取得结果", requestCancel: "取消请求已记录", operatorContinueQuery: "运营请求查询原任务", operatorRetrieveResult: "运营请求重新取得结果", finalUndeliverable: "登记最终无法交付" } as Record<string, string>)[value] ?? "任务状态记录";
}
async function loadTasks(reset = true) {
  if (reset) { loading.value = true; taskCursor.value = null; }
  else loadingMoreTasks.value = true;
  pageError.value = "";
  try {
    const params = new URLSearchParams({ limit: "50" });
    if (!reset && taskCursor.value) params.set("cursor", taskCursor.value);
    const result = await api<{ tasks: Task[]; nextCursor: string | null }>(`/api/generation/tasks?${params}`);
    tasks.value = reset ? result.tasks ?? [] : [...tasks.value, ...(result.tasks ?? [])];
    taskCursor.value = result.nextCursor;
  } catch (error) { pageError.value = error instanceof Error ? error.message : "任务读取失败。"; }
  finally { loading.value = false; loadingMoreTasks.value = false; }
}
function ensureReviewInputs(task: ReviewTask) {
  reviewInputs[task.id] ??= { supplierReference: task.providerTaskId ?? "", supplierEvidence: "", platformAttemptId: eligibleAttempts(task).at(-1)?.id ?? "", platformEvidence: "", reason: "", currentPassword: "" };
}
function eligibleAttempts(task: ReviewTask) { return task.attempts.filter(attempt => ["unknown", "failed"].includes(attempt.phase) && attempt.safeError); }
function getActionKey(key: string) { return actionKeys[key] ??= crypto.randomUUID(); }
function contactSupport(taskId: string) { void router.push({ path: "/support", query: { category: "generation", sourceId: taskId } }); }
async function loadOperations(reset = true) {
  if (!isModelOperator.value) return;
  loadingOperations.value = true;
  operationsError.value = "";
  try {
    const params = new URLSearchParams({ limit: "50" });
    if (!reset && operationsCursor.value) params.set("cursor", operationsCursor.value);
    const result = await api<{ tasks: ReviewTask[]; nextCursor: string | null }>(`/api/operations/generation/tasks?${params}`);
    reviewTasks.value = reset ? result.tasks ?? [] : [...reviewTasks.value, ...(result.tasks ?? [])];
    operationsCursor.value = result.nextCursor;
    reviewTasks.value.forEach(ensureReviewInputs);
  } catch (error) { operationsError.value = error instanceof Error ? error.message : "核查待办读取失败。"; }
  finally { loadingOperations.value = false; }
}
async function runTaskAction(task: Task, action: "continueQuery" | "retrieveResult" | "requestCancel") {
  busyTaskId.value = task.taskId;
  pageError.value = "";
  pageMessage.value = "";
  try {
    const message = await api<{ message: string }>(`/api/generation/tasks/${encodeURIComponent(task.taskId)}/actions`, {
      method: "POST", body: JSON.stringify({ action, idempotencyKey: getActionKey(`${task.taskId}:${action}`) }),
    });
    pageMessage.value = message.message;
    delete actionKeys[`${task.taskId}:${action}`];
    await loadTasks();
  } catch (error) { pageError.value = error instanceof Error ? error.message : "任务操作未能记录。"; }
  finally { busyTaskId.value = ""; }
}
async function runOperationsAction(task: ReviewTask, action: "continueQuery" | "retrieveResult") {
  const key = `${task.id}:operator:${action}`;
  busyOperationTaskId.value = task.id;
  operationsError.value = "";
  try {
    const result = await api<{ message: string }>(`/api/operations/generation/tasks/${encodeURIComponent(task.id)}/actions`, {
      method: "POST", body: JSON.stringify({ action, idempotencyKey: getActionKey(key) }),
    });
    pageMessage.value = result.message;
    delete actionKeys[key];
    await loadOperations();
  } catch (error) { operationsError.value = error instanceof Error ? error.message : "原任务查询请求未能记录。"; }
  finally { busyOperationTaskId.value = ""; }
}
async function submitReview(task: ReviewTask) {
  const input = reviewInputs[task.id];
  reviewingTaskId.value = task.id;
  operationsError.value = "";
  try {
    const result = await api<{ message: string }>(`/api/operations/generation/tasks/${encodeURIComponent(task.id)}/review`, {
      method: "POST", body: JSON.stringify({ outcome: "finalUndeliverable", ...input,
        expectedUpdatedAt: task.updatedAt, idempotencyKey: reviewKeys[task.id] ??= crypto.randomUUID() }),
    });
    pageMessage.value = result.message;
    delete reviewKeys[task.id];
    delete reviewInputs[task.id];
    await Promise.all([loadOperations(), loadTasks()]);
  } catch (error) { operationsError.value = error instanceof Error ? error.message : "核查结论登记失败。"; }
  finally { reviewingTaskId.value = ""; }
}
onMounted(async () => {
  await session.refresh();
  if (!session.user) { await router.replace({ name: "login", query: { next: route.fullPath } }); return; }
  await Promise.all([loadTasks(), isModelOperator.value ? loadOperations() : Promise.resolve()]);
});
</script>

<style scoped lang="scss">
.tasksPage { min-height: 100dvh; background: var(--cr-page-background); color: var(--cr-text-primary); font-size: 14px; }
.pageContent { width: min(1080px, 100%); margin: 0 auto; padding: 24px 24px 48px; }
.pageHeading, .sectionHeading { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.pageHeading { margin-bottom: 24px; h1 { margin: 0; font-size: 20px; } p:not(.eyebrow) { margin: 8px 0 0; color: var(--cr-text-secondary); } }
.eyebrow { margin: 0 0 8px; color: var(--cr-text-muted); font-size: 12px; }
.taskList, .operationsSection { display: grid; gap: 12px; }
.taskCard, .operationsSection { padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.taskHeading { display: flex; align-items: start; justify-content: space-between; gap: 12px; h2, h3 { margin: 0; font-size: 16px; } }
.statusBadge { flex: none; border-radius: 999px; padding: 4px 8px; background: var(--cr-surface-hover); font-size: 12px; }
.statusunknown { color: var(--cr-status-warning); background: color-mix(in srgb, var(--cr-status-warning) 14%, var(--cr-surface)); }.statusfailed { color: var(--cr-status-danger); background: color-mix(in srgb, var(--cr-status-danger) 10%, var(--cr-surface)); }.statusdelivered { color: var(--cr-status-success); background: color-mix(in srgb, var(--cr-status-success) 12%, var(--cr-surface)); }
.taskMeta { overflow-wrap: anywhere; color: var(--cr-text-muted); font-size: 12px; }
.creditSummary { color: var(--cr-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.cancelNote { align-self: center; color: var(--cr-text-muted); font-size: 12px; }
.safeFailure { border-left: 3px solid var(--cr-status-warning); padding: 8px 12px; color: var(--cr-text-secondary); background: var(--cr-surface-subtle); }
.resultList { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }
.resultCard { overflow: hidden; border: 1px solid var(--cr-border-subtle); border-radius: 6px; img, video { display: block; width: 100%; max-height: 320px; object-fit: contain; background: var(--cr-surface-subtle); } > div { display: flex; justify-content: space-between; gap: 12px; padding: 12px; } }
.timeline { margin-top: 16px; h3 { margin: 0 0 8px; font-size: 14px; } ol { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; } li { display: grid; grid-template-columns: 12px 1fr; gap: 8px; } li > div { display: grid; gap: 4px; } p { margin: 0; color: var(--cr-text-secondary); } time { color: var(--cr-text-muted); font-size: 12px; } }
.timelineMark { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: var(--cr-brand-primary); }
.taskActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.secondaryButton, .dangerButton { min-height: 36px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); cursor: pointer; font-size: 14px; &:disabled { cursor: not-allowed; opacity: .55; } }
.textButton { border: 0; padding: 8px; color: var(--cr-text-secondary); background: transparent; cursor: pointer; }
.operationsSection { margin-top: 24px; }.sectionHeading { padding-bottom: 16px; border-bottom: 1px solid var(--cr-border-subtle); h2 { margin: 0; font-size: 18px; } p:not(.eyebrow) { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 12px; } }
.reviewCard { display: grid; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--cr-border-subtle); &:last-child { border-bottom: 0; } }
.operatorTimeline { display: grid; gap: 8px; padding-left: 16px; color: var(--cr-text-secondary); time { margin-left: 8px; color: var(--cr-text-muted); font-size: 12px; } pre { overflow: auto; max-height: 180px; padding: 8px; background: var(--cr-surface-subtle); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; } }
.attemptList { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; li { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; } code { color: var(--cr-text-muted); font-size: 12px; overflow-wrap: anywhere; } p { margin: 0; color: var(--cr-text-secondary); font-size: 12px; } }
.reviewForm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; label { display: grid; gap: 8px; font-size: 12px; color: var(--cr-text-secondary); } textarea, input, select { width: 100%; border: 1px solid var(--cr-border-strong); border-radius: 6px; padding: 8px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; } textarea { min-height: 82px; resize: vertical; } .dangerButton { align-self: end; color: var(--cr-status-danger); border-color: color-mix(in srgb, var(--cr-status-danger) 40%, var(--cr-surface)); } }
.loadMore { justify-self: center; margin: 16px auto 0; }
.feedback, .emptyState { padding: 12px 0; color: var(--cr-text-muted); }.error { color: var(--cr-status-danger); }.success { color: var(--cr-status-success); }
@media (max-width: 680px) { .pageContent { padding: 24px 12px 48px; }.pageHeading { align-items: start; flex-direction: column; }.reviewForm { grid-template-columns: 1fr; }.taskHeading { flex-direction: column; } }
</style>
