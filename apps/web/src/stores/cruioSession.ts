import { ref } from "vue";
import { defineStore } from "pinia";
import { api } from "@/lib/cruioApi";

export type CruioUser = { id: string; email: string };

export const useCruioSession = defineStore("cruio-session", () => {
  const user = ref<CruioUser | null>(null);
  const initialized = ref(false);

  async function initialize(force = false) {
    if (initialized.value && !force) return user.value;
    try {
      user.value = (await api<{ user: CruioUser }>("/api/auth/me")).user;
    } catch {
      user.value = null;
    } finally {
      initialized.value = true;
    }
    return user.value;
  }

  async function signOut() {
    await api<null>("/api/auth/logout", { method: "POST" });
    user.value = null;
    initialized.value = true;
  }

  return { user, initialized, initialize, signOut };
});
