<template>
  <el-dialog
    :modelValue="requiresReauthentication && !logoutRequested"
    width="min(440px, calc(100vw - 32px))"
    :showClose="false"
    :closeOnClickModal="false"
    :closeOnPressEscape="false"
    alignCenter
    appendToBody>
    <template #header="{ titleId }">
      <div class="dialogHeading">
        <icon-lock :size="26" aria-hidden="true" />
        <h2 :id="titleId">{{ accountDisabled ? "此账号暂时无法使用" : "重新登录" }}</h2>
      </div>
    </template>
    <div class="accountDialogBody">
      <p>{{ accountDisabled ? "如需帮助，请联系支持。" : "请重新登录，继续创作。" }}</p>
      <p v-if="hasUnsavedAccountWork" class="secondaryText">当前有未保存的修改，请先不要关闭窗口。</p>
      <form v-if="showLogin && !accountDisabled" class="loginForm" @submit.prevent="reauthenticate">
        <label for="reauthAccount">账号</label>
        <el-input id="reauthAccount" v-model="account" autocomplete="username" :readonly="!!accountSession.user" :disabled="busy" />
        <label for="reauthPassword">密码</label>
        <el-input id="reauthPassword" v-model="password" type="password" autocomplete="current-password" showPassword :disabled="busy" :aria-describedby="operationError ? 'accountOperationError' : undefined" />
        <p class="secondaryText">如需更换账号，请先退出当前账号。</p>
        <el-button class="primaryAction" nativeType="submit" type="primary" :loading="busy" :disabled="!account.trim() || !password">重新登录</el-button>
      </form>
      <p v-if="operationError" id="accountOperationError" class="errorText" role="alert">{{ operationError }}</p>
      <p v-if="saveMessage" class="savedText" role="status">{{ saveMessage }}</p>
      <div class="dialogActions">
        <el-button v-if="hasUnsavedAccountWork" :loading="saving" :disabled="busy" @click="saveCurrent">保存当前内容</el-button>
        <el-button v-if="!showLogin && !accountDisabled" class="primaryAction" type="primary" :disabled="busy" @click="showLogin = true">重新登录</el-button>
        <el-button v-if="accountDisabled && accountBootstrap.supportUrl" class="primaryAction" tag="a" :href="accountBootstrap.supportUrl" target="_blank" rel="noopener noreferrer" type="primary">联系支持</el-button>
      </div>
      <p v-if="accountDisabled && !accountBootstrap.supportUrl" class="secondaryText">可向提供 Cruio 账号的人员寻求帮助。</p>
      <div class="secondaryAction">
        <el-button text :disabled="busy" @click="requestLogout">退出当前账号</el-button>
      </div>
    </div>
  </el-dialog>

  <el-dialog
    :modelValue="logoutRequested"
    width="min(480px, calc(100vw - 32px))"
    :showClose="false"
    :closeOnClickModal="false"
    :closeOnPressEscape="false"
    alignCenter
    appendToBody>
    <template #header="{ titleId }">
      <div class="dialogHeading">
        <icon-lock :size="26" aria-hidden="true" />
        <h2 :id="titleId">退出当前账号？</h2>
      </div>
    </template>
    <div class="accountDialogBody">
      <p v-if="hasUnsavedAccountWork" class="unsavedNotice"><icon-alert-triangle :size="22" aria-hidden="true" />有修改尚未保存，要保存后退出吗？</p>
      <p v-else>退出后可重新登录，已保存的项目不会删除。</p>
      <p v-if="operationError" class="errorText" role="alert">{{ operationError }}</p>
      <div class="dialogActions">
        <el-button :disabled="busy || accountWorkFinished" @click="logoutRequested = false">取消</el-button>
        <el-button class="primaryAction" type="primary" :loading="busy" @click="confirmLogout(false)">{{ accountWorkFinished && operationError ? "重试退出" : hasUnsavedAccountWork ? "保存并退出" : "退出登录" }}</el-button>
      </div>
      <div v-if="hasUnsavedAccountWork" class="secondaryAction">
        <el-button type="danger" text :disabled="busy" @click="confirmLogout(true)">不保存并退出</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import axios from "axios";
import { IconAlertTriangle, IconLock } from "@tabler/icons-vue";
import { accountBootstrap, accountBusy, accountSession, loginAccount, logoutAccount, logoutRequested, requestLogout, requiresReauthentication } from "@/stores/account";
import { accountWorkFinished, finishAccountWork, hasUnsavedAccountWork, saveAccountWork } from "@/lib/accountWorkspace";

const showLogin = ref(false);
const account = ref("");
const password = ref("");
const saving = ref(false);
const finishing = ref(false);
const operationError = ref("");
const saveMessage = ref("");
const accountDisabled = computed(() => accountSession.value.status === "disabled");
const busy = computed(() => accountBusy.value || saving.value || finishing.value);

function operationMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") return error.response.data.message;
  return error instanceof Error ? error.message : fallback;
}

watch(() => accountSession.value.user?.account, (value) => { account.value = value || ""; }, { immediate: true });
watch([requiresReauthentication, logoutRequested], () => {
  password.value = "";
  showLogin.value = false;
  operationError.value = "";
  saveMessage.value = "";
});

async function saveCurrent() {
  if (busy.value) return;
  saving.value = true;
  operationError.value = "";
  saveMessage.value = "";
  try {
    await saveAccountWork();
    saveMessage.value = "当前内容已保存。";
  } catch (error) {
    operationError.value = operationMessage(error, "保存失败，请重试。");
  } finally {
    saving.value = false;
  }
}

async function reauthenticate() {
  if (busy.value || !account.value.trim() || !password.value) return;
  operationError.value = "";
  try {
    await loginAccount(account.value.trim(), password.value);
  } catch (error) {
    operationError.value = operationMessage(error, "登录失败，请重试。");
  } finally {
    password.value = "";
  }
}

async function confirmLogout(discard: boolean) {
  if (busy.value) return;
  finishing.value = true;
  operationError.value = "";
  try {
    await finishAccountWork(discard);
    await logoutAccount();
  } catch (error) {
    operationError.value = operationMessage(error, "退出失败，请重试。");
  } finally {
    finishing.value = false;
  }
}
</script>

<style lang="scss" scoped>
.dialogHeading {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 8px 0;

  svg { flex-shrink: 0; color: var(--el-color-primary); }
  h2 { margin: 0; color: var(--el-text-color-primary); font-size: 22px; line-height: 1.4; font-weight: 600; }
}

.accountDialogBody {
  padding: 4px 8px 8px;
  max-height: calc(100dvh - 160px);
  overflow-y: auto;
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;

  p { margin: 0 0 16px; }
  .secondaryText { color: var(--el-text-color-regular); font-size: 13px; }
  .errorText { color: #b42318; :global(.dark) & { color: #ff9292; } }
  .savedText { color: #216e43; :global(.dark) & { color: #75d7a0; } }
  .unsavedNotice {
    display: flex;
    align-items: center;
    gap: 10px;
    svg { flex-shrink: 0; color: var(--el-color-warning); }
  }

  .loginForm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 24px 0 16px;

    label { font-weight: 500; }
    label:not(:first-child) { margin-top: 12px; }
    p { margin: 8px 0; }
    :deep(.el-input__wrapper) {
      min-height: 42px;
      box-shadow: 0 0 0 1px #858d99 inset;
      :global(.dark) & { box-shadow: 0 0 0 1px #737780 inset; }
      &.is-focus { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
    :deep(.el-input__password) { min-width: 32px; min-height: 40px; }
  }

  .dialogActions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 24px;
    > * { flex: 1; min-width: 120px; margin: 0; }
  }

  .primaryAction { color: #fff; background: #2475d0; border-color: #2475d0; }
  .secondaryAction {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
    :deep(.el-button--danger) { color: #b42318; :global(.dark) & { color: #ff9292; } }
  }
  :deep(.el-button) {
    min-height: 44px;
    height: auto;
    white-space: normal;
    line-height: 1.5;
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
  }
}
</style>
