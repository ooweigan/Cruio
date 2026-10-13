<template>
  <div class="operationsPage">
    <cruioHeader />
    <main class="pageContent" :inert="Boolean(preview)">
      <header class="pageHeading"><div><p class="eyebrow">受限岗位入口</p><h1>{{ isAdmin && !isCreditOperator ? "岗位授权" : "积分运营" }}</h1><p v-if="isCreditOperator">外部资金事实由经授权人员录入；这里仅追加积分账本事实，不创建平台订单或支付。</p><p v-else-if="isAdmin">按授权范围管理后台岗位。</p></div></header>
      <p v-if="pageError" class="feedback error" role="alert">{{ pageError }}</p>
      <p v-if="pageMessage" class="feedback success" role="status">{{ pageMessage }}</p>
      <p v-if="!ready" class="feedback">正在刷新岗位权限…</p>
      <template v-else-if="isCreditOperator">
        <section class="workspaceGrid">
          <aside class="panel userPanel">
            <div class="panelHeading"><div><h2>用户</h2><p>按邮箱查找；仅显示授权范围内的余额摘要和安全账本字段</p></div><button class="iconButton" type="button" aria-label="刷新用户" :disabled="busy || Boolean(preview)" @click="loadUsers">刷新</button></div>
            <form class="searchRow" @submit.prevent="loadUsers"><input v-model.trim="query" aria-label="按用户邮箱或名称搜索" placeholder="邮箱或名称" /><button type="submit" class="secondaryButton">搜索</button></form>
            <p v-if="loadingUsers" class="mutedLine">正在读取用户…</p>
            <button v-for="user in users" :key="user.id" class="userRow" :class="{ selected: selectedUser?.id === user.id }" type="button" :disabled="busy || Boolean(preview)" @click="selectUser(user)">
              <span class="userName">{{ user.name || user.email }}</span><small>{{ user.email }}</small><span class="userBalance">余额 {{ formatCredits(user.balance) }}<template v-if="user.debt > 0"> · 欠 {{ formatCredits(user.debt) }}</template></span>
            </button>
            <p v-if="!loadingUsers && users.length === 0" class="emptyState">没有匹配的用户</p>
          </aside>
          <section class="mainColumn">
            <section v-if="selectedUser" class="panel selectedSummary">
              <div><span class="fieldLabel">当前对象</span><h2>{{ selectedUser.name || selectedUser.email }}</h2><p>{{ selectedUser.email }} · <code>{{ selectedUser.id }}</code></p></div>
              <div class="summaryBalances"><div><span>账面</span><strong>{{ formatCredits(selectedUser.balance) }}</strong></div><div><span>预占</span><strong>{{ formatCredits(selectedUser.reserved) }}</strong></div><div><span>欠额</span><strong :class="{ negative: selectedUser.debt > 0 }">{{ formatCredits(selectedUser.debt) }}</strong></div></div>
            </section>
            <section v-if="selectedUser" class="panel actionPanel">
              <div class="tabs" role="tablist" aria-label="积分操作"><button v-for="item in operationTabs" :key="item.key" type="button" role="tab" :aria-selected="operation === item.key" :class="{ active: operation === item.key }" :disabled="busy || Boolean(preview)" @click="setOperation(item.key)">{{ item.label }}</button></div>
              <template v-if="operation !== 'reversal'">
                <div class="formGrid">
                  <label>积分数量<input v-model.number="amount" type="number" min="1" step="1" placeholder="输入积分数" :disabled="busy || Boolean(preview)" /></label>
                  <label>外部成交渠道<input v-model.trim="channel" maxlength="120" placeholder="例如：线下合同" :disabled="busy || Boolean(preview)" /></label>
                  <label class="wideField">外部单号／合同号<input v-model.trim="externalReference" maxlength="200" placeholder="录入可核对的外部编号" :disabled="busy || Boolean(preview)" /></label>
                  <label class="wideField">处理理由<textarea v-model.trim="reason" maxlength="500" rows="3" placeholder="说明已确认的成交或退款事实" :disabled="busy || Boolean(preview)" /></label>
                  <label class="wideField">凭据文件<input ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png,text/plain" :disabled="busy || Boolean(preview)" @change="selectCredential" /><small>PDF、JPG、PNG 或纯文本，最大 1 MiB。上传前遮挡无关姓名、地址和账号。</small><span v-if="credentialFile" class="fileName">{{ credentialFile.name }}</span></label>
                  <label v-if="operation === 'refund'" class="wideField">原充值记录<select v-model="topupEntryId" :disabled="busy || Boolean(preview)"><option value="">选择该用户的充值记录</option><option v-for="entry in topupEntries" :key="entry.id" :value="entry.id">{{ entry.id }} · {{ formatCredits(entry.amount) }} · {{ formatDate(entry.createdAt) }}</option></select></label>
                </div>
                <div v-if="operation === 'refund' && topupEntries.length === 0" class="mutedLine">该用户账单中没有可关联的充值记录。</div>
                <button ref="previewTrigger" class="primaryButton" type="button" :disabled="busy || Boolean(preview) || !canPreview" @click="previewOperation">核对影响</button>
              </template>
              <template v-else>
                <label class="wideField">冲正原账本记录<select v-model="entryId" :disabled="busy || Boolean(preview)"><option value="">选择需要纠正的记录</option><option v-for="entry in reversibleEntries" :key="entry.id" :value="entry.id">{{ entry.id }} · {{ entry.label || entry.type }} · {{ formatCredits(entry.amount) }} · {{ formatDate(entry.createdAt) }}</option></select></label>
                <label class="wideField">冲正理由<textarea v-model.trim="reason" maxlength="500" rows="3" placeholder="说明原记录错误及对应依据" :disabled="busy || Boolean(preview)" /></label>
                <label class="wideField">凭据文件<input ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png,text/plain" :disabled="busy || Boolean(preview)" @change="selectCredential" /><small>PDF、JPG、PNG 或纯文本，最大 1 MiB。上传前遮挡无关姓名、地址和账号。</small><span v-if="credentialFile" class="fileName">{{ credentialFile.name }}</span></label>
                <button ref="previewTrigger" class="primaryButton" type="button" :disabled="busy || Boolean(preview) || !canPreview" @click="previewOperation">核对影响</button>
              </template>
              <p class="policyNote">单次操作由服务端核对账户现状并生成短时预览。最终结果只在服务端成功后显示；无需第二审批人。</p>
            </section>
            <section v-if="selectedUser" class="panel ledgerPanel"><div class="panelHeading"><div><h2>用户账本</h2><p>凭据原件不在普通账单中展示</p></div><button class="secondaryButton" type="button" @click="loadUserLedger">刷新</button></div>
              <p v-if="loadingLedger" class="mutedLine">正在读取账本…</p>
              <div v-else class="ledgerList"><article v-for="entry in userEntries" :key="entry.id" class="ledgerRow"><div><strong>{{ entry.label || entry.type }}</strong><small>{{ entry.id }} · {{ formatDate(entry.createdAt) }}</small><span>{{ entry.reason || "" }}<template v-if="entry.externalReference"> · {{ entry.externalReference }}</template></span></div><strong :class="entry.amount < 0 ? 'negative' : 'positive'">{{ entry.amount > 0 ? "+" : "" }}{{ formatCredits(entry.amount) }}</strong><button v-if="hasEvidence(entry)" class="secondaryButton evidenceButton" type="button" :disabled="busy || Boolean(preview)" @click="downloadCredential(entry)">查看凭据</button></article><p v-if="userEntries.length === 0" class="emptyState">暂无账本记录</p></div>
            </section>
          </section>
        </section>
      </template>
      <section v-if="ready && isAdmin" id="rolePanel" class="panel rolePanel">
        <div class="panelHeading"><div><h2>角色授权</h2><p>管理员入口不含财务凭据或积分操作权限。授权范围与有效期会明确记录。</p></div></div>
        <form class="searchRow roleSearch" @submit.prevent="searchRoleUsers"><input v-model.trim="roleQuery" aria-label="搜索授权用户邮箱" placeholder="搜索用户邮箱" :disabled="busy" /><button type="submit" class="secondaryButton" :disabled="busy">搜索</button></form>
        <div class="roleGrid">
          <div class="roleUserList"><button v-for="user in roleUsers" :key="user.id" class="userRow" :class="{ selected: roleUser?.id === user.id }" type="button" :disabled="busy" @click="selectRoleUser(user)"><span>{{ user.email }}</span><small><code>{{ user.id }}</code></small></button><p v-if="roleUsers.length === 0" class="emptyState">搜索后选择授权对象</p></div>
          <div v-if="roleUser" class="roleDetails"><h3>{{ roleUser.email }}</h3><p class="mutedLine">{{ roleUser.id }}</p>
            <div class="grantList"><article v-for="grant in grants" :key="grant.id" class="grantRow"><div><strong>{{ roleLabel(grant.role) }} · {{ grant.revokedAt ? "已撤销" : new Date(grant.expiresAt).getTime() <= Date.now() ? "已过期" : "有效" }}</strong><span>{{ scopeLabel(grant) }}</span><small>有效期至 {{ formatDate(grant.expiresAt) }}<template v-if="grant.revokedAt"> · 撤销于 {{ formatDate(grant.revokedAt) }}：{{ grant.revokeReason }}</template></small></div><button v-if="!grant.revokedAt && new Date(grant.expiresAt).getTime() > Date.now()" class="dangerButton" type="button" :disabled="busy" @click="revokeGrant(grant)">撤销</button></article><p v-if="grants.length === 0" class="emptyState">该用户没有角色记录</p></div>
            <form class="grantForm" @submit.prevent="grantRole"><h3>新增角色</h3><label>岗位<select v-model="grantForm.role" @change="changeGrantRole"><option value="creditOperator">积分运营</option><option value="privacyOperator">隐私运营</option><option value="admin">管理员</option></select></label><label>授权范围<select v-model="grantForm.scopeKind"><option value="global">全局</option><option v-if="grantForm.role !== 'admin'" value="user">指定用户</option></select></label><label v-if="grantForm.scopeKind === 'user'">{{ grantForm.role === "privacyOperator" ? "隐私运营" : "积分运营" }}目标用户 ID<input v-model.trim="grantForm.scopeUserId" required /></label><label>到期时间<input v-model="grantForm.expiresAt" type="datetime-local" required /></label><label>理由<textarea v-model.trim="grantForm.reason" rows="2" required maxlength="500" /></label><label>当前密码<input v-model="grantForm.currentPassword" type="password" autocomplete="current-password" required /></label><button class="secondaryButton" type="submit" :disabled="busy || !roleUser">授权</button></form>
          </div>
          <p v-else class="emptyState rolePrompt">选择用户查看或变更后台岗位。</p>
        </div>
      </section>
    </main>
    <div v-if="preview" class="modalBackdrop" @click.self="handleBackdrop"><section ref="confirmDialogRef" class="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" tabindex="-1" @keydown="trapDialogFocus" @keydown.esc.prevent.stop="handleEscape"><h2 id="confirmTitle">再次核对本次操作</h2><p class="targetLine"><strong>目标用户：</strong>{{ previewIntent?.user.name || previewIntent?.user.email }} · {{ previewIntent?.user.email }}<br /><strong>用户 ID：</strong><code>{{ preview.userId }}</code></p><dl class="impactList"><div><dt>操作</dt><dd>{{ operationLabel(preview.operation) }}</dd></div><div><dt>{{ preview.operation === 'reversal' ? '服务端核算冲正数量' : '服务端确认积分数量' }}</dt><dd>{{ formatCredits(preview.impact.amountDelta) }} 点</dd></div><div v-if="previewIntent?.channel"><dt>成交渠道</dt><dd>{{ previewIntent.channel }}</dd></div><div v-if="previewIntent?.externalReference"><dt>外部交易号</dt><dd>{{ previewIntent.externalReference }}</dd></div><div v-if="previewIntent?.credentialFileName"><dt>凭据</dt><dd>{{ previewIntent.credentialFileName }} · {{ previewIntent.credentialType }}</dd></div><div v-if="preview.entryId"><dt>{{ preview.operation === 'refund' ? '原充值记录' : preview.operation === 'reversal' ? '冲正记录' : '关联记录' }}</dt><dd><code>{{ preview.entryId }}</code></dd></div><div><dt>账面余额</dt><dd>{{ formatCredits(preview.account.balance) }} → {{ formatCredits(preview.impact.balanceAfter) }}</dd></div><div><dt>可用积分</dt><dd>{{ formatCredits(preview.account.available) }} → {{ formatCredits(preview.impact.availableAfter) }}</dd></div><div><dt>预占积分</dt><dd>{{ formatCredits(preview.account.reserved) }}</dd></div><div><dt>欠额</dt><dd>{{ formatCredits(preview.account.debt) }} → {{ formatCredits(preview.impact.debtAfter) }}</dd></div></dl><p v-if="preview.impact.debtAfter > preview.account.debt" class="riskNote">本次操作将增加欠额，并暂停该用户新的付费生成。充值时新增积分会优先抵消欠额。</p><p v-else-if="preview.impact.debtAfter > 0" class="riskNote">操作后用户仍有欠额，可用积分为零，新的付费生成仍受限。</p><p class="expiresNote">预览有效至 {{ formatDate(preview.expiresAt) }}。过期后需重新核对。</p><label class="passwordField">当前密码<input ref="passwordInputRef" v-model="currentPassword" type="password" autocomplete="current-password" :disabled="busy" /></label><p v-if="previewError" class="feedback error" role="alert">{{ previewError }}</p><div class="dialogActions"><button class="secondaryButton" type="button" :disabled="busy" @click="clearPreview">返回修改</button><button class="primaryButton" type="button" :disabled="busy || !currentPassword" @click="submitOperation">{{ busy ? "正在提交…" : "确认并提交" }}</button></div></section></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import { api } from "@/lib/cruioApi";
import { useCruioSession, type CruioRole } from "@/stores/cruioSession";

const session = useCruioSession();
const route = useRoute();
type User = { id: string; email: string; name?: string; balance: number; available: number; reserved: number; debt: number };
type Entry = { id: string; type: string; label?: string; amount: number; reason?: string; externalReference?: string | null; channel?: string | null; createdAt: string; status?: string; relatedEntryId?: string | null };
type Preview = { operation: "topup" | "refund" | "reversal"; userId: string; amount: number | null; entryId: string | null; topupEntryId: string | null; previewToken: string; expiresAt: string; account: { balance: number; available: number; reserved: number; debt: number }; impact: { amountDelta: number; balanceAfter: number; availableAfter: number; debtAfter: number } };
type CommitResult = { entry: { id: string; type: string; amount: number; relatedEntryId: string | null }; account: { balance: number; reserved: number; available: number; debt: number }; idempotent: boolean };
type OperationIntent = { operation: "topup" | "refund" | "reversal"; user: User; amount: number | null; channel: string; externalReference: string; reason: string; entryId: string; credentialFileName: string; credentialType: string; idempotencyKey: string };
const ready = ref(false);
const pageError = ref("");
const pageMessage = ref("");
const users = ref<User[]>([]);
const query = ref("");
const selectedUser = ref<User | null>(null);
const userEntries = ref<Entry[]>([]);
const loadingUsers = ref(false);
const loadingLedger = ref(false);
const busy = ref(false);
const operation = ref<"topup" | "refund" | "reversal">("topup");
const amount = ref<number | null>(null);
const channel = ref("");
const externalReference = ref("");
const reason = ref("");
const topupEntryId = ref("");
const entryId = ref("");
const credentialFile = ref<File | null>(null);
const credentialData = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const preview = ref<Preview | null>(null);
const previewIntent = ref<OperationIntent | null>(null);
const previewError = ref("");
const currentPassword = ref("");
const previewTrigger = ref<HTMLButtonElement | null>(null);
const confirmDialogRef = ref<HTMLElement | null>(null);
const passwordInputRef = ref<HTMLInputElement | null>(null);
const isAdmin = computed(() => session.user?.roles?.some((role) => role.role === "admin" && role.scopeKind === "global") ?? false);
const isCreditOperator = computed(() => session.user?.roles?.some((role) => role.role === "creditOperator") ?? false);
const operationTabs = [{ key: "topup", label: "外部成交充值" }, { key: "refund", label: "外部退款扣回" }, { key: "reversal", label: "账本冲正" }] as const;
const reversedEntryIds = computed(() => new Set(userEntries.value.filter((entry) => entry.type === "reversal" && entry.relatedEntryId).map((entry) => entry.relatedEntryId)));
const topupEntries = computed(() => userEntries.value.filter((entry) => entry.type === "topup" && !reversedEntryIds.value.has(entry.id)));
const reversibleEntries = computed(() => userEntries.value.filter((entry) => ["topup", "refund"].includes(entry.type) && !reversedEntryIds.value.has(entry.id)));
const canPreview = computed(() => Boolean(selectedUser.value && reason.value.trim() && credentialFile.value && (operation.value === "reversal"
  ? entryId.value
  : typeof amount.value === "number" && Number.isSafeInteger(amount.value) && amount.value > 0 && channel.value.trim() && externalReference.value.trim() && (operation.value !== "refund" || topupEntryId.value))));

onBeforeRouteLeave(() => !busy.value);

function formatCredits(value: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
function operationLabel(value: string) { return value === "topup" ? "外部成交充值" : value === "refund" ? "外部退款积分扣回" : "账本冲正"; }
function roleLabel(role: CruioRole["role"]) { return ({ admin: "管理员", creditOperator: "积分运营", modelOperator: "模型运营", support: "客服", privacyOperator: "隐私运营" } as Record<CruioRole["role"], string>)[role]; }
function scopeLabel(grant: CruioRole) { return grant.scopeKind === "global" ? "全局范围" : `指定用户：${grant.scopeUserId || "未提供用户 ID"}`; }
function hasEvidence(entry: Entry) { return ["topup", "refund", "reversal"].includes(entry.type); }
function selectCredential(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null;
  credentialFile.value = file;
  credentialData.value = "";
  if (!file) return;
  if (!(["application/pdf", "image/jpeg", "image/png", "text/plain"].includes(file.type)) || file.size > 1024 * 1024) {
    credentialFile.value = null;
    (event.target as HTMLInputElement).value = "";
    pageError.value = "凭据仅支持 PDF、JPG、PNG 或纯文本，且不能超过 1 MiB。";
    return;
  }
  pageError.value = "";
}
function readCredential(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("凭据读取失败"));
    reader.onerror = () => reject(new Error("凭据读取失败"));
    reader.readAsDataURL(file);
  });
}
async function loadUsers() {
  if (!isCreditOperator.value) return;
  loadingUsers.value = true;
  pageError.value = "";
  try {
    const result = await api<{ users: { id: string; email: string; account: { balance: number; available: number; reserved: number; debt: number } }[] }>(`/api/operations/credits/users?query=${encodeURIComponent(query.value)}&limit=50`);
    users.value = result.users.map(({ id, email, account }) => ({ id, email, ...account }));
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : "用户读取失败"; }
  finally { loadingUsers.value = false; }
}
async function selectUser(user: User) {
  selectedUser.value = user;
  operation.value = "topup";
  resetForm();
  await loadUserLedger();
}
async function loadUserLedger() {
  if (!selectedUser.value) return;
  const userId = selectedUser.value.id;
  loadingLedger.value = true;
  try {
    const result = await api<{ account: Omit<User, "id" | "email">; entries: Entry[] }>(`/api/operations/credits/users/${encodeURIComponent(userId)}/ledger?limit=100`);
    if (selectedUser.value?.id !== userId) return;
    userEntries.value = result.entries;
    selectedUser.value = { ...selectedUser.value, ...result.account };
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : "用户账本读取失败"; }
  finally { loadingLedger.value = false; }
}
function resetForm() {
  amount.value = null; channel.value = ""; externalReference.value = ""; reason.value = ""; topupEntryId.value = ""; entryId.value = "";
  credentialFile.value = null; credentialData.value = ""; if (fileInput.value) fileInput.value.value = "";
}
function setOperation(value: "topup" | "refund" | "reversal") {
  if (busy.value || preview.value) return;
  operation.value = value;
  resetForm();
}
async function previewOperation() {
  if (!selectedUser.value || !canPreview.value || busy.value || preview.value) return;
  const userSnapshot = { ...selectedUser.value };
  const intent: OperationIntent = {
    operation: operation.value, user: userSnapshot,
    amount: operation.value === "reversal" ? null : amount.value,
    channel: operation.value === "reversal" ? "" : channel.value.trim(),
    externalReference: operation.value === "reversal" ? "" : externalReference.value.trim(),
    reason: reason.value.trim(),
    entryId: operation.value === "refund" ? topupEntryId.value : entryId.value,
    credentialFileName: credentialFile.value?.name ?? "",
    credentialType: credentialFile.value?.type || "application/octet-stream",
    idempotencyKey: crypto.randomUUID(),
  };
  busy.value = true; pageError.value = ""; previewError.value = "";
  try {
    const file = credentialFile.value;
    if (!file) throw new Error("请附上本次操作凭据。");
    credentialData.value = await readCredential(file);
    const result = await api<Preview>("/api/operations/credits/preview", { method: "POST", body: JSON.stringify({
      operation: intent.operation, userId: userSnapshot.id,
      ...(intent.operation === "reversal" ? { entryId: intent.entryId } : { amount: intent.amount, channel: intent.channel, externalReference: intent.externalReference, ...(intent.operation === "refund" ? { entryId: intent.entryId } : {}) }),
      credential: { fileName: file.name, contentType: file.type, data: credentialData.value },
    }) });
    const expiresAt = new Date(result.expiresAt).getTime();
    if (result.operation !== intent.operation || result.userId !== userSnapshot.id || typeof result.previewToken !== "string" || result.previewToken.length < 32
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !result.account || !result.impact
      || ![result.account.balance, result.account.available, result.account.reserved, result.account.debt,
        result.impact.amountDelta, result.impact.balanceAfter, result.impact.availableAfter, result.impact.debtAfter].every(Number.isFinite)
      || (intent.operation !== "reversal" && (typeof intent.amount !== "number" || result.amount !== intent.amount || !Number.isSafeInteger(result.amount)))
      || (intent.operation === "topup" && result.impact.amountDelta !== intent.amount)
      || (intent.operation === "refund" && (typeof intent.amount !== "number" || result.impact.amountDelta !== -intent.amount))
      || result.impact.balanceAfter !== result.account.balance + result.impact.amountDelta
      || result.impact.availableAfter !== Math.max(0, result.impact.balanceAfter - result.account.reserved)
      || result.impact.debtAfter !== Math.max(0, -result.impact.balanceAfter)
      || (intent.operation === "reversal" && result.entryId !== intent.entryId)
      || (intent.operation === "refund" && result.topupEntryId !== intent.entryId)) throw new Error("服务端预览与当前操作不一致，请重新核对。");
    previewIntent.value = intent;
    preview.value = result;
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : "影响预览失败"; }
  finally { credentialData.value = ""; busy.value = false; }
}
function clearPreview() {
  if (busy.value) return;
  preview.value = null; previewIntent.value = null; previewError.value = ""; currentPassword.value = "";
  void nextTick(() => previewTrigger.value?.focus());
}
function handleEscape() { if (!busy.value) clearPreview(); }
function handleBackdrop() { if (!busy.value) clearPreview(); }
function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== "Tab" || !confirmDialogRef.value) return;
  const focusable = [...confirmDialogRef.value.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) { event.preventDefault(); confirmDialogRef.value.focus(); return; }
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch(preview, (value) => {
  if (value) void nextTick(() => passwordInputRef.value?.focus());
});
async function submitOperation() {
  const confirmedPreview = preview.value;
  const intent = previewIntent.value;
  if (!confirmedPreview || !intent || !currentPassword.value || busy.value) return;
  if (new Date(confirmedPreview.expiresAt).getTime() <= Date.now()) {
    previewError.value = "本次影响预览已过期，请返回后重新核对。";
    return;
  }
  const previewAmount = confirmedPreview.amount;
  if (intent.operation !== "reversal" && (previewAmount === null || !Number.isSafeInteger(previewAmount))) {
    previewError.value = "服务端预览未返回有效积分数量，请重新核对。";
    return;
  }
  busy.value = true; previewError.value = ""; pageError.value = ""; pageMessage.value = "";
  const input = intent.operation === "topup"
    ? { amount: previewAmount, channel: intent.channel, externalReference: intent.externalReference }
    : intent.operation === "refund"
      ? { amount: previewAmount, entryId: confirmedPreview.topupEntryId, channel: intent.channel, externalReference: intent.externalReference }
      : { entryId: confirmedPreview.entryId };
  const path = intent.operation === "topup" ? "/api/operations/credits/topups" : intent.operation === "refund" ? "/api/operations/credits/refunds" : "/api/operations/credits/reversals";
  try {
    const result = await api<CommitResult>(path, { method: "POST", body: JSON.stringify({ ...input, reason: intent.reason, previewToken: confirmedPreview.previewToken, currentPassword: currentPassword.value, idempotencyKey: intent.idempotencyKey }) });
    const expectedType = intent.operation === "reversal" ? "reversal" : intent.operation;
    if (!result?.entry?.id || result.entry.type !== expectedType || typeof result.entry.amount !== "number"
      || !result.account || ![result.account.balance, result.account.available, result.account.reserved, result.account.debt].every(Number.isFinite)
      || typeof result.idempotent !== "boolean"
      || result.account.balance !== confirmedPreview.impact.balanceAfter
      || result.account.available !== confirmedPreview.impact.availableAfter
      || result.account.debt !== confirmedPreview.impact.debtAfter
      || result.account.reserved !== confirmedPreview.account.reserved
      || (intent.operation === "topup" && result.entry.amount !== previewAmount)
      || (intent.operation === "refund" && (previewAmount === null || result.entry.amount !== -previewAmount || result.entry.relatedEntryId !== confirmedPreview.topupEntryId))
      || (intent.operation === "reversal" && (result.entry.relatedEntryId !== confirmedPreview.entryId || result.entry.amount !== confirmedPreview.impact.amountDelta))) {
      throw new Error("服务端响应未包含与已核对预览一致的成功账本事实；请刷新账本核对状态。");
    }
    pageMessage.value = `${operationLabel(intent.operation)}成功 · 账本记录 ${result.entry.id} · 当前余额 ${formatCredits(result.account.balance)} 点。`;
    currentPassword.value = ""; preview.value = null; previewIntent.value = null; resetForm();
    await loadUsers(); await loadUserLedger();
    await nextTick(() => previewTrigger.value?.focus());
  } catch (cause) { previewError.value = cause instanceof Error ? cause.message : "服务端未确认成功。请刷新账本核对状态；重试将沿用相同幂等编号。"; }
  finally { busy.value = false; }
}

async function downloadCredential(entry: Entry) {
  if (!isCreditOperator.value || !selectedUser.value || !hasEvidence(entry)) return;
  const purpose = window.prompt(`查看积分凭据：${entry.id}\n请输入本次查看理由。`);
  if (!purpose?.trim()) return;
  const currentPassword = window.prompt("请再次验证当前密码。");
  if (!currentPassword) return;
  busy.value = true; pageError.value = ""; pageMessage.value = "";
  try {
    const response = await fetch(`/api/operations/credits/entries/${encodeURIComponent(entry.id)}/credential`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, purpose: purpose.trim() }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(payload?.message || `凭据读取失败（${response.status}）`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const encodedName = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName).replace(/[\\/\x00-\x1f]/g, "_") : `credit-evidence-${entry.id}`;
    anchor.href = objectUrl; anchor.download = fileName; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    pageMessage.value = `凭据 ${entry.id} 已由服务端授权下载，查看理由已留痕。`;
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : "凭据读取失败"; }
  finally { busy.value = false; }
}

const roleQuery = ref("");
const roleUsers = ref<{ id: string; email: string }[]>([]);
const roleUser = ref<{ id: string; email: string } | null>(null);
const grants = ref<CruioRole[]>([]);
const grantForm = reactive({ role: "creditOperator" as "admin" | "creditOperator" | "privacyOperator", scopeKind: "global" as "global" | "user", scopeUserId: "", expiresAt: "", reason: "", currentPassword: "" });
async function searchRoleUsers() {
  if (!isAdmin.value) return;
  try { roleUsers.value = (await api<{ users: { id: string; email: string }[] }>(`/api/operations/roles/users?query=${encodeURIComponent(roleQuery.value)}&limit=50`)).users; }
  catch (cause) { pageError.value = cause instanceof Error ? cause.message : "用户搜索失败"; }
}
async function selectRoleUser(user: { id: string; email: string }) { roleUser.value = user; await loadGrants(); }
async function loadGrants() {
  if (!roleUser.value) return;
  try { grants.value = (await api<{ grants: CruioRole[] }>(`/api/operations/roles?userId=${encodeURIComponent(roleUser.value.id)}`)).grants; }
  catch (cause) { pageError.value = cause instanceof Error ? cause.message : "角色读取失败"; }
}
async function grantRole() {
  if (!roleUser.value || !grantForm.reason.trim() || !grantForm.currentPassword || !grantForm.expiresAt || grantForm.scopeKind === "user" && !grantForm.scopeUserId.trim()) return;
  busy.value = true; pageError.value = ""; pageMessage.value = "";
  try {
    const target = { ...roleUser.value };
    const result = await api<{ grant: CruioRole }>("/api/operations/roles", { method: "POST", body: JSON.stringify({ userId: target.id, role: grantForm.role, scopeKind: grantForm.scopeKind, ...(grantForm.scopeKind === "user" ? { scopeUserId: grantForm.scopeUserId.trim() } : {}), expiresAt: new Date(grantForm.expiresAt).toISOString(), reason: grantForm.reason.trim(), currentPassword: grantForm.currentPassword }) });
    if (!result.grant?.id) throw new Error("服务端没有返回角色授权事实。");
    pageMessage.value = `已为 ${target.email} 授予${roleLabel(result.grant.role)}（${scopeLabel(result.grant)}，至 ${formatDate(result.grant.expiresAt)}），服务端已记录。`;
    grantForm.currentPassword = ""; grantForm.reason = ""; await session.refresh(); await loadGrants();
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : "角色授权失败"; }
  finally { busy.value = false; }
}
async function revokeGrant(grant: CruioRole) {
  if (busy.value || grant.revokedAt || !isAdmin.value) return;
  const target = roleUser.value;
  if (!target) return;
  const password = window.prompt(`撤销${roleLabel(grant.role)}（${scopeLabel(grant)}）需要再次验证当前密码。`);
  if (!password) return;
  const reasonText = window.prompt("请说明撤权理由。");
  if (!reasonText?.trim() || reasonText.trim().length > 500) return;
  busy.value = true; pageError.value = ""; pageMessage.value = "";
  try {
    const result = await api<{ grant: { id: string; revokedAt: string } }>(`/api/operations/roles/${encodeURIComponent(grant.id)}/revoke`, { method: "POST", body: JSON.stringify({ reason: reasonText.trim(), currentPassword: password }) });
    if (!result.grant?.id || !result.grant.revokedAt) throw new Error("服务端没有返回角色撤权事实。");
    pageMessage.value = `已撤销 ${roleLabel(grant.role)}（${target.email}），服务端已记录。`; await session.refresh(); await loadGrants();
  } catch (cause) { pageError.value = cause instanceof Error ? cause.message : "角色撤销失败"; }
  finally { busy.value = false; }
}
function changeGrantRole() { if (grantForm.role === "admin") { grantForm.scopeKind = "global"; grantForm.scopeUserId = ""; } }
onMounted(async () => {
  await session.refresh(); ready.value = true;
  if (isCreditOperator.value) await loadUsers();
  if (!isCreditOperator.value && !isAdmin.value) pageError.value = "当前账号没有运营岗位授权。";
  if (route.hash === "#rolePanel" && isAdmin.value) {
    await nextTick();
    document.getElementById("rolePanel")?.scrollIntoView();
  }
});
</script>

<style scoped lang="scss">
.operationsPage { min-height: 100dvh; background: var(--cr-page-background); }.pageContent { max-width: 1320px; margin: 0 auto; padding: 24px 24px 24px; }.pageHeading { margin-bottom: 24px; h1 { margin: 0; font-size: 20px; } p { margin: 8px 0 0; color: var(--cr-text-secondary); } }.eyebrow { color: var(--cr-text-muted) !important; font-size: 12px; }.panel { background: var(--cr-surface); border: 1px solid var(--cr-border-subtle); border-radius: 8px; padding: 16px; }.workspaceGrid { display: grid; grid-template-columns: 280px minmax(0, 1fr); align-items: start; gap: 12px; }.userPanel { padding: 12px; }.panelHeading { display: flex; justify-content: space-between; align-items: start; gap: 12px; h2 { margin: 0; font-size: 16px; } p { margin: 4px 0 0; color: var(--cr-text-muted); font-size: 12px; } }.iconButton, .secondaryButton, .dangerButton { border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-surface); cursor: pointer; font-size: 14px; &:hover { background: var(--cr-surface-hover); } &:disabled { cursor: not-allowed; opacity: .55; } }.iconButton { flex: none; white-space: nowrap; }.searchRow { display: flex; gap: 8px; margin: 12px 0 8px; input { min-width: 0; flex: 1; } }.userRow { width: 100%; display: grid; gap: 4px; padding: 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; &:hover, &.selected { background: var(--cr-surface-hover); } &.selected { box-shadow: inset 2px 0 var(--cr-brand-primary); } small { color: var(--cr-text-muted); font-size: 12px; } }.userName { font-weight: 620; }.userBalance { color: var(--cr-text-secondary); font-size: 12px; }.mainColumn { display: grid; gap: 12px; }.selectedSummary { display: flex; justify-content: space-between; gap: 16px; align-items: center; h2 { margin: 4px 0; font-size: 16px; } p { margin: 0; color: var(--cr-text-muted); font-size: 12px; } }.fieldLabel, .mutedLine { color: var(--cr-text-muted); font-size: 12px; }.summaryBalances { display: flex; gap: 16px; > div { display: grid; gap: 4px; } span { color: var(--cr-text-muted); font-size: 12px; } strong { font-variant-numeric: tabular-nums; } }.tabs { display: flex; gap: 8px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--cr-border-subtle); button { border: 0; border-radius: 6px; padding: 8px 8px; color: var(--cr-text-secondary); background: transparent; cursor: pointer; font-size: 14px; } button.active { color: var(--cr-brand-primary); background: color-mix(in srgb, var(--cr-brand-primary) 8%, transparent); } }.formGrid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }.formGrid label, .grantForm label, .passwordField, .wideField { display: grid; gap: 8px; color: var(--cr-text-secondary); font-size: 14px; }.wideField { grid-column: 1 / -1; }.formGrid small { color: var(--cr-text-muted); font-size: 12px; }.fileName, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }.primaryButton { border: 0; border-radius: 6px; margin-top: 16px; padding: 8px 12px; color: var(--cr-text-primary); background: var(--cr-gradient); cursor: pointer; font-size: 14px; font-weight: 650; &:disabled { cursor: not-allowed; opacity: .55; } }.policyNote, .expiresNote { color: var(--cr-text-muted); font-size: 12px; }.ledgerPanel { max-height: 540px; overflow: auto; }.ledgerList { margin-top: 8px; }.ledgerRow { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--cr-border-subtle); &:last-child { border-bottom: 0; } > div { min-width: 0; display: grid; gap: 4px; } span, small { color: var(--cr-text-muted); font-size: 12px; overflow-wrap: anywhere; } }.negative { color: var(--cr-status-danger) !important; }.positive { color: var(--cr-status-success) !important; }.emptyState { padding: 12px 8px; color: var(--cr-text-muted); font-size: 12px; }.feedback { padding: 12px 12px; border-radius: 6px; background: var(--cr-surface); color: var(--cr-text-secondary); }.error { color: var(--cr-status-danger); }.success { color: var(--cr-status-success); }.rolePanel { margin-top: 16px; }.roleSearch { max-width: 460px; }.roleGrid { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 16px; }.roleUserList { border-right: 1px solid var(--cr-border-subtle); padding-right: 12px; }.roleDetails { display: grid; gap: 8px; h3 { margin: 0; font-size: 14px; } }.grantList { display: grid; gap: 8px; }.grantRow { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; > div { display: grid; gap: 4px; } span, small { color: var(--cr-text-muted); font-size: 12px; } }.dangerButton { color: var(--cr-status-danger); }.grantForm { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; padding: 12px; border-radius: 6px; background: var(--cr-surface-subtle); h3 { grid-column: 1/-1; margin: 0; font-size: 14px; } }.grantForm button { justify-self: start; }.rolePrompt { align-self: center; }.modalBackdrop { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--cr-text-primary) 46%, transparent); }.confirmDialog { width: min(620px,100%); max-height: min(90vh,850px); overflow: auto; padding: 16px; border: 1px solid var(--cr-border-strong); border-radius: 8px; background: var(--cr-surface); box-shadow: 0 4px 12px color-mix(in srgb, var(--cr-text-primary) 12%, transparent); h2 { margin: 0 0 12px; font-size: 20px; } }.targetLine { color: var(--cr-text-secondary); line-height: 1.8; }.impactList { margin: 12px 0; border-top: 1px solid var(--cr-border-subtle); > div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--cr-border-subtle); } dt { color: var(--cr-text-muted); } dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; } }.riskNote { padding: 8px 12px; border-radius: 6px; color: var(--cr-text-primary); background: color-mix(in srgb, var(--cr-status-warning) 12%, var(--cr-surface)); font-size: 14px; }.passwordField { margin-top: 12px; }.dialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }.dialogActions .primaryButton { margin: 0; }
input, textarea, select { width: 100%; min-width: 0; border: 1px solid var(--cr-border-strong); border-radius: 6px; padding: 8px 8px; color: var(--cr-text-primary); background: var(--cr-surface); font: inherit; font-size: 14px; }input[type="file"] { padding: 8px; }textarea { resize: vertical; }
@media (max-width: 900px) { .workspaceGrid { grid-template-columns: 1fr; }.userPanel { max-height: 370px; overflow: auto; }.roleGrid { grid-template-columns: 1fr; }.roleUserList { max-height: 220px; overflow: auto; border-right: 0; border-bottom: 1px solid var(--cr-border-subtle); padding: 0 0 8px; } }
@media (max-width: 620px) { .pageContent { padding: 24px 12px; }.formGrid, .grantForm { grid-template-columns: 1fr; }.wideField, .grantForm h3 { grid-column: auto; }.selectedSummary { align-items: start; flex-direction: column; }.summaryBalances { width: 100%; justify-content: space-between; gap: 8px; }.tabs { overflow: auto; } }
</style>
