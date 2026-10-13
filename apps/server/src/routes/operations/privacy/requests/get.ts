import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, requireRole } from "@/utils/operations/access";
import { uuidPattern } from "@/utils/privacy/requests";

type User = { id: string; email: string };

export function createOperationsPrivacyRequestGetRoute(database: Database) {
  return Router().get("/:requestId", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const requestId = request.params.requestId;
    if (!uuidPattern.test(requestId)) throw fail(400, "申请编号无效。");
    const result = await database.begin(async transaction => {
      const rows = await transaction<{ id: string; ownerId: string }[]>`
        SELECT id, owner_id AS "ownerId" FROM privacy_requests WHERE id = ${requestId} FOR SHARE
      `;
      if (!rows[0]) throw fail(404, "隐私申请不存在。");
      try {
        await requireRole(transaction, user, "privacyOperator", rows[0].ownerId, transaction);
      } catch (error) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 403) throw fail(404, "隐私申请不存在。");
        throw error;
      }
      const requests = await transaction`
        SELECT id, number, owner_id AS "ownerId", category, status, subject, description,
          created_at::text AS "createdAt", updated_at::text AS "updatedAt", closed_at::text AS "closedAt"
        FROM privacy_requests WHERE id = ${requestId}
      `;
      const objects = await transaction`
        SELECT id, object_type AS "objectType", source_id AS "sourceId", requested_action AS "requestedAction",
          status, reason_code AS "reasonCode", user_reason AS "userReason", internal_reason AS "internalReason",
          evidence_ref AS "evidenceRef", created_at::text AS "createdAt", updated_at::text AS "updatedAt"
        FROM privacy_request_objects WHERE request_id = ${requestId} ORDER BY created_at, id
      `;
      const timeline = await transaction`
        SELECT id, object_id AS "objectId", actor_role AS "actorRole", event_type AS "eventType",
          visibility, details, created_at::text AS "createdAt"
        FROM privacy_request_events WHERE request_id = ${requestId} ORDER BY created_at, id
      `;
      return { request: requests[0], objects, timeline };
    });
    return response.json(result);
  });
}
