<template>
  <main class="adminUsersPage">
    <header class="adminHeading"><div><h1>用户与权限</h1><p>管理账号状态、后台岗位及授权范围</p></div><button class="adminButton" type="button" :disabled="loading || busy" @click="loadUsers(page)">刷新</button></header>
    <form class="adminToolbar" @submit.prevent="loadUsers(1)"><label>邮箱<input v-model.trim="query" type="search" maxlength="254" placeholder="搜索邮箱" :disabled="busy" /></label><label>账号状态<select v-model="status" :disabled="busy"><option value="all">全部</option><option value="active">正常</option><option value="disabled">已停用</option></select></label><button class="adminButton" type="submit" :disabled="loading || busy">查询</button></form>
    <p v-if="errorMessage" class="adminFeedback error" role="alert">{{ errorMessage }}</p><p v-if="message" class="adminFeedback" role="status">{{ message }}</p>
    <div class="adminTableWrap" :aria-busy="loading"><table><thead><tr><th>用户</th><th>状态</th><th>后台岗位</th><th>注册时间</th><th>操作</th></tr></thead><tbody>
      <tr v-for="user in users" :key="user.id"><td>{{ user.email }}<span class="secondaryText">{{ user.emailVerifiedAt ? '邮箱已验证' : '邮箱未验证' }}</span></td><td><span class="statusText" :class="user.disabledAt ? 'disabled' : 'active'">{{ user.disabledAt ? '已停用' : '正常' }}</span></td><td>{{ user.roles.map(role => roleLabels[role.role]).filter((role, index, list) => list.indexOf(role) === index).join('、') || '普通用户' }}</td><td>{{ formatDate(user.createdAt) }}</td><td><button class="adminTextLink" type="button" :disabled="busy" @click="selectUser(user)">管理</button></td></tr>
      <tr v-if="!users.length"><td colspan="5" class="adminEmpty">{{ loading ? '正在读取用户…' : '没有匹配的用户' }}</td></tr>
    </tbody></table></div>
    <footer class="adminPagination"><span>共 {{ total }} 位用户</span><div><button class="adminButton" type="button" :disabled="loading || busy || page <= 1" @click="loadUsers(page - 1)">上一页</button><span>{{ page }} / {{ Math.max(1, Math.ceil(total / 20)) }}</span><button class="adminButton" type="button" :disabled="loading || busy || page * 20 >= total" @click="loadUsers(page + 1)">下一页</button></div></footer>
    <section v-if="selected" ref="editor" class="userEditor" tabindex="-1" aria-labelledby="userHeading">
      <header><div><h2 id="userHeading">{{ selected.email }}</h2><code>{{ selected.id }}</code></div><button class="adminButton" type="button" :disabled="busy" @click="closeEditor">关闭</button></header>
      <p v-if="detailError" class="adminFeedback error" role="alert">{{ detailError }}</p>
      <div class="userActions"><button class="adminButton" :class="{ primary: action === 'grant' }" type="button" :disabled="busy" @click="setAction('grant')">授予岗位</button><button class="adminButton" type="button" :disabled="busy || selected.id === session.user?.id" @click="setAction('status')">{{ selected.disabledAt ? '恢复账号' : '停用账号' }}</button></div>
      <div class="adminTableWrap"><table><thead><tr><th>岗位</th><th>范围</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="grant in grants" :key="grant.id"><td>{{ roleLabels[grant.role] }}</td><td>{{ grant.scopeKind === 'global' ? '全局' : grant.scopeUserId }}</td><td>{{ formatDate(grant.expiresAt) }}</td><td>{{ grant.revokedAt ? '已撤销' : new Date(grant.expiresAt).getTime() <= Date.now() ? '已到期' : '有效' }}</td><td><button v-if="!grant.revokedAt && new Date(grant.expiresAt).getTime() > Date.now()" class="adminTextLink" type="button" :disabled="busy" @click="prepareRevoke(grant)">撤销</button></td></tr><tr v-if="!grants.length"><td colspan="5" class="adminEmpty">{{ loadingGrants ? '正在读取授权…' : '暂无岗位授权记录' }}</td></tr></tbody></table></div>
      <form v-if="action" class="actionForm" @submit.prevent="submitAction">
        <h3>{{ action === 'grant' ? '授予后台岗位' : action === 'revoke' ? `撤销${revokeTarget ? roleLabels[revokeTarget.role] : '岗位'}` : selected.disabledAt ? '恢复账号' : '停用账号' }}</h3>
        <p v-if="action === 'status' && !selected.disabledAt" class="actionNotice">停用后将退出该用户的所有登录会话，并阻止重新登录。已保存的数据继续保留。</p>
        <template v-if="action === 'grant'"><label>岗位<select v-model="form.role" :disabled="busy" @change="changeRole"><option v-for="(label, key) in roleLabels" :key="key" :value="key">{{ label }}</option></select></label><label>授权范围<select v-model="form.scopeKind" :disabled="busy"><option value="global">全局</option><option v-if="form.role !== 'admin'" value="user">指定用户</option></select></label><label v-if="form.scopeKind === 'user'">范围内用户 ID<input v-model.trim="form.scopeUserId" required :disabled="busy" /></label><label>到期时间<input v-model="form.expiresAt" type="datetime-local" required :disabled="busy" /></label></template>
        <label class="fullWidth">操作理由<textarea v-model.trim="form.reason" required maxlength="500" rows="2" :disabled="busy" /></label><label>当前登录密码<input v-model="form.currentPassword" type="password" autocomplete="current-password" required :disabled="busy" /></label><div class="formActions"><button class="adminButton primary" type="submit" :disabled="busy || loadingGrants">{{ busy ? '正在提交…' : '确认提交' }}</button><button class="adminButton" type="button" :disabled="busy" @click="setAction(null)">取消</button></div>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/cruioApi";
import { useCruioSession, type CruioRole } from "@/stores/cruioSession";

type UserRow = { id: string; email: string; createdAt: string; emailVerifiedAt: string | null; disabledAt: string | null; roles: CruioRole[] };
type Action = "grant" | "revoke" | "status" | null;
const session = useCruioSession();
const route = useRoute();
const router = useRouter();
const roleLabels = { admin: "管理员", modelOperator: "模型运营", creditOperator: "积分运营", support: "客服", privacyOperator: "隐私运营" };
const users = ref<UserRow[]>([]);
const query = ref(typeof route.query.user === "string" ? route.query.user : "");
const status = ref("all");
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const loadingGrants = ref(false);
const busy = ref(false);
const errorMessage = ref("");
const detailError = ref("");
const message = ref("");
const selected = ref<UserRow | null>(null);
const grants = ref<CruioRole[]>([]);
const revokeTarget = ref<CruioRole | null>(null);
const action = ref<Action>(null);
const editor = ref<HTMLElement | null>(null);
const form = reactive({ role: "modelOperator" as CruioRole["role"], scopeKind: "global", scopeUserId: "", expiresAt: "", reason: "", currentPassword: "" });
const formatDate = (value: string) => new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
async function loadUsers(nextPage: number) {
  if (loading.value) return;
  loading.value = true; errorMessage.value = "";
  try {
    const params = new URLSearchParams({ query: query.value, status: status.value, page: String(nextPage) });
    const { data } = await api<{ data: { users: UserRow[]; total: number; page: number } }>(`/api/operations/users?${params}`);
    users.value = data.users; total.value = data.total; page.value = data.page;
    if (selected.value) selected.value = data.users.find(user => user.id === selected.value?.id) ?? selected.value;
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : "用户读取失败。"; }
  finally { loading.value = false; }
}
async function loadGrants(userId: string) {
  loadingGrants.value = true;
  try { const result = await api<{ grants: CruioRole[] }>(`/api/operations/roles?userId=${encodeURIComponent(userId)}&limit=100`); if (selected.value?.id === userId) grants.value = result.grants; }
  catch (error) { if (selected.value?.id === userId) detailError.value = error instanceof Error ? error.message : "授权读取失败。"; }
  finally { if (selected.value?.id === userId) loadingGrants.value = false; }
}
async function selectUser(user: UserRow) { selected.value = user; grants.value = []; detailError.value = ""; setAction(null); await nextTick(); editor.value?.focus(); await loadGrants(user.id); }
function closeEditor() { selected.value = null; setAction(null); }
function setAction(value: Action) { action.value = value; form.currentPassword = ""; form.reason = ""; detailError.value = ""; }
function prepareRevoke(grant: CruioRole) { revokeTarget.value = grant; setAction("revoke"); }
function changeRole() { if (form.role === "admin") { form.scopeKind = "global"; form.scopeUserId = ""; } }
async function submitAction() {
  if (!selected.value || !action.value || busy.value) return;
  busy.value = true; detailError.value = ""; message.value = "";
  const target = selected.value;
  try {
    const common = { reason: form.reason, currentPassword: form.currentPassword };
    if (action.value === "grant") {
      await api("/api/operations/roles", { method: "POST", body: JSON.stringify({ ...common, userId: target.id, role: form.role, scopeKind: form.scopeKind, ...(form.scopeKind === "user" ? { scopeUserId: form.scopeUserId } : {}), expiresAt: new Date(form.expiresAt).toISOString() }) });
      message.value = `已为 ${target.email} 授予${roleLabels[form.role]}。`;
    } else if (action.value === "revoke" && revokeTarget.value) {
      await api(`/api/operations/roles/${revokeTarget.value.id}/revoke`, { method: "POST", body: JSON.stringify(common) });
      message.value = `已撤销 ${target.email} 的${roleLabels[revokeTarget.value.role]}岗位。`;
    } else if (action.value === "status") {
      const result = await api<{ data: { user: { disabledAt: string | null } } }>("/api/operations/users/status", { method: "POST", body: JSON.stringify({ ...common, userId: target.id, disabled: !target.disabledAt }) });
      selected.value = { ...target, disabledAt: result.data.user.disabledAt };
      message.value = `${target.email} 已${result.data.user.disabledAt ? '停用' : '恢复'}。`;
    }
    setAction(null); await session.refresh();
    if (!session.hasRole("admin", true)) { await router.replace("/admin"); return; }
    await Promise.all([loadUsers(page.value), loadGrants(target.id)]);
  } catch (error) { detailError.value = error instanceof Error ? error.message : "操作失败。"; }
  finally { busy.value = false; }
}
onMounted(() => loadUsers(1));
</script>

<style scoped lang="scss">
.adminUsersPage {
  .userEditor { margin-top: 32px; padding: 24px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; background: var(--cr-surface);
    > header { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 20px; h2 { overflow-wrap: anywhere; } code { display: block; margin-top: 6px; color: var(--cr-text-muted); font-size: 11px; overflow-wrap: anywhere; } }
    .userActions { display: flex; gap: 8px; margin-bottom: 16px; }
    .actionForm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding-top: 24px;
      h3 { grid-column: 1 / -1; margin: 0; font-size: 14px; font-weight: 600; }
      .actionNotice, .fullWidth { grid-column: 1 / -1; } .actionNotice { margin: 0; color: var(--cr-text-secondary); font-size: 12px; }
      label { display: grid; gap: 6px; color: var(--cr-text-secondary); font-size: 12px; }
      input, select, textarea { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--cr-border-strong); border-radius: 5px; background: var(--cr-surface); color: var(--cr-text-primary); } textarea { resize: vertical; }
      .formActions { display: flex; align-items: end; gap: 8px; }
    }
  }
  @media (max-width: 680px) { .userEditor { padding: 16px; .actionForm { grid-template-columns: 1fr; } } }
}
</style>
