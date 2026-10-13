<template>
  <div class="privacyRequestsPage">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading"><div><p class="eyebrow">隐私与数据</p><h1>隐私申请</h1><p>提交本人数据相关申请，并查看每个处理对象的进度与安全说明。</p></div><button class="secondaryButton" type="button" :disabled="loading" @click="loadRequests()">刷新记录</button></header>
      <p v-if="errorMessage" class="feedback error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="feedback success" role="status">{{ successMessage }}</p>
      <section class="panel createPanel" aria-labelledby="createHeading">
        <header class="sectionHeading"><div><h2 id="createHeading">新建申请</h2><p>只填写本人对象。请勿提交密码、密钥或无关人员信息。</p></div></header>
        <form class="requestForm" @submit.prevent="createRequest">
          <div class="formGrid"><label>申请类别<select v-model="form.category"><option v-for="item in categories" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label>主题<input v-model.trim="form.subject" required minlength="2" maxlength="120" /></label><label class="wideField">申请说明<textarea v-model.trim="form.description" required minlength="10" maxlength="3000" rows="4" /></label></div>
          <fieldset class="objectFieldset"><legend>申请对象</legend><div v-for="(item, index) in form.objects" :key="index" class="objectRow"><label>对象类型<select v-model="item.objectType"><option v-for="type in objectTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label><label>本人对象 ID<input v-model.trim="item.objectId" :disabled="['account', 'externalMapping'].includes(item.objectType)" :placeholder="['account', 'externalMapping'].includes(item.objectType) ? '由系统识别本人对象' : '粘贴本人对象编号'" autocomplete="off" /></label><button v-if="form.objects.length > 1" class="textButton" type="button" @click="removeObject(index)">移除</button></div><div class="objectActions"><button class="secondaryButton" type="button" :disabled="form.objects.length >= 20" @click="addObject">添加对象</button><p>解释类申请可不关联对象；其他类别需要明确选择对象。</p></div></fieldset>
          <label>当前密码<input v-model="form.currentPassword" type="password" autocomplete="current-password" required minlength="8" maxlength="256" /></label>
          <button class="primaryButton" type="submit" :disabled="submitting">{{ submitting ? "正在提交…" : "提交隐私申请" }}</button>
        </form>
      </section>
      <div class="contentGrid">
        <section class="panel requestList" aria-labelledby="listHeading"><header class="sectionHeading"><h2 id="listHeading">本人申请</h2><button class="textButton" type="button" @click="clearFilter">全部</button></header><label class="filterLabel">按类别筛选<select v-model="filterCategory" @change="loadRequests()"><option value="">全部类别</option><option v-for="item in categories" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><p v-if="loading && !requests.length" class="emptyState">正在读取申请…</p><p v-else-if="!requests.length" class="emptyState">暂无隐私申请。</p><button v-for="item in requests" :key="item.id" class="requestRow" :class="{ selected: selectedRequest?.id === item.id }" type="button" @click="openRequest(item.id)"><span><strong>{{ item.subject }}</strong><span class="statusBadge">{{ statusLabel(item.status) }}</span></span><small>{{ item.number }} · {{ categoryLabel(item.category) }} · {{ formatDate(item.updatedAt) }}</small></button><button v-if="nextCursor" class="secondaryButton loadMore" type="button" :disabled="loadingMore" @click="loadRequests(false)">{{ loadingMore ? "正在加载…" : "加载更多" }}</button></section>
        <section v-if="selectedRequest" class="panel requestDetail" aria-labelledby="detailHeading"><header class="sectionHeading"><div><p class="eyebrow">{{ selectedRequest.number }} · {{ categoryLabel(selectedRequest.category) }}</p><h2 id="detailHeading">{{ selectedRequest.subject }}</h2></div><span class="statusBadge">{{ statusLabel(selectedRequest.status) }}</span></header><p class="description">{{ selectedRequest.description }}</p><h3>对象处理进度</h3><article v-for="item in selectedObjects" :key="item.id" class="objectStatus"><div><strong>{{ objectTypeLabel(item.objectType) }}<span v-if="item.objectId" class="objectId"> · {{ item.objectId }}</span></strong><span class="statusBadge">{{ objectStatusLabel(item.status) }}</span></div><p>请求：{{ categoryLabel(item.requestedAction) }}</p><p v-if="item.userReason">处理说明：{{ item.userReason }}</p><p v-if="item.status === 'softDeleted'" class="statusNote">已软删除；这不代表永久删除或外部副本已删除。</p><p v-else-if="item.status === 'retained'" class="statusNote">该对象按适用规则继续保留。</p></article><p v-if="!selectedObjects.length" class="emptyState">此申请没有指定对象，进度以申请状态为准。</p><h3>可见进度</h3><ol class="timeline"><li v-for="event in selectedTimeline" :key="event.id"><strong>{{ eventLabel(event.eventType) }}</strong><p>{{ eventMessage(event.details) }}</p><time>{{ formatDate(event.createdAt) }}</time></li></ol><form v-if="!isClosed(selectedRequest.status)" class="supplementForm" @submit.prevent="sendSupplement"><label>补充说明<textarea v-model.trim="supplementMessage" required minlength="10" maxlength="3000" rows="3" /></label><label>当前密码<input v-model="supplementPassword" type="password" autocomplete="current-password" required minlength="8" maxlength="256" /></label><button class="secondaryButton" type="submit" :disabled="supplementing">{{ supplementing ? "正在提交…" : "提交补充" }}</button></form></section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type RequestSummary = { id: string; number: string; category: string; status: string; subject: string; createdAt: string; updatedAt: string };
type RequestObject = { id: string; objectType: string; objectId: string | null; requestedAction: string; status: string; userReason?: string | null; updatedAt: string };
type TimelineEvent = { id: string; eventType: string; details: { message?: string }; createdAt: string };
type RequestDetail = RequestSummary & { description: string };
type RequestResult = { request: RequestDetail; objects: RequestObject[]; timeline: TimelineEvent[] };
type ObjectForm = { objectType: string; objectId: string };
const categories = [{ value: "access", label: "访问" }, { value: "copy", label: "获取副本" }, { value: "correction", label: "更正" }, { value: "supplement", label: "补充" }, { value: "deletion", label: "删除" }, { value: "restriction", label: "限制处理" }, { value: "explanation", label: "处理说明" }, { value: "accountClosure", label: "关闭账户" }];
const objectTypes = [{ value: "account", label: "本人账户" }, { value: "asset", label: "素材" }, { value: "task", label: "生成任务" }, { value: "work", label: "作品" }, { value: "ledger", label: "积分账单" }, { value: "credential", label: "凭据记录" }, { value: "supportTicket", label: "客服工单" }, { value: "externalMapping", label: "外部映射" }];
const route = useRoute(); const router = useRouter(); const session = useCruioSession();
const requests = ref<RequestSummary[]>([]); const nextCursor = ref<string | null>(null); const filterCategory = ref(""); const selectedRequest = ref<RequestDetail | null>(null); const selectedObjects = ref<RequestObject[]>([]); const selectedTimeline = ref<TimelineEvent[]>([]);
const loading = ref(true); const loadingMore = ref(false); const submitting = ref(false); const supplementing = ref(false); const errorMessage = ref(""); const successMessage = ref(""); const supplementMessage = ref(""); const supplementPassword = ref("");
const form = reactive({ category: "access", subject: "", description: "", currentPassword: "", objects: [{ objectType: "account", objectId: "" }] as ObjectForm[] });
let listSequence = 0; let detailSequence = 0; let supplementSequence = 0;
let createKeySignature = ""; let createIdempotencyKey = ""; let supplementKeySignature = ""; let supplementIdempotencyKey = "";

function categoryLabel(value: string) { return categories.find(item => item.value === value)?.label ?? "其他申请"; }
function objectTypeLabel(value: string) { return objectTypes.find(item => item.value === value)?.label ?? "申请对象"; }
function statusLabel(value: string) { return ({ received: "已收到", identityReview: "身份核验", processing: "处理中", awaitingUser: "等待补充", partiallyCompleted: "部分完成", partiallyRefused: "部分未受理", appealReview: "复核中", completed: "已完成", closed: "已结束" } as Record<string, string>)[value] ?? "状态待确认"; }
function objectStatusLabel(value: string) { return ({ pending: "待处理", processing: "处理中", awaitingUser: "等待用户补充", partial: "部分完成", completed: "已完成", restricted: "已限制", softDeleted: "已软删除", retained: "继续保留", refused: "未受理" } as Record<string, string>)[value] ?? "状态待确认"; }
function eventLabel(value: string) { return ({ requestCreated: "已提交", userSupplement: "已补充", statusChanged: "状态更新", objectUpdated: "对象进度更新", userReply: "处理说明" } as Record<string, string>)[value] ?? "进度更新"; }
function eventMessage(details: TimelineEvent["details"]) { return typeof details?.message === "string" ? details.message : "申请记录已更新。"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
function isClosed(value: string) { return ["completed", "partiallyRefused", "closed"].includes(value); }
function addObject() { if (form.objects.length < 20) form.objects.push({ objectType: "asset", objectId: "" }); }
function removeObject(index: number) { form.objects.splice(index, 1); }
function clearFilter() { filterCategory.value = ""; void loadRequests(); }
async function loadRequests(reset = true) {
  const sequence = ++listSequence;
  if (reset) { nextCursor.value = null; if (!preserveSelectedDetail) clearSelectedDetail(); } else loadingMore.value = true;
  errorMessage.value = ""; if (reset) loading.value = true;
  try { const params = new URLSearchParams({ limit: "30" }); if (filterCategory.value) params.set("category", filterCategory.value); if (!reset && nextCursor.value) params.set("cursor", nextCursor.value); const result = await api<{ requests: RequestSummary[]; nextCursor: string | null }>(`/api/privacy/requests?${params}`); if (sequence !== listSequence) return; requests.value = reset ? result.requests : [...requests.value, ...result.requests]; nextCursor.value = result.nextCursor; }
  catch (error) { if (sequence === listSequence) errorMessage.value = error instanceof Error ? error.message : "隐私申请暂时无法读取。"; }
  finally { if (sequence === listSequence) { loading.value = false; loadingMore.value = false; } }
}
let preserveSelectedDetail = false;
function clearSelectedDetail() { detailSequence++; supplementSequence++; selectedRequest.value = null; selectedObjects.value = []; selectedTimeline.value = []; supplementMessage.value = ""; supplementPassword.value = ""; supplementing.value = false; }
async function refreshListPreservingDetail() { preserveSelectedDetail = true; try { await loadRequests(true); } finally { preserveSelectedDetail = false; } }
async function openRequest(requestId: string) { const sequence = ++detailSequence; supplementSequence++; selectedRequest.value = null; selectedObjects.value = []; selectedTimeline.value = []; supplementMessage.value = ""; supplementPassword.value = ""; supplementing.value = false; errorMessage.value = ""; try { const result = await api<RequestResult>(`/api/privacy/requests/${encodeURIComponent(requestId)}`); if (sequence !== detailSequence) return; selectedRequest.value = result.request; selectedObjects.value = result.objects; selectedTimeline.value = result.timeline; } catch (error) { if (sequence === detailSequence) errorMessage.value = error instanceof Error ? error.message : "申请不存在或无权查看。"; } }
async function createRequest() {
  if (submitting.value) return; submitting.value = true; errorMessage.value = ""; successMessage.value = "";
  try {
    const objects = form.objects.filter(item => item.objectType || item.objectId).map(item => ({ objectType: item.objectType, objectId: ["account", "externalMapping"].includes(item.objectType) ? null : item.objectId.trim() || null }));
    const signature = JSON.stringify({ category: form.category, subject: form.subject.trim(), description: form.description.trim(), objects });
    if (signature !== createKeySignature) { createKeySignature = signature; createIdempotencyKey = crypto.randomUUID(); }
    const result = await api<{ request: RequestSummary }>("/api/privacy/requests", { method: "POST", body: JSON.stringify({ category: form.category, subject: form.subject.trim(), description: form.description.trim(), objects, currentPassword: form.currentPassword, idempotencyKey: createIdempotencyKey }) });
    if (!result.request?.id) throw new Error("服务端没有返回申请记录。");
    form.currentPassword = ""; form.subject = ""; form.description = ""; form.objects = [{ objectType: "account", objectId: "" }]; createKeySignature = ""; createIdempotencyKey = ""; successMessage.value = `申请 ${result.request.number} 已由服务端记录。`;
    await loadRequests(); await openRequest(result.request.id);
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : "隐私申请未能提交。"; }
  finally { submitting.value = false; }
}
async function sendSupplement() {
  if (supplementing.value || !selectedRequest.value) return; supplementing.value = true; errorMessage.value = "";
  const sequence = ++supplementSequence; const requestId = selectedRequest.value.id; const message = supplementMessage.value.trim();
  const signature = JSON.stringify({ requestId, message }); if (signature !== supplementKeySignature) { supplementKeySignature = signature; supplementIdempotencyKey = crypto.randomUUID(); }
  try { await api(`/api/privacy/requests/${encodeURIComponent(requestId)}/supplements`, { method: "POST", body: JSON.stringify({ message, currentPassword: supplementPassword.value, idempotencyKey: supplementIdempotencyKey }) }); if (sequence !== supplementSequence || selectedRequest.value?.id !== requestId) return; supplementMessage.value = ""; supplementPassword.value = ""; supplementKeySignature = ""; supplementIdempotencyKey = ""; successMessage.value = "补充内容已记录。"; await Promise.all([openRequest(requestId), refreshListPreservingDetail()]); }
  catch (error) { if (sequence === supplementSequence && selectedRequest.value?.id === requestId) errorMessage.value = error instanceof Error ? error.message : "补充内容未能提交。"; }
  finally { if (sequence === supplementSequence) supplementing.value = false; }
}
watch(() => form.category, category => { if (category === "explanation") form.objects = []; else if (form.objects.length === 0) form.objects = [{ objectType: category === "accountClosure" ? "account" : "asset", objectId: "" }]; if (category === "accountClosure") form.objects = [{ objectType: "account", objectId: "" }]; });
onMounted(async () => { const user = await session.initialize(); if (!user) { await router.replace({ path: "/login", query: { next: route.fullPath } }); return; } await loadRequests(); const requestId = typeof route.query.requestId === "string" ? route.query.requestId : ""; if (requestId) await openRequest(requestId); });
</script>

<style scoped lang="scss">
.privacyRequestsPage { min-height: 100dvh; background: var(--cr-page-background); color: var(--cr-text-primary); }.pageContent { width: min(100% - 48px, 1200px); margin: 0 auto; padding: 24px 0; }
.pageHeading, .sectionHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.pageHeading { margin-bottom: 24px; h1 { margin: 0; font-size: 20px; line-height: 1.4; } p:not(.eyebrow) { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; } }.eyebrow { margin: 0 0 4px; color: var(--cr-text-muted); font-size: 12px; }
.panel { min-width: 0; padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }.createPanel { margin-bottom: 24px; }.sectionHeading { margin-bottom: 16px; h2 { margin: 0; font-size: 16px; line-height: 1.5; } p { margin: 8px 0 0; color: var(--cr-text-muted); font-size: 12px; } }.requestForm, .formGrid, .supplementForm { display: grid; gap: 12px; }.formGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.wideField { grid-column: 1 / -1; }
label { display: grid; gap: 8px; min-width: 0; color: var(--cr-text-secondary); font-size: 14px; }input, select, textarea { width: 100%; min-width: 0; padding: 8px 12px; border: 1px solid var(--cr-border-strong); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; }textarea { resize: vertical; }input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
.objectFieldset { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; }.objectFieldset legend { padding: 0 8px; color: var(--cr-text-secondary); font-size: 14px; }.objectRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 12px; }.objectActions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }.objectActions p { margin: 0; color: var(--cr-text-muted); font-size: 12px; }
.primaryButton, .secondaryButton { min-height: 36px; width: fit-content; padding: 8px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; cursor: pointer; }.primaryButton { border-color: transparent; background: var(--cr-gradient); font-weight: 600; }.primaryButton:disabled, .secondaryButton:disabled { opacity: .55; cursor: not-allowed; }.textButton { width: fit-content; padding: 8px; border: 0; color: var(--cr-brand-primary); background: transparent; font: inherit; font-size: 14px; cursor: pointer; }
.contentGrid { display: grid; grid-template-columns: minmax(280px, .75fr) minmax(0, 1.25fr); align-items: start; gap: 16px; }.filterLabel { margin-bottom: 12px; }.requestRow { display: grid; gap: 8px; width: 100%; margin-top: 8px; padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; color: var(--cr-text-primary); background: var(--cr-surface); text-align: left; cursor: pointer; }.requestRow:hover, .requestRow.selected { background: var(--cr-surface-hover); }.requestRow > span, .objectStatus > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.requestRow strong { overflow-wrap: anywhere; font-size: 14px; }.requestRow small { color: var(--cr-text-muted); font-size: 12px; }.statusBadge { flex: 0 0 auto; padding: 4px 8px; border-radius: 6px; color: var(--cr-text-secondary); background: var(--cr-surface-subtle); font-size: 12px; }.loadMore { margin-top: 12px; }.requestDetail { display: grid; gap: 12px; }.requestDetail .sectionHeading { margin: 0; align-items: start; }.requestDetail h3 { margin: 0; font-size: 14px; }.description { margin: 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; white-space: pre-wrap; }.objectStatus { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; }.objectStatus p { margin: 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }.objectId { color: var(--cr-text-muted); font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }.objectStatus .statusNote { color: var(--cr-text-muted); font-size: 12px; }.timeline { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }.timeline li { display: grid; gap: 4px; padding: 12px; border-left: 3px solid var(--cr-brand-primary); background: var(--cr-surface-subtle); }.timeline strong { font-size: 14px; }.timeline p, .timeline time { margin: 0; color: var(--cr-text-muted); font-size: 12px; line-height: 1.5; }.feedback { margin: 0 0 16px; font-size: 14px; }.feedback.error { color: var(--cr-status-danger); }.feedback.success { color: var(--cr-status-success); }.emptyState { margin: 0; padding: 12px 0; color: var(--cr-text-muted); font-size: 14px; }
@media (max-width: 800px) { .contentGrid { grid-template-columns: 1fr; } }.supplementForm { margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--cr-border-subtle); }
@media (max-width: 620px) { .pageContent { width: min(100% - 24px, 1200px); }.pageHeading, .sectionHeading { align-items: start; flex-direction: column; }.formGrid { grid-template-columns: 1fr; }.wideField { grid-column: auto; }.objectRow { grid-template-columns: 1fr; }.objectRow .textButton { justify-self: start; }.requestRow > span { align-items: start; flex-direction: column; }.primaryButton, .secondaryButton { max-width: 100%; white-space: nowrap; } }
</style>
