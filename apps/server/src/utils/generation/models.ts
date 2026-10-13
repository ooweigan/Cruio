import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Database } from "@/db/database";

type GenerationProtocol = "openai_images" | "volcengine_ark_video";
type GenerationModelConfig = {
  providerId: string;
  providerLabel: string;
  channelKind: "official" | "compatible";
  region: string;
  protocol: GenerationProtocol;
  adapterVersion: string;
  endpoint: string;
  credentialEnv: string;
  modelId: string;
  modelVersion: string;
  operation: "image.generate" | "video.generate";
  capabilities: Record<string, unknown>;
  costReference: Record<string, unknown>;
  creditPrice: number | null;
  verifiedAt: string;
  published: boolean;
};

type ModelVersionRow = GenerationModelConfig & { configVersion: number };
const safeIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
const officialHosts: Record<GenerationProtocol, Set<string>> = {
  openai_images: new Set(["api.openai.com"]),
  volcengine_ark_video: new Set(["ark.cn-beijing.volces.com", "ark.ap-southeast.bytepluses.com"]),
};
const adapterVersions: Record<GenerationProtocol, string> = { openai_images: "v1", volcengine_ark_video: "v1" };

export function parseGenerationModelConfig(value: unknown): GenerationModelConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const protocol = item.protocol;
  const operation = item.operation;
  if (protocol !== "openai_images" && protocol !== "volcengine_ark_video") return null;
  if ((protocol === "openai_images" && operation !== "image.generate")
    || (protocol === "volcengine_ark_video" && operation !== "video.generate")) return null;
  if (typeof item.providerId !== "string" || !/^[a-z][a-zA-Z0-9]{0,63}$/.test(item.providerId)
    || typeof item.providerLabel !== "string" || !item.providerLabel.trim()
    || (item.channelKind !== "official" && item.channelKind !== "compatible")
    || typeof item.region !== "string" || !item.region.trim()
    || typeof item.endpoint !== "string" || !URL.canParse(item.endpoint)
    || typeof item.credentialEnv !== "string" || !safeIdentifier.test(item.credentialEnv)
    || typeof item.modelId !== "string" || !item.modelId.trim()
    || typeof item.modelVersion !== "string" || !item.modelVersion.trim()
    || !item.capabilities || typeof item.capabilities !== "object" || Array.isArray(item.capabilities)
    || !item.costReference || typeof item.costReference !== "object" || Array.isArray(item.costReference)
    || (item.creditPrice !== null && (!Number.isSafeInteger(item.creditPrice) || Number(item.creditPrice) <= 0))
    || typeof item.verifiedAt !== "string" || !Number.isFinite(Date.parse(item.verifiedAt))
    || typeof item.published !== "boolean") return null;
  const endpoint = new URL(item.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  const expectedPath = protocol === "openai_images" ? "/v1" : "/api/v3";
  if (endpoint.pathname.replace(/\/+$/, "") !== expectedPath) return null;
  if (protocol === "volcengine_ark_video") {
    const resultHosts = (item.capabilities as Record<string, unknown>).resultHosts;
    if (!Array.isArray(resultHosts) || resultHosts.length === 0 || resultHosts.length > 16
      || resultHosts.some(host => typeof host !== "string" || host !== host.toLowerCase()
        || host.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/.test(host))) return null;
  }
  const officialHost = officialHosts[protocol].has(endpoint.hostname);
  if ((item.channelKind === "official") !== officialHost) return null;
  if (item.published && (!item.creditPrice || !item.verifiedAt)) return null;
  return {
    providerId: item.providerId, providerLabel: item.providerLabel, channelKind: item.channelKind,
    region: item.region, protocol, adapterVersion: adapterVersions[protocol], endpoint: item.endpoint, credentialEnv: item.credentialEnv,
    modelId: item.modelId, modelVersion: item.modelVersion, operation: operation as GenerationModelConfig["operation"],
    capabilities: item.capabilities as Record<string, unknown>, costReference: item.costReference as Record<string, unknown>,
    creditPrice: item.creditPrice as number | null, verifiedAt: item.verifiedAt, published: item.published,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function sameConfig(left: GenerationModelConfig, right: GenerationModelConfig) {
  const normalize = (model: GenerationModelConfig) => ({
    providerId: model.providerId, providerLabel: model.providerLabel, channelKind: model.channelKind,
    region: model.region, protocol: model.protocol, adapterVersion: model.adapterVersion,
    endpoint: model.endpoint, credentialEnv: model.credentialEnv,
    modelId: model.modelId, modelVersion: model.modelVersion, operation: model.operation,
    capabilities: model.capabilities, costReference: model.costReference,
    creditPrice: model.creditPrice === null ? null : Number(model.creditPrice),
    verifiedAt: new Date(model.verifiedAt).toISOString(), published: model.published,
  });
  return JSON.stringify(stableValue(normalize(left))) === JSON.stringify(stableValue(normalize(right)));
}

function modelKey(model: Pick<GenerationModelConfig, "providerId" | "modelId" | "modelVersion" | "operation">) {
  return JSON.stringify([model.providerId, model.modelId, model.modelVersion, model.operation]);
}

export async function synchronizeGenerationModels(database: Database, configFile?: string) {
  if (!configFile) return;
  let contents: string;
  try {
    contents = await readFile(configFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) {
    throw new Error("Generation model config must contain a models array");
  }
  const models = ((parsed as { models: unknown[] }).models).map(parseGenerationModelConfig);
  if (models.some(model => !model)) throw new Error("Generation model config contains an invalid or unsupported model");
  const configs = models as GenerationModelConfig[];
  const uniqueKeys = new Set(configs.map(modelKey));
  if (uniqueKeys.size !== configs.length) throw new Error("Generation model config contains duplicate mappings");

  const existing = await database<{ exists: boolean }[]>`SELECT EXISTS(SELECT 1 FROM generation_models) AS exists`;
  if (existing[0]?.exists) return;

  await database.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
    const currentRows = await transaction<ModelVersionRow[]>`
      SELECT provider_id AS "providerId", provider_label AS "providerLabel", channel_kind AS "channelKind",
        region, protocol, adapter_version AS "adapterVersion", endpoint, credential_env AS "credentialEnv", model_id AS "modelId",
        model_version AS "modelVersion", operation, capabilities, cost_reference AS "costReference",
        credit_price AS "creditPrice", verified_at AS "verifiedAt", published,
        config_version AS "configVersion"
      FROM generation_models WHERE is_current = true FOR UPDATE
    `;
    const currentByKey = new Map(currentRows.map(row => [modelKey(row), row]));
    const incomingKeys = new Set(configs.map(modelKey));

    for (const oldModel of currentRows) {
      if (!incomingKeys.has(modelKey(oldModel))) {
        await transaction`
          UPDATE generation_models SET is_current = false, updated_at = now()
          WHERE provider_id = ${oldModel.providerId} AND model_id = ${oldModel.modelId}
            AND model_version = ${oldModel.modelVersion} AND operation = ${oldModel.operation}
            AND is_current = true
        `;
      }
    }

    for (const model of configs) {
      const oldModel = currentByKey.get(modelKey(model));
      if (oldModel && sameConfig(oldModel, model)) continue;
      const nextVersion = oldModel
        ? Number(oldModel.configVersion) + 1
        : Number((await transaction<{ version: number }[]>`
          SELECT COALESCE(MAX(config_version), 0) + 1 AS version FROM generation_models
          WHERE provider_id = ${model.providerId} AND model_id = ${model.modelId}
            AND model_version = ${model.modelVersion} AND operation = ${model.operation}
        `)[0].version);
      if (oldModel) {
        await transaction`
          UPDATE generation_models SET is_current = false, updated_at = now()
          WHERE provider_id = ${model.providerId} AND model_id = ${model.modelId}
            AND model_version = ${model.modelVersion} AND operation = ${model.operation}
            AND is_current = true
        `;
      }
      await transaction`
        INSERT INTO generation_models (
          id, provider_id, provider_label, channel_kind, region, protocol, endpoint, credential_env,
          model_id, model_version, operation, capabilities, cost_reference, credit_price, verified_at, adapter_version,
          published, config_version, is_current
        ) VALUES (
          ${randomUUID()}, ${model.providerId}, ${model.providerLabel}, ${model.channelKind}, ${model.region},
          ${model.protocol}, ${model.endpoint}, ${model.credentialEnv}, ${model.modelId}, ${model.modelVersion},
          ${model.operation}, ${JSON.stringify(model.capabilities)}::text::jsonb,
          ${JSON.stringify(model.costReference)}::text::jsonb, ${model.creditPrice}, ${model.verifiedAt}, ${model.adapterVersion},
          ${model.published}, ${nextVersion}, true
        )
      `;
    }
  });
}
