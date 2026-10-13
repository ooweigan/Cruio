import { Router } from "express";
import type { Database } from "@/db/database";

type ModelRow = {
  id: string; providerId: string; providerLabel: string; channelKind: string; region: string;
  upstreamModelId: string; configuredAt: Date;
  modelVersion: string; operation: "image.generate" | "video.generate";
  capabilities: Record<string, unknown>; credentialEnv: string; creditPrice: number | null;
};

const parameterNames = {
  "image.generate": new Set(["size", "ratio"]),
  "video.generate": new Set(["duration", "resolution", "ratio", "mode", "generateAudio"]),
};

function publicParameterRule(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 32 || value.some(item => !publicEnumValue(item))) return undefined;
    return value;
  }
  if (!value || typeof value !== "object") return undefined;
  const rule = value as Record<string, unknown>;
  if (Array.isArray(rule.enum)) {
    if (rule.enum.length > 32 || rule.enum.some(item => !publicEnumValue(item))) return undefined;
    return { enum: rule.enum };
  }
  if (Object.keys(rule).some(key => !["type", "min", "max"].includes(key))) return undefined;
  if ((rule.type === undefined || rule.type === "number")
    && (rule.min === undefined || (typeof rule.min === "number" && Number.isFinite(rule.min)))
    && (rule.max === undefined || (typeof rule.max === "number" && Number.isFinite(rule.max)))) {
    return { type: "number", ...(rule.min === undefined ? {} : { min: rule.min }), ...(rule.max === undefined ? {} : { max: rule.max }) };
  }
  return undefined;
}

function publicEnumValue(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    || (Array.isArray(value) && value.length <= 16 && value.every(item => item === null || ["string", "number", "boolean"].includes(typeof item)));
}

function publicCapabilities(value: Record<string, unknown>, operation: ModelRow["operation"]) {
  const parameters = value.parameters && typeof value.parameters === "object" && !Array.isArray(value.parameters)
    ? Object.fromEntries(Object.entries(value.parameters as Record<string, unknown>)
      .filter(([key]) => parameterNames[operation].has(key))
      .flatMap(([key, rule]) => {
        const safeRule = publicParameterRule(rule);
        return safeRule === undefined ? [] : [[key, safeRule]];
      })) : {};
  const allowedPorts = new Set(["text", "image", "video", "audio", "reference_image", "first_frame", "last_frame"]);
  const publicPortList = (name: "inputs" | "outputs") => Array.isArray(value[name])
    ? [...new Set((value[name] as unknown[]).filter((item): item is string => typeof item === "string" && allowedPorts.has(item)))].slice(0, 8)
    : undefined;
  const safeLimit = (name: "maxReferenceImages" | "maxPromptLength", maximum: number) =>
    typeof value[name] === "number" && Number.isSafeInteger(value[name]) && value[name] >= 0 && value[name] <= maximum
      ? value[name] : undefined;
  return {
    ...(publicPortList("inputs") ? { inputs: publicPortList("inputs") } : {}),
    ...(publicPortList("outputs") ? { outputs: publicPortList("outputs") } : {}),
    ...(safeLimit("maxReferenceImages", 16) === undefined ? {} : { maxReferenceImages: safeLimit("maxReferenceImages", 16) }),
    ...(safeLimit("maxPromptLength", 100_000) === undefined ? {} : { maxPromptLength: safeLimit("maxPromptLength", 100_000) }),
    parameters,
  };
}

export function createGenerationModelsRoute(database: Database, videoRuntimeAvailable = false) {
  return Router().get("/", async (request, response) => {
    const models = await database<ModelRow[]>`
      SELECT models.id, models.provider_id AS "providerId", models.provider_label AS "providerLabel",
        models.channel_kind AS "channelKind", models.region, models.model_id AS "upstreamModelId",
        models.model_version AS "modelVersion", models.operation, models.capabilities, models.credit_price AS "creditPrice",
        models.credential_env AS "credentialEnv", models.verified_at AS "configuredAt"
      FROM generation_models AS models
      WHERE models.published = true AND models.is_current = true
      ORDER BY operation, provider_label, model_id
    `;
    response.json({ models: models.map(model => ({
      modelId: model.id,
      providerId: model.providerId,
      providerLabel: model.providerLabel,
      upstreamModelId: model.upstreamModelId,
      channelKind: model.channelKind,
      region: model.region,
      modelVersion: model.modelVersion,
      operation: model.operation,
      capabilities: publicCapabilities(model.capabilities, model.operation),
      configuredAt: model.configuredAt,
      available: Boolean(process.env[model.credentialEnv]) && model.creditPrice != null
        && (model.operation !== "video.generate" || videoRuntimeAvailable),
      unavailableReason: model.creditPrice == null || !process.env[model.credentialEnv]
        || (model.operation === "video.generate" && !videoRuntimeAvailable) ? "当前暂不可用" : undefined,
    })) });
  });
}
