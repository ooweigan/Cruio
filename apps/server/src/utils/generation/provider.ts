import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "@/db/database";
import { createPrivateMediaService, validateMediaContent } from "@/utils/privateMedia";
import type { MediaType } from "@/utils/privateMedia";
import { getGenerationResultFile } from "@/utils/generation/resultFile";

export type GenerationModel = {
  id: string;
  providerId: string;
  protocol: "openai_images" | "volcengine_ark_video";
  endpoint: string;
  credentialEnv: string;
  modelId: string;
  operation: "image.generate" | "video.generate";
  capabilities: Record<string, unknown>;
};

export type GenerationSnapshot = {
  operation: "image.generate" | "video.generate";
  prompt: string;
  parameters: Record<string, unknown>;
  assetIds: string[];
  referenceInputs?: ({ kind: "asset"; assetId: string; sourceNodeId: string; sourceHandle: string; targetHandle: string; role: string }
    | { kind: "formalOutput"; resultId: string; taskId: string; adoptionVersion: number; mediaType: string; mimeType: string; sha256: string; sourceNodeId: string; sourceHandle: string; targetHandle: string; role: string; sourceRisk?: "clear" | "realPerson" | "unknown" })[];
  nodeId: string;
  model: { providerId?: string; protocol: string; endpoint: string; credentialEnv: string; modelId: string; capabilities: Record<string, unknown> };
};

export type StoredOutput = { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4"; mediaType: "image" | "video"; usage?: Record<string, unknown> };
export type ProviderResult = { kind: "accepted"; taskId: string; providerStatus: string } | { kind: "output"; outputs: StoredOutput[]; requestId?: string };
export type ProviderStatus = { status: string; rawStatus: string; outputUrl?: string; usage?: Record<string, unknown>; requestId?: string; safeError?: string };

const imageLimit = 50 * 1024 * 1024;
const responseLimit = 90 * 1024 * 1024;
const videoLimit = 512 * 1024 * 1024;
const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function adapterBlock(model: GenerationModel, snapshot: GenerationSnapshot, assetTypes: string[]) {
  let endpoint: URL;
  try { endpoint = new URL(model.endpoint); } catch { return "provider_endpoint_invalid"; }
  const requiredBasePath = model.protocol === "openai_images" ? "/v1" : "/api/v3";
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname.replace(/\/+$/, "") !== requiredBasePath) return "provider_endpoint_invalid";
  const parameters = snapshot.parameters;
  if (model.protocol === "openai_images") {
    if (!/^gpt-image-2(?:-[a-zA-Z0-9.-]+)?$/.test(model.modelId)) return "unsupported_openai_image_model";
    if (assetTypes.some(type => !imageMimeTypes.has(type))) return "unsupported_reference_image_format";
    try { resolveOpenAiImageSize(parameters); } catch { return "unsupported_image_size_or_ratio"; }
    return undefined;
  }
  if (!/^doubao-seedance-[a-zA-Z0-9-]+$|^ep-[a-zA-Z0-9-]+$/.test(model.modelId)) return "unsupported_ark_video_model";
  if (!Array.isArray(model.capabilities.resultHosts) || model.capabilities.resultHosts.length === 0) return "result_hosts_not_configured";
  if (assetTypes.some(type => !imageMimeTypes.has(type))) return "unsupported_reference_media_type";
  const mode = parseMode(parameters.mode);
  const referenceCount = snapshot.referenceInputs?.length ?? snapshot.assetIds.length;
  if (mode === undefined || mode === "") return referenceCount ? "video_mode_required_for_reference" : undefined;
  if (mode === "text") return referenceCount ? "mode_input_mismatch" : undefined;
  if (mode === "singleImage") return referenceCount === 1 ? undefined : "mode_input_mismatch";
  if (mode === "startEndRequired") return referenceCount === 2 ? undefined : "mode_input_mismatch";
  if (mode === "endFrameOptional" || mode === "startFrameOptional") return referenceCount >= 1 && referenceCount <= 2 ? undefined : "mode_input_mismatch";
  if (Array.isArray(mode)) {
    const imageCapacity = mode.reduce((sum, item) => {
      const match = /^imageReference:(\d+)$/.exec(item);
      return sum + (match ? Number(match[1]) : 0);
    }, 0);
    return referenceCount > 0 && referenceCount <= imageCapacity ? undefined : "mode_input_mismatch";
  }
  return "unsupported_video_mode";
}

export function parseMode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function openAiImageSize(size: unknown, ratio: unknown) {
  if (ratio === undefined && (size === undefined || size === "" || size === "auto")) return true;
  if (ratio === undefined && typeof size === "string" && /^(\d{3,4})x(\d{3,4})$/.test(size)) {
    const [, rawWidth, rawHeight] = /^(\d{3,4})x(\d{3,4})$/.exec(size)!;
    const width = Number(rawWidth);
    const height = Number(rawHeight);
    return width <= 3840 && height <= 3840 && width % 16 === 0 && height % 16 === 0
      && width * height >= 655_360 && width * height <= 8_294_400 && Math.max(width / height, height / width) <= 3;
  }
  if (typeof ratio !== "string" || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio)) return false;
  const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
  if (!ratioWidth || !ratioHeight || Math.max(ratioWidth / ratioHeight, ratioHeight / ratioWidth) > 3) return false;
  if (size === undefined || size === "") return true;
  if (typeof size !== "string") return false;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(size);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width <= 3840 && height <= 3840 && width % 16 === 0 && height % 16 === 0
      && width * height >= 655_360 && width * height <= 8_294_400
      && Math.abs(width / height - ratioWidth / ratioHeight) < 0.015;
  }
  return size === "1K" || size === "2K" || size === "4K";
}

export function resolveOpenAiImageSize(parameters: Record<string, unknown>): string | undefined {
  const explicit = parameters.size;
  if (typeof explicit === "string" && /^\d{3,4}x\d{3,4}$/.test(explicit)) {
    if (!openAiImageSize(explicit, parameters.ratio)) throw new Error("image_dimensions_unsupported");
    return explicit;
  }
  if ((explicit === undefined || explicit === "" || explicit === "auto") && parameters.ratio === undefined) return undefined;
  const ratio = String(parameters.ratio ?? "").split(":").map(Number);
  if (ratio.length !== 2 || !ratio[0] || !ratio[1]) {
    if (explicit === undefined || explicit === "" || explicit === "auto") return undefined;
    throw new Error("image_ratio_required_for_named_size");
  }
  const aspect = ratio[0] / ratio[1];
  const target = explicit === "2K" ? 2048 : explicit === "4K" ? 3840 : 1024;
  const targetArea = Math.min(8_294_400, target * target);
  let best: { width: number; height: number; score: number } | undefined;
  for (let width = 16; width <= 3840; width += 16) {
    for (let height = 16; height <= 3840; height += 16) {
      const area = width * height;
      const actualRatio = width / height;
      if (area < 655_360 || area > 8_294_400 || Math.max(actualRatio, 1 / actualRatio) > 3) continue;
      const ratioError = Math.abs(actualRatio / aspect - 1);
      if (ratioError > 0.015) continue;
      const score = Math.abs(Math.log(area / targetArea)) + ratioError * 10;
      if (!best || score < best.score) best = { width, height, score };
    }
  }
  if (!best) throw new Error("image_dimensions_unsupported");
  return `${best.width}x${best.height}`;
}

function makeEndpoint(base: string, suffix: string) {
  const url = new URL(base);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/${suffix}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

async function boundedBytes(response: Response, maximum: number) {
  if (!response.body) throw new Error("empty_response");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) throw new Error("response_too_large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maximum) throw new Error("response_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function safeJson(response: Response, maximum = 1024 * 1024) {
  const bytes = await boundedBytes(response, maximum);
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
}

async function readReferences(database: Database, storageDirectory: string, userId: string, assetIds: string[]) {
  const media = createPrivateMediaService(database, storageDirectory);
  const result: { bytes: Buffer; mimeType: MediaType }[] = [];
  for (const id of assetIds) {
    const record = await media.getActive(userId, id);
    if (!record || !imageMimeTypes.has(record.mediaType)) throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true, failureKind: "referenceUnavailable" });
    let bytes: Buffer;
    try { bytes = await readFile(record.filePath); } catch { throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true, failureKind: "referenceUnavailable" }); }
    if (bytes.byteLength !== record.size || !await validateMediaContent(record.mediaType, bytes)) throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true, failureKind: "referenceUnavailable" });
    result.push({ bytes, mimeType: record.mediaType });
  }
  return result;
}

async function readSnapshotReferences(database: Database, storageDirectory: string, userId: string, snapshot: GenerationSnapshot) {
  if (!snapshot.referenceInputs) return readReferences(database, storageDirectory, userId, snapshot.assetIds);
  const references: { bytes: Buffer; mimeType: MediaType }[] = [];
  for (const input of snapshot.referenceInputs) {
    if (input.kind === "asset") {
      const items = await readReferences(database, storageDirectory, userId, [input.assetId]);
      references.push(...items);
      continue;
    }
    const rows = await database<{ storageKey: string; size: number; sha256: string; mimeType: string; mediaType: string; taskId: string; taskStatus: string }[]>`
      SELECT results.storage_key AS "storageKey", results.size, results.sha256, results.mime_type AS "mimeType",
        results.media_type AS "mediaType", tasks.id AS "taskId", tasks.status AS "taskStatus"
      FROM generation_results AS results JOIN generation_tasks AS tasks ON tasks.id = results.task_id
      WHERE results.id = ${input.resultId} AND results.user_id = ${userId} AND tasks.user_id = ${userId}
    `;
    const row = rows[0];
    const file = row && row.taskId === input.taskId && row.taskStatus === "delivered" && row.mediaType === "image"
      && row.mimeType === input.mimeType && row.sha256.trim() === input.sha256
      ? await getGenerationResultFile(storageDirectory, userId, row.storageKey, Number(row.size)) : null;
    if (!row || !file) throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true, failureKind: "referenceUnavailable" });
    let bytes: Buffer;
    try { bytes = await readFile(file.filePath); } catch { throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true, failureKind: "referenceUnavailable" }); }
    if (bytes.byteLength !== file.size || hashOutput(bytes) !== input.sha256 || !imageMimeTypes.has(row.mimeType)
      || !await validateMediaContent(row.mimeType as MediaType, bytes)) {
      throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true, failureKind: "referenceUnavailable" });
    }
    references.push({ bytes, mimeType: row.mimeType as MediaType });
  }
  return references;
}

export function openAiResponsePath(storageDirectory: string, userId: string, taskId: string) {
  return resolve(storageDirectory, "generationResponses", userId, taskId);
}

async function persistProviderResponse(storageDirectory: string, userId: string, taskId: string, bytes: Uint8Array) {
  const path = openAiResponsePath(storageDirectory, userId, taskId);
  const directory = resolve(storageDirectory, "generationResponses", userId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    await link(temporaryPath, path);
    await rm(temporaryPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw Object.assign(new Error("provider_response_already_staged"), { requestUnknown: true });
    throw error;
  }
}

export async function readStagedArkAcceptance(storageDirectory: string, userId: string, taskId: string) {
  let raw: Buffer;
  try { raw = await readFile(openAiResponsePath(storageDirectory, userId, taskId)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (raw.length > 1024 * 1024) throw new Error("staged_provider_response_too_large");
  const payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  if (typeof payload.id !== "string" || !/^[a-zA-Z0-9._:-]{1,256}$/.test(payload.id)) throw new Error("provider_acceptance_unknown");
  return { taskId: payload.id, providerStatus: typeof payload.status === "string" ? payload.status : "queued" };
}

export type StagedOpenAiOutput =
  | { kind: "missing" }
  | { kind: "transientIo" }
  | { kind: "tooLarge" }
  | { kind: "staged"; outputs: StoredOutput[]; sha256: string; byteLength: number; failureKind?: string };

export async function readStagedOpenAiOutput(storageDirectory: string, userId: string, taskId: string): Promise<StagedOpenAiOutput> {
  const path = openAiResponsePath(storageDirectory, userId, taskId);
  let handle;
  try { handle = await open(path, "r"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "transientIo" };
  }
  let contents: Buffer;
  try {
    const bounded = Buffer.alloc(responseLimit + 1);
    let length = 0;
    while (length < bounded.length) {
      const { bytesRead } = await handle.read(bounded, length, bounded.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > responseLimit) return { kind: "tooLarge" };
    contents = bounded.subarray(0, length);
  } catch {
    return { kind: "transientIo" };
  } finally {
    await handle.close().catch(() => undefined);
  }
  const sha256 = createHash("sha256").update(contents).digest("hex");
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(contents.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "staged", outputs: [], sha256, byteLength: contents.length, failureKind: "invalidResponseShape" };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { kind: "staged", outputs: [], sha256, byteLength: contents.length, failureKind: "invalidJson" };
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  const outputs: StoredOutput[] = [];
  let failureKind: string | undefined = data.length ? undefined : "responseHasNoImageOutputs";
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof (item as { b64_json?: unknown }).b64_json !== "string") {
      failureKind ??= "invalidImageEntry";
      continue;
    }
    const encoded = (item as { b64_json: string }).b64_json;
    if (encoded.length > Math.ceil(imageLimit * 4 / 3)) {
      failureKind ??= "imageEntryTooLarge";
      continue;
    }
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > imageLimit || bytes.toString("base64") !== encoded) {
      failureKind ??= "invalidImageBase64";
      continue;
    }
    outputs.push({ bytes, mimeType: "image/png", mediaType: "image" });
  }
  if (data.length && !outputs.length && !failureKind) failureKind = "responseHasNoImageOutputs";
  const usage = payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage)
    ? payload.usage as Record<string, unknown> : undefined;
  return { kind: "staged", outputs: outputs.map(output => ({ ...output, usage })), sha256, byteLength: contents.length, failureKind };
}

export async function clearStagedProviderResponse(storageDirectory: string, userId: string, taskId: string) {
  await rm(openAiResponsePath(storageDirectory, userId, taskId), { force: true });
}

function requestId(response: Response) {
  return response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined;
}

export async function submitGeneration(input: {
  model: GenerationModel; snapshot: GenerationSnapshot; userId: string; database: Database; storageDirectory: string;
  taskId: string; fetchImpl?: typeof fetch; signal?: AbortSignal;
}): Promise<ProviderResult> {
  const secret = process.env[input.model.credentialEnv];
  if (!secret) throw Object.assign(new Error("credential_missing"), { definiteFailure: true, failureKind: "credentialUnavailable" });
  const fetchImpl = input.fetchImpl ?? fetch;
  const references = await readSnapshotReferences(input.database, input.storageDirectory, input.userId, input.snapshot);
  if (input.model.protocol === "openai_images") {
    const size = resolveOpenAiImageSize(input.snapshot.parameters);
    let response: Response;
    const headers = { Authorization: `Bearer ${secret}` };
    if (references.length) {
      const body = new FormData();
      body.set("model", input.model.modelId);
      body.set("prompt", input.snapshot.prompt);
      if (size) body.set("size", size);
      body.set("output_format", "png");
      references.forEach((image, index) => body.append("image[]", new Blob([image.bytes], { type: image.mimeType }), `reference-${index}.${image.mimeType.split("/")[1]}`));
      response = await fetchImpl(makeEndpoint(input.snapshot.model.endpoint, "images/edits"), {
        method: "POST", headers, body, signal: input.signal, redirect: "error",
      });
    } else {
      const imagePayload: Record<string, unknown> = { model: input.model.modelId, prompt: input.snapshot.prompt, output_format: "png" };
      if (size) imagePayload.size = size;
      response = await fetchImpl(makeEndpoint(input.snapshot.model.endpoint, "images/generations"), {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(imagePayload),
        signal: input.signal, redirect: "error",
      });
    }
    const id = requestId(response);
    if (!response.ok) {
      await boundedBytes(response, 16 * 1024).catch(() => Buffer.alloc(0));
      if (response.status >= 500 || response.status === 408) throw Object.assign(new Error("provider_response_unknown"), { requestUnknown: true, requestId: id });
      throw Object.assign(new Error("provider_rejected_request"), { definiteFailure: true, failureKind: "providerRejected", requestId: id });
    }
    const raw = await boundedBytes(response, responseLimit);
    await persistProviderResponse(input.storageDirectory, input.userId, input.taskId, raw);
    const payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const data = Array.isArray(payload.data) ? payload.data : [];
    const outputs: StoredOutput[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object" || typeof (item as { b64_json?: unknown }).b64_json !== "string") continue;
      const encoded = (item as { b64_json: string }).b64_json;
      if (encoded.length > Math.ceil(imageLimit * 4 / 3)) continue;
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length === 0 || bytes.length > imageLimit || bytes.toString("base64") !== encoded) continue;
      outputs.push({ bytes, mimeType: "image/png", mediaType: "image" });
    }
    if (!outputs.length) throw Object.assign(new Error("provider_result_unknown"), { requestUnknown: true, requestId: id });
    const usage = payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage)
      ? payload.usage as Record<string, unknown> : undefined;
    return { kind: "output", outputs: outputs.map(output => ({ ...output, usage })), requestId: id };
  }

  const content: Record<string, unknown>[] = [{ type: "text", text: input.snapshot.prompt }];
  const mode = parseMode(input.snapshot.parameters.mode);
  references.forEach((image, index) => {
    const role = mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional"
      ? mode === "startFrameOptional" && references.length === 1 ? "last_frame"
        : index === 0 ? "first_frame" : "last_frame" : "reference_image";
    content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}` }, role });
  });
  const parameters = input.snapshot.parameters;
  const payload: Record<string, unknown> = { model: input.model.modelId, content };
  for (const name of ["duration", "resolution", "ratio", "generateAudio"] as const) {
    if (parameters[name] !== undefined) payload[name === "generateAudio" ? "generate_audio" : name] = parameters[name];
  }
  const response = await fetchImpl(makeEndpoint(input.snapshot.model.endpoint, "contents/generations/tasks"), {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: input.signal, redirect: "error",
  });
  const id = requestId(response);
  if (!response.ok) {
    await boundedBytes(response, 16 * 1024).catch(() => Buffer.alloc(0));
    if (response.status >= 500 || response.status === 408) throw Object.assign(new Error("provider_response_unknown"), { requestUnknown: true, requestId: id });
    throw Object.assign(new Error("provider_rejected_request"), { definiteFailure: true, failureKind: "providerRejected", requestId: id });
  }
  const raw = await boundedBytes(response, 1024 * 1024);
  await persistProviderResponse(input.storageDirectory, input.userId, input.taskId, raw);
  const result = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  if (typeof result.id !== "string" || result.id.length > 256) {
    throw Object.assign(new Error("provider_acceptance_unknown"), { requestUnknown: true, requestId: id });
  }
  return { kind: "accepted", taskId: result.id, providerStatus: "queued" };
}

export async function queryArkTask(input: {
  model: GenerationModel; providerTaskId: string; fetchImpl?: typeof fetch; signal?: AbortSignal;
}): Promise<ProviderStatus> {
  const secret = process.env[input.model.credentialEnv];
  if (!secret) throw new Error("credential_missing");
  if (!/^[a-zA-Z0-9._:-]{1,256}$/.test(input.providerTaskId)) throw new Error("provider_task_id_invalid");
  const endpoint = makeEndpoint(input.model.endpoint, `contents/generations/tasks/${encodeURIComponent(input.providerTaskId)}`);
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    headers: { Authorization: `Bearer ${secret}` }, signal: input.signal, redirect: "error",
  });
  if (!response.ok) {
    await boundedBytes(response, 16 * 1024).catch(() => Buffer.alloc(0));
    throw new Error(response.status >= 500 || response.status === 408 ? "provider_query_unknown" : "provider_query_rejected");
  }
  const payload = await safeJson(response, 1024 * 1024);
  if (payload.id !== input.providerTaskId || typeof payload.status !== "string") throw new Error("provider_status_unknown");
  const rawStatus = payload.status;
  const status = rawStatus === "queued" || rawStatus === "running" ? "running"
    : rawStatus === "succeeded" ? "succeeded"
      : rawStatus === "failed" || rawStatus === "cancelled" || rawStatus === "expired" ? "failed" : "unknown";
  const content = payload.content && typeof payload.content === "object" ? payload.content as Record<string, unknown> : {};
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : undefined;
  return {
    status,
    rawStatus,
    outputUrl: typeof content.video_url === "string" ? content.video_url : undefined,
    usage,
    requestId: requestId(response),
    safeError: status === "failed" ? "上游已确认任务失败。" : undefined,
  };
}

function isAllowedResultUrl(value: string, allowedHosts: unknown) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.every(host => typeof host === "string")) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  if (!allowedHosts.includes(url.hostname)) return null;
  return url;
}

export async function retrieveArkOutput(input: {
  url: string; allowedHosts: unknown; fetchImpl?: typeof fetch; signal?: AbortSignal;
}): Promise<StoredOutput> {
  const url = isAllowedResultUrl(input.url, input.allowedHosts);
  if (!url) throw new Error("provider_result_url_rejected");
  const response = await (input.fetchImpl ?? fetch)(url, { signal: input.signal, redirect: "error" });
  if (!response.ok) throw new Error("provider_result_download_failed");
  const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mime !== "video/mp4") throw new Error("provider_result_format_unsupported");
  const bytes = await boundedBytes(response, videoLimit);
  if (!bytes.length) throw new Error("provider_result_empty");
  return { bytes, mimeType: "video/mp4", mediaType: "video" };
}

export async function validateImageOutput(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > imageLimit) throw Object.assign(new Error("image_result_size_invalid"), { contentInvalid: true });
  const sharp = (await import("sharp")).default;
  let decoded;
  try { decoded = await sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000 }).raw().toBuffer({ resolveWithObject: true }); }
  catch (error) {
    if (!isInvalidImageContent(error)) throw error;
    throw Object.assign(new Error("image_result_invalid"), { contentInvalid: true });
  }
  if (!decoded.info.width || !decoded.info.height || decoded.info.width * decoded.info.height > 40_000_000 || !decoded.data.length) {
    throw Object.assign(new Error("image_result_invalid"), { contentInvalid: true });
  }
  let metadata;
  try { metadata = await sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000 }).metadata(); }
  catch (error) {
    if (!isInvalidImageContent(error)) throw error;
    throw Object.assign(new Error("image_result_invalid"), { contentInvalid: true });
  }
  if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format)) {
    throw Object.assign(new Error("image_result_format_invalid"), { contentInvalid: true });
  }
  const mimeType = `image/${metadata.format === "jpeg" ? "jpeg" : metadata.format}` as StoredOutput["mimeType"];
  return { bytes, mimeType, mediaType: "image" as const };
}

function isInvalidImageContent(error: unknown) {
  if (typeof error === "object" && error && "code" in error) return false;
  const message = error instanceof Error ? error.message : "";
  if (/memory|allocat|resource|temporar|out of (?:memory|resources)|buffer.{0,20}(?:alloc|full)/i.test(message)) return false;
  return /^Input buffer contains unsupported image format$/i.test(message)
    || /^Input buffer has corrupt header:/i.test(message)
    || /^Input image exceeds pixel limit$/i.test(message)
    || /^(?:Input image is truncated|Input buffer is truncated|premature end of input|corrupt (?:image )?header|invalid (?:image|header|jpeg|png|webp)(?: data| format)?|CRC (?:mismatch|error|invalid))\b/i.test(message);
}

export function makeStoredFilePath(storageDirectory: string, userId: string, storageKey: string) {
  return resolve(storageDirectory, "generationResults", userId, storageKey);
}

export function hashOutput(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
