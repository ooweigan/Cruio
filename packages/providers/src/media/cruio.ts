const rules = [
  { type: "input", field: "apiUrl" as const, title: "服务地址", value: "https://cruiorouter.onebeget.com" },
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

const imageRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function getMediaModel(id: string, type: "image" | "video" | "audio"): ProviderModel {
  // 能力依据部署版本的插件定义：https://github.com/QuantumNous/new-api/tree/v1.0.0-rc.44/plugins/tasks
  const lower = id.toLowerCase();
  if (type === "image") {
    let imageSizes = ["1K"];
    let ratios = imageRatios;
    if (lower.startsWith("gpt-image")) ratios = ["3:2", "2:3", "1:1"];
    else if (lower.includes("seedream")) {
      imageSizes = /5-0-(?:pro|flash)/.test(lower) ? ["1K", "1.5K", "2K"]
        : /5-0/.test(lower) ? ["2K", "3K", "4K"] : /4-5/.test(lower) ? ["2K", "4K"] : ["1K", "2K", "4K"];
    } else if (/wan2\.[67].*image/.test(lower)) imageSizes = lower === "wan2.7-image-pro" ? ["1K", "2K", "4K"] : ["1K", "2K"];
    return { id, label: id, type, mode: ["text", "singleImage", "multiReference"], imageSizes, imageRatios: ratios };
  }
  if (type === "video") {
    if (lower.includes("seedance")) {
      // 能力依据 NewAPI v1.0.0-rc.44 的 Doubao 插件；新系列缺省由上游校验。
      const secondGeneration = /seedance-2-/.test(lower);
      const maxDuration = /seedance-2-5/.test(lower) ? 30 : secondGeneration ? 15 : 12;
      const resolution = /seedance-2-0-(?:fast|mini)/.test(lower) ? ["480p", "720p"]
        : /seedance-2-0-260128/.test(lower) ? ["480p", "720p", "1080p", "4k"] : ["480p", "720p", "1080p"];
      const mode: NonNullable<ProviderModel["mode"]> = lower.endsWith("-t2v") ? ["text"] : lower.endsWith("-i2v") ? ["singleImage"] : ["text", "singleImage", "endFrameOptional"];
      if (secondGeneration) mode.push(["imageReference:9", "videoReference:3", "audioReference:3"]);
      return { id, label: id, type, mode, audio: secondGeneration || /seedance-1-5/.test(lower) ? "optional" : false,
        durationResolutionMap: [{ duration: Array.from({ length: maxDuration - 3 }, (_, index) => index + 4), resolution }] };
    }
    return { id, label: id, type, mode: ["text", "singleImage"] };
  }
  return { id, label: id, type };
}

function requestModel(context: ProviderContext, id: string, type: "image" | "video" | "audio") {
  const models = context.config.models;
  const model = Array.isArray(models) ? models.find(model => model.id === id && model.type === type) : undefined;
  if (Array.isArray(models) && !model) throw new Error("所选模型不存在或类型不匹配，请重新选择");
  return (model ?? getMediaModel(id, type)) as ProviderModel & { endpoints?: string[] };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cruio 服务响应格式错误");
  return value as Record<string, unknown>;
}

async function fetchResponse(context: ProviderContext, path: string, signal: AbortSignal, body?: unknown) {
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "") : "";
  if (!apiKey) throw new Error("请配置 Cruio 模型服务凭证");
  const url = new URL(String(context.config.apiUrl ?? "https://cruiorouter.onebeget.com"));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Cruio 服务地址须为不含凭据、查询参数或片段的 HTTP(S) 地址");
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}/${path}`;
  const response = await context.tool.fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${apiKey}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    const message = context.tool.errorMessage(await response.text());
    throw new Error(message || `Cruio 模型请求失败（HTTP ${response.status}）`);
  }
  return response;
}

async function requestJson(context: ProviderContext, path: string, signal: AbortSignal, body?: unknown) {
  const response = await fetchResponse(context, path, signal, body);
  const result = object(await response.json());
  if (result.error) throw new Error(context.tool.errorMessage(result) || "Cruio 模型请求失败");
  return result;
}

function imageSize(model: ProviderModel, input: ImageRequest) {
  const ratio = input.ratio ?? model.imageRatios?.[0] ?? "1:1";
  const size = input.size ?? model.imageSizes?.[0] ?? "1K";
  if (model.imageRatios?.length && !model.imageRatios.includes(ratio) || model.imageSizes?.length && !model.imageSizes.includes(size)) throw new Error("图片尺寸或比例不在模型支持范围内");
  if (model.id.toLowerCase().startsWith("gpt-image") && size === "1K") {
    const sizes: Record<string, string> = { "3:2": "1536x1024", "2:3": "1024x1536", "1:1": "1024x1024" };
    if (sizes[ratio]) return sizes[ratio];
  }
  if (/^\d+x\d+$/.test(size)) return size;
  const parts = /^([1-9]\d*):([1-9]\d*)$/.exec(ratio);
  if (!parts || !/^\d+(?:\.\d+)?K$/i.test(size)) throw new Error("图片尺寸或比例格式无效");
  const scale = Number.parseFloat(size) * 1024;
  const aspect = Number(parts[1]) / Number(parts[2]);
  // K 档按像素面积换算，向下对齐 16，避免横竖比例造成超出模型像素上限。
  return `${Math.max(16, Math.floor(scale * Math.sqrt(aspect) / 16) * 16)}x${Math.max(16, Math.floor(scale / Math.sqrt(aspect) / 16) * 16)}`;
}

function imageAssets(context: ProviderContext, result: Record<string, unknown>): MediaAsset[] {
  if (!Array.isArray(result.data) || !result.data.length) throw new Error("Cruio 未返回图片结果");
  return result.data.map((item: unknown): MediaAsset => {
    const data = object(item);
    if (typeof data.url === "string" && /^https?:\/\//i.test(data.url)) return { mediaType: "image", type: "url", url: data.url };
    if (typeof data.b64_json === "string" && data.b64_json) return { mediaType: "image", type: "base64", data: data.b64_json, mimeType: "image/png" };
    throw new Error(context.tool.errorMessage(data) || "Cruio 图片结果格式错误");
  });
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") {
    if (!/^https?:\/\//i.test(input.url)) throw new Error("参考媒体需要 HTTP 或 HTTPS 地址");
    return input.url;
  }
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

function wait(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 3000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export default {
  id: "cruio" as const,
  label: "Cruio",
  icon: "",
  version: "1.1.0",
  readme: "Cruio 模型服务，按当前账号的 NewAPI 目录分类提供图片、视频和音频模型。",
  rules,
  models: [] satisfies ProviderModel[],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const model = requestModel(this, request.model, "image");
    const size = imageSize(model, request);
    const maxReferences = /seedream-5-0-(?:pro|flash)/i.test(model.id) ? 10 : /seedream/i.test(model.id) ? 14 : /^wan2\.7-image/i.test(model.id) ? 9 : 16;
    if ((request.images?.length ?? 0) > maxReferences) throw new Error(`此图片模型最多支持 ${maxReferences} 张参考图`);
    if (/^wan2\.7-image/.test(model.id) && request.size === "4K" && request.images?.length) throw new Error("Wan 2.7 的 4K 仅支持文生图");
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);
    if (/gemini/i.test(model.id) || model.endpoints?.includes("gemini")) {
      const parts: Record<string, unknown>[] = [{ text: request.prompt }];
      for (const input of request.images ?? []) {
        let mimeType = input.mimeType ?? "image/png";
        let bytes: Uint8Array;
        if (input.type === "url") {
          const response = await this.tool.fetch(mediaUrl(input), { signal });
          if (!response.ok) throw new Error(`读取参考图失败（HTTP ${response.status}）`);
          mimeType = response.headers.get("content-type") ?? mimeType;
          bytes = new Uint8Array(await response.arrayBuffer());
        } else bytes = input.type === "binary" ? input.data : Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ""), "base64");
        parts.push({ inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } });
      }
      const result = await requestJson(this, `v1beta/models/${encodeURIComponent(model.id)}:generateContent`, signal, {
        contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: {
          aspectRatio: request.ratio ?? model.imageRatios?.[0],
          ...(/gemini-2\.5/i.test(model.id) ? {} : { imageSize: request.size ?? model.imageSizes?.[0] }),
        } },
      });
      const assets: MediaAsset[] = [];
      for (const candidate of Array.isArray(result.candidates) ? result.candidates : []) {
        const content = object(object(candidate).content);
        for (const part of Array.isArray(content.parts) ? content.parts : []) {
          const data = object(part).inlineData ?? object(part).inline_data;
          if (!data) continue;
          const inline = object(data);
          if (typeof inline.data === "string") assets.push({ mediaType: "image", type: "base64", data: inline.data, mimeType: String(inline.mimeType ?? inline.mime_type ?? "image/png") });
        }
      }
      if (!assets.length) throw new Error(this.tool.errorMessage(result) || "Cruio 未返回图片结果");
      return assets;
    }
    let body: FormData | Record<string, unknown> = { model: request.model, prompt: request.prompt, size, n: 1 };
    if (request.images?.length) {
      body = new FormData();
      body.set("model", request.model);
      body.set("prompt", request.prompt);
      body.set("size", size);
      body.set("n", "1");
      for (const [index, input] of request.images.entries()) {
        let image: Blob;
        if (input.type === "url") {
          const response = await this.tool.fetch(mediaUrl(input), { signal });
          if (!response.ok) throw new Error(`读取参考图失败（HTTP ${response.status}）`);
          image = await response.blob();
        } else {
          const bytes = input.type === "binary" ? input.data : Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ""), "base64");
          image = new Blob([new Uint8Array(bytes)], { type: input.mimeType });
        }
        body.append("image[]", image, `reference${index}.png`);
      }
    }
    const result = await requestJson(this, `v1/images/${request.images?.length ? "edits" : "generations"}`, signal, body);
    return imageAssets(this, result);
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const model = requestModel(this, request.model, "video");
    const duration = request.duration ?? model.durationResolutionMap?.[0]?.duration[0];
    const resolution = request.resolution ?? model.durationResolutionMap?.[0]?.resolution[0];
    const ratio = request.ratio ?? "16:9";
    if (model.durationResolutionMap?.length && !model.durationResolutionMap.some(item => item.duration.includes(duration!) && item.resolution.includes(resolution!))) throw new Error("视频时长或分辨率不在模型支持范围内");
    if (!["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(ratio)) throw new Error("视频画面比例不支持");
    const images = request.images ?? [];
    const videos = request.videos ?? [];
    const audios = request.audios ?? [];
    const mode = request.mode ?? (request.firstFrame || request.lastFrame ? "endFrameOptional" : images.length ? "singleImage" : "text");
    if (model.mode?.length && !model.mode.some(item => JSON.stringify(item) === JSON.stringify(mode))) throw new Error("此视频模型不支持所选生成模式");
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
    if (!model.id.toLowerCase().includes("seedance")) {
      if (images.length > 1 || videos.length || audios.length || request.lastFrame || images.length && request.firstFrame) throw new Error("此视频协议仅支持文字或一张首帧图片");
      const firstFrame = request.firstFrame ?? images[0];
      const body = { model: model.id, prompt: request.prompt, ...(duration ? { seconds: String(duration) } : {}),
        ...(resolution ? { resolution } : {}), ...(request.ratio ? { aspect_ratio: request.ratio } : {}),
        ...(firstFrame ? { input_reference: mediaUrl(firstFrame) } : {}) };
      const task = await requestJson(this, "v1/videos", signal, body);
      const id = task.id;
      if (typeof id !== "string" || !/^[a-zA-Z0-9._:-]{1,256}$/.test(id)) throw new Error("Cruio 未返回有效的视频任务 ID");
      while (true) {
        const result = await requestJson(this, `v1/videos/${encodeURIComponent(id)}`, signal);
        if (result.id !== id) throw new Error("Cruio 返回了不匹配的视频任务");
        if (["completed", "succeeded"].includes(String(result.status))) {
          const response = await fetchResponse(this, `v1/videos/${encodeURIComponent(id)}/content`, signal);
          return [{ mediaType: "video", type: "binary", data: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("content-type") ?? "video/mp4" }];
        }
        if (["failed", "cancelled", "expired"].includes(String(result.status))) throw new Error(this.tool.errorMessage(result) || "Cruio 视频生成失败");
        if (!["queued", "pending", "running", "processing", "in_progress"].includes(String(result.status))) throw new Error("Cruio 返回了未知的视频任务状态");
        await wait(signal);
      }
    }
    const content: Record<string, unknown>[] = [{ type: "text", text: request.prompt }];
    const append = (type: "image" | "video" | "audio", input: MediaInput, role: string) => {
      content.push({ type: `${type}_url`, [`${type}_url`]: { url: mediaUrl(input) }, role });
    };
    if (Array.isArray(mode)) {
      if (request.firstFrame || request.lastFrame || images.length > 9 || videos.length > 3 || audios.length > 3
        || images.length + videos.length + audios.length > 12 || !images.length && !videos.length) throw new Error("参考模式须包含图片或视频，最多 9 张图、3 段视频、3 段音频，总数不超过 12");
      images.forEach(input => append("image", input, "reference_image"));
      videos.forEach(input => append("video", input, "reference_video"));
      audios.forEach(input => append("audio", input, "reference_audio"));
    } else if (mode === "singleImage") {
      if (images.length !== 1 || request.firstFrame || request.lastFrame || videos.length || audios.length) throw new Error("图生视频模式须提供一张图片");
      append("image", images[0]!, "first_frame");
    } else if (mode === "endFrameOptional") {
      if (!request.firstFrame || images.length || videos.length || audios.length) throw new Error("首尾帧模式须提供首帧，可选尾帧");
      append("image", request.firstFrame, "first_frame");
      if (request.lastFrame) append("image", request.lastFrame, "last_frame");
    } else if (mode !== "text" || images.length || videos.length || audios.length || request.firstFrame || request.lastFrame) {
      throw new Error("视频生成模式与参考素材不匹配");
    }
    // ACT: 沿用宿主任务生命周期，单次最多等待 30 分钟，不自动重提付费任务。
    const path = "doubao/api/v3/contents/generations/tasks";
    const task = await requestJson(this, path, signal, {
      model: request.model, content, duration, resolution, ratio, generate_audio: request.generateAudio ?? false, watermark: request.watermark ?? false,
    });
    if (typeof task.id !== "string" || !/^[a-zA-Z0-9._:-]{1,256}$/.test(task.id)) throw new Error("Cruio 未返回有效的视频任务 ID");
    while (true) {
      const result = await requestJson(this, `${path}/${encodeURIComponent(task.id)}`, signal);
      if (result.id !== task.id) throw new Error("Cruio 返回了不匹配的视频任务");
      if (result.status === "succeeded") {
        const url = object(result.content).video_url;
        if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("Cruio 未返回有效的视频地址");
        return [{ mediaType: "video", type: "url", url, mimeType: "video/mp4" }];
      }
      if (["failed", "cancelled", "expired"].includes(String(result.status))) throw new Error(this.tool.errorMessage(result) || "Cruio 视频生成失败");
      if (result.status !== undefined && !["queued", "pending", "running", "processing"].includes(String(result.status))) throw new Error("Cruio 返回了未知的视频任务状态");
      await wait(signal);
    }
  },
  async generateAudio(input: AudioRequest): Promise<MediaAsset[]> {
    const model = requestModel(this, input.model, "audio");
    if (input.audios?.length || input.images?.length) throw new Error("语音合成接口不支持参考媒体");
    if (input.volume !== undefined && input.volume !== 0 || input.pitch !== undefined && input.pitch !== 0) throw new Error("语音合成接口不支持所选音量或音调参数");
    const format = input.format === "ogg_opus" ? "opus" : input.format ?? "mp3";
    const mimeTypes: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", flac: "audio/flac", pcm: "audio/pcm" };
    if (!mimeTypes[format]) throw new Error("不支持此音频输出格式");
    if (input.sampleRate && !["wav", "mp3"].includes(format) && input.sampleRate !== 24000) throw new Error("自定义采样率仅支持 WAV 或 MP3 输出");
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const resample = input.sampleRate !== undefined && (format === "wav" || format === "mp3");
    // ACT: OpenAI TTS 根据朗读文本识别语种；采样率交由已有 WAV 转换工具处理。
    const response = await fetchResponse(this, "v1/audio/speech", signal, {
      model: input.model, input: input.text ?? input.prompt, voice: input.voice ?? model.voices?.[0]?.voice ?? "alloy", response_format: resample ? "wav" : format,
      ...(input.speed === undefined ? {} : { speed: input.speed }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (resample) {
      const result = await this.tool.audio.convert(bytes, { format: format as "wav" | "mp3", sampleRate: input.sampleRate });
      return [{ mediaType: "audio", type: "binary", data: result.data, mimeType: result.mimeType }];
    }
    return [{ mediaType: "audio", type: "binary", data: bytes, mimeType: mimeTypes[format] }];
  },
} satisfies ProviderDefinition<typeof rules>;
