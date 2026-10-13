<template>
  <div class="accountPage">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading"><div><p class="eyebrow">个人账户</p><h1>账户安全</h1><p>管理邮箱状态和当前账户的活动会话。</p></div></header>
      <section class="panel accountPanel" aria-labelledby="identityHeading">
        <div class="sectionHeading"><h2 id="identityHeading">账户标识</h2></div>
        <dl class="identityList"><div><dt>邮箱</dt><dd>{{ session.user?.email }}</dd></div><div><dt>验证状态</dt><dd>{{ emailVerified ? "已验证" : "尚未验证" }}</dd></div></dl>
        <p v-if="!emailVerified" class="notice">邮箱尚未验证。退出后请使用登录页的验证重发入口完成验证。</p>
      </section>
      <section class="panel sessionsPanel" aria-labelledby="sessionsHeading">
        <div class="sectionHeading"><div><h2 id="sessionsHeading">活动会话</h2><p>会话列表仅对本人可见。退出其他会话需要再次确认当前密码。</p></div><button ref="revokeOthersTrigger" class="secondaryButton" type="button" :disabled="loading || otherCount === 0" @click="startRevoke(null, $event)">退出其他会话</button></div>
        <p v-if="errorMessage" class="message errorMessage" role="alert">{{ errorMessage }}</p>
        <p v-if="successMessage" class="message successMessage" role="status">{{ successMessage }}</p>
        <p v-else-if="loading" class="notice">正在读取会话…</p>
        <p v-else-if="sessions.length === 0" class="notice">当前没有活动会话。</p>
        <ul v-else class="sessionList">
          <li v-for="item in sessions" :key="item.id" class="sessionRow">
            <div><strong>{{ item.isCurrent ? "当前设备" : "其他设备" }}</strong><p>{{ item.userAgent || "未提供设备信息" }}</p></div>
            <div class="sessionMeta"><span>{{ formatDate(item.createdAt) }}</span><small>有效至 {{ formatDate(item.expiresAt) }}</small><button v-if="!item.isCurrent" class="textButton" type="button" @click="startRevoke(item, $event)">退出此会话</button></div>
          </li>
        </ul>
      </section>
      <div v-if="showRevokeDialog" class="modalBackdrop" @click.self="closeDialog">
        <section ref="dialogRef" class="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="confirmHeading" tabindex="-1" @keydown="trapDialogFocus" @keydown.esc.prevent.stop="closeDialog">
          <h2 id="confirmHeading">{{ dialogTarget ? "退出此会话" : "退出其他会话" }}</h2>
          <p>{{ dialogTarget ? `将结束 ${dialogTarget.userAgent || "此设备"} 的活动会话。` : `将结束 ${otherCount} 个其他活动会话，当前设备保持登录。` }}</p>
          <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" :disabled="submitting" /></label>
          <p v-if="dialogError" class="message errorMessage" role="alert">{{ dialogError }}</p>
          <div class="dialogActions"><button class="secondaryButton" type="button" :disabled="submitting" @click="closeDialog">取消</button><button class="primaryButton" type="button" :disabled="submitting || !currentPassword" @click="revokeSessions">{{ submitting ? "正在退出…" : "确认退出" }}</button></div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";
import cruioHeader from "@/components/cruioHeader.vue";

type SessionItem = { id: string; userAgent: string | null; createdAt: string; expiresAt: string; isCurrent: boolean };
const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const sessions = ref<SessionItem[]>([]);
const loading = ref(true);
const submitting = ref(false);
const errorMessage = ref("");
const dialogError = ref("");
const currentPassword = ref("");
const showRevokeDialog = ref(false);
const dialogRef = ref<HTMLElement | null>(null);
const revokeOthersTrigger = ref<HTMLButtonElement | null>(null);
const returnFocusElement = ref<HTMLElement | null>(null);
const dialogTarget = ref<SessionItem | null>(null);
const successMessage = ref("");
const emailVerified = computed(() => session.user?.emailVerifiedAt != null);
const otherCount = computed(() => sessions.value.filter(item => !item.isCurrent).length);

onMounted(async () => {
  const user = await session.initialize();
  if (!user) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  await loadSessions();
});

watch(showRevokeDialog, async visible => {
  if (visible) {
    currentPassword.value = "";
    dialogError.value = "";
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    dialogRef.value?.querySelector("input")?.focus();
  }
});

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function loadSessions() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await api<{ sessions: SessionItem[] }>("/api/auth/sessions");
    sessions.value = result.sessions;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法读取活动会话。";
  } finally {
    loading.value = false;
  }
}

function startRevoke(target: SessionItem | null, event: MouseEvent) {
  dialogTarget.value = target;
  returnFocusElement.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : revokeOthersTrigger.value;
  showRevokeDialog.value = true;
}

function closeDialog() {
  if (submitting.value) return;
  showRevokeDialog.value = false;
  currentPassword.value = "";
  dialogError.value = "";
  dialogTarget.value = null;
  void restoreFocus();
}

async function restoreFocus() {
  await nextTick();
  if (returnFocusElement.value?.isConnected) returnFocusElement.value.focus();
  else revokeOthersTrigger.value?.focus();
}

function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== "Tab" || !dialogRef.value) return;
  const focusable = [...dialogRef.value.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) { event.preventDefault(); dialogRef.value.focus(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

async function revokeSessions() {
  if (submitting.value || !currentPassword.value) return;
  submitting.value = true;
  dialogError.value = "";
  try {
    const target = dialogTarget.value;
    const result = target
      ? await api<{ revoked: boolean }>(`/api/auth/sessions/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: currentPassword.value }),
      })
      : await api<{ revokedCount: number }>("/api/auth/sessions/revokeOthers", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPassword.value }),
      });
    currentPassword.value = "";
    showRevokeDialog.value = false;
    dialogTarget.value = null;
    await loadSessions();
    successMessage.value = target ? "已退出所选会话。" : `已退出 ${"revokedCount" in result ? result.revokedCount : 0} 个其他会话。`;
    void restoreFocus();
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : "无法退出其他会话。";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped lang="scss">
.accountPage { min-height: 100dvh; background: var(--cr-page-background); }.pageContent { max-width: 1080px; margin: 0 auto; padding: 24px; }.pageHeading { margin-bottom: 24px; h1 { margin: 0; font-size: 20px; } p { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; } }.eyebrow { color: var(--cr-text-muted) !important; font-size: 12px !important; }
.panel { margin-bottom: 16px; padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }.sectionHeading { display: flex; justify-content: space-between; align-items: start; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--cr-border-subtle); h2 { margin: 0; font-size: 16px; } p { margin: 8px 0 0; color: var(--cr-text-muted); font-size: 12px; } }.identityList { display: grid; gap: 12px; margin: 0; padding-top: 12px; > div { display: flex; justify-content: space-between; gap: 16px; } dt { color: var(--cr-text-muted); font-size: 14px; } dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; } }
.sessionList { margin: 0; padding: 0; list-style: none; }.sessionRow { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--cr-border-subtle); &:last-child { border-bottom: 0; } strong { font-size: 14px; } p { margin: 4px 0 0; color: var(--cr-text-muted); font-size: 12px; overflow-wrap: anywhere; } }.sessionMeta { display: grid; justify-items: end; gap: 4px; color: var(--cr-text-secondary); font-size: 12px; text-align: right; small { color: var(--cr-text-muted); font-size: 12px; } }.notice, .message { margin: 0; padding: 12px 0; color: var(--cr-text-muted); font-size: 14px; line-height: 1.5; }.errorMessage { color: var(--cr-status-danger); }.successMessage { color: var(--cr-status-success); }.textButton { border: 0; padding: 0; color: var(--cr-brand-primary); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.secondaryButton, .primaryButton { padding: 8px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; font: inherit; font-size: 14px; cursor: pointer; }.secondaryButton { color: var(--cr-text-primary); background: var(--cr-surface); }.primaryButton { border: 0; color: var(--cr-text-primary); background: var(--cr-gradient); }.secondaryButton:disabled, .primaryButton:disabled { cursor: not-allowed; opacity: .55; }
.modalBackdrop { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--cr-text-primary) 46%, transparent); }.confirmDialog { width: min(440px, 100%); padding: 16px; border: 1px solid var(--cr-border-strong); border-radius: 8px; background: var(--cr-surface); h2 { margin: 0; font-size: 20px; } p { color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; } label { display: grid; gap: 8px; font-size: 14px; } input { width: 100%; padding: 8px 12px; border: 1px solid var(--cr-border-strong); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; } input:focus { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; } }.dialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
@media (max-width: 720px) { .pageContent { padding: 24px 12px; }.sectionHeading, .sessionRow { align-items: start; flex-direction: column; }.sessionMeta { justify-items: start; text-align: left; } }
</style>
