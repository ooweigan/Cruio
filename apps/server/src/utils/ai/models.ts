import { t } from "@/lib/i18n";
import { z } from "zod";
import { context, hasModelCredential, modelCredential, signal as accountSignal } from "@/utils/account";
import { getMediaModel } from "@toonflow/providers/media/cruio";

const capabilitiesSchema = z.object({
  mode: z.array(z.union([z.enum(["text", "singleImage", "multiReference", "startEndRequired", "endFrameOptional", "startFrameOptional"]),
    z.array(z.templateLiteral([z.enum(["image", "video", "audio"]), "Reference:", z.number()]))])).optional(),
  imageSizes: z.array(z.string().min(1)).optional(),
  imageRatios: z.array(z.string().regex(/^[1-9]\d*:[1-9]\d*$/)).optional(),
  audio: z.union([z.boolean(), z.literal("optional")]).optional(),
  durationResolutionMap: z.array(z.object({ duration: z.array(z.number().positive()), resolution: z.array(z.string().min(1)) })).optional(),
  voices: z.array(z.object({ title: z.string(), voice: z.string() })).optional(),
});

const modelSchema = z.object({
  id: z.string().optional(), name: z.string().optional(),
  display_name: z.string().optional(), displayName: z.string().optional(),
  inputTokenLimit: z.number().int().positive().optional(),
  outputTokenLimit: z.number().int().positive().optional(),
  owned_by: z.string().nullish(),
  supported_endpoint_types: z.array(z.string()).nullish(),
  type: z.enum(["text", "image", "video", "audio", "embedding", "rerank", "moderation"]).optional(),
  modelInfo: capabilitiesSchema.optional(),
  ...capabilitiesSchema.shape,
});

function modelType(item: z.infer<typeof modelSchema>) {
  if (item.type) return item.type;
  const endpoints = item.supported_endpoint_types ?? [];
  for (const type of ["image", "video", "audio", "embedding", "rerank", "moderation"] as const) {
    if (endpoints.some(endpoint => new RegExp(`(?:^|[-_/])${type}(?:$|[-_/])`, "i").test(endpoint))) return type;
  }
  // ACT: NewAPI 旧任务插件只标 openai；仅为已知系列补齐类型，未知任务不冒充聊天模型。
  const id = (item.id ?? "").toLowerCase();
  if (/seedream|gpt-image|dall-e|(?:gemini|qwen|wan|wanx|flux|z-image).*?(?:image|t2i|i2i)|^flux|^z-image/.test(id)) return "image";
  if (/seedance|(?:wan|wanx).*?(?:video|t2v|i2v|r2v)|sora|veo|kling|hailuo|vidu/.test(id)) return "video";
  if (/(?:^|[-_/])(?:tts|speech|suno|chirp)(?:$|[-_/])/.test(id)) return "audio";
  if (/embedding|rerank|moderation|whisper|transcri/.test(id) || item.owned_by === "task plugin") return;
  return "text";
}

export async function fetchProviderModels({ apiUrl, protocol, apiKey, signal: requestSignal }: { apiUrl: string; protocol: string; apiKey: string; signal?: AbortSignal }) {
  const url = new URL(apiUrl);
  if (url.pathname === "/") url.pathname = "/v1";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (protocol === "anthropic-messages") {
    headers["anthropic-version"] = "2023-06-01";
    headers["x-api-key"] = apiKey;
    url.searchParams.set("limit", "1000");
  } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const models = new Map<string, ReturnType<typeof normalizeModel>>();
  const cursors = new Set<string>();
  const timeout = AbortSignal.timeout(30000);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  while (true) {
    const response = await fetch(url, { headers, signal, redirect: "error" });
    if (!response.ok) throw new Error(t`获取模型列表失败（HTTP ${response.status}），请检查 API 地址、协议和密钥`);
    const result = z.object({
      data: z.array(modelSchema),
      has_more: z.boolean().optional(), last_id: z.string().nullable().optional(),
    }).parse(await response.json());
    const items = result.data;
    for (const item of items) {
      const id = item.id?.trim();
      if (!id) throw new Error("模型列表包含无效的模型 ID");
      models.set(id, normalizeModel({ ...item, id }));
    }
    const cursor = protocol === "anthropic-messages" && result.has_more ? result.last_id : undefined;
    if (protocol === "anthropic-messages" && result.has_more && !cursor) throw new Error("模型列表缺少分页游标");
    if (!cursor) break;
    if (cursors.has(cursor)) throw new Error("模型列表分页游标重复");
    cursors.add(cursor);
    url.searchParams.set("after_id", cursor);
  }
  return [...models.values()];
}

function normalizeModel(item: z.infer<typeof modelSchema> & { id: string }) {
  const type = modelType(item);
  const profile = type === "image" || type === "video" || type === "audio" ? getMediaModel(item.id, type) : {};
  return {
    ...profile, ...capabilitiesSchema.parse(item), ...item.modelInfo,
    id: item.id, label: item.display_name || item.displayName || item.id, type,
    contextWindow: item.inputTokenLimit, maxOutputTokens: item.outputTokenLimit,
    endpoints: item.supported_endpoint_types ?? [],
  };
}

const catalogs = new WeakMap<object, { apiUrl: string; apiKey: string; expiresAt: number; models: ReturnType<typeof fetchProviderModels> }>();

export async function getGatewayModels() {
  if (!hasModelCredential()) return [];
  const current = context();
  const credential = modelCredential();
  const cached = catalogs.get(current);
  if (cached && cached.apiUrl === credential.apiUrl && cached.apiKey === credential.apiKey && cached.expiresAt > Date.now()) return cached.models;
  // ACT: 目录仅缓存于当前会话 60 秒；不落盘、不跨账号复用，失败不回退到共享目录。
  const entry = { ...credential, expiresAt: Date.now() + 60000, models: fetchProviderModels({ ...credential, protocol: "openai-completions", signal: accountSignal() }) };
  catalogs.set(current, entry);
  try { return await entry.models; }
  catch (error) { if (catalogs.get(current) === entry) catalogs.delete(current); throw error; }
}
