import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { fail, requireRole, verifyPassword, type User } from "@/utils/operations/access";
import { validateFields } from "@/lib/middleware";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsRolesGrantRoute(database: Database) {
  return Router().post("/", validateFields({
    userId: z.string().uuid(), role: z.enum(["admin", "creditOperator", "modelOperator", "support", "privacyOperator"]), scopeKind: z.enum(["global", "user"]),
    scopeUserId: z.string().uuid().optional(), expiresAt: z.string().min(1).max(80), reason: z.string().min(1).max(500),
    currentPassword: z.string().min(8).max(256),
  }), async (request, response) => {
    const operator = response.locals.user as User;
    const { userId, role, scopeKind, scopeUserId, expiresAt, reason, currentPassword } = request.body ?? {};
    if (!idPattern.test(userId ?? "") || !["admin", "creditOperator", "modelOperator", "support", "privacyOperator"].includes(role)
      || !["global", "user"].includes(scopeKind) || typeof reason !== "string" || !reason.trim() || reason.length > 500) {
      throw fail(400, "授权信息无效。");
    }
    if ((role === "admin" && scopeKind !== "global") || (scopeKind === "user" && !idPattern.test(scopeUserId ?? ""))) {
      throw fail(400, "岗位授权范围无效。");
    }
    const expires = new Date(expiresAt);
    if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) throw fail(400, "授权到期时间必须晚于当前时间。");
    await verifyPassword(database, operator.id, currentPassword);
    const grant = await database.begin(async transaction => {
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      await requireRole(database, operator, "admin", undefined, transaction);
      const targets = await transaction`SELECT id FROM users WHERE id = ${userId} AND disabled_at IS NULL FOR SHARE`;
      if (!targets[0]) throw fail(409, "用户不存在或已停用，不能授予岗位。");
      if (scopeKind === "user") {
        const scopes = await transaction`SELECT id FROM users WHERE id = ${scopeUserId} FOR SHARE`;
        if (!scopes[0]) throw fail(400, "授权范围内的用户不存在。");
      }
      const existing = await transaction`
        SELECT id FROM staff_role_grants
        WHERE user_id = ${userId} AND role = ${role} AND scope_kind = ${scopeKind}
          AND scope_user_id IS NOT DISTINCT FROM ${scopeKind === "user" ? scopeUserId : null}::uuid
          AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE
      `;
      if (existing.length) throw fail(409, "该用户已有相同范围的有效岗位授权。");
      const rows = await transaction`
        INSERT INTO staff_role_grants
          (id, user_id, role, scope_kind, scope_user_id, expires_at, reason, granted_by)
        VALUES (${randomUUID()}, ${userId}, ${role}, ${scopeKind}, ${scopeKind === "user" ? scopeUserId : null}, ${expires}, ${reason.trim()}, ${operator.id})
        RETURNING id, user_id AS "userId", role, scope_kind AS "scopeKind", scope_user_id AS "scopeUserId", expires_at AS "expiresAt", reason
      `;
      return rows[0];
    });
    return response.status(201).json({ grant });
  });
}
