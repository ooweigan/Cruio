import type { Database } from "@/db/database";

export type Role = "admin" | "creditOperator" | "modelOperator" | "support" | "privacyOperator";
export type User = { id: string; email: string };

export function fail(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export function parseLimit(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : null;
}

export async function hasRole(database: Database, userId: string, role: Role, targetUserId?: string, lock = false) {
  const rows = lock
    ? await database<{ id: string }[]>`
      SELECT id FROM staff_role_grants
      WHERE user_id = ${userId} AND role = ${role} AND revoked_at IS NULL AND expires_at > clock_timestamp()
        AND EXISTS (SELECT 1 FROM users WHERE users.id = ${userId} AND disabled_at IS NULL)
        AND (scope_kind = 'global' OR (scope_kind = 'user' AND scope_user_id = ${targetUserId ?? null}))
      ORDER BY scope_kind = 'global' DESC LIMIT 1 FOR SHARE
    `
    : await database<{ id: string }[]>`
      SELECT id FROM staff_role_grants
      WHERE user_id = ${userId} AND role = ${role} AND revoked_at IS NULL AND expires_at > clock_timestamp()
        AND EXISTS (SELECT 1 FROM users WHERE users.id = ${userId} AND disabled_at IS NULL)
        AND (scope_kind = 'global' OR (scope_kind = 'user' AND scope_user_id = ${targetUserId ?? null}))
      ORDER BY scope_kind = 'global' DESC LIMIT 1
    `;
  return rows[0]?.id ?? null;
}

export async function requireRole(database: Database, user: User, role: Role, targetUserId?: string, transaction?: Database) {
  const source = transaction ?? database;
  const grantId = await hasRole(source, user.id, role, targetUserId, Boolean(transaction));
  if (!grantId) throw fail(403, "当前账户没有执行此操作的有效岗位授权。");
  return grantId;
}

export async function verifyPassword(database: Database, userId: string, password: unknown) {
  if (typeof password !== "string" || password.length < 8 || password.length > 256) throw fail(400, "请重新确认当前账户密码。");
  const rows = await database<{ passwordHash: string }[]>`
    SELECT password_hash AS "passwordHash" FROM users WHERE id = ${userId}
  `;
  if (!rows[0] || !(await Bun.password.verify(password, rows[0].passwordHash))) throw fail(401, "当前账户密码不正确。");
}
