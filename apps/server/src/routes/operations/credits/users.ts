import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit, type User } from "@/utils/operations/access";

export function createOperationsCreditsUsersRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const operator = response.locals.user as User;
    const query = typeof request.query.query === "string" ? request.query.query.trim().toLowerCase() : "";
    const userId = typeof request.query.userId === "string" ? request.query.userId : null;
    const limit = parseLimit(request.query.limit, 20, 50);
    if (!limit) throw fail(400, "用户查询数量无效。");
    const grants = await database<{ scopeKind: string; scopeUserId: string | null }[]>`
      SELECT scope_kind AS "scopeKind", scope_user_id AS "scopeUserId"
      FROM staff_role_grants WHERE user_id = ${operator.id} AND role = 'creditOperator'
        AND revoked_at IS NULL AND expires_at > now()
    `;
    if (!grants.length) throw fail(403, "当前账户没有积分运营权限。");
    const global = grants.some(grant => grant.scopeKind === "global");
    const scopedUserIds = new Set(grants.map(grant => grant.scopeUserId).filter((id): id is string => Boolean(id)));
    if (userId && !global && !scopedUserIds.has(userId)) throw fail(404, "用户不存在。");
    const search = query ? `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null;
    const rows = await database<{ id: string; email: string; balance: string; reserved: string }[]>`
      SELECT users.id, users.email, COALESCE(accounts.balance, 0) AS balance, COALESCE(accounts.reserved, 0) AS reserved
      FROM users LEFT JOIN credit_accounts AS accounts ON accounts.user_id = users.id
      WHERE (${userId}::uuid IS NULL OR users.id = ${userId}::uuid)
        AND (${search}::text IS NULL OR users.email ILIKE ${search} ESCAPE '\\')
        AND (${global} OR EXISTS (
          SELECT 1 FROM staff_role_grants AS scoped
          WHERE scoped.user_id = ${operator.id} AND scoped.role = 'creditOperator' AND scoped.scope_kind = 'user'
            AND scoped.scope_user_id = users.id AND scoped.revoked_at IS NULL AND scoped.expires_at > clock_timestamp()
        ))
      ORDER BY users.email LIMIT ${limit}
    `;
    return response.json({ users: rows.map(row => {
      const balance = Number(row.balance); const reserved = Number(row.reserved);
      return { id: row.id, email: row.email, account: { balance, reserved, available: Math.max(0, balance - reserved), debt: Math.max(0, -balance) } };
    }) });
  });
}
