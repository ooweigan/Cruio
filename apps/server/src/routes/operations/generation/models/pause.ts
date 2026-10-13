import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { appendModelRevision, recordModelEvent, requireModelOperator } from "@/utils/generation/modelGovernance";
import { fail, verifyPassword, type User } from "@/utils/operations/access";

const schema = z.object({ modelRevisionId: z.string().uuid(), configVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500), currentPassword: z.string().min(8).max(256) });

export function createOperationsGenerationModelPauseRoute(database: Database) {
  return Router().post("/pause", validateFields(schema.shape), async (request, response) => {
    const operator = response.locals.user as User;
    const body = schema.parse(request.body);
    await verifyPassword(database, operator.id, body.currentPassword);
    const model = await database.begin(async transaction => {
      await requireModelOperator(database, operator, transaction);
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      const current = await transaction<{ published: boolean; configVersion: number }[]>`
        SELECT published, config_version AS "configVersion" FROM generation_models WHERE id = ${body.modelRevisionId} AND is_current = true FOR UPDATE
      `;
      if (!current[0]?.published || Number(current[0].configVersion) !== body.configVersion) throw fail(409, "只能暂停当前已发布的映射。");
      const appended = await appendModelRevision(transaction, body.modelRevisionId, false);
      await recordModelEvent(transaction, operator.id, "paused", appended.id, null,
        { configVersion: appended.configVersion, reason: body.reason });
      return { id: appended.id, configVersion: appended.configVersion, isCurrent: true, published: false };
    });
    return response.status(201).json({ model });
  });
}
