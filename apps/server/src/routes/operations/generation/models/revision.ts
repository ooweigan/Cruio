import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { parseGenerationModelConfig } from "@/utils/generation/models";
import { recordModelEvent, requireModelOperator } from "@/utils/generation/modelGovernance";
import { fail, verifyPassword, type User } from "@/utils/operations/access";

const schema = z.object({
  baseRevisionId: z.string().uuid().optional(), currentPassword: z.string().min(8).max(256),
  mapping: z.record(z.string(), z.unknown()),
});

export function createOperationsGenerationModelRevisionRoute(database: Database) {
  return Router().post("/revision", validateFields(schema.shape), async (request, response) => {
    const operator = response.locals.user as User;
    const { baseRevisionId, currentPassword, mapping } = schema.parse(request.body);
    await verifyPassword(database, operator.id, currentPassword);
    const config = parseGenerationModelConfig({ ...mapping, credentialEnv: mapping.credentialRef ?? mapping.credentialEnv,
      verifiedAt: new Date().toISOString(), published: false });
    if (!config) throw fail(400, "模型映射配置无效或不受当前适配器支持。");
    const model = await database.begin(async transaction => {
      await requireModelOperator(database, operator, transaction);
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      const baseRows = baseRevisionId ? await transaction<{ id: string; providerId: string; modelId: string; modelVersion: string; operation: string; isCurrent: boolean }[]>`
        SELECT id, provider_id AS "providerId", model_id AS "modelId", model_version AS "modelVersion",
          operation, is_current AS "isCurrent" FROM generation_models WHERE id = ${baseRevisionId} FOR UPDATE
      ` : [];
      const base = baseRows[0];
      if (baseRevisionId && (!base || !base.isCurrent)) throw fail(409, "基础映射已发生变化，请刷新后重试。");
      if (base && (base.providerId !== config.providerId || base.modelId !== config.modelId
        || base.modelVersion !== config.modelVersion || base.operation !== config.operation)) {
        throw fail(400, "修订必须保留映射身份；更换映射请新建独立映射。");
      }
      const currentRows = await transaction<{ id: string; configVersion: number }[]>`
        SELECT id, config_version AS "configVersion" FROM generation_models
        WHERE provider_id = ${config.providerId} AND model_id = ${config.modelId}
          AND model_version = ${config.modelVersion} AND operation = ${config.operation}
        ORDER BY config_version DESC FOR UPDATE
      `;
      const current = currentRows.find(row => row.id === base?.id);
      if (!base && currentRows.some(row => row.id)) throw fail(409, "该映射已经存在，请基于当前版本创建修订。");
      if (base) await transaction`UPDATE generation_models SET is_current = false, updated_at = now() WHERE id = ${base.id} AND is_current = true`;
      const configVersion = (currentRows[0] ? Number(currentRows[0].configVersion) : 0) + 1;
      if (current && Number(current.configVersion) !== Number(currentRows[0].configVersion)) throw fail(409, "基础映射版本已变化。");
      const id = randomUUID();
      await transaction`
        INSERT INTO generation_models (id, provider_id, provider_label, channel_kind, region, protocol, endpoint, credential_env,
          model_id, model_version, operation, capabilities, cost_reference, credit_price, verified_at, adapter_version,
          published, config_version, is_current)
        VALUES (${id}, ${config.providerId}, ${config.providerLabel}, ${config.channelKind}, ${config.region}, ${config.protocol},
          ${config.endpoint}, ${config.credentialEnv}, ${config.modelId}, ${config.modelVersion}, ${config.operation},
          ${JSON.stringify(config.capabilities)}::text::jsonb, ${JSON.stringify(config.costReference)}::text::jsonb,
          ${config.creditPrice}, ${config.verifiedAt}, ${config.adapterVersion}, false, ${configVersion}, true)
      `;
      await recordModelEvent(transaction, operator.id, "revisionCreated", id, null, { configVersion });
      return { id, configVersion, published: false, isCurrent: true };
    });
    return response.status(201).json({ model });
  });
}
