<template>
  <main class="loginPage">
    <section class="loginIntro" aria-labelledby="login-heading">
      <div>
        <p class="brand">CRUIO</p>
        <p class="eyebrow">视觉创作工作台</p>
        <h1 id="login-heading">从一个项目开始，<br />把想法变成成片。</h1>
        <p class="introCopy">项目收拢成片与工作流。需要编排时，再进入专注的节点画布。</p>
      </div>
      <p class="buildNote">V1 本地开发环境 · 数据保存至 Cruio PostgreSQL</p>
    </section>

    <section class="loginPanel">
      <div class="loginCard">
        <p class="stepLabel">{{ authMode === "login" ? "欢迎回来" : "创建本地账户" }}</p>
        <h2>{{ authMode === "login" ? "进入你的项目" : "开始第一个项目" }}</h2>
        <p class="helper">{{ authMode === "login" ? "登录后先选择项目，再进入工作流。" : "只用于当前本地开发环境。" }}</p>

        <form @submit.prevent="submitAuth">
          <label>
            邮箱
            <input v-model.trim="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </label>
          <label>
            密码
            <input
              v-model="password"
              type="password"
              :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
              minlength="8"
              placeholder="至少 8 位"
              required
            />
          </label>
          <p v-if="message" class="errorMessage">{{ message }}</p>
          <button class="primaryButton" type="submit" :disabled="working">
            {{ working ? "请稍候…" : authMode === "login" ? "登录并查看项目" : "创建账户" }}
          </button>
        </form>

        <button class="switchButton" type="button" @click="toggleMode">
          {{ authMode === "login" ? "没有账户？创建一个" : "已有账户？返回登录" }}
        </button>
      </div>
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

onMounted(async () => {
  if (await session.initialize()) await router.replace("/projects");
});

function toggleMode() {
  authMode.value = authMode.value === "login" ? "register" : "login";
  message.value = "";
}

async function submitAuth() {
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ user: CruioUser }>(`/api/auth/${authMode.value}`, {
      method: "POST",
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    session.user = result.user;
    session.initialized = true;
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/")
      ? route.query.next
      : "/projects";
    await router.replace(next);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法登录。";
  } finally {
    working.value = false;
  }
}
</script>

<style scoped lang="scss">
.loginPage {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(420px, .85fr);
  color: var(--cr-ink);
  background: var(--cr-paper);
}

.loginIntro {
  min-height: 100dvh;
  padding: clamp(34px, 6vw, 86px);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--cr-gradient-vertical);
  color: #28242e;
}

.brand { margin: 0 0 clamp(100px, 20vh, 220px); font-size: .9rem; font-weight: 800; letter-spacing: .2em; }
.eyebrow, .stepLabel { margin: 0 0 18px; font-size: .72rem; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
h1 { max-width: 760px; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(3.2rem, 6vw, 6.8rem); font-weight: 500; letter-spacing: -.055em; line-height: .92; text-wrap: balance; }
.introCopy { max-width: 520px; margin: 34px 0 0; color: rgba(40,36,46,.7); font-size: 1.02rem; line-height: 1.7; }
.buildNote { margin: 0; color: rgba(40,36,46,.58); font-size: .75rem; }
.loginPanel { display: grid; place-items: center; padding: 40px; }
.loginCard { width: min(390px, 100%); }
.stepLabel { color: var(--cr-violet); }
h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.6rem; font-weight: 500; letter-spacing: -.035em; }
.helper { margin: 14px 0 34px; color: var(--cr-muted); line-height: 1.6; }
form { display: grid; gap: 18px; }
label { display: grid; gap: 8px; font-size: .78rem; font-weight: 680; }
input { width: 100%; padding: 13px 14px; border: 1px solid var(--cr-line); border-radius: 8px; color: var(--cr-ink); background: #fffef9; font: inherit; transition: border-color .2s, box-shadow .2s; }
input:focus { outline: 0; border-color: var(--cr-green); box-shadow: 0 0 0 3px rgba(36,85,61,.12); }
.primaryButton { margin-top: 4px; padding: 13px 18px; border: 0; border-radius: 8px; color: #28242e; background: var(--cr-gradient); font: inherit; font-weight: 700; cursor: pointer; transition: transform .2s, filter .2s; }
.primaryButton:hover { filter: saturate(1.08) brightness(.98); transform: translateY(-1px); }
.primaryButton:active { transform: translateY(1px); }
.primaryButton:disabled { opacity: .55; cursor: default; transform: none; }
.switchButton { margin-top: 18px; padding: 7px 0; border: 0; color: var(--cr-violet); background: transparent; font: inherit; font-size: .84rem; cursor: pointer; }
.errorMessage { margin: 0; color: var(--cr-danger); font-size: .82rem; line-height: 1.5; }

@media (max-width: 860px) {
  .loginPage { grid-template-columns: 1fr; }
  .loginIntro { min-height: auto; padding: 34px 24px 54px; }
  .brand { margin-bottom: 74px; }
  .buildNote { margin-top: 54px; }
  .loginPanel { padding: 54px 24px 72px; }
}
</style>
