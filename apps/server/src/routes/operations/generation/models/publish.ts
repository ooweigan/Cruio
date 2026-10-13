import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { appendModelRevision, recordModelEvent, requireModelOperator } from "@/utils/generation/modelGovernance";
import { fail, verifyPassword, type User } from "@/utils/operations/access";

const schema = z.object({ modelRevisionId: z.string().uuid(), configVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500), currentPassword: z.string().min(8).max(256) });

export function createOperationsGenerationModelPublishRoute(database: Database) {
  return Router().post("/publish", validateFields(schema.shape), async (request, response) => {
    const operator = response.locals.user as User;
    const body = schema.parse(request.body);
    await verifyPassword(database, operator.id, body.currentPassword);
    const result = await database.begin(async transaction => {
      await requireModelOperator(database, operator, transaction);
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      const currentRows = await transaction<{ credentialEnv: string; configVersion: number }[]>`
        SELECT credential_env AS "credentialEnv", config_version AS "configVersion" FROM generation_models
        WHERE id = ${body.modelRevisionId} AND is_current = true AND published = false FOR UPDATE
      `;
      const current = currentRows[0];
      if (!current || Number(current.configVersion) !== body.configVersion) throw fail(409, "只能发布当前未发布的模型修订。");
      if (!process.env[current.credentialEnv]) throw fail(409, "服务端未配置该凭据引用，不能发布。");
      const appended = await appendModelRevision(transaction, body.modelRevisionId, true);
      await recordModelEvent(transaction, operator.id, "published", appended.id, null,
        { configVersion: appended.configVersion, reason: body.reason });
      return { id: appended.id, configVersion: appended.configVersion, isCurrent: true, published: true };
    });
    return response.status(201).json({ model: result });
  });
}
