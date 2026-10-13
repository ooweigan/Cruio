import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, verifyPassword } from "@/utils/operations/access";
import { uuidPattern } from "@/utils/privacy/requests";

type User = { id: string };

export function createPrivacyRequestSupplementRoute(database: Database) {
  return Router().post("/requests/:requestId/supplements", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const requestId = request.params.requestId;
    const body = request.body ?? {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const idempotencyKey = body.idempotencyKey;
    if (!user?.id) throw fail(401, "请先登录。");
    if (typeof requestId !== "string" || !uuidPattern.test(requestId)) throw fail(404, "隐私申请不存在。");
    if (message.length < 10 || message.length > 3000 || typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey)) {
      throw fail(400, "补充内容或幂等标识无效。");
    }
    await verifyPassword(database, user.id, body.currentPassword);
    const result = await database.begin(async transaction => {
      const requests = await transaction<{ status: string }[]>`
        SELECT status FROM privacy_requests WHERE id = ${requestId} AND owner_id = ${user.id} FOR UPDATE
      `;
      if (!requests[0]) throw fail(404, "隐私申请不存在。");
      const prior = await transaction<{ details: { message?: string } }[]>`
        SELECT details FROM privacy_request_events WHERE request_id = ${requestId} AND actor_id = ${user.id}
          AND idempotency_key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].details?.message !== message) throw fail(409, "幂等标识已用于其他补充内容。");
        return { idempotent: true };
      }
      if (["completed", "partiallyRefused", "closed"].includes(requests[0].status)) throw fail(409, "申请已结束，不能继续补充。");
      await transaction`
        INSERT INTO privacy_request_events (id, request_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${requestId}, ${user.id}, 'user', 'userSupplement', 'user', ${idempotencyKey},
          ${JSON.stringify({ message })}::text::jsonb)
      `;
      await transaction`
        UPDATE privacy_requests SET status = CASE WHEN status = 'awaitingUser' THEN 'received' ELSE status END,
          updated_at = now() WHERE id = ${requestId}
      `;
      return { idempotent: false };
    });
    return response.json({ message: result.idempotent ? "该补充内容已记录。" : "补充内容已记录。", idempotent: result.idempotent });
  });
}
