import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit } from "@/utils/operations/access";
import { isValidPrivacyTimestamp, uuidPattern } from "@/utils/privacy/requests";

type User = { id: string; email: string };

export function createOperationsPrivacyRequestListRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const grants = await database<{ id: string }[]>`
      SELECT id FROM staff_role_grants WHERE user_id = ${user.id} AND role = 'privacyOperator'
        AND revoked_at IS NULL AND expires_at > clock_timestamp() LIMIT 1
    `;
    if (!grants[0]) throw fail(403, "当前账户没有隐私申请核查权限。");
    const limit = parseLimit(request.query.limit, 25, 100);
    if (!limit) throw fail(400, "分页数量无效。");
    const cursorTime = request.query.updatedAt;
    const cursorId = request.query.id;
    if ((cursorTime === undefined) !== (cursorId === undefined)
      || (cursorTime !== undefined && (typeof cursorTime !== "string" || !isValidPrivacyTimestamp(cursorTime)
        || typeof cursorId !== "string" || !uuidPattern.test(cursorId)))) {
      throw fail(400, "分页游标无效。");
    }
    const status = request.query.status;
    const category = request.query.category;
    const statuses = ["received", "identityReview", "awaitingUser", "processing", "partiallyCompleted", "completed", "partiallyRefused", "appealReview", "closed"];
    if (status !== undefined && (typeof status !== "string" || !statuses.includes(status))) throw fail(400, "申请状态无效。");
    if (category !== undefined && (typeof category !== "string" || !["access", "copy", "correction", "supplement", "deletion", "restriction", "explanation", "accountClosure"].includes(category))) throw fail(400, "申请类别无效。");
    const rows = await database<{ id: string; number: string; ownerId: string; category: string; status: string; subject: string; createdAt: string; updatedAt: string }[]>`
      SELECT request.id, request.number, request.owner_id AS "ownerId", request.category, request.status,
        request.subject, request.created_at::text AS "createdAt", request.updated_at::text AS "updatedAt"
      FROM privacy_requests AS request
      WHERE (${status ?? null}::text IS NULL OR request.status = ${status ?? null})
        AND (${category ?? null}::text IS NULL OR request.category = ${category ?? null})
        AND (${cursorTime ?? null}::timestamptz IS NULL OR (request.updated_at, request.id) < (${cursorTime ?? null}::timestamptz, ${cursorId ?? null}::uuid))
        AND EXISTS (
          SELECT 1 FROM staff_role_grants AS grantRow
          WHERE grantRow.user_id = ${user.id} AND grantRow.role = 'privacyOperator'
            AND grantRow.revoked_at IS NULL AND grantRow.expires_at > clock_timestamp()
            AND (grantRow.scope_kind = 'global' OR (grantRow.scope_kind = 'user' AND grantRow.scope_user_id = request.owner_id))
        )
      ORDER BY request.updated_at DESC, request.id DESC LIMIT ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const requests = hasMore ? rows.slice(0, limit) : rows;
    const last = requests.at(-1);
    return response.json({ requests, nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null });
  });
}
