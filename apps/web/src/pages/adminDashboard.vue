<template>
  <main class="dashboardPage">
    <header class="adminHeading"><div><h1>Dashboard</h1><p>运行概览<span v-if="report"> · 更新于 {{ formatTime(report.updatedAt) }}</span></p></div><button v-if="isAdmin" type="button" class="adminButton" :disabled="loading" @click="load">{{ loading ? "刷新中…" : "刷新" }}</button></header>
    <p v-if="errorMessage" class="adminFeedback error" role="alert">{{ errorMessage }}</p>
    <p v-if="loading && !report" class="adminEmpty" role="status">正在读取运行数据…</p>
    <template v-if="report">
      <section class="metricStrip" aria-label="平台统计">
        <div><span>注册用户</span><strong>{{ report.summary.users }}</strong><small>{{ report.summary.disabledUsers }} 个已停用</small></div>
        <div><span>生成任务</span><strong>{{ report.summary.tasks }}</strong><small>累计受理</small></div>
      </section>
      <div class="dashboardGrid">
        <section class="dashboardPanel trendPanel">
          <header><div><h2>近 7 天活动</h2><p>按北京时间自然日统计</p></div><div class="chartLegend"><span>新增用户</span><span>生成任务</span></div></header>
          <div class="barChart" role="img" :aria-label="chartDescription">
            <div v-for="day in report.daily" :key="day.day" class="chartColumn">
              <div class="barPair"><div class="userBar" :style="{ height: `${day.users / chartMax * 100}%` }"><span>{{ day.users }}</span></div><div class="taskBar" :style="{ height: `${day.tasks / chartMax * 100}%` }"><span>{{ day.tasks }}</span></div></div>
              <time>{{ day.day.slice(5).replace('-', '/') }}</time>
            </div>
          </div>
        </section>
        <section class="dashboardPanel">
          <header><div><h2>任务状态</h2><p>当前状态分布</p></div></header>
          <dl class="stateList"><div v-for="state in taskStates" :key="state.key"><dt><span class="stateDot" :class="state.key" />{{ state.label }}</dt><dd>{{ state.count }}</dd></div></dl>
        </section>
        <section class="dashboardPanel">
          <header><h2>最近注册</h2><router-link class="adminTextLink" to="/admin/users">全部用户</router-link></header>
          <div v-if="!report.recentUsers.length" class="adminEmpty">暂无注册用户</div>
          <ul v-else class="recentUsers"><li v-for="user in report.recentUsers" :key="user.id"><router-link :to="{ path: '/admin/users', query: { user: user.email } }">{{ user.email }}</router-link><time>{{ formatDate(user.createdAt) }}</time></li></ul>
        </section>
        <section class="dashboardPanel">
          <header><h2>New API</h2><router-link class="adminTextLink" to="/admin/models">模型管理 ↗</router-link></header>
          <div class="modelSummary"><router-link class="adminTextLink" to="/admin/providers">供应商与渠道</router-link><span>在 New API 中配置上游渠道、密钥和模型。</span></div>
          <div class="modelSummary"><router-link class="adminTextLink" to="/admin/models">模型目录与定价</router-link><span>模型数量和使用情况以 New API 控制台为准。</span></div>
        </section>
      </div>
    </template>
    <section v-else-if="!isAdmin" class="staffOverview"><h2>岗位工作区</h2><p>从左侧导航进入当前岗位的工作页面。</p><dl><div v-for="role in activeRoles" :key="role.id"><dt>{{ roleLabels[role.role] }}</dt><dd>{{ role.scopeKind === 'global' ? '全局范围' : '指定用户范围' }} · 有效至 {{ formatDate(role.expiresAt) }}</dd></div></dl></section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";

type Report = {
  summary: { users: number; disabledUsers: number; providers: number; models: number; publishedModels: number; tasks: number };
  daily: { day: string; users: number; tasks: number }[];
  taskStates: { status: string; count: number }[];
  modelTypes: { operation: string; count: number; published: number }[];
  recentUsers: { id: string; email: string; createdAt: string; disabledAt: string | null }[];
  updatedAt: string;
};
const session = useCruioSession();
const isAdmin = computed(() => session.hasRole("admin", true));
const activeRoles = computed(() => session.user?.roles?.filter(role => !role.revokedAt && new Date(role.expiresAt).getTime() > Date.now()) ?? []);
const roleLabels = { admin: "管理员", modelOperator: "模型运营", creditOperator: "积分运营", support: "客服", privacyOperator: "隐私运营" };
const report = ref<Report | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const formatDate = (value: string) => new Date(value).toLocaleDateString("zh-CN");
const formatTime = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
const chartMax = computed(() => Math.max(1, ...report.value?.daily.flatMap(day => [day.users, day.tasks]) ?? []));
const chartDescription = computed(() => report.value?.daily.map(day => `${day.day}：新增用户 ${day.users}，生成任务 ${day.tasks}`).join("；") ?? "");
const taskStates = computed(() => [
  { key: "queued", label: "排队中" }, { key: "running", label: "处理中" }, { key: "succeeded", label: "等待交付" },
  { key: "delivered", label: "已交付" }, { key: "unknown", label: "待核查" }, { key: "failed", label: "失败" },
].map(state => ({ ...state, count: report.value?.taskStates.find(item => item.status === state.key)?.count ?? 0 })));
async function load() {
  if (!isAdmin.value || loading.value) return;
  loading.value = true; errorMessage.value = "";
  try { report.value = (await api<{ data: Report }>("/api/operations/dashboard")).data; }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : "统计读取失败。"; }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped lang="scss">
.dashboardPage {
  .metricStrip { display: grid; grid-template-columns: repeat(2, 1fr); margin-bottom: 24px; padding: 24px 0; border: 1px solid var(--cr-border-subtle); border-radius: 6px; background: var(--cr-surface);
    > div { display: grid; gap: 4px; padding: 0 24px; border-right: 1px solid var(--cr-border-subtle); &:last-child { border: 0; } }
    span, small, a { color: var(--cr-text-muted); font-size: 12px; } strong { font-size: 28px; line-height: 1.5; font-weight: 600; font-variant-numeric: tabular-nums; } a { text-decoration: none; &:hover { text-decoration: underline; } }
  }
  .dashboardGrid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 20px;
    .dashboardPanel { min-width: 0; padding: 20px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; background: var(--cr-surface);
      > header { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 20px; p { margin: 4px 0 0; font-size: 11px; color: var(--cr-text-muted); } }
      .chartLegend { display: flex; gap: 12px; font-size: 10px; color: var(--cr-text-secondary); span { display: flex; align-items: center; gap: 5px; &::before { content: ""; width: 7px; height: 7px; background: var(--cr-border-strong); } &:last-child::before { background: var(--cr-brand-primary); } } }
      .barChart { display: flex; justify-content: space-around; gap: 8px; padding: 24px 0 0;
        .chartColumn { flex: 1; min-width: 0; text-align: center;
          .barPair { height: 150px; display: flex; align-items: end; justify-content: center; gap: 5px; border-bottom: 1px solid var(--cr-border-subtle);
            > div { position: relative; width: min(28%, 22px); min-height: 1px; border-radius: 2px 2px 0 0; background: var(--cr-border-strong); span { position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--cr-text-muted); font-variant-numeric: tabular-nums; } }
            .taskBar { background: var(--cr-brand-primary); }
          }
          time { display: block; margin-top: 10px; color: var(--cr-text-muted); font-size: 10px; }
        }
      }
      .stateList { margin: 0; > div { display: flex; justify-content: space-between; padding: 8px 0; font-size: 12px; dt { display: flex; align-items: center; gap: 8px; color: var(--cr-text-secondary); } dd { margin: 0; font-variant-numeric: tabular-nums; } } .stateDot { width: 5px; height: 5px; border-radius: 50%; background: var(--cr-border-strong); &.delivered { background: var(--cr-status-success); } &.unknown { background: var(--cr-status-warning); } &.failed { background: var(--cr-status-danger); } } }
      .recentUsers { list-style: none; padding: 0; margin: 0; li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--cr-border-subtle); font-size: 12px; a { color: var(--cr-text-primary); text-decoration: none; overflow-wrap: anywhere; &:hover { text-decoration: underline; } } time { flex: none; color: var(--cr-text-muted); font-size: 11px; } } }
      .modelSummary { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 14px 0; border-top: 1px solid var(--cr-border-subtle); font-size: 13px; strong { font-weight: 600; } small, > span:last-child { font-size: 11px; font-weight: 400; color: var(--cr-text-muted); } > span:last-child { grid-column: 1 / -1; } }
    }
  }
  .staffOverview { border-top: 1px solid var(--cr-border-subtle); padding-top: 24px; p, dl { font-size: 13px; color: var(--cr-text-secondary); } dl > div { padding: 12px 0; display: flex; justify-content: space-between; gap: 16px; } dd { margin: 0; } }
  @media (max-width: 1050px) { .dashboardGrid { grid-template-columns: 1fr; } }
  @media (max-width: 680px) { .metricStrip { grid-template-columns: repeat(2, 1fr); gap: 20px 0; > div { padding: 0 16px; &:nth-child(2) { border: 0; } } } .dashboardGrid .dashboardPanel { padding: 16px; > header { flex-wrap: wrap; } } }
}
</style>
