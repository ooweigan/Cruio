<template>
  <main class="recoveryPage">
    <section class="recoveryCard">
      <div class="brandRow"><span class="brand">CRUIO</span><span class="eyebrow">账户恢复</span></div>
      <template v-if="isVerification">
        <p class="stepLabel">邮箱验证</p>
        <h1>设置账户密码</h1>
        <p class="helper">验证链接仅能使用一次且会过期。设置密码后，请返回登录。</p>
        <p v-if="!token && !done" class="message errorMessage" role="alert">链接缺少验证凭据。请从邮件链接进入，或返回登录重新发送验证说明。</p>
        <form @submit.prevent="verifyEmail">
          <label>新密码<input v-model="password" type="password" minlength="8" maxlength="256" autocomplete="new-password" required /></label>
          <label>再次输入新密码<input v-model="passwordAgain" type="password" minlength="8" maxlength="256" autocomplete="new-password" required /></label>
          <p v-if="message" class="message" role="status">{{ message }}</p>
          <button class="primaryButton" type="submit" :disabled="working || done || !token">{{ working ? "正在验证…" : "验证邮箱并设置密码" }}</button>
        </form>
      </template>
      <template v-else-if="token || route.query.completed === 'passwordReset'">
        <p class="stepLabel">密码重设</p>
        <h1>设置新密码</h1>
        <p class="helper">提交后，所有其他活动会话都会退出。</p>
        <form @submit.prevent="confirmReset">
          <label>新密码<input v-model="password" type="password" minlength="8" maxlength="256" autocomplete="new-password" required /></label>
          <label>再次输入新密码<input v-model="passwordAgain" type="password" minlength="8" maxlength="256" autocomplete="new-password" required /></label>
          <p v-if="message" class="message" role="status">{{ message }}</p>
          <button class="primaryButton" type="submit" :disabled="working || done">{{ working ? "正在更新…" : "更新密码" }}</button>
        </form>
      </template>
      <template v-else>
        <p class="stepLabel">忘记密码</p>
        <h1>通过已验证邮箱重设</h1>
        <p class="helper">如果邮箱对应已验证账户，系统会发送一次性重设链接。</p>
        <form @submit.prevent="requestReset">
          <label>邮箱<input v-model.trim="email" type="email" maxlength="254" autocomplete="email" required /></label>
          <p v-if="message" class="message" role="status">{{ message }}</p>
          <button class="primaryButton" type="submit" :disabled="working">{{ working ? "正在提交…" : "发送重设说明" }}</button>
        </form>
      </template>
      <button class="switchButton" type="button" @click="router.replace('/login')">返回登录</button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/cruioApi";

const route = useRoute();
const router = useRouter();
const isVerification = computed(() => route.path === "/verifyEmail");
const token = computed(() => typeof route.query.token === "string" ? route.query.token : "");
const email = ref("");
const password = ref("");
const passwordAgain = ref("");
const message = ref(route.query.completed === "verification" ? "邮箱验证已完成，请返回登录。" : route.query.completed === "passwordReset" ? "密码已更新，请返回登录。" : "");
const working = ref(false);
const done = ref(Boolean(route.query.completed));
let requestId = 0;

watch(() => [route.path, token.value, route.query.completed], ([path, currentToken, completed], [previousPath, previousToken]) => {
  if (path === previousPath && currentToken === previousToken && !completed) return;
  requestId += 1;
  working.value = false;
  if (completed) return;
  password.value = "";
  passwordAgain.value = "";
  message.value = "";
  done.value = false;
});

async function verifyEmail() {
  if (password.value !== passwordAgain.value) {
    message.value = "两次输入的密码不一致。";
    return;
  }
  await submitToken("/api/auth/verifyEmail");
}

async function confirmReset() {
  if (password.value !== passwordAgain.value) {
    message.value = "两次输入的密码不一致。";
    return;
  }
  await submitToken("/api/auth/passwordReset/confirm");
}

async function submitToken(path: string) {
  if (working.value || done.value || !token.value) return;
  const requestPath = route.path;
  const requestToken = token.value;
  const currentRequestId = requestId;
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ message: string }>(path, {
      method: "POST",
      body: JSON.stringify({ token: requestToken, password: password.value }),
    });
    if (requestId !== currentRequestId || route.path !== requestPath || token.value !== requestToken) return;
    password.value = "";
    passwordAgain.value = "";
    message.value = result.message;
    done.value = true;
    await router.replace({ path: route.path, query: { completed: isVerification.value ? "verification" : "passwordReset" } });
  } catch (error) {
    if (requestId === currentRequestId && route.path === requestPath && token.value === requestToken) {
      message.value = error instanceof Error ? error.message : "暂时无法完成请求。";
    }
  } finally {
    if (requestId === currentRequestId) working.value = false;
  }
}

async function requestReset() {
  if (working.value) return;
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ message: string }>("/api/auth/passwordReset/request", {
      method: "POST",
      body: JSON.stringify({ email: email.value }),
    });
    message.value = result.message;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "暂时无法提交请求。";
  } finally {
    working.value = false;
  }
}
</script>

<style scoped lang="scss">
.recoveryPage { min-height: 100dvh; display: grid; place-items: center; padding: 24px; color: var(--cr-text-primary); background: var(--cr-page-background); }
.recoveryCard { width: min(440px, 100%); padding: 24px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.brandRow { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }.brand { color: var(--cr-brand-primary); font-size: 14px; font-weight: 800; letter-spacing: .16em; }.eyebrow { color: var(--cr-text-muted); font-size: 12px; }
.stepLabel { margin: 0 0 8px; color: var(--cr-brand-primary); font-size: 12px; font-weight: 700; }h1 { margin: 0; font-size: 20px; font-weight: 620; line-height: 1.5; }.helper { margin: 8px 0 24px; color: var(--cr-text-muted); font-size: 14px; line-height: 1.5; }
form { display: grid; gap: 16px; }label { display: grid; gap: 8px; font-size: 14px; font-weight: 600; }input { width: 100%; padding: 8px 12px; border: 1px solid var(--cr-border-strong); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; }input:focus { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; border-color: var(--cr-border-focus); box-shadow: var(--cr-selection-ring); }
.primaryButton { margin-top: 4px; padding: 8px 12px; border: 0; border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-gradient); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }.primaryButton:disabled { opacity: .55; cursor: not-allowed; }.message { margin: 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; }.errorMessage { color: var(--cr-status-danger); }.switchButton { margin-top: 12px; padding: 8px 0; border: 0; color: var(--cr-brand-primary); background: transparent; font: inherit; font-size: 14px; cursor: pointer; }
@media (max-width: 480px) { .recoveryPage { padding: 12px; }.recoveryCard { padding: 16px; } }
</style>
