<template>
  <main class="hello">
    <section class="loginPanel" aria-labelledby="loginTitle">
      <header class="pageHeader">
        <span class="brandName" translate="no"><img class="brandLogo" :src="logoUrl" alt="" />Cruio</span>
        <languageSelect popover />
      </header>
      <div v-if="!accountReady && accountBusy" class="restoreState" role="status" aria-live="polite">
        <span id="loginTitle" class="restoreBrand" translate="no">Cruio</span>
        <p>正在加载…</p>
      </div>
      <div v-else class="loginContent">
        <h1 id="loginTitle">登录 Cruio</h1>
        <p class="description">登录后，继续你的创作。</p>
        <div v-if="isAuthenticated" class="loginForm">
          <p v-if="!accountError">正在加载…</p>
          <p v-if="accountError" class="loginError" role="alert">{{ accountError }}</p>
          <button class="loginButton" type="button" :disabled="accountBusy" @click="retryAccount">{{ accountBusy ? '正在加载…' : '重试' }}</button>
          <button class="retryButton" type="button" :disabled="accountBusy" @click="requestLogout">退出当前账号</button>
        </div>
        <form v-else class="loginForm" :aria-busy="submitting" novalidate @submit.prevent="submitLogin">
          <div class="formField">
            <label for="loginAccount">账号</label>
            <div class="inputShell" :class="{ invalid: accountMissing }">
              <icon-user :size="20" aria-hidden="true" />
              <input id="loginAccount" ref="accountInput" v-model="account" name="username" autocomplete="username" autocapitalize="none" :spellcheck="false"
                placeholder="输入你的账号" :readonly="submitting" :aria-invalid="accountMissing" :aria-describedby="accountMissing ? 'accountFieldError' : undefined"
                @input="accountMissing = false" />
            </div>
            <p v-if="accountMissing" id="accountFieldError" class="fieldError">请输入账号</p>
          </div>
          <div class="formField">
            <label for="loginPassword">密码</label>
            <div class="inputShell" :class="{ invalid: passwordMissing }">
              <icon-lock :size="20" aria-hidden="true" />
              <input id="loginPassword" ref="passwordInput" v-model="password" name="password" :type="passwordVisible ? 'text' : 'password'" autocomplete="current-password"
                placeholder="输入密码" :readonly="submitting" :aria-invalid="passwordMissing" :aria-describedby="passwordMissing ? 'passwordFieldError' : undefined"
                @input="passwordMissing = false" />
              <button class="passwordToggle" type="button" :aria-label="passwordVisible ? '隐藏密码' : '显示密码'" :aria-pressed="passwordVisible" @click="passwordVisible = !passwordVisible">
                <icon-eye v-if="passwordVisible" :size="20" aria-hidden="true" />
                <icon-eye-off v-else :size="20" aria-hidden="true" />
              </button>
            </div>
            <p v-if="passwordMissing" id="passwordFieldError" class="fieldError">请输入密码</p>
          </div>
          <div v-if="serviceUnavailable && !loginError && !accountError" class="serviceNotice" role="status">
            <icon-info-circle :size="19" aria-hidden="true" />
            <p>暂时无法登录，请稍后重试。</p>
          </div>
          <p v-if="loginError || accountError" class="loginError" role="alert">{{ loginError || accountError }}</p>
          <button class="loginButton" type="submit" :disabled="accountBusy || submitting || serviceUnavailable">{{ submitting ? '正在登录…' : '登录' }}</button>
          <button v-if="serviceUnavailable || accountError" class="retryButton" type="button" :disabled="accountBusy" @click="retryAccount">{{ accountBusy ? '正在重试…' : '重试' }}</button>
          <a v-if="accountBootstrap?.supportUrl" class="helpLink" :href="accountBootstrap.supportUrl" target="_blank" rel="noopener noreferrer">联系支持</a>
        </form>
      </div>
      <footer class="pageFooter">
        <p>项目文件保存在本机。</p>
        <p v-if="accountReady && !accountBootstrap.rememberSession">重启 Cruio 后需重新登录。</p>
        <nav v-if="accountBootstrap?.termsUrl || accountBootstrap?.privacyUrl" class="legalLinks" aria-label="法律条款">
          <a v-if="accountBootstrap.termsUrl" :href="accountBootstrap.termsUrl" target="_blank" rel="noopener noreferrer">用户协议</a>
          <a v-if="accountBootstrap.privacyUrl" :href="accountBootstrap.privacyUrl" target="_blank" rel="noopener noreferrer">隐私政策</a>
        </nav>
      </footer>
    </section>
    <aside class="artPanel" aria-hidden="true">
      <img class="creativeArt" :src="creativeLoginArt" alt="" />
      <p class="artCaption"><span />从想法，到作品。</p>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { IconEye, IconEyeOff, IconInfoCircle, IconLock, IconUser } from "@tabler/icons-vue";
import languageSelect from "@/components/languageSelect.vue";
import { accountBootstrap, accountBusy, accountError, accountReady, isAuthenticated, loadAccount, loginAccount, requestLogout } from "@/stores/account";
import creativeLoginArt from "./creativeLoginArt.png";
import logoUrl from "@toonflow/assets/logoColor.svg";

const account = ref("");
const password = ref("");
const passwordVisible = ref(false);
const accountMissing = ref(false);
const passwordMissing = ref(false);
const submitting = ref(false);
const loginError = ref("");
const accountInput = ref<HTMLInputElement>();
const passwordInput = ref<HTMLInputElement>();
const serviceUnavailable = computed(() => !accountBootstrap.value?.configured);

async function submitLogin() {
  if (accountBusy.value || submitting.value || serviceUnavailable.value) return;
  accountMissing.value = !account.value.trim();
  passwordMissing.value = !password.value;
  loginError.value = "";
  if (accountMissing.value || passwordMissing.value) {
    (accountMissing.value ? accountInput : passwordInput).value?.focus();
    return;
  }
  submitting.value = true;
  try {
    await loginAccount(account.value.trim(), password.value);
    password.value = "";
    passwordVisible.value = false;
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : "登录失败，请重试。";
  } finally {
    submitting.value = false;
  }
}

async function retryAccount() {
  loginError.value = "";
  try {
    await loadAccount(true);
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : "暂时无法登录，请稍后重试。";
  }
}

onBeforeUnmount(() => { password.value = ""; });
</script>

<style lang="scss" scoped>
.hello {
  --accountLink: #1c64b5;
  --accountBorder: #858d99;
  --accountError: #b42318;
  display: grid;
  grid-template-columns: minmax(420px, 38.4%) minmax(0, 1fr);
  min-height: 100svh;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: "Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;

  a, button, input {
    &:focus-visible { outline: 2px solid var(--accountLink); outline-offset: 4px; }
  }
  .loginPanel {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-width: 0;
    min-height: 700px;
    padding: 30px clamp(28px, 5.05vw, 76px) 48px;

    .pageHeader {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-inline: -24px;
      .brandName {
        display: inline-flex; align-items: center; gap: 9px; font-size: 26px; font-weight: 650; letter-spacing: -0.7px;
        .brandLogo {
          width: 36px; height: 36px;
          .dark & { filter: brightness(0) invert(1); }
        }
      }
      :deep(.languageTrigger) { border-color: transparent; border-radius: 8px; background: transparent; }
    }
    .restoreState {
      align-self: center; text-align: center; color: var(--el-text-color-regular);
      .restoreBrand { color: var(--el-text-color-primary); font-size: 32px; font-weight: 600; }
      p { margin-top: 20px; font-size: 14px; }
    }
    .loginContent {
      align-self: center; width: 100%; max-width: 400px; margin: 64px auto;
      h1 { margin: 0; font-size: clamp(32px, 3.3vw, 44px); line-height: 1.35; font-weight: 600; letter-spacing: -1px; }
      .description { margin: 12px 0 40px; color: var(--el-text-color-regular); font-size: 17px; line-height: 1.6; }
      .loginForm {
        display: flex; flex-direction: column; gap: 24px;
        .formField {
          label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 500; line-height: 1.5; }
          .inputShell {
            display: flex; align-items: center; gap: 14px; min-height: 50px; padding-inline: 16px 6px;
            border: 1px solid var(--accountBorder); border-radius: 8px; background: var(--el-fill-color-light);
            color: var(--el-text-color-regular); transition: border-color 150ms;
            &.invalid { border-color: var(--accountError); }
            &:focus-within { outline: 2px solid var(--accountLink); outline-offset: 2px; }
            > svg { flex-shrink: 0; }
            input {
              width: 100%; min-width: 0; height: 48px; padding: 0; border: 0; outline: none;
              background: transparent; color: var(--el-text-color-primary); font: inherit; font-size: 15px;
              &::placeholder { color: var(--el-text-color-secondary); }
              &:focus-visible { outline: none; }
            }
            .passwordToggle {
              display: grid; flex-shrink: 0; place-items: center; width: 40px; height: 40px; padding: 0;
              border: 0; border-radius: 6px; background: transparent; color: var(--el-text-color-regular); cursor: pointer;
              &:hover { background: var(--el-fill-color); }
            }
          }
          .fieldError { margin: 8px 0 0; color: var(--accountError); font-size: 13px; line-height: 1.5; }
        }
        .serviceNotice {
          display: flex; align-items: flex-start; gap: 8px; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.6;
          > svg { flex-shrink: 0; margin-top: 1px; }
          p { margin: 0; }
        }
        .loginError { margin: 0; color: var(--accountError); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
        .loginButton {
          width: 100%; min-height: 50px; padding: 12px 16px; border: 1px solid transparent; border-radius: 8px;
          background: #2475d0; color: #fff; font: inherit; font-size: 16px; font-weight: 500; cursor: pointer; transition: background-color 150ms;
          &:hover:not(:disabled) { background: #1c64b5; }
          &:disabled { cursor: not-allowed; background: var(--el-fill-color); color: var(--el-text-color-secondary); border-color: var(--el-border-color); }
        }
        .retryButton, .helpLink { align-self: flex-start; color: var(--accountLink); font: inherit; font-size: 14px; line-height: 1.5; }
        .retryButton { min-height: 40px; padding: 0; border: 0; background: transparent; cursor: pointer; &:disabled { cursor: wait; } }
        .helpLink { text-decoration: none; &:hover { text-decoration: underline; } }
      }
    }
    .pageFooter {
      width: 100%; max-width: 400px; margin-inline: auto; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.6;
      p { margin: 0; }
      .legalLinks {
        display: flex; flex-wrap: wrap; gap: 12px 20px; margin-top: 16px; padding-top: 18px; border-top: 1px solid var(--el-border-color);
        a { color: inherit; text-decoration: none; &:hover { color: var(--accountLink); text-decoration: underline; } }
      }
    }
  }
  .artPanel {
    position: relative; min-width: 0; overflow: hidden; background: #0c1b27;
    .creativeArt { display: block; position: absolute; width: 100%; height: 100%; object-fit: cover; object-position: center; }
    .artCaption {
      position: absolute; inset-inline-end: 7%; bottom: 4%; display: flex; align-items: center; gap: 20px; margin: 0;
      color: #e3e9f2; font-size: clamp(16px, 1.5vw, 22px); letter-spacing: 2px;
      span { width: 40px; height: 1px; background: #74899e; }
    }
  }
  @media (max-width: 1099px) {
    grid-template-columns: 1fr;
    .loginPanel { min-height: 100svh; padding-inline: 48px; .pageHeader { margin-inline: 0; } }
    .artPanel { display: none; }
  }
  @media (max-width: 699px) {
    .loginPanel {
      padding: 20px 24px 28px;
      .pageHeader { gap: 8px; .brandName { font-size: 24px; } }
      .loginContent { margin-block: 56px; h1 { font-size: 32px; } .description { font-size: 16px; } }
    }
  }
}
:global(html.dark .hello) { --accountLink: #66b1ff; --accountBorder: #737780; --accountError: #ff9292; }
@media (prefers-reduced-motion: reduce) {
  .hello .loginPanel .loginContent .loginForm .formField .inputShell,
  .hello .loginPanel .loginContent .loginForm .loginButton { transition: none; }
}
</style>
