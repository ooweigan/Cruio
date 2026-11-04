import cruio from "@toonflow/providers/language/cruio";
import conf from "@/utils/conf";
import { fetchProviderModels } from "@/utils/ai/models";

let initialization: Promise<void> | undefined;

function normalizeApiKey(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "";
}

function getLanguageProvider(settings: Record<string, unknown>) {
  const providers = settings.customProviders;
  if (!Array.isArray(providers)) return;
  return providers.find(item => item?.id === cruio.id && typeof item.apiUrl === "string" && URL.canParse(item.apiUrl));
}

async function refreshLanguageModels(previousSettings?: Record<string, unknown>) {
  const provider = getLanguageProvider(conf.get("settings", {}));
  const apiKey = normalizeApiKey(provider?.apiKey);
  const previous = previousSettings && getLanguageProvider(previousSettings);
  if (!apiKey || (previous && apiKey === normalizeApiKey(previous.apiKey) && previous.apiUrl === provider.apiUrl && previous.protocol === provider.protocol)) return;
  const models = (await fetchProviderModels({ apiUrl: provider.apiUrl, protocol: provider.protocol, apiKey })).filter(model => model.type === "text");
  if (!models.length) throw new Error("未获取到文本模型，保留原有列表");
  const modelOrder = new Map<string, number>((provider.models ?? []).map((model: { id: string }, index: number) => [model.id, index]));
  models.sort((left, right) => (modelOrder.get(left.id) ?? modelOrder.size) - (modelOrder.get(right.id) ?? modelOrder.size));
  const current = conf.get("settings.customProviders");
  if (!Array.isArray(current)) return;
  const index = current.findIndex(item => item?.id === provider.id && item.apiUrl === provider.apiUrl
    && item.protocol === provider.protocol && item.apiKey === provider.apiKey);
  if (index === -1) return;
  const providers = current.map((item, itemIndex) => itemIndex === index ? { ...item, models: models.map(model => {
    const saved = Array.isArray(item.models) ? item.models.find((existing: { id?: string; reasoningEfforts?: unknown }) => existing?.id === model.id) : undefined;
    return saved?.reasoningEfforts === undefined ? model : { ...model, reasoningEfforts: saved.reasoningEfforts };
  }) } : item);
  conf.set("settings.customProviders", providers);
  return providers;
}

export async function refreshProviderModels(previousSettings?: Record<string, unknown>) {
  try {
    const providers = await refreshLanguageModels(previousSettings);
    return providers ? { customProviders: providers } : {};
  } catch (error) {
    return { modelRefreshErrors: [`Cruio 文本模型更新失败：${error instanceof Error ? error.message : "未知错误"}`] };
  }
}

export default function initializeProviderModels() {
  // ACT: 每个进程启动时仅尝试一次；失败保留已有模型，下次启动再更新。
  return initialization ??= refreshProviderModels().then(result => {
    result.modelRefreshErrors?.forEach(error => console.warn(error));
  });
}
