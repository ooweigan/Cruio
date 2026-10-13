<template>
  <main class="loginPage">
    <section class="loginCard" aria-labelledby="login-heading">
        <div class="brandRow"><p class="brand">CRUIO</p><p class="eyebrow">视觉创作工作台</p></div>
        <p class="stepLabel">{{ authMode === "login" ? "欢迎回来" : "创建账户" }}</p>
        <h1 id="login-heading">{{ authMode === "login" ? "进入创作空间" : "开始创作" }}</h1>
        <p class="helper">{{ authMode === "login" ? "登录后可打开项目或工作流库。" : "使用邮箱和密码创建账户。" }}</p>

        <form @submit.prevent="submitAuth">
          <label>
            邮箱
            <input v-model.trim="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </label>
          <label>
            {{ authMode === "login" ? "密码" : "设置密码" }}
            <input
              v-model="password"
              type="password"
              :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
              minlength="8"
              placeholder="至少 8 位"
              required
            />
          </label>
          <p v-if="message" class="formMessage" :class="{ errorMessage: messageKind === 'error' }" :role="messageKind === 'error' ? 'alert' : 'status'">{{ message }}</p>
          <button class="primaryButton" type="submit" :disabled="working">
            {{ working ? "请稍候…" : authMode === "login" ? "登录并查看项目" : "创建账户并进入项目" }}
          </button>
        </form>

        <button v-if="authMode === 'login'" class="switchButton" type="button" @click="router.push('/passwordReset')">忘记密码？</button>

        <button class="switchButton" type="button" @click="toggleMode">
          {{ authMode === "login" ? "没有账户？创建一个" : "已有账户？返回登录" }}
        </button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/cruioApi";
import { useCruioSession, type CruioUser } from "@/stores/cruioSession";

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const authMode = ref<"login" | "register">("login");
const email = ref("");
const password = ref("");
const working = ref(false);
const message = ref("");
const messageKind = ref<"error" | "success">("error");

onMounted(async () => {
  if (await session.initialize()) await router.replace("/projects");
});

function toggleMode() {
  authMode.value = authMode.value === "login" ? "register" : "login";
  message.value = "";
  messageKind.value = "error";
}

async function submitAuth() {
  if (working.value) return;
  working.value = true;
  message.value = "";
  messageKind.value = "error";
  try {
    if (authMode.value === "register") {
      const result = await api<{ user: CruioUser }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      session.user = result.user;
      session.initialized = true;
    } else {
      const result = await api<{ user: CruioUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      session.user = result.user;
      session.initialized = true;
    }
    await session.refresh();
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/") && !route.query.next.startsWith("//")
      ? route.query.next
      : "/projects";
    await router.replace(next);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法登录。";
    messageKind.value = "error";
  } finally {
    working.value = false;
  }
}

</script>

<style scoped lang="scss">
.loginPage {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  color: var(--cr-text-primary);
  background: var(--cr-page-background);
}

.loginCard {
  width: min(440px, 100%);
  padding: 24px;
  border: 1px solid var(--cr-border-subtle);
  border-radius: 8px;
  background: var(--cr-surface);
}

.brandRow { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
.brand { margin: 0; color: var(--cr-brand-primary); font-size: 14px; font-weight: 800; letter-spacing: .16em; }
.eyebrow { margin: 0; color: var(--cr-text-muted); font-size: 12px; }
.stepLabel { margin: 0 0 8px; color: var(--cr-violet); font-size: 12px; font-weight: 700; }
h1 { margin: 0; font-size: 20px; font-weight: 620; letter-spacing: -.02em; line-height: 1.5; }
.stepLabel { color: var(--cr-violet); }
.helper { margin: 8px 0 24px; color: var(--cr-text-muted); font-size: 14px; line-height: 1.5; }
form { display: grid; gap: 16px; }
label { display: grid; gap: 8px; font-size: 14px; font-weight: 600; }
input { width: 100%; padding: 8px 12px; border: 1px solid var(--cr-border-strong); border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; transition: border-color .2s, box-shadow .2s; }
input:focus { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; border-color: var(--cr-border-focus); box-shadow: var(--cr-selection-ring); }
.primaryButton { margin-top: 4px; padding: 8px 12px; border: 0; border-radius: 6px; color: var(--cr-text-primary); background: var(--cr-gradient); box-shadow: 0 2px 8px color-mix(in srgb, var(--cr-brand-primary) 25%, transparent); font: inherit; font-weight: 600; cursor: pointer; transition: transform .2s, box-shadow .2s; }
.primaryButton:hover { filter: saturate(1.08) brightness(.98); transform: translateY(-1px); }
.primaryButton:active { transform: translateY(1px); }
.primaryButton:disabled { opacity: .55; cursor: default; transform: none; }
.switchButton { margin-top: 12px; padding: 8px 0; border: 0; color: var(--cr-brand-primary); background: transparent; font: inherit; font-size: 14px; cursor: pointer; }
.formMessage { margin: 0; color: var(--cr-text-secondary); font-size: 14px; line-height: 1.5; }.errorMessage { color: var(--cr-status-danger); }
.switchButton:disabled { opacity: .6; cursor: not-allowed; }

@media (max-width: 480px) {
  .loginPage { padding: 12px; }
  .loginCard { padding: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .primaryButton,
  .switchButton {
    transition: none;
  }

  .primaryButton:hover,
  .primaryButton:active {
    transform: none;
  }
}
</style>
