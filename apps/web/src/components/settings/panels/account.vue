<template>
  <div class="accountPanel">
    <dl class="identityRow">
      <dt>当前账号</dt>
      <dd>{{ accountSession.user?.displayName || accountSession.user?.account || "未登录" }}</dd>
    </dl>

    <section class="accountSection" aria-labelledby="accountWalletTitle" :aria-busy="walletLoading">
      <div class="walletHeader">
        <h3 id="accountWalletTitle">余额与会员等级</h3>
        <el-button :loading="walletLoading" :disabled="redeeming" @click="refreshWallet">刷新余额</el-button>
      </div>
      <dl v-if="wallet" class="walletDetails">
        <dt>账户余额</dt><dd class="balanceValue">{{ formatAmount(wallet.balance, wallet.currency) }}</dd>
        <dt>会员等级</dt><dd>{{ wallet.group }}</dd>
        <dt>消费折扣</dt><dd>{{ discountLabel }}</dd>
        <dt>消费分组</dt><dd>{{ wallet.billingGroup === "auto" ? "自动选择" : wallet.billingGroup }}</dd>
      </dl>
      <p v-if="walletError" class="walletError" role="alert">{{ walletError }}</p>
      <p v-else-if="walletLoading && !wallet" role="status">正在读取账户余额…</p>
      <p>充值按兑换码面额到账，消费时按所属分组计费。</p>
      <form class="redeemForm" @submit.prevent="redeemCode">
        <label for="accountRedemptionCode">兑换码</label>
        <div class="redeemRow">
          <el-input id="accountRedemptionCode" v-model="redemptionCode" :maxlength="128" :disabled="redeeming" autocomplete="off" placeholder="输入兑换码" />
          <el-button type="primary" nativeType="submit" :loading="redeeming" :disabled="!redemptionCode.trim() || !modelAvailable || walletLoading">兑换充值</el-button>
        </div>
        <p v-if="redemptionMessage" :class="{ walletError: redemptionFailed }" :role="redemptionFailed ? 'alert' : 'status'">{{ redemptionMessage }}</p>
      </form>
    </section>

    <section class="accountSection" aria-labelledby="accountModelTitle">
      <h3 id="accountModelTitle">模型服务</h3>
      <div class="modelState" :class="{ available: modelAvailable }" role="status">
        <icon-circle-check v-if="modelAvailable" :size="22" aria-hidden="true" />
        <icon-alert-circle v-else :size="22" aria-hidden="true" />
        <span>{{ modelTitle }}</span>
      </div>
      <p>{{ modelDescription }}</p>
      <template v-if="!modelAvailable">
        <el-button v-if="accountBootstrap.supportUrl" class="contactButton" tag="a" :href="accountBootstrap.supportUrl" target="_blank" rel="noopener noreferrer" type="primary">
          联系支持
        </el-button>
        <p v-else class="supportHint">可向提供 Cruio 账号的人员寻求帮助。</p>
      </template>
    </section>

    <section class="accountSection" aria-labelledby="accountLogoutTitle">
      <h3 id="accountLogoutTitle">退出登录</h3>
      <p>退出后可重新登录，已保存的项目不会删除。</p>
      <el-button :disabled="accountBusy" @click="requestLogout">退出登录</el-button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import axios from "axios";
import type { AccountWallet, AccountRedemption } from "@toonflow/server/accountProtocol";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-vue";
import { accountBootstrap, accountBusy, accountSession, requestLogout } from "@/stores/account";

const modelAvailable = computed(() => accountSession.value.modelAccess.status === "available");
const wallet = ref<AccountWallet | null>(null);
const walletLoading = ref(false);
const walletError = ref("");
const redemptionCode = ref("");
const redeeming = ref(false);
const redemptionMessage = ref("");
const redemptionFailed = ref(false);
let lifetime = new AbortController();

const discountLabel = computed(() => {
  const ratio = wallet.value?.groupRatio;
  if (ratio == null) return "按实际消费分组计算";
  if (ratio === 0) return "免费";
  if (ratio === 1) return "标准价格";
  return ratio < 1 ? `${Number((ratio * 10).toFixed(4))} 折` : `${ratio} 倍率`;
});

function formatAmount(amount: number, currency: string) {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(amount)} ${currency}`;
}

function requestError(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.message === "string" ? error.response.data.message : fallback;
}

async function refreshWallet() {
  if (walletLoading.value || accountSession.value.status !== "authenticated") return;
  const current = lifetime;
  walletLoading.value = true;
  walletError.value = "";
  try {
    const { data } = await axios.get<{ data: AccountWallet }>("/api/account/wallet", { signal: current.signal });
    if (!current.signal.aborted) wallet.value = data.data;
  } catch (error) {
    if (!current.signal.aborted) walletError.value = requestError(error, "暂时无法读取余额，请稍后刷新。");
  } finally {
    if (!current.signal.aborted) walletLoading.value = false;
  }
}

async function redeemCode() {
  const key = redemptionCode.value.trim();
  if (!key || redeeming.value || walletLoading.value || !modelAvailable.value) return;
  const current = lifetime;
  redeeming.value = true;
  redemptionMessage.value = "";
  redemptionFailed.value = false;
  try {
    const { data } = await axios.post<{ data: AccountRedemption }>("/api/account/redeem", { key }, { signal: current.signal });
    if (current.signal.aborted) return;
    redemptionCode.value = "";
    redemptionMessage.value = `兑换成功，已到账 ${formatAmount(data.data.amount, data.data.currency)}。`;
    await refreshWallet();
  } catch (error) {
    if (current.signal.aborted) return;
    redemptionFailed.value = true;
    redemptionMessage.value = requestError(error, "暂未确认兑换结果，请先刷新余额确认到账情况。");
  } finally {
    if (!current.signal.aborted) redeeming.value = false;
  }
}

watch([() => accountSession.value.contextId, () => accountSession.value.status], () => {
  lifetime.abort();
  lifetime = new AbortController();
  wallet.value = null;
  walletLoading.value = false;
  walletError.value = "";
  redemptionCode.value = "";
  redemptionMessage.value = "";
  redeeming.value = false;
  void refreshWallet();
}, { immediate: true });
onBeforeUnmount(() => lifetime.abort());

const modelTitle = computed(() => {
  if (modelAvailable.value) return "已配置";
  return accountSession.value.modelAccess.status === "notProvisioned" ? "模型服务尚未开通" : "模型服务暂不可用";
});
const modelDescription = computed(() => {
  if (modelAvailable.value) return "如需调整可用模型或使用额度，请联系支持。";
  if (accountSession.value.modelAccess.status === "notProvisioned") return "当前账号尚未开通 AI 创作，请联系支持。";
  return "暂时无法使用 AI 创作，请稍后重试。";
});
</script>

<style lang="scss" scoped>
.accountPanel {
  padding: 0 4px 8px;
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 1.6;

  .identityRow {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: 16px;
    margin: 4px 0 28px;

    dt { color: var(--el-text-color-regular); }
    dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
  }

  .accountSection {
    padding: 28px 0;
    border-top: 1px solid var(--el-border-color);

    h3 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
    p { margin: 8px 0 20px; color: var(--el-text-color-regular); }

    .walletHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      h3 { margin: 0; }
    }

    .walletDetails {
      display: grid;
      grid-template-columns: 104px minmax(0, 1fr);
      align-items: center;
      gap: 12px 16px;
      dt { color: var(--el-text-color-regular); }
      dd { margin: 0; overflow-wrap: anywhere; }
      .balanceValue { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
    }

    .redeemForm {
      label { display: block; margin-bottom: 8px; }
      .redeemRow {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        :deep(.el-input) { flex: 1; min-width: 180px; }
      }
      p { margin-bottom: 0; }
    }

    .walletError { color: var(--el-color-danger); }

    .modelState {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--el-text-color-primary);

      svg { flex-shrink: 0; color: var(--el-color-warning); }
      &.available svg { color: var(--el-color-success); }
    }

    .contactButton {
      color: #fff;
      background: #2475d0;
      border-color: #2475d0;
    }

    .supportHint { margin-bottom: 0; font-size: 13px; }

    :deep(.el-button) {
      min-height: 40px;
      padding-inline: 20px;
      white-space: normal;
      line-height: 1.5;
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
    }
  }
}
</style>
