import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";
import { uuidPattern } from "@/utils/privacy/requests";

type User = { id: string };

export function createPrivacyRequestGetRoute(database: Database) {
  return Router().get("/requests/:requestId", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const requestId = request.params.requestId;
    if (!user?.id) throw fail(401, "请先登录。");
    if (typeof requestId !== "string" || !uuidPattern.test(requestId)) throw fail(404, "隐私申请不存在。");
    const rows = await database<{ id: string; number: string; category: string; status: string; subject: string; description: string;
      createdAt: string; updatedAt: string }[]>`
      SELECT id, number, category, status, subject, description,
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM privacy_requests WHERE id = ${requestId} AND owner_id = ${user.id}
    `;
    if (!rows[0]) throw fail(404, "隐私申请不存在。");
    const [objects, events] = await Promise.all([
      database<{ id: string; objectType: string; objectId: string | null; requestedAction: string; status: string;
        reasonCode: string | null; userReason: string | null; updatedAt: string }[]>`
        SELECT id, object_type AS "objectType", source_id AS "objectId", requested_action AS "requestedAction", status,
          reason_code AS "reasonCode", user_reason AS "userReason", updated_at::text AS "updatedAt"
        FROM privacy_request_objects WHERE request_id = ${requestId} ORDER BY created_at, id
      `,
      database<{ id: string; eventType: string; details: Record<string, unknown>; createdAt: string }[]>`
        SELECT id, event_type AS "eventType", details, created_at::text AS "createdAt"
        FROM privacy_request_events WHERE request_id = ${requestId} AND visibility = 'user' ORDER BY created_at, id
      `,
    ]);
    return response.json({ request: rows[0], objects, timeline: events });
  });
}
