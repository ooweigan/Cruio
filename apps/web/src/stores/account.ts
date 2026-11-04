import axios from "axios";
import { computed, ref } from "vue";
import type { AccountBootstrap, AccountSession } from "@toonflow/server/accountProtocol";
import { setAccountTransport } from "@/lib/accountTransport";
import { loadSettings, resetAccountSettings } from "@/stores/settings";
import { creationLocation, loadCreationLocation } from "@/stores/creationLocation";

const anonymousSession = (): AccountSession => ({ status: "anonymous", contextId: null, user: null, expiresAt: null, modelAccess: { status: "notProvisioned", message: "请先登录 Cruio" } });
export const accountSession = ref<AccountSession>(anonymousSession());
export const accountBootstrap = ref<AccountBootstrap>({ configured: false, supportUrl: null, termsUrl: null, privacyUrl: null, rememberSession: false });
export const accountBusy = ref(false);
export const accountReady = ref(false);
export const accountDataReady = ref(false);
export const accountError = ref("");
export const logoutRequested = ref(false);
export const isAuthenticated = computed(() => accountSession.value.status === "authenticated");
export const requiresReauthentication = computed(() => ["expired", "disabled"].includes(accountSession.value.status));
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;

function errorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error) ? error.response?.data?.message || fallback : error instanceof Error ? error.message : fallback;
}

function acceptSession(session: AccountSession) {
  clearTimeout(refreshTimer);
  accountSession.value = session;
  setAccountTransport(session.contextId, session.user?.id ?? null, reason => {
    if (!accountSession.value.user) return;
    acceptSession({ ...accountSession.value, status: reason === "accountDisabled" ? "disabled" : "expired" });
  });
  if (session.status === "authenticated") {
    const expiry = session.expiresAt ? Date.parse(session.expiresAt) - Date.now() : 60000;
    refreshTimer = setTimeout(() => { void refreshAccount(); }, Math.max(1000, Math.min(expiry, 60000)));
  }
}

async function refreshAccount() {
  const currentRevision = revision;
  try {
    const { data } = await axios.get<{ data: AccountSession }>("/api/account/session");
    if (revision !== currentRevision) return;
    if (data.data.status === "anonymous" && accountSession.value.user) acceptSession({ ...accountSession.value, status: "expired" });
    else acceptSession(data.data);
  } catch {
    if (revision !== currentRevision || !isAuthenticated.value) return;
    if (accountSession.value.expiresAt && Date.parse(accountSession.value.expiresAt) <= Date.now()) acceptSession({ ...accountSession.value, status: "expired" });
    else refreshTimer = setTimeout(() => { void refreshAccount(); }, 15000);
  }
}

export async function loadAccount(navigate = false) {
  if (accountBusy.value) return;
  accountBusy.value = true;
  accountError.value = "";
  try {
    const { data } = await axios.get<{ data: AccountBootstrap }>("/api/account/bootstrap");
    accountBootstrap.value = data.data;
    const result = await axios.get<{ data: AccountSession }>("/api/account/session");
    acceptSession(result.data.data);
    if (isAuthenticated.value) {
      await loadSettings();
      await loadCreationLocation();
      accountDataReady.value = true;
      if (navigate) {
        const { useWorkspaceStore } = await import("@/stores/workspace");
        useWorkspaceStore().$hydrate();
        const { default: router } = await import("@/router");
        await router.replace("/home");
      }
    }
  } catch (error) {
    accountError.value = isAuthenticated.value ? "加载失败，请重试。" : errorMessage(error, "暂时无法登录，请稍后重试。");
  } finally {
    accountBusy.value = false;
    accountReady.value = true;
  }
}

export async function loginAccount(account: string, password: string) {
  if (accountBusy.value) throw new Error("请稍候再试。");
  accountBusy.value = true;
  accountError.value = "";
  const previousUser = accountSession.value.user?.id;
  try {
    const { data } = await axios.post<{ data: AccountSession }>("/api/account/login", { account, password });
    revision++;
    acceptSession(data.data);
    const { accountWorkFinished } = await import("@/lib/accountWorkspace");
    accountWorkFinished.value = false;
    resetAccountSettings();
    accountDataReady.value = false;
    await loadSettings();
    await loadCreationLocation();
    accountDataReady.value = true;
    const { default: router } = await import("@/router");
    if (!previousUser || router.currentRoute.value.path === "/hello") {
      const { useWorkspaceStore } = await import("@/stores/workspace");
      useWorkspaceStore().$hydrate();
      await router.replace("/home");
    }
  } catch (error) {
    accountError.value = isAuthenticated.value ? "加载失败，请重试。" : errorMessage(error, "暂时无法登录，请稍后重试。");
    throw new Error(accountError.value);
  } finally { accountBusy.value = false; }
}

export function requestLogout() { logoutRequested.value = true; }

export async function logoutAccount() {
  if (accountBusy.value) throw new Error("请稍候再试。");
  accountBusy.value = true;
  try {
    await axios.post("/api/account/logout", {}, {
      headers: accountSession.value.contextId ? { "x-cruio-context": accountSession.value.contextId } : {},
    });
    revision++;
    acceptSession(anonymousSession());
    accountError.value = "";
    resetAccountSettings();
    accountDataReady.value = false;
    creationLocation.value = { directory: null, available: false };
    const { useWorkspaceStore } = await import("@/stores/workspace");
    const workspace = useWorkspaceStore();
    workspace.project = null;
    workspace.projectList = [];
    workspace.pendingAgentMessage = null;
    logoutRequested.value = false;
    const { default: router } = await import("@/router");
    await router.replace("/hello");
  } catch (error) { throw new Error(errorMessage(error, "退出失败，请重试。")); }
  finally { accountBusy.value = false; }
}
