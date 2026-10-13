<template>
  <div class="appContainer">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading">
        <div><p class="eyebrow">服务记录</p><h1>通知</h1><p>通知引用任务和积分账本的真实记录；业务状态以对应页面为准。</p></div>
        <button class="secondaryButton" type="button" :disabled="loading" @click="loadNotifications(true)">刷新通知</button>
      </header>
      <nav class="categoryTabs" aria-label="通知类别">
        <button v-for="tab in tabs" :key="tab.value" type="button" :class="{ activeTab: category === tab.value }" @click="selectCategory(tab.value)">{{ tab.label }}</button>
      </nav>
      <p v-if="errorMessage" class="feedback error" role="alert">{{ errorMessage }}</p>
      <p v-if="loading && !notifications.length" class="emptyState">正在读取站内通知…</p>
      <p v-else-if="!notifications.length" class="emptyState">暂无通知记录。</p>
      <section class="notificationList" aria-label="站内服务通知">
        <article v-for="notification in notifications" :key="notification.eventId" class="notificationCard" :class="{ unreadCard: !notification.readAt }">
          <div class="notificationHeading">
            <div><span class="categoryBadge">{{ categoryLabel(notification.category) }}</span><h2>{{ notification.title }}</h2></div>
            <span class="readState">{{ notification.readAt ? "已读" : "未读" }}</span>
          </div>
          <p class="notificationSummary">{{ notification.summary }}</p>
          <p class="sourceReference">{{ sourceLabel(notification.sourceType) }} · {{ notification.sourceId }} · 模板 {{ notification.templateVersion }}</p>
          <p v-if="notification.currentStatus" class="currentStatus">当前源状态：{{ sourceStatusLabel(notification) }}</p>
          <div class="notificationFooter">
            <time :datetime="notification.eventAt">{{ formatDate(notification.eventAt) }}</time>
            <div>
              <button v-if="!notification.readAt" class="textButton" type="button" :disabled="busyEventId === notification.eventId" @click="markRead(notification)">标为已读</button>
              <button class="secondaryButton" type="button" @click="openNotification(notification)">{{ linkLabel(notification.category) }}</button>
            </div>
          </div>
        </article>
      </section>
      <button v-if="nextCursor" class="secondaryButton loadMore" type="button" :disabled="loadingMore" @click="loadNotifications(false)">{{ loadingMore ? "正在加载…" : "加载更多通知" }}</button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type Notification = {
  eventId: string; category: "task" | "credits" | "support"; sourceType: "task" | "creditLedger" | "supportTicket"; sourceId: string;
  title: string; summary: string; currentStatus: string | null; href: string; templateVersion: string;
  eventAt: string; readAt: string | null;
};
const tabs = [{ value: "all", label: "全部" }, { value: "task", label: "任务" }, { value: "credits", label: "积分" }, { value: "support", label: "工单" }] as const;
type Category = typeof tabs[number]["value"];
const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const notifications = ref<Notification[]>([]);
const category = ref<Category>("all");
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const busyEventId = ref("");
const errorMessage = ref("");

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
function sourceStatusLabel(notification: Notification) {
  if (notification.sourceType === "supportTicket") return ({ new: "新建", processing: "处理中", waitingUser: "等待用户", waitingBusiness: "等待业务模块", waitingExternal: "等待外部核查", solutionPending: "待用户确认", closed: "已结案" } as Record<string, string>)[notification.currentStatus ?? ""] ?? "工单处理中";
  if (notification.sourceType === "task") return ({ queued: "排队中", running: "处理中", unknown: "待核查", failed: "未交付", delivered: "已可靠交付" } as Record<string, string>)[notification.currentStatus ?? ""] ?? "状态更新中";
  return ({ topup: "已入账", refund: "账务已扣回", reversal: "已冲正", settle: "已结算", release: "已释放" } as Record<string, string>)[notification.currentStatus ?? ""] ?? "账本状态已记录";
}
function categoryLabel(value: Notification["category"]) { return ({ task: "任务", credits: "积分", support: "工单" } as Record<string, string>)[value]; }
function sourceLabel(value: Notification["sourceType"]) { return ({ task: "关联任务", creditLedger: "关联账本记录", supportTicket: "关联服务工单" } as Record<string, string>)[value]; }
function linkLabel(value: Notification["category"]) { return value === "task" ? "查看任务" : value === "credits" ? "查看账单" : "查看工单"; }
async function loadNotifications(reset: boolean) {
  if (reset) { loading.value = true; nextCursor.value = null; }
  else loadingMore.value = true;
  errorMessage.value = "";
  try {
    const params = new URLSearchParams({ limit: "30" });
    if (category.value !== "all") params.set("category", category.value);
    if (!reset && nextCursor.value) params.set("cursor", nextCursor.value);
    const result = await api<{ notifications: Notification[]; nextCursor: string | null }>(`/api/notifications?${params}`);
    notifications.value = reset ? result.notifications : [...notifications.value, ...result.notifications];
    nextCursor.value = result.nextCursor;
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : "通知暂时无法读取。"; }
  finally { loading.value = false; loadingMore.value = false; }
}
function selectCategory(value: Category) { if (category.value === value) return; category.value = value; void loadNotifications(true); }
async function markRead(notification: Notification) {
  busyEventId.value = notification.eventId;
  errorMessage.value = "";
  try {
    await api<{ markedRead: number }>("/api/notifications/read", { method: "POST", body: JSON.stringify({ eventIds: [notification.eventId] }) });
    notification.readAt = new Date().toISOString();
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : "通知已读状态未能保存。"; }
  finally { busyEventId.value = ""; }
}
async function openNotification(notification: Notification) {
  if (!notification.readAt) await markRead(notification);
  if (notification.category === "task") await router.push({ path: "/tasks", query: { taskId: notification.sourceId } });
  else if (notification.category === "credits") await router.push({ path: "/credits", query: { entryId: notification.sourceId } });
  else await router.push({ path: "/support", query: { ticketId: notification.sourceId } });
}

onMounted(async () => {
  await session.refresh();
  if (!session.user) { await router.replace({ name: "login", query: { next: route.fullPath } }); return; }
  await loadNotifications(true);
});
</script>

<style scoped lang="scss">
.appContainer { min-height: 100dvh; background: var(--cr-page-background); color: var(--cr-text-primary); }
.pageContent { width: min(100% - 48px, 1040px); margin: 0 auto; padding: 24px 0; }
.pageHeading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
.eyebrow { margin: 0 0 4px; color: var(--cr-text-muted); font-size: 12px; }
h1 { margin: 0; font-size: 20px; line-height: 1.4; }
.pageHeading p:not(.eyebrow) { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; }
.secondaryButton, .categoryTabs button { min-height: 36px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; cursor: pointer; }
.secondaryButton:hover, .categoryTabs button:hover { background: var(--cr-surface-hover); }
.categoryTabs { display: flex; gap: 8px; margin-bottom: 16px; }
.categoryTabs .activeTab { border-color: var(--cr-brand-primary); color: var(--cr-brand-primary); }
.feedback { margin: 0 0 16px; padding: 12px 16px; border-radius: 8px; font-size: 14px; }
.feedback.error { color: var(--cr-status-danger); background: color-mix(in srgb, var(--cr-status-danger) 9%, var(--cr-surface)); }
.emptyState { margin: 0; padding: 24px; border: 1px dashed var(--cr-border-strong); border-radius: 8px; color: var(--cr-text-muted); background: var(--cr-surface); text-align: center; font-size: 14px; }
.notificationList { display: grid; gap: 12px; }
.notificationCard { padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.unreadCard { border-left: 3px solid var(--cr-brand-primary); }
.notificationHeading, .notificationHeading > div, .notificationFooter, .notificationFooter > div { display: flex; align-items: center; }
.notificationHeading, .notificationFooter { justify-content: space-between; gap: 12px; }
.notificationHeading > div { gap: 8px; min-width: 0; }
h2 { margin: 0; font-size: 16px; line-height: 1.5; }
.categoryBadge, .readState { border-radius: 6px; padding: 4px 8px; background: var(--cr-surface-subtle); color: var(--cr-text-secondary); font-size: 12px; white-space: nowrap; }
.notificationSummary, .currentStatus { margin: 12px 0 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; }
.sourceReference { margin: 8px 0 0; color: var(--cr-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
.currentStatus { color: var(--cr-text-muted); font-size: 12px; }
.notificationFooter { margin-top: 16px; color: var(--cr-text-muted); font-size: 12px; }
.notificationFooter > div { gap: 12px; }
.textButton { border: 0; padding: 8px; color: var(--cr-brand-primary); background: transparent; font: inherit; font-size: 14px; cursor: pointer; }
.loadMore { display: block; margin: 16px auto 0; }
button:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
@media (max-width: 680px) { .pageContent { width: min(100% - 32px, 1040px); } .pageHeading { align-items: flex-start; flex-direction: column; } }
</style>
