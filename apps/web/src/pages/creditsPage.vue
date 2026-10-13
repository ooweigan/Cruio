<template>
  <div class="creditsPage">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading"><div><p class="eyebrow">账户</p><h1>积分</h1><p>余额、预占与欠额分开展示。账单仅显示安全摘要，不包含付款凭据原件。</p></div></header>
      <p v-if="loading" class="notice">正在读取积分账户…</p>
      <p v-else-if="error" class="notice error" role="alert">{{ error }}</p>
      <template v-else-if="account">
        <section class="balanceGrid" aria-label="积分账户余额">
          <article class="balanceCard"><span>账面余额</span><strong :class="{ negative: account.balance < 0 }">{{ formatCredits(account.balance) }}</strong></article>
          <article class="balanceCard"><span>可用积分</span><strong>{{ formatCredits(account.available) }}</strong></article>
          <article class="balanceCard"><span>预占积分</span><strong>{{ formatCredits(account.reserved) }}</strong><small>处理中任务暂时锁定的额度</small></article>
          <article class="balanceCard"><span>欠额</span><strong :class="{ negative: account.debt > 0 }">{{ formatCredits(account.debt) }}</strong><small v-if="account.debt > 0">欠额清偿前，付费生成不可用</small></article>
        </section>
        <section class="ledgerCard">
          <div class="sectionHeading"><div><h2>账单明细</h2><p>预占不代表已扣除；未知状态会继续保留预占。</p></div><button class="secondaryButton" type="button" :disabled="loading" @click="refreshLedger">刷新</button></div>
          <p v-if="entries.length === 0 && !loading" class="emptyState">暂无积分记录</p>
          <div v-else class="ledgerList">
            <article v-for="entry in entries" :key="entry.id" class="ledgerRow">
              <div class="entryInfo"><strong>{{ entryLabel(entry.type) }}</strong><span>{{ entry.reason || "" }}</span><small>{{ formatDate(entry.createdAt) }}</small></div>
              <div class="entryAmount" :class="entry.amount < 0 ? 'negative' : 'positive'">{{ entry.amount > 0 ? "+" : "" }}{{ formatCredits(entry.amount) }}</div>
              <span class="entryStatus">{{ statusLabel(entry.status) }}</span>
              <button class="supportButton" type="button" @click="contactSupport(entry.id)">联系支持</button>
            </article>
          </div>
          <p v-if="pageError" class="notice error" role="alert">{{ pageError }}</p>
          <div v-if="entries.length && hasMore" class="ledgerFooter"><button class="secondaryButton" type="button" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? "正在加载…" : "加载更多" }}</button></div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";
import { useRoute, useRouter } from "vue-router";

const session = useCruioSession();
const route = useRoute();
const router = useRouter();
type Account = { balance: number; available: number; reserved: number; debt: number };
type LedgerEntry = { id: string; type: string; amount: number; reason?: string; createdAt: string; status?: string };
const account = ref<Account | null>(null);
const entries = ref<LedgerEntry[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
const pageError = ref("");
const cursor = ref<string | null>(null);
const hasMore = ref(false);

function formatCredits(value: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
function entryLabel(type: string) {
  const labels: Record<string, string> = { topup: "积分入账", refund: "退款扣回", reversal: "账本冲正", reserve: "生成预占", settle: "生成结算", release: "预占释放", adjustment: "积分调整" };
  return labels[type] || "积分账务记录";
}
function statusLabel(status?: string) {
  const labels: Record<string, string> = { pending: "处理中", success: "已完成", settled: "已结算", released: "已释放", failed: "失败", reversed: "已冲正" };
  return status ? labels[status] || "状态更新中" : "已记录";
}
async function loadLedger(reset = true) {
  if (reset) {
    loading.value = true;
    cursor.value = null;
    hasMore.value = false;
    pageError.value = "";
  } else {
    if (loadingMore.value || !hasMore.value || !cursor.value) return;
    loadingMore.value = true;
    pageError.value = "";
  }
  error.value = "";
  try {
    const params = new URLSearchParams({ limit: "50" });
    if (!reset && cursor.value) params.set("cursor", cursor.value);
    const result = await api<{ account: Account; entries: LedgerEntry[] }>(`/api/credits/ledger?${params.toString()}`);
    if (!result.account || !Array.isArray(result.entries)) throw new Error("服务端未返回有效账单数据。");
    account.value = result.account;
    entries.value = reset ? result.entries : [...entries.value, ...result.entries];
    cursor.value = result.entries.at(-1)?.id ?? (reset ? null : cursor.value);
    hasMore.value = result.entries.length === 50;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "积分账单读取失败";
    if (reset) error.value = message;
    else pageError.value = message;
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}
function loadMore() { return loadLedger(false); }
function refreshLedger() { return loadLedger(true); }
function contactSupport(entryId: string) { void router.push({ path: "/support", query: { category: "credits", sourceId: entryId } }); }
onMounted(async () => {
  await session.refresh();
  if (!session.user) {
    await router.replace({ name: "login", query: { next: route.fullPath } });
    return;
  }
  await loadLedger();
});
</script>

<style scoped lang="scss">
.creditsPage { min-height: 100dvh; background: var(--cr-page-background); }
.pageContent { max-width: 1080px; margin: 0 auto; padding: 24px 24px 24px; }
.pageHeading { display: flex; justify-content: space-between; align-items: end; margin-bottom: 24px; h1 { margin: 0; font-size: 20px; } p { margin: 8px 0 0; color: var(--cr-text-secondary); } }
.eyebrow { color: var(--cr-text-muted) !important; font-size: 12px; }
.balanceGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.balanceCard, .ledgerCard { background: var(--cr-surface); border: 1px solid var(--cr-border-subtle); border-radius: 8px; }
.balanceCard { min-height: 126px; display: flex; flex-direction: column; gap: 8px; padding: 16px; color: var(--cr-text-secondary); font-size: 14px; strong { color: var(--cr-text-primary); font-size: 20px; font-variant-numeric: tabular-nums; } small { color: var(--cr-text-muted); font-size: 12px; } }
.negative { color: var(--cr-status-danger) !important; }.positive { color: var(--cr-status-success) !important; }
.ledgerCard { padding: 16px; }
.sectionHeading { display: flex; justify-content: space-between; align-items: start; padding-bottom: 16px; border-bottom: 1px solid var(--cr-border-subtle); h2 { margin: 0; font-size: 16px; } p { margin: 8px 0 0; color: var(--cr-text-muted); font-size: 12px; } }
.secondaryButton { border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); cursor: pointer; font-size: 14px; &:hover { background: var(--cr-surface-hover); } }
.ledgerList { margin-top: 8px; }
.ledgerRow { min-height: 64px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--cr-border-subtle); &:last-child { border-bottom: 0; } }
.entryInfo { display: grid; gap: 4px; strong { font-size: 14px; } span { color: var(--cr-text-secondary); } small { color: var(--cr-text-muted); font-size: 12px; } }
.entryAmount { font-variant-numeric: tabular-nums; font-weight: 650; }.entryStatus { color: var(--cr-text-muted); font-size: 12px; }
.emptyState, .notice { padding: 16px 0; color: var(--cr-text-muted); }.error { color: var(--cr-status-danger); }
.ledgerFooter { display: flex; justify-content: center; padding-top: 12px; }
.supportButton { border: 0; padding: 8px; color: var(--cr-brand-primary); background: transparent; font: inherit; font-size: 14px; cursor: pointer; white-space: nowrap; }
.secondaryButton { border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); cursor: pointer; font-size: 14px; &:hover { background: var(--cr-surface-hover); } &:disabled { cursor: not-allowed; opacity: .55; } }
@media (max-width: 720px) { .pageContent { padding: 24px 12px; }.balanceGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.ledgerRow { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 8px 0; }.entryStatus, .supportButton { grid-column: 1 / -1; justify-self: start; } }
</style>
