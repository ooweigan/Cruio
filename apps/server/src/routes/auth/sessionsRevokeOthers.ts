import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

export function createAuthRevokeOtherSessionsRoute(database: Database) {
  return Router().post("/", validateFields({ currentPassword: z.string().min(1).max(256) }), async (request: Request, response) => {
    const session = await auth.currentSession(database, request);
    if (!session) return response.status(401).json({ message: "请先登录。" });
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`revokeOtherSessions:${ip}`, 10, 15 * 60 * 1000)) {
      return response.status(429).json({ message: "操作过于频繁，请稍后重试。" });
    }
    const revokedCount = await database.begin(async transaction => {
      const users = await transaction<{ passwordHash: string; emailVerifiedAt: Date | null }[]>`
        SELECT password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt"
        FROM users WHERE id = ${session.userId} FOR UPDATE
      `;
      const currentSessions = await transaction<{ id: string }[]>`
        SELECT id FROM sessions WHERE id = ${session.id} AND user_id = ${session.userId}
          AND expires_at > clock_timestamp() FOR UPDATE
      `;
      if (!users[0]?.emailVerifiedAt || !currentSessions[0]) {
        await auth.recordAuthSecurityEvent({ database: transaction as Database, actorUserId: session.userId, subjectUserId: session.userId, eventType: "sessionRevokeOthers", outcome: "denied" });
        return null;
      }
      if (!(await Bun.password.verify(request.body.currentPassword, users[0].passwordHash))) {
        await auth.recordAuthSecurityEvent({ database: transaction as Database, actorUserId: session.userId, subjectUserId: session.userId, eventType: "sessionRevokeOthers", outcome: "denied" });
        return -1;
      }
      const removed = await transaction<{ id: string }[]>`
        DELETE FROM sessions WHERE user_id = ${session.userId} AND id <> ${session.id} RETURNING id
      `;
      await auth.recordAuthSecurityEvent({ database: transaction as Database, actorUserId: session.userId, subjectUserId: session.userId, eventType: "sessionRevokeOthers", outcome: "success", details: { revokedCount: removed.length } });
      return removed.length;
    });
    if (revokedCount === null) return response.status(401).json({ message: "当前登录会话已失效，请重新登录。" });
    if (revokedCount < 0) return response.status(403).json({ message: "当前密码不正确。" });
    return response.json({ revokedCount });
  });
}
