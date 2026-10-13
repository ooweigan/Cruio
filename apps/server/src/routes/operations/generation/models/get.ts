import { Router } from "express";
import type { Database } from "@/db/database";
import { requireModelOperator } from "@/utils/generation/modelGovernance";
import { hasRole, type User } from "@/utils/operations/access";

type ModelRow = { id: string; providerId: string; providerLabel: string; channelKind: string; region: string; protocol: string;
  endpoint: string; credentialRef: string; modelId: string; modelVersion: string; operation: string; capabilities: unknown;
  costReference: unknown; creditPrice: number | null; configuredAt: Date; published: boolean; configVersion: number; isCurrent: boolean };

export function createOperationsGenerationModelsGetRoute(database: Database) {
  return Router().get("/", async (_request, response) => {
    const operator = response.locals.user as User;
    const canManage = Boolean(await hasRole(database, operator.id, "modelOperator"));
    if (!canManage && !(await hasRole(database, operator.id, "admin"))) await requireModelOperator(database, operator);
    const models = await database<ModelRow[]>`SELECT id, provider_id AS "providerId", provider_label AS "providerLabel", channel_kind AS "channelKind",
        region, protocol, endpoint, credential_env AS "credentialRef", model_id AS "modelId", model_version AS "modelVersion",
        operation, capabilities, cost_reference AS "costReference", credit_price AS "creditPrice", verified_at AS "configuredAt", published,
        config_version AS "configVersion", is_current AS "isCurrent"
        FROM generation_models ORDER BY provider_id, model_id, model_version, operation, config_version DESC`;
    return response.json({ models: canManage ? models : models.map(({ costReference, ...model }) => model), canManage });
  });
}
