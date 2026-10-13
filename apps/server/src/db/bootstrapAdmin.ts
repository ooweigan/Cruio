import { randomUUID } from "node:crypto";
import { createDatabase } from "./database";

const [userId, expiresAtValue, ...reasonParts] = process.argv.slice(2);
const reason = reasonParts.join(" ").trim();
if (process.env.NODE_ENV !== "dev" || process.env.CRUIO_ALLOW_LOCAL_ADMIN_BOOTSTRAP !== "true") {
  throw new Error("仅在 NODE_ENV=dev 且 CRUIO_ALLOW_LOCAL_ADMIN_BOOTSTRAP=true 时允许引导本地管理员。");
}
if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
  || !expiresAtValue || !reason || reason.length > 500) {
  throw new Error("用法：bun src/db/bootstrapAdmin.ts <本地用户UUID> <到期时间ISO8601> <授权理由>");
}
const expiresAt = new Date(expiresAtValue);
if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("到期时间必须晚于当前时间。");

const database = await createDatabase();
try {
  await database.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
    const users = await transaction`SELECT id FROM users WHERE id = ${userId}`;
    if (!users[0]) throw new Error("指定用户不存在；此命令不会创建或自动授权账户。");
    const existing = await transaction`
      SELECT id FROM staff_role_grants WHERE role = 'admin' AND revoked_at IS NULL AND expires_at > now() LIMIT 1
    `;
    if (existing.length) throw new Error("已有有效管理员；此引导命令只用于首次本地管理员授权。");
    await transaction`
      INSERT INTO staff_role_grants (id, user_id, role, scope_kind, scope_user_id, expires_at, reason)
      VALUES (${randomUUID()}, ${userId}, 'admin', 'global', NULL, ${expiresAt}, ${reason})
    `;
  });
  console.log(`本地管理员授权已记录：${userId}，到期 ${expiresAt.toISOString()}。`);
} finally {
  await database.close();
}
