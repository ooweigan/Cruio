<template>
  <main>
    <header class="adminHeading"><div><h1>操作日志</h1><p>账号安全、岗位授权和模型配置的历史记录</p></div><button class="adminButton" type="button" :disabled="loading" @click="load(page)">刷新</button></header>
    <form class="adminToolbar" @submit.prevent="load(1)"><label>检索<input v-model.trim="query" type="search" maxlength="254" placeholder="邮箱或模型 ID" /></label><label>分类<select v-model="category"><option value="all">全部日志</option><option value="account">账号安全</option><option value="roles">岗位授权</option><option value="models">模型配置</option></select></label><label>开始日期<input v-model="from" type="date" /></label><label>结束日期<input v-model="to" type="date" /></label><button class="adminButton" type="submit" :disabled="loading">查询</button></form>
    <p v-if="errorMessage" class="adminFeedback error" role="alert">{{ errorMessage }}</p>
    <div class="adminTableWrap" :aria-busy="loading"><table><thead><tr><th>时间</th><th>分类</th><th>操作</th><th>操作者</th><th>对象</th><th>结果</th></tr></thead><tbody><tr v-for="event in events" :key="event.id"><td>{{ formatDate(event.occurredAt) }}</td><td>{{ categories[event.category] }}</td><td>{{ actions[event.action] ?? event.action }}</td><td>{{ event.actor || '系统' }}</td><td>{{ event.subject || event.target || '—' }}<span v-if="event.subject && event.target" class="secondaryText">{{ roleLabels[event.target] ?? event.target }}</span></td><td><span class="statusText" :class="event.outcome === 'success' ? 'active' : 'disabled'">{{ outcomes[event.outcome] ?? event.outcome }}</span></td></tr><tr v-if="!events.length"><td colspan="6" class="adminEmpty">{{ loading ? '正在读取日志…' : '当前条件下没有记录' }}</td></tr></tbody></table></div>
    <footer class="adminPagination"><span>共 {{ total }} 条记录</span><div><button class="adminButton" type="button" :disabled="loading || page <= 1" @click="load(page - 1)">上一页</button><span>{{ page }} / {{ Math.max(1, Math.ceil(total / 30)) }}</span><button class="adminButton" type="button" :disabled="loading || page * 30 >= total" @click="load(page + 1)">下一页</button></div></footer>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "@/lib/cruioApi";

type LogEvent = { id: string; category: string; action: string; actor: string | null; subject: string | null; target: string; outcome: string; occurredAt: string };
const events = ref<LogEvent[]>([]);
const query = ref(""); const category = ref("all"); const from = ref(""); const to = ref("");
const page = ref(1); const total = ref(0); const loading = ref(false); const errorMessage = ref("");
const categories: Record<string, string> = { roles: "岗位授权", models: "模型配置", account: "账号安全" };
const actions: Record<string, string> = { roleGranted: "授予岗位", roleRevoked: "撤销岗位", revisionCreated: "创建模型版本", published: "发布模型", paused: "停用模型", marketUpsert: "更新服务区域", reviewRecorded: "记录模型审核", emailVerification: "邮箱验证", passwordReset: "重置密码", sessionRevokeOne: "退出登录会话", sessionRevokeOthers: "退出其他会话", userDisabled: "停用账号", userEnabled: "恢复账号" };
const outcomes: Record<string, string> = { success: "成功", invalid: "无效请求", notEligible: "条件不满足", denied: "已拒绝" };
const roleLabels: Record<string, string> = { admin: "管理员", modelOperator: "模型运营", creditOperator: "积分运营", support: "客服", privacyOperator: "隐私运营" };
const formatDate = (value: string) => new Date(value).toLocaleString("zh-CN");
async function load(nextPage: number) {
  if (loading.value) return;
  loading.value = true; errorMessage.value = "";
  try {
    const params = new URLSearchParams({ query: query.value, category: category.value, page: String(nextPage) });
    if (from.value) params.set("from", new Date(`${from.value}T00:00:00`).toISOString());
    if (to.value) { const end = new Date(`${to.value}T00:00:00`); end.setDate(end.getDate() + 1); params.set("to", end.toISOString()); }
    const { data } = await api<{ data: { events: LogEvent[]; total: number; page: number } }>(`/api/operations/logs?${params}`);
    events.value = data.events; total.value = data.total; page.value = data.page;
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : "日志读取失败。"; }
  finally { loading.value = false; }
}
onMounted(() => load(1));
</script>
