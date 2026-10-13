<template>
  <div class="appContainer">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading">
        <div><p class="eyebrow">帮助与核查</p><h1>客服工单</h1><p>工单用于沟通和转交，不会直接更改任务或积分账本。</p></div>
        <button class="secondaryButton" type="button" :disabled="loading" @click="refreshLists">刷新记录</button>
      </header>
      <p v-if="pageError" class="feedback error" role="alert">{{ pageError }}</p>
      <p v-if="pageMessage" class="feedback success" role="status">{{ pageMessage }}</p>

      <section class="createPanel" aria-labelledby="createHeading">
        <h2 id="createHeading">新建工单</h2>
        <p class="helperText">请勿提交密码、供应商密钥、银行卡信息或无关他人隐私。关联对象仅限本人可访问的任务或积分账单。</p>
        <form class="ticketForm" @submit.prevent="createTicket">
          <label>问题类别<select v-model="newTicket.category"><option value="generation">生成任务</option><option value="credits">积分账单</option><option value="access">账户与访问</option><option value="other">其他问题</option></select></label>
          <label>主题<input v-model="newTicket.subject" required minlength="2" maxlength="120" /></label>
          <label class="wideField">问题说明<textarea v-model="newTicket.description" required minlength="10" maxlength="4000" rows="4" /></label>
          <label>关联任务 ID{{ newTicket.category === "generation" ? "（必填）" : "（可选）" }}<input v-model="newTicket.relatedTaskId" :required="newTicket.category === 'generation'" autocomplete="off" /></label>
          <label>关联积分账单 ID{{ newTicket.category === "credits" ? "（必填）" : "（可选）" }}<input v-model="newTicket.relatedLedgerId" :required="newTicket.category === 'credits'" autocomplete="off" /></label>
          <button class="primaryButton" type="submit" :disabled="creating">{{ creating ? "正在提交…" : "提交工单" }}</button>
        </form>
      </section>

      <div class="contentGrid">
        <section class="listPanel" aria-labelledby="myTicketsHeading">
          <header class="panelHeading"><div><p class="eyebrow">本人记录</p><h2 id="myTicketsHeading">我的工单</h2></div><span>{{ myTickets.length }}</span></header>
          <p v-if="loading && !myTickets.length" class="emptyState">正在读取工单…</p>
          <p v-else-if="!myTickets.length" class="emptyState">暂无工单。</p>
          <button v-for="ticket in myTickets" :key="ticket.id" class="ticketRow" :class="{ selectedRow: selectedMyTicket?.id === ticket.id }" type="button" @click="openMyTicket(ticket.id)">
            <span class="ticketRowHeading"><strong>{{ ticket.subject }}</strong><span class="statusBadge">{{ statusLabel(ticket.status) }}</span></span>
            <span class="ticketMeta">{{ ticket.number }} · {{ categoryLabel(ticket.category) }} · {{ formatDate(ticket.updatedAt) }}</span>
          </button>
          <button v-if="myTicketCursor" class="secondaryButton loadMore" type="button" :disabled="loadingMoreMy" @click="loadMyTickets(false)">{{ loadingMoreMy ? "正在加载…" : "加载更多" }}</button>
        </section>

        <section v-if="selectedMyTicket" class="detailPanel" aria-labelledby="userTicketHeading">
          <header class="detailHeading"><div><p class="eyebrow">{{ selectedMyTicket.number }} · {{ categoryLabel(selectedMyTicket.category) }}</p><h2 id="userTicketHeading">{{ selectedMyTicket.subject }}</h2></div><span class="statusBadge">{{ statusLabel(selectedMyTicket.status) }}</span></header>
          <p class="detailText">{{ selectedMyTicket.description }}</p>
          <p v-if="selectedMyTicket.related" class="relatedSummary">{{ relatedLabel(selectedMyTicket.related) }}</p>
          <ol class="messageList"><li v-for="message in selectedMyTicket.messages" :key="message.id" :class="message.authorRole === 'user' ? 'ownMessage' : 'staffMessage'">
            <strong>{{ message.authorRole === "user" ? "我" : "客服" }}</strong><p>{{ message.body }}</p><time>{{ formatDate(message.createdAt) }}</time>
          </li></ol>
          <form v-if="!isClosed(selectedMyTicket.status)" class="inlineForm" @submit.prevent="replyToTicket">
            <label>补充说明<textarea v-model="userReply" required maxlength="4000" rows="3" /></label>
            <button class="secondaryButton" type="submit" :disabled="replying">{{ replying ? "正在发送…" : "发送补充" }}</button>
          </form>
          <form v-else-if="selectedMyTicket.status === 'closed'" class="inlineForm" @submit.prevent="reopenTicket">
            <label>申请重开的原因<textarea v-model="reopenReason" required minlength="3" maxlength="500" rows="2" /></label>
            <button class="secondaryButton" type="submit" :disabled="reopening">{{ reopening ? "正在提交…" : "申请重开" }}</button>
          </form>
        </section>
      </div>

      <section v-if="isStaff" class="operationsSection" aria-labelledby="queueHeading">
        <header class="panelHeading"><div><p class="eyebrow">岗位授权</p><h2 id="queueHeading">待处理工单</h2><p>业务岗位仅查看被转交对象的安全摘要；源事实必须回到对应业务页面核验。</p></div><button class="secondaryButton" type="button" :disabled="loadingQueue" @click="loadQueue(true)">刷新队列</button></header>
        <div class="contentGrid">
          <div class="listPanel">
            <p v-if="loadingQueue && !queueTickets.length" class="emptyState">正在读取待处理工单…</p>
            <p v-else-if="!queueTickets.length" class="emptyState">当前岗位范围内暂无工单。</p>
            <button v-for="ticket in queueTickets" :key="ticket.id" class="ticketRow" :class="{ selectedRow: selectedOpsTicket?.ticket.id === ticket.id }" type="button" @click="openOpsTicket(ticket.id)">
              <span class="ticketRowHeading"><strong>{{ ticket.subject }}</strong><span class="statusBadge">{{ statusLabel(ticket.status) }}</span></span>
              <span class="ticketMeta">{{ ticket.number }} · {{ categoryLabel(ticket.category) }} · {{ ticket.assignedRole }}</span>
            </button>
            <button v-if="queueCursor" class="secondaryButton loadMore" type="button" :disabled="loadingMoreQueue" @click="loadQueue(false)">{{ loadingMoreQueue ? "正在加载…" : "加载更多" }}</button>
          </div>
          <section v-if="selectedOpsTicket" class="detailPanel" aria-labelledby="staffTicketHeading">
            <header class="detailHeading"><div><p class="eyebrow">{{ selectedOpsTicket.ticket.number }} · {{ categoryLabel(selectedOpsTicket.ticket.category) }}</p><h3 id="staffTicketHeading">{{ selectedOpsTicket.role === "support" ? selectedOpsTicket.ticket.subject : "关联业务待核查" }}</h3></div><span class="statusBadge">{{ statusLabel(selectedOpsTicket.ticket.status) }}</span></header>
            <p v-if="selectedOpsTicket.related" class="relatedSummary">{{ relatedLabel(selectedOpsTicket.related) }}</p>
            <template v-if="selectedOpsTicket.role === 'support'">
              <p class="detailText">{{ selectedOpsTicket.ticket.description }}</p>
              <ol class="messageList"><li v-for="message in selectedOpsTicket.ticket.messages" :key="message.id" :class="message.audience === 'internal' ? 'internalMessage' : message.authorRole === 'user' ? 'ownMessage' : 'staffMessage'">
                <strong>{{ message.audience === "internal" ? "内部备注" : message.authorRole === "user" ? "用户" : "客服" }}</strong><p>{{ message.body }}</p><time>{{ formatDate(message.createdAt) }}</time>
              </li></ol>
              <form class="inlineForm" @submit.prevent="runOpsAction('reply')"><label>用户可见回复<textarea v-model="opsText" required maxlength="4000" rows="3" /></label><button class="secondaryButton" type="submit" :disabled="savingOps">发送回复</button></form>
              <form class="inlineForm" @submit.prevent="runOpsAction('internalNote')"><label>内部核查备注<textarea v-model="internalNote" required maxlength="3000" rows="2" /></label><button class="secondaryButton" type="submit" :disabled="savingOps">记录备注</button></form>
              <form class="actionRow" @submit.prevent="runOpsAction('handoff')"><label>转交岗位<select v-model="handoffRole"><option value="modelOperator" :disabled="!selectedOpsTicket.ticket.relatedTaskId">模型核查</option><option value="creditOperator" :disabled="!selectedOpsTicket.ticket.relatedLedgerId">积分核查</option></select></label><label>核查摘要<input v-model="handoffText" required maxlength="1000" /></label><button class="secondaryButton" type="submit" :disabled="savingOps">转交</button></form>
              <form class="actionRow" @submit.prevent="runOpsAction('setStatus')"><label>工单状态<select v-model="nextStatus"><option value="processing">处理中</option><option value="waitingUser">等待用户补充</option><option value="waitingExternal">等待外部核查</option><option value="solutionPending">待用户确认</option><option value="closed">已结案</option></select></label><label>说明<textarea v-model="statusExplanation" :required="['closed', 'waitingUser', 'waitingExternal', 'solutionPending'].includes(nextStatus)" maxlength="1000" rows="2" /></label><button class="secondaryButton" type="submit" :disabled="savingOps">更新状态</button></form>
            </template>
            <template v-else>
              <p class="helperText">客服用户材料和内部沟通对当前岗位不可见。核查摘要：{{ selectedOpsTicket.ticket.handoffSummary || "请按上方关联对象摘要核验。" }}</p>
              <form class="inlineForm" @submit.prevent="runOpsAction('internalNote')"><label>业务核查摘要<textarea v-model="internalNote" required maxlength="3000" rows="3" /></label><button class="secondaryButton" type="submit" :disabled="savingOps">记录核查</button></form>
              <form class="inlineForm" @submit.prevent="runOpsAction('handoff')"><label>交接说明<textarea v-model="handoffText" required maxlength="1000" rows="2" /></label><button class="secondaryButton" type="submit" :disabled="savingOps">转回客服</button></form>
            </template>
          </section>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type TicketSummary = { id: string; number: string; category: string; subject: string; status: string; createdAt: string; updatedAt: string; assignedRole?: string };
type TicketMessage = { id: string; authorRole: string; audience?: string; body: string; createdAt: string };
type Related = { kind: string; id: string; status?: string; type?: string; amount?: number; publicReason?: string | null; createdAt: string };
type UserTicket = TicketSummary & { description: string; assignedRole: string; relatedTaskId?: string | null; relatedLedgerId?: string | null; messages: TicketMessage[]; related: Related[] };
type OpsTicket = { role: string; related: Related[]; ticket: UserTicket & { handoffSummary?: string | null; events?: { id: string; eventType: string; details: Record<string, unknown>; createdAt: string }[] } };
type TicketCategory = "generation" | "credits" | "access" | "other";
const route = useRoute(); const router = useRouter(); const session = useCruioSession();
const myTickets = ref<TicketSummary[]>([]); const queueTickets = ref<TicketSummary[]>([]);
const selectedMyTicket = ref<UserTicket | null>(null); const selectedOpsTicket = ref<OpsTicket | null>(null);
const newTicket = reactive<{ category: TicketCategory; subject: string; description: string; relatedTaskId: string; relatedLedgerId: string }>({ category: "generation", subject: "", description: "", relatedTaskId: "", relatedLedgerId: "" });
const userReply = ref(""); const reopenReason = ref(""); const opsText = ref(""); const internalNote = ref(""); const handoffText = ref("");
const handoffRole = ref<"modelOperator" | "creditOperator">("modelOperator"); const nextStatus = ref("processing"); const statusExplanation = ref("");
const myTicketCursor = ref<string | null>(null); const queueCursor = ref<string | null>(null);
const loading = ref(true); const loadingQueue = ref(false); const loadingMoreMy = ref(false); const loadingMoreQueue = ref(false);
const creating = ref(false); const replying = ref(false); const reopening = ref(false); const savingOps = ref(false);
const pageError = ref(""); const pageMessage = ref("");
const staffRoles = computed(() => session.user?.roles?.map(role => role.role) ?? []);
const isStaff = computed(() => staffRoles.value.some(role => ["support", "modelOperator", "creditOperator"].includes(role)));

watch(() => [route.query.category, route.query.sourceId], ([category, sourceId]) => {
  if (typeof sourceId !== "string" || !sourceId) return;
  if (category === "generation") {
    newTicket.category = "generation";
    newTicket.relatedTaskId = sourceId;
    newTicket.relatedLedgerId = "";
  } else if (category === "credits") {
    newTicket.category = "credits";
    newTicket.relatedLedgerId = sourceId;
    newTicket.relatedTaskId = "";
  }
}, { immediate: true });

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
function categoryLabel(value: string) { return ({ generation: "生成任务", credits: "积分账单", access: "账户与访问", other: "其他问题" } as Record<string, string>)[value] ?? "服务问题"; }
function statusLabel(value: string) { return ({ new: "新建", processing: "处理中", waitingUser: "等待用户", waitingBusiness: "等待业务模块", waitingExternal: "等待外部核查", solutionPending: "待用户确认", closed: "已结案", withdrawn: "已撤回", duplicate: "重复工单", safetyEscalated: "转安全处理" } as Record<string, string>)[value] ?? "处理中"; }
function isClosed(status: string) { return ["closed", "withdrawn", "duplicate", "safetyEscalated"].includes(status); }
function relatedLabel(related: Related[]) {
  return related.map(item => item.kind === "task"
    ? `关联任务 ${item.id} · 当前状态 ${statusLabel(item.status ?? "")}`
    : `关联积分记录 ${item.id} · ${item.type ?? "账本记录"} · ${item.amount ?? 0} 点${item.publicReason ? ` · ${item.publicReason}` : ""}`).join("；");
}
async function loadMyTickets(reset = true) {
  if (reset) myTicketCursor.value = null; else loadingMoreMy.value = true;
  try {
    const params = new URLSearchParams({ limit: "30" }); if (!reset && myTicketCursor.value) params.set("cursor", myTicketCursor.value);
    const result = await api<{ tickets: TicketSummary[]; nextCursor: string | null }>(`/api/support/tickets?${params}`);
    myTickets.value = reset ? result.tickets : [...myTickets.value, ...result.tickets]; myTicketCursor.value = result.nextCursor;
  } catch (error) { pageError.value = error instanceof Error ? error.message : "本人工单暂时无法读取。"; }
  finally { loading.value = false; loadingMoreMy.value = false; }
}
async function loadQueue(reset = true) {
  if (!isStaff.value) return;
  if (reset) queueCursor.value = null; else loadingMoreQueue.value = true;
  loadingQueue.value = true;
  try {
    const params = new URLSearchParams({ limit: "30" }); if (!reset && queueCursor.value) params.set("cursor", queueCursor.value);
    const result = await api<{ tickets: TicketSummary[]; nextCursor: string | null }>(`/api/support/queue?${params}`);
    queueTickets.value = reset ? result.tickets : [...queueTickets.value, ...result.tickets]; queueCursor.value = result.nextCursor;
  } catch (error) { pageError.value = error instanceof Error ? error.message : "岗位工单队列暂时无法读取。"; }
  finally { loadingQueue.value = false; loadingMoreQueue.value = false; }
}
async function refreshLists() { pageError.value = ""; await Promise.all([loadMyTickets(), loadQueue()]); }
async function createTicket() {
  creating.value = true; pageError.value = ""; pageMessage.value = "";
  try {
    const result = await api<{ ticket: TicketSummary }>("/api/support/tickets", { method: "POST", body: JSON.stringify({ ...newTicket, relatedTaskId: newTicket.relatedTaskId.trim() || null, relatedLedgerId: newTicket.relatedLedgerId.trim() || null }) });
    pageMessage.value = `工单 ${result.ticket.number} 已创建。创建成功不代表关联任务或积分问题已解决。`;
    newTicket.subject = ""; newTicket.description = ""; newTicket.relatedTaskId = ""; newTicket.relatedLedgerId = "";
    await loadMyTickets(); await openMyTicket(result.ticket.id);
  } catch (error) { pageError.value = error instanceof Error ? error.message : "工单暂时无法提交。"; }
  finally { creating.value = false; }
}
async function openMyTicket(ticketId: string) {
  pageError.value = "";
  try { const result = await api<{ ticket: UserTicket }>(`/api/support/tickets/${encodeURIComponent(ticketId)}`); selectedMyTicket.value = result.ticket; }
  catch (error) { pageError.value = error instanceof Error ? error.message : "工单不存在或无权查看。"; }
}
async function replyToTicket() {
  if (!selectedMyTicket.value) return; replying.value = true; pageError.value = "";
  try { await api(`/api/support/tickets/${encodeURIComponent(selectedMyTicket.value.id)}/reply`, { method: "POST", body: JSON.stringify({ body: userReply.value }) }); userReply.value = ""; await openMyTicket(selectedMyTicket.value.id); await loadMyTickets(); }
  catch (error) { pageError.value = error instanceof Error ? error.message : "补充信息暂时无法发送。"; }
  finally { replying.value = false; }
}
async function reopenTicket() {
  if (!selectedMyTicket.value) return; reopening.value = true; pageError.value = "";
  try { await api(`/api/support/tickets/${encodeURIComponent(selectedMyTicket.value.id)}/reopen`, { method: "POST", body: JSON.stringify({ reason: reopenReason.value }) }); reopenReason.value = ""; await openMyTicket(selectedMyTicket.value.id); await loadMyTickets(); }
  catch (error) { pageError.value = error instanceof Error ? error.message : "重开申请暂时无法提交。"; }
  finally { reopening.value = false; }
}
async function openOpsTicket(ticketId: string) {
  pageError.value = "";
  try { const result = await api<{ ticket: OpsTicket["ticket"] & { related: Related[] }; role: string }>(`/api/support/operations/${encodeURIComponent(ticketId)}`); selectedOpsTicket.value = { ticket: result.ticket, role: result.role, related: result.ticket.related ?? [] }; opsText.value = ""; internalNote.value = ""; handoffText.value = ""; }
  catch (error) { pageError.value = error instanceof Error ? error.message : "岗位范围内工单暂时无法读取。"; }
}
async function runOpsAction(action: "reply" | "internalNote" | "handoff" | "setStatus") {
  if (!selectedOpsTicket.value) return; savingOps.value = true; pageError.value = ""; pageMessage.value = "";
  const text = action === "reply" ? opsText.value : action === "internalNote" ? internalNote.value : action === "handoff" ? handoffText.value : statusExplanation.value;
  const payload: Record<string, string> = { action, text };
  if (action === "handoff") payload.assignedRole = selectedOpsTicket.value.role === "support" ? handoffRole.value : "support";
  if (action === "setStatus") payload.status = nextStatus.value;
  try {
    const result = await api<{ ticket: { status?: string; assignedRole?: string } }>(`/api/support/operations/${encodeURIComponent(selectedOpsTicket.value.ticket.id)}/action`, { method: "POST", body: JSON.stringify(payload) });
    pageMessage.value = action === "reply" ? "用户可见回复已记录。" : action === "handoff" ? "工单已转交；任务或积分源状态未改变。" : action === "setStatus" ? `工单状态已更新为${statusLabel(result.ticket.status ?? "processing")}。` : "内部核查记录已保存。";
    if (action === "reply") opsText.value = ""; if (action === "internalNote") internalNote.value = ""; if (action === "handoff") handoffText.value = ""; if (action === "setStatus") statusExplanation.value = "";
    await openOpsTicket(selectedOpsTicket.value.ticket.id); await loadQueue(); await loadMyTickets();
  } catch (error) { pageError.value = error instanceof Error ? error.message : "工单操作暂时无法保存。"; }
  finally { savingOps.value = false; }
}
onMounted(async () => {
  await session.refresh();
  if (!session.user) { await router.replace({ name: "login", query: { next: route.fullPath } }); return; }
  await Promise.all([loadMyTickets(), loadQueue()]);
  const ticketId = typeof route.query.ticketId === "string" ? route.query.ticketId : "";
  if (ticketId) await openMyTicket(ticketId);
});
</script>

<style scoped lang="scss">
.appContainer { min-height: 100dvh; background: var(--cr-page-background); color: var(--cr-text-primary); }
.pageContent { width: min(100% - 48px, 1200px); margin: 0 auto; padding: 24px 0; }
.pageHeading, .panelHeading, .detailHeading, .ticketRowHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pageHeading { margin-bottom: 24px; }
.eyebrow { margin: 0 0 4px; color: var(--cr-text-muted); font-size: 12px; }
h1 { margin: 0; font-size: 20px; line-height: 1.4; }
h2, h3 { margin: 0; font-size: 16px; line-height: 1.5; }
.pageHeading p:not(.eyebrow), .helperText { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; }
.helperText { color: var(--cr-text-muted); font-size: 12px; }
.primaryButton, .secondaryButton { min-height: 36px; width: fit-content; border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; cursor: pointer; }
.primaryButton { border-color: transparent; background: var(--cr-gradient); font-weight: 600; }
.secondaryButton:hover { background: var(--cr-surface-hover); }
.feedback { margin: 0 0 16px; padding: 12px 16px; border-radius: 8px; font-size: 14px; }
.feedback.error { color: var(--cr-status-danger); background: color-mix(in srgb, var(--cr-status-danger) 9%, var(--cr-surface)); }
.feedback.success { color: var(--cr-status-success); background: color-mix(in srgb, var(--cr-status-success) 9%, var(--cr-surface)); }
.createPanel, .listPanel, .detailPanel { min-width: 0; padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.createPanel { margin-bottom: 24px; }
.ticketForm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
label { display: grid; gap: 8px; color: var(--cr-text-secondary); font-size: 14px; }
input, textarea, select { width: 100%; min-width: 0; border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; }
textarea { resize: vertical; }
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
.wideField { grid-column: 1 / -1; }
.contentGrid { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(0, 1.2fr); gap: 16px; align-items: start; }
.panelHeading { margin-bottom: 12px; }
.panelHeading > span { color: var(--cr-text-muted); font-size: 12px; }
.panelHeading p:not(.eyebrow) { margin: 4px 0 0; color: var(--cr-text-secondary); font-size: 12px; }
.ticketRow { display: grid; gap: 8px; width: 100%; margin-top: 8px; padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; color: var(--cr-text-primary); background: var(--cr-surface); text-align: left; cursor: pointer; }
.ticketRow:hover, .selectedRow { background: var(--cr-surface-hover); }
.ticketRow strong { overflow-wrap: anywhere; font-size: 14px; }
.statusBadge { flex: 0 0 auto; border-radius: 6px; padding: 4px 8px; color: var(--cr-text-secondary); background: var(--cr-surface-subtle); font-size: 12px; }
.ticketMeta, .detailText, .relatedSummary { color: var(--cr-text-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.detailPanel { display: grid; gap: 16px; }
.detailText { margin: 0; color: var(--cr-text-secondary); font-size: 14px; white-space: pre-wrap; }
.relatedSummary { margin: 0; padding: 12px; border-radius: 8px; background: var(--cr-surface-subtle); }
.messageList { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.messageList li { padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.messageList strong { font-size: 12px; }
.messageList p { margin: 8px 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.messageList time { color: var(--cr-text-muted); font-size: 12px; }
.ownMessage { border-left: 3px solid var(--cr-neutral-blue-gray) !important; }
.staffMessage { border-left: 3px solid var(--cr-brand-primary) !important; }
.internalMessage { border-left: 3px solid var(--cr-status-warning) !important; background: color-mix(in srgb, var(--cr-status-warning) 8%, var(--cr-surface)) !important; }
.inlineForm, .actionRow { display: grid; gap: 12px; }
.actionRow { grid-template-columns: minmax(140px, .7fr) minmax(0, 1.3fr) auto; align-items: end; margin-top: 12px; }
.operationsSection { display: grid; gap: 12px; margin-top: 24px; }
.emptyState { margin: 0; padding: 24px; border: 1px dashed var(--cr-border-strong); border-radius: 8px; color: var(--cr-text-muted); background: var(--cr-surface); text-align: center; font-size: 14px; }
.loadMore { display: block; width: 100%; margin-top: 12px; }
@media (max-width: 820px) { .contentGrid { grid-template-columns: 1fr; } .pageContent { width: min(100% - 32px, 1200px); } .ticketForm { grid-template-columns: 1fr; } .wideField { grid-column: auto; } .actionRow { grid-template-columns: 1fr; } .pageHeading { align-items: flex-start; flex-direction: column; } }
</style>
