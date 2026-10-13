import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { fail, requireRole, verifyPassword, type User } from "@/utils/operations/access";
import { validateFields } from "@/lib/middleware";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsRolesRevokeRoute(database: Database) {
  return Router().post("/:grantId/revoke", validateFields({
    reason: z.string().min(1).max(500), currentPassword: z.string().min(8).max(256),
  }), async (request, response) => {
    const operator = response.locals.user as User;
    const { reason, currentPassword } = request.body ?? {};
    const grantId = typeof request.params.grantId === "string" ? request.params.grantId : "";
    if (!idPattern.test(grantId) || typeof reason !== "string" || !reason.trim() || reason.length > 500) {
      throw fail(400, "撤权信息无效。");
    }
    await verifyPassword(database, operator.id, currentPassword);
    const result = await database.begin(async transaction => {
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      await requireRole(database, operator, "admin", undefined, transaction);
      const targets = await transaction`SELECT role FROM staff_role_grants WHERE id = ${grantId} AND revoked_at IS NULL FOR UPDATE`;
      if (targets[0]?.role === "admin") {
        const remaining = await transaction`SELECT grants.id FROM staff_role_grants grants JOIN users ON users.id = grants.user_id
          WHERE grants.role = 'admin' AND grants.scope_kind = 'global' AND grants.revoked_at IS NULL
            AND grants.expires_at > clock_timestamp() AND users.disabled_at IS NULL AND grants.id <> ${grantId} LIMIT 1`;
        if (!remaining.length) throw fail(409, "不能撤销最后一位有效管理员的岗位。");
      }
      const grants = await transaction`
        UPDATE staff_role_grants SET revoked_at = now(), revoked_by = ${operator.id}, revoke_reason = ${reason.trim()}
        WHERE id = ${grantId} AND revoked_at IS NULL RETURNING id, revoked_at AS "revokedAt"
      `;
      return grants[0] ?? null;
    });
    if (!result) throw fail(404, "有效岗位授权不存在。");
    return response.json({ grant: result });
  });
}
