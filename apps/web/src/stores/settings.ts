import axios from "axios";
import { normalizeLocale } from "@toonflow/i18n";
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import { canvasShortcutFields, defaultCanvasShortcuts, getShortcutBindings, isShortcutAllowed, normalizeShortcut, type CanvasShortcuts } from "@/lib/canvasShortcuts";
import { normalizeNodeMenu, type StoredNodeMenuItem } from "@toonflow/server/nodeMenu";
import type { ReasoningEfforts, ThinkingLevel } from "@toonflow/server/modelReasoning";
import "element-plus/es/components/message/style/css";
import { getAccountContext } from "@/lib/accountTransport";

export const settings = ref<Record<string, unknown>>({});
// ACT: 页面在 loadSettings 完成后才挂载，加载标记仅保留在设置初始化与自动保存内部。
let settingsReady = false;
let saveQueue = Promise.resolve();
let applyingSettings = false;

export const settingsStorage = {
  getItem(key: string) {
    const stores = settings.value.stores as Record<string, unknown> | undefined;
    if (stores && Object.hasOwn(stores, key)) return JSON.stringify(stores[key]);
    return null;
  },
  setItem(key: string, value: string) {
    if (!settingsReady) return;
    settings.value.stores = { ...(settings.value.stores as Record<string, unknown> | undefined), [key]: JSON.parse(value) };
  },
};

export const defaultUiSettings = { theme: "dark", language: "system", primaryColor: "#409eff", fontScale: 100, mobileScale: 75, radius: 8, startupAnimation: true };
export const uiSettings = computed(() => {
  const raw = settings.value.ui;
  const ui = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    language: normalizeLocale(ui.language) ?? "system" as const,
    theme: ui.theme === "light" || ui.theme === "dark" || ui.theme === "system" ? ui.theme : defaultUiSettings.theme,
    primaryColor: typeof ui.primaryColor === "string" && /^#[\da-f]{6}$/i.test(ui.primaryColor) ? ui.primaryColor : defaultUiSettings.primaryColor,
    fontScale: typeof ui.fontScale === "number" && Number.isFinite(ui.fontScale) ? Math.min(125, Math.max(85, ui.fontScale)) : defaultUiSettings.fontScale,
    mobileScale: typeof ui.mobileScale === "number" && Number.isFinite(ui.mobileScale) ? Math.min(100, Math.max(50, ui.mobileScale)) : defaultUiSettings.mobileScale,
    radius: typeof ui.radius === "number" && Number.isFinite(ui.radius) ? Math.min(16, Math.max(0, ui.radius)) : defaultUiSettings.radius,
    startupAnimation: ui.startupAnimation !== false,
  };
});

export function updateUiSettings(patch: Partial<typeof defaultUiSettings>) {
  const current = settings.value.ui;
  settings.value = { ...settings.value, ui: { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...patch } };
}

export const generalSettings = computed(() => {
  const raw = settings.value.general;
  const general = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const shortcuts = general.canvasShortcuts && typeof general.canvasShortcuts === "object" && !Array.isArray(general.canvasShortcuts)
    ? general.canvasShortcuts as Record<string, unknown> : {};
  const savedBindings = new Map(canvasShortcutFields.flatMap(field => {
    const value = shortcuts[field.id];
    const binding = typeof value === "string" ? normalizeShortcut(value) : undefined;
    return binding !== undefined && isShortcutAllowed(field, binding) ? [[field.id, binding] as const] : [];
  }));
  return {
    nodeMenu: normalizeNodeMenu(general.nodeMenu),
    canvasCompositingEnabled: general.canvasCompositingEnabled === true,
    canvasEdgeAnimationEnabled: general.canvasEdgeAnimationEnabled !== false,
    canvasEdgeColorMode: general.canvasEdgeColorMode === "none" || general.canvasEdgeColorMode === "custom" ? general.canvasEdgeColorMode : "theme",
    canvasEdgeColor: typeof general.canvasEdgeColor === "string" && /^#[\da-f]{6}$/i.test(general.canvasEdgeColor) ? general.canvasEdgeColor : defaultUiSettings.primaryColor,
    canvasShortcuts: Object.fromEntries(canvasShortcutFields.map(field => {
      if (savedBindings.has(field.id)) return [field.id, savedBindings.get(field.id)];
      const binding = defaultCanvasShortcuts[field.id];
      const conflicts = canvasShortcutFields.some(other => other.gesture === field.gesture
        && getShortcutBindings(savedBindings.get(other.id) ?? "").some(value => getShortcutBindings(binding).includes(value)));
      return [field.id, conflicts ? "" : binding];
    })) as CanvasShortcuts,
  };
});

export function updateGeneralSettings(patch: Omit<Partial<typeof generalSettings.value>, "nodeMenu"> & { nodeMenu?: StoredNodeMenuItem[] }) {
  const current = settings.value.general;
  settings.value = { ...settings.value, general: { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...patch } };
}

export type CustomProviderModel = { id: string; label: string; contextWindow?: number; maxOutputTokens?: number; reasoningEfforts?: ReasoningEfforts };
export type CustomProvider = { id: string; label: string; icon?: string; version?: string; apiUrl: string; apiKey: string; protocol: string; models: CustomProviderModel[] };
export const customProviders = computed<CustomProvider[]>(() => Array.isArray(settings.value.customProviders)
  ? settings.value.customProviders.filter((item): item is CustomProvider => !!item && item.id === "cruio" && typeof item.label === "string" && Array.isArray(item.models)
    && item.models.every((model: CustomProviderModel) => !!model && typeof model.id === "string" && typeof model.label === "string"))
  : []);

type ResolvedAiModel = { providerId: string; providerLabel: string; modelId: string; label: string; contextWindow?: number; maxOutputTokens?: number; reasoningLevels: ThinkingLevel[] };
const resolvedModelReasoning = ref<Partial<Record<string, ThinkingLevel[]>>>({});
export const modelChoices = computed(() => customProviders.value.flatMap(provider => provider.models.map(model => ({
  value: JSON.stringify([provider.id, model.id]), providerId: provider.id, modelId: model.id, label: model.label, contextWindow: model.contextWindow,
  reasoningLevels: resolvedModelReasoning.value[JSON.stringify([provider.id, model.id])],
}))));

function applyModelReasoning(models: ResolvedAiModel[]) {
  resolvedModelReasoning.value = Object.fromEntries(models.map(model => [JSON.stringify([model.providerId, model.modelId]), model.reasoningLevels]));
}

async function loadModelReasoning() {
  const context = getAccountContext();
  const { data } = await axios.get<{ code: number; data: ResolvedAiModel[] }>(
    "/api/ai/models", { headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" } },
  );
  if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("读取模型推理等级失败");
  if (context !== getAccountContext()) throw new Error("账户已切换，模型加载已停止");
  settings.value.customProviders = [{ id: "cruio", label: "Cruio", models: data.data.map(model => ({
    id: model.modelId, label: model.label, contextWindow: model.contextWindow, maxOutputTokens: model.maxOutputTokens,
  })) }];
  applyModelReasoning(data.data);
}

export async function loadSettings() {
  if (settingsReady) return;
  const context = getAccountContext();
  const { data } = await axios.get("/api/settings/get", { headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" } });
  if (settingsReady) return;
  if (context !== getAccountContext()) throw new Error("账户已切换，设置加载已停止");
  if (data.code !== 200 || !data.data || typeof data.data !== "object" || Array.isArray(data.data)) {
    throw new Error("读取设置失败");
  }
  settings.value = data.data;
  await loadModelReasoning().catch(error => {
    if (context !== getAccountContext() || axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)
      && !["modelNotProvisioned", "modelAuthorizationUnavailable"].includes(error.response?.data?.data?.reason)) throw error;
    // ACT: 模型目录暂时不可用时保留本地项目和设置入口，由生成入口显示实际服务错误。
    ElMessage.warning("模型目录暂时无法获取，请稍后重试");
    applyModelReasoning([]);
  });
  // 等初始化引发的监听执行完，再允许自动保存。
  await nextTick();
  if (context !== getAccountContext()) throw new Error("账户已切换，设置加载已停止");
  settingsReady = true;
}

export function resetAccountSettings() {
  settingsReady = false;
  settings.value = {};
  resolvedModelReasoning.value = {};
  invalidateNodeModels("language");
  invalidateNodeModels("media");
}

function writableSettings(value: Record<string, unknown>) {
  return Object.fromEntries(["ui", "general", "privacy", "personalization", "agentSystemPrompt", "stores", "updateBoxSeenBuilds"]
    .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

export function saveSettings(update?: (current: Record<string, unknown>) => Record<string, unknown> | undefined) {
  const context = getAccountContext();
  // ACT: 队列内读取最新配置再计算变更，确认成功后发布；仅协调当前页面的保存。
  const saving = saveQueue.then(async () => {
    if (!context || context !== getAccountContext() || !settingsReady) throw new Error("账户已切换，设置保存已停止");
    const patch = update?.(settings.value);
    if (update && !patch) return false;
    const requestedNodeMenu = JSON.stringify(((patch?.general ?? settings.value.general) as { nodeMenu?: unknown } | undefined)?.nodeMenu);
    const { data } = await axios.put<{ code: number; data: { customProviders?: CustomProvider[]; mediaProviderConfigs?: Record<string, unknown>; mediaProvider?: { id: string }; modelRefreshErrors?: string[]; nodeMenu?: StoredNodeMenuItem[] | null; aiModels?: ResolvedAiModel[] } | null }>(
      "/api/settings/save", { settings: writableSettings({ ...settings.value, ...patch }) }, { headers: { "x-toonflow-workspace": "1", "x-cruio-context": context } },
    );
    if (data.code !== 200) throw new Error("保存设置失败");
    if (data.data?.aiModels) applyModelReasoning(data.data.aiModels);
    const providers = data.data?.customProviders;
    if ((patch && Object.hasOwn(patch, "customProviders")) || providers) invalidateNodeModels("language");
    if (patch || providers) {
      applyingSettings = true;
      try { settings.value = { ...settings.value, ...patch, ...(providers ? { customProviders: providers } : {}), ...(data.data?.mediaProviderConfigs ? { mediaProviderConfigs: data.data.mediaProviderConfigs } : {}) }; }
      finally { applyingSettings = false; }
    }
    if (data.data && Object.hasOwn(data.data, "nodeMenu")
      && requestedNodeMenu === JSON.stringify((settings.value.general as { nodeMenu?: unknown } | undefined)?.nodeMenu)
      && requestedNodeMenu !== JSON.stringify(data.data.nodeMenu ?? undefined)) {
      applyingSettings = true;
      try {
        const general = { ...(settings.value.general as Record<string, unknown> | undefined) };
        if (data.data.nodeMenu?.length) general.nodeMenu = data.data.nodeMenu;
        else delete general.nodeMenu;
        settings.value = { ...settings.value, general };
      } finally { applyingSettings = false; }
    }
    if (data.data?.mediaProvider) {
      invalidateNodeModels("media");
      window.dispatchEvent(new CustomEvent("toonflow:plugin-installed", { detail: { type: "provider", name: data.data.mediaProvider.id } }));
    }
    if (patch && (Object.hasOwn(patch, "mediaProviderConfigs") || Object.hasOwn(patch, "customProviders"))) {
      window.dispatchEvent(new Event("toonflow:provider-config-changed"));
    }
    if (data.data?.modelRefreshErrors?.length) ElMessage.warning(`API Key 已保存，部分模型获取失败：${data.data.modelRefreshErrors.join("；")}`);
    return true;
  });
  saveQueue = saving.then(() => {}, () => {});
  return saving;
}

watch(settings, () => {
  if (!settingsReady || applyingSettings) return;
  void saveSettings().catch(() => { ElMessage.error("设置保存失败，请稍后重试"); });
}, { deep: true, flush: "sync" });
