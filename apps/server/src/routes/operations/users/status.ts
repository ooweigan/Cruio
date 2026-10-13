import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { recordAuthSecurityEvent } from "@/utils/auth";
import { fail, requireRole, verifyPassword, type User } from "@/utils/operations/access";

const schema = z.object({ userId: z.string().uuid(), disabled: z.boolean(), reason: z.string().trim().min(1).max(500), currentPassword: z.string().min(8).max(256) });

export default function createUserStatusRoute(database: Database) {
  return Router().post("/", validateFields(schema.shape), async (request, response) => {
    const operator = response.locals.user as User;
    const input = schema.parse(request.body);
    await requireRole(database, operator, "admin");
    await verifyPassword(database, operator.id, input.currentPassword);
    if (input.disabled && input.userId === operator.id) throw fail(409, "不能停用当前登录账号。");
    const user = await database.begin(async transaction => {
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      await requireRole(database, operator, "admin", undefined, transaction);
      const users = await transaction`SELECT id, disabled_at FROM users WHERE id = ${input.userId} FOR UPDATE`;
      if (!users[0]) throw fail(404, "用户不存在。");
      if (Boolean(users[0].disabled_at) === input.disabled) throw fail(409, "用户状态已变化，请刷新后操作。");
      const rows = await transaction`UPDATE users SET disabled_at = ${input.disabled ? new Date() : null} WHERE id = ${input.userId}
        RETURNING id, email, disabled_at AS "disabledAt"`;
      if (input.disabled) await transaction`DELETE FROM sessions WHERE user_id = ${input.userId}`;
      await recordAuthSecurityEvent({ database: transaction as Database, actorUserId: operator.id, subjectUserId: input.userId,
        eventType: input.disabled ? "userDisabled" : "userEnabled", outcome: "success", details: { reason: input.reason } });
      return rows[0];
    });
    response.json(success({ user }));
  });
}
