<template>
  <div class="reconciliationPage">
    <cruioHeader />
    <main class="pageContent">
      <header class="pageHeading">
        <div><p class="eyebrow">只读核对</p><h1>积分与任务核对</h1><p>仅展示当前授权范围内的账户、任务与账本差异；核对视图不会修改任何源记录。</p></div>
        <button class="secondaryButton" type="button" :disabled="loading" @click="loadReport">{{ loading ? "正在读取…" : "刷新核对" }}</button>
      </header>
      <form class="filterCard" @submit.prevent="applyFilters">
        <label>任务与外部账本开始时间（UTC）<input v-model="fromInput" type="datetime-local" /></label>
        <label>结束时间（UTC）<input v-model="toInput" type="datetime-local" /></label>
        <label>单个用户 ID（可选）<input v-model.trim="userIdInput" placeholder="按授权用户精确核对" /></label>
        <button class="secondaryButton" type="submit" :disabled="loading">应用筛选</button>
        <p>窗口按任务创建时间和外部账本创建时间筛选，最长 366 天。账户余额核对使用该用户全量历史账本，不受窗口和分页限制。</p>
      </form>
      <p v-if="pageError" class="feedback error" role="alert">{{ pageError }}</p>
      <template v-if="report">
        <div class="scopeNote">范围：{{ report.scope.kind === "global" ? "当前岗位全局授权" : `指定用户授权（${report.scope.userIds?.length ?? 0} 个授权目标）` }} · {{ formatDate(report.window.from) }} 至 {{ formatDate(report.window.to) }} · 账户账本全量累计</div>
        <section class="summaryGrid" aria-label="当前返回范围统计">
          <article class="summaryCard"><span>账户</span><strong>{{ formatNumber(report.summary.accountCount) }}</strong><small>本页用户</small></article>
          <article class="summaryCard"><span>任务</span><strong>{{ formatNumber(report.summary.taskCount) }}<i v-if="report.tasks.truncated">+</i></strong><small>{{ report.tasks.truncated ? "已达到 100 条上限" : "所选窗口" }}</small></article>
          <article class="summaryCard"><span>外部账本记录</span><strong>{{ formatNumber(report.summary.externalEntryCount) }}</strong><small>充值、退款扣回與冲正</small></article>
          <article class="summaryCard"><span>已发现差异</span><strong :class="{ hasIssues: report.summary.issueCount > 0 }">{{ formatNumber(report.summary.issueCount) }}</strong><small>仅当前返回范围</small></article>
        </section>
        <p v-if="report.summary.issueCount === 0" class="scopeNote">当前返回范围未发现差异；该结果不代表完整经营或财务对账结论。</p>
          <p v-if="report.tasks.truncated" class="feedback warning" role="status">任务明细达到 100 条展示上限。缩短时间窗或按用户 ID 筛选后再核对。</p>

        <section class="reportSection">
          <header class="sectionHeading"><div><p class="eyebrow">全量账本校验</p><h2>账户余额与账本</h2><p>账面余额对比该用户所有账本 amount 合计；预占对比 reserved_delta 全量合计。</p></div><div class="pagination"><button class="secondaryButton" type="button" :disabled="loading || report.users.offset === 0" @click="changePage(-1)">上一页</button><span>第 {{ Math.floor(report.users.offset / report.users.limit) + 1 }} 页</span><button class="secondaryButton" type="button" :disabled="loading || !report.users.hasMore" @click="changePage(1)">下一页</button></div></header>
          <p v-if="!report.users.items.length" class="emptyState">授权范围内没有匹配账户。</p>
          <article v-for="item in report.users.items" :key="item.user.id" class="accountCard">
            <div class="accountHeading"><div><h3>{{ item.user.email }}</h3><code>{{ item.user.id }}</code></div><span class="statusBadge" :class="item.issues.length ? 'statusIssue' : 'statusClear'">{{ item.issues.length ? `${item.issues.length} 项异常` : "当前账户核对无差异" }}</span></div>
            <div class="accountGrid"><div><span>账户余额</span><strong>{{ credits(item.balance) }}</strong></div><div><span>账本金额合计</span><strong>{{ credits(item.ledgerBalance) }}</strong></div><div><span>余额差异</span><strong :class="{ hasIssues: item.difference !== 0 }">{{ credits(item.difference) }}</strong></div><div><span>当前预占</span><strong>{{ credits(item.reserved) }}</strong></div><div><span>账本预占变动合计</span><strong>{{ credits(item.ledgerReserved) }}</strong></div><div><span>账本记录</span><strong>{{ formatNumber(item.entryCount) }}</strong></div></div>
            <ul v-if="item.issues.length" class="issueList"><li v-for="issue in item.issues" :key="issue">{{ issue }}</li></ul>
          </article>
        </section>

        <section class="reportSection">
          <header class="sectionHeading"><div><p class="eyebrow">M04 × M07</p><h2>生成任务与积分结算</h2><p>状态与实结/释放来自源任务和账本；结果可访问性仅核对文件存在及登记大小。</p></div></header>
          <p v-if="!report.tasks.items.length" class="emptyState">当前时间窗没有任务。</p>
          <article v-for="task in report.tasks.items" :key="task.id" class="taskCard">
            <div class="taskHeading"><div><h3>{{ statusLabel(task.status) }}</h3><p>{{ task.createdAt }} · 用户 {{ task.userId }}</p><code>{{ task.id }}</code></div><span class="statusBadge" :class="task.issues.length ? 'statusIssue' : 'statusNeutral'">{{ task.issues.length ? `${task.issues.length} 项待核` : "该任务账本匹配" }}</span></div>
            <div class="taskNumbers"><div><span>报价 / 初始预占</span><strong>{{ credits(task.quoted) }} / {{ credits(task.reserve.reservedDelta) }}</strong><small>预占 {{ task.reserve.count }} 条</small></div><div><span>实结</span><strong>{{ credits(task.settle.amount) }}</strong><small>{{ task.settle.count }} 条 · 预占变化 {{ credits(task.settle.reservedDelta) }}</small></div><div><span>释放</span><strong>{{ credits(task.release.reservedDelta) }}</strong><small>{{ task.release.count }} 条 · 金额 {{ credits(task.release.amount) }}</small></div></div>
            <div v-if="task.results.length" class="resultSummary"><span v-for="result in task.results" :key="result.id" :class="{ inaccessible: !result.fileAccessible }">{{ result.mediaType }} · {{ result.mimeType }} · {{ formatNumber(result.recordedSize) }} B · {{ result.fileAccessible ? "文件可访问" : "文件缺失或大小不符" }}</span></div>
            <ul v-if="task.issues.length" class="issueList"><li v-for="issue in task.issues" :key="issue">{{ issue }}</li></ul>
          </article>
        </section>

        <section class="reportSection">
          <header class="sectionHeading"><div><p class="eyebrow">M11 × M07</p><h2>外部成交与退款扣回账本</h2><p>只汇总积分账本净额和关联存在性；不代表支付、平台订单、收入或付款真实性。</p></div></header>
          <p v-if="!report.external.length" class="emptyState">窗口内没有外部充值、退款扣回或冲正账本记录。</p>
          <div v-else class="externalTableWrap"><table><thead><tr><th>用户</th><th>账本类型</th><th>记录数</th><th>积分净额</th><th>关联账本记录</th><th>凭据记录</th></tr></thead><tbody><tr v-for="row in report.external" :key="`${row.userId}-${row.type}`"><td><code>{{ row.userId }}</code></td><td>{{ externalLabel(row.type) }}</td><td>{{ formatNumber(row.count) }}</td><td>{{ credits(row.netAmount) }}</td><td>{{ row.relatedPresentCount }} 存在 · {{ row.relatedMissingCount }} 缺失{{ row.type === "topup" ? " · 无上游关联要求" : "" }}</td><td>{{ row.evidencePresentCount }} 存在 · {{ row.evidenceMissingCount }} 缺失</td></tr></tbody></table></div>
          <p class="scopeNote">当前未启用平台订单、线上支付、退款和佣金。本视图不展示或推算相关金额。</p>
        </section>
        <footer class="reportFooter">生成时间 {{ formatDate(report.generatedAt) }} · 窗口：UTC · 账户余额：全量历史账本 · 不自动修复差异</footer>
      </template>
      <p v-else-if="loading" class="emptyState">正在读取授权范围内的核对数据…</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";

type Account = { user: { id: string; email: string }; balance: number; reserved: number; ledgerBalance: number; ledgerReserved: number; difference: number; differenceReserved: number; entryCount: number; issues: string[] };
type Task = { id: string; userId: string; status: string; createdAt: string; updatedAt: string; quoted: number; reserve: { count: number; amount: number; reservedDelta: number }; settle: { count: number; amount: number; reservedDelta: number }; release: { count: number; amount: number; reservedDelta: number }; results: { id: string; mediaType: string; mimeType: string; recordedSize: number; fileAccessible: boolean }[]; issues: string[] };
type Report = { scope: { kind: "global" | "users"; userIds: string[] | null }; window: { from: string; to: string; timezone: string; taskRange: string; ledgerRange: string; externalRange: string }; users: { items: Account[]; limit: number; offset: number; hasMore: boolean; nextOffset: number | null }; tasks: { items: Task[]; limit: number; truncated: boolean }; external: { userId: string; type: string; count: number; netAmount: number; relatedPresentCount: number; relatedMissingCount: number; evidencePresentCount: number; evidenceMissingCount: number }[]; summary: { accountCount: number; taskCount: number; externalEntryCount: number; issueCount: number }; generatedAt: string };

const report = ref<Report | null>(null);
const pageError = ref("");
const loading = ref(false);
const fromInput = ref(toUtcInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
const toInput = ref(toUtcInput(new Date()));
const userIdInput = ref("");
const activeOffset = ref(0);
const formatNumber = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
const credits = (value: number) => `${formatNumber(value)} 点`;
const formatDate = (value: string | Date) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
function toUtcInput(date: Date) {
  return date.toISOString().slice(0, 16);
}
function statusLabel(status: string) {
  return ({ queued: "排队中", running: "处理中", unknown: "待核查", failed: "失败", delivered: "已交付", succeeded: "供应商已成功" } as Record<string, string>)[status] ?? status;
}
function externalLabel(type: string) {
  return ({ topup: "外部成交充值", refund: "外部退款扣回", reversal: "账本冲正" } as Record<string, string>)[type] ?? type;
}
function isoInput(value: string) {
  return `${value}:00.000Z`;
}
async function loadReport() {
  loading.value = true;
  pageError.value = "";
  try {
    const query = new URLSearchParams({ from: isoInput(fromInput.value), to: isoInput(toInput.value), limit: "20", offset: String(activeOffset.value) });
    if (userIdInput.value) query.set("userId", userIdInput.value);
    report.value = await api<Report>(`/api/operations/reconciliation?${query.toString()}`);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "核对数据读取失败。";
  } finally {
    loading.value = false;
  }
}
function applyFilters() {
  activeOffset.value = 0;
  void loadReport();
}
function changePage(direction: number) {
  if (!report.value) return;
  activeOffset.value = Math.max(0, report.value.users.offset + direction * report.value.users.limit);
  void loadReport();
}
onMounted(loadReport);
</script>

<style scoped lang="scss">
.reconciliationPage { min-height: 100vh; color: var(--cr-text-primary); background: var(--cr-page-background); }
.pageContent { width: min(1180px, 100%); margin: 0 auto; padding: 24px; }
.pageHeading, .sectionHeading, .accountHeading, .taskHeading { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.pageHeading { margin-bottom: 24px; h1 { margin: 0; font-size: 20px; } p:not(.eyebrow) { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 14px; } }
.eyebrow { margin: 0 0 8px; color: var(--cr-text-muted); font-size: 12px; }
.filterCard, .reportSection { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.filterCard { grid-template-columns: repeat(3, minmax(160px, 1fr)) auto; align-items: end; margin-bottom: 16px; label { display: grid; gap: 8px; color: var(--cr-text-secondary); font-size: 14px; } input { min-height: 38px; min-width: 0; border: 1px solid var(--cr-border-strong); border-radius: 6px; padding: 8px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; } p { grid-column: 1 / -1; margin: 0; color: var(--cr-text-muted); font-size: 12px; } }
.secondaryButton { min-height: 36px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); cursor: pointer; font: inherit; &:disabled { cursor: not-allowed; opacity: .55; } }
.scopeNote, .reportFooter { color: var(--cr-text-muted); font-size: 12px; }
.summaryGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
.summaryCard, .accountCard, .taskCard { padding: 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); }
.summaryCard { display: grid; gap: 4px; span { color: var(--cr-text-secondary); font-size: 12px; } strong { font-size: 20px; font-variant-numeric: tabular-nums; } small { color: var(--cr-text-muted); font-size: 12px; } i { font-style: normal; } }
.reportSection { margin-top: 16px; }
.sectionHeading { align-items: center; h2 { margin: 0; font-size: 20px; } p:not(.eyebrow) { margin: 8px 0 0; color: var(--cr-text-secondary); font-size: 12px; } }
.pagination { display: flex; align-items: center; gap: 8px; white-space: nowrap; color: var(--cr-text-muted); font-size: 12px; }
.accountCard, .taskCard { display: grid; gap: 12px; }
.accountHeading { align-items: center; h3 { margin: 0 0 4px; font-size: 14px; } code, .taskHeading code { color: var(--cr-text-muted); font-size: 12px; overflow-wrap: anywhere; } }
.statusBadge { flex: none; border-radius: 999px; padding: 4px 8px; font-size: 12px; }.statusClear { color: color-mix(in srgb, var(--cr-status-success) 55%, var(--cr-text-primary)); background: var(--cr-surface-subtle); }.statusIssue { color: color-mix(in srgb, var(--cr-status-danger) 55%, var(--cr-text-primary)); background: var(--cr-surface-subtle); }.statusNeutral { color: var(--cr-text-secondary); background: var(--cr-surface-hover); }
.accountGrid, .taskNumbers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.accountGrid > div, .taskNumbers > div { display: grid; gap: 4px; padding: 8px; border-radius: 8px; background: var(--cr-surface-subtle); span { color: var(--cr-text-muted); font-size: 12px; } strong { font-size: 14px; font-variant-numeric: tabular-nums; } small { color: var(--cr-text-muted); font-size: 12px; } }
.taskHeading { align-items: center; h3 { margin: 0 0 4px; font-size: 14px; } p { margin: 0 0 4px; color: var(--cr-text-muted); font-size: 12px; } code { font-size: 12px; overflow-wrap: anywhere; } }
.issueList { display: grid; gap: 4px; margin: 0; padding-left: 16px; color: var(--cr-status-danger); font-size: 12px; }
.hasIssues, .inaccessible { color: var(--cr-status-danger); }
.resultSummary { display: flex; flex-wrap: wrap; gap: 8px; span { padding: 4px 8px; border-radius: 6px; color: var(--cr-text-secondary); background: var(--cr-surface-subtle); font-size: 12px; overflow-wrap: anywhere; } }
.externalTableWrap { overflow-x: auto; }table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; th, td { padding: 8px; border-bottom: 1px solid var(--cr-border-subtle); white-space: nowrap; } th { color: var(--cr-text-muted); font-weight: 500; } code { font-size: 12px; } }
.feedback, .emptyState { padding: 12px 0; color: var(--cr-text-muted); font-size: 14px; }.error { color: color-mix(in srgb, var(--cr-status-danger) 55%, var(--cr-text-primary)); }.warning { color: color-mix(in srgb, var(--cr-status-warning) 55%, var(--cr-text-primary)); }
.reportFooter { padding: 8px 0; }
@media (max-width: 760px) { .pageContent { padding: 24px 12px; }.pageHeading, .sectionHeading { align-items: start; flex-direction: column; }.filterCard { grid-template-columns: 1fr; }.summaryGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.accountGrid, .taskNumbers { grid-template-columns: repeat(2, minmax(0, 1fr)); }.pagination { white-space: normal; } }
</style>
