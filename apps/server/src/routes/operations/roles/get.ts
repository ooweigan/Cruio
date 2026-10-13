import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit, requireRole, type User } from "@/utils/operations/access";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsRolesGetRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const operator = response.locals.user as User;
    await requireRole(database, operator, "admin");
    const userId = typeof request.query.userId === "string" ? request.query.userId : "";
    if (!idPattern.test(userId)) throw fail(400, "用户编号无效。");
    const limit = parseLimit(request.query.limit, 50, 100);
    if (!limit) throw fail(400, "授权记录查询数量无效。");
    const grants = await database`
      SELECT grants.id, grants.user_id AS "userId", grants.role, grants.scope_kind AS "scopeKind",
        grants.scope_user_id AS "scopeUserId", grants.expires_at AS "expiresAt", grants.reason,
        grants.granted_by AS "grantedBy", grants.revoked_at AS "revokedAt", grants.revoked_by AS "revokedBy",
        grants.revoke_reason AS "revokeReason", grants.created_at AS "createdAt"
      FROM staff_role_grants AS grants WHERE grants.user_id = ${userId}::uuid ORDER BY grants.created_at DESC LIMIT ${limit}
    `;
    return response.json({ grants });
  });
}
