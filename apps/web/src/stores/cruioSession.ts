import { ref } from "vue";
import { defineStore } from "pinia";
import { api } from "@/lib/cruioApi";

export type CruioRole = {
  id: string;
  role: "admin" | "creditOperator" | "modelOperator" | "support" | "privacyOperator";
  scopeKind: "global" | "user";
  scopeUserId?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
  revokeReason?: string | null;
};
export type CruioUser = { id: string; email: string; emailVerifiedAt?: string | null; roles?: CruioRole[] };

export const useCruioSession = defineStore("cruio-session", () => {
  const user = ref<CruioUser | null>(null);
  const initialized = ref(false);

  async function initialize(force = false) {
    if (initialized.value && !force) return user.value;
    try {
      const result = await api<{ user: Omit<CruioUser, "roles">; roles?: CruioRole[] }>("/api/auth/me");
      user.value = { ...result.user, roles: result.roles ?? [] };
    } catch {
      user.value = null;
    } finally {
      initialized.value = true;
    }
    return user.value;
  }

  async function refresh() {
    return initialize(true);
  }

  async function signOut() {
    await api<null>("/api/auth/logout", { method: "POST" });
    user.value = null;
    initialized.value = true;
  }

  function hasRole(role: CruioRole["role"], globalOnly = false) {
    return user.value?.roles?.some(grant => grant.role === role && !grant.revokedAt
      && new Date(grant.expiresAt).getTime() > Date.now() && (!globalOnly || grant.scopeKind === "global")) ?? false;
  }

  return { user, initialized, initialize, refresh, signOut, hasRole };
});
