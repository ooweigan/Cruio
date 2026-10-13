import { Router } from "express";
import type { Database } from "@/db/database";
import { currentSession } from "@/utils/auth";

export function createAuthSessionsRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const session = await currentSession(database, request);
    if (!session) return response.status(401).json({ message: "请先登录。" });
    const sessions = await database<{ id: string; userAgent: string | null; createdAt: Date; expiresAt: Date }[]>`
      SELECT id, user_agent AS "userAgent", created_at AS "createdAt", expires_at AS "expiresAt"
      FROM sessions WHERE user_id = ${session.userId} AND expires_at > now()
      ORDER BY created_at DESC
    `;
    return response.json({ sessions: sessions.map(item => ({ ...item, isCurrent: item.id === session.id })) });
  });
}
