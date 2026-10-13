import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

const dummyPasswordHash = Bun.password.hash(randomUUID(), { algorithm: "argon2id" });

export function createAuthLoginRoute(database: Database) {
  return Router().post("/", validateFields({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }), async (request: Request, response) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    const password = request.body?.password;
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`login:${ip}`, 20, 15 * 60 * 1000)
      || !auth.takeAuthRateLimit(`login:${ip}:${email}`, 10, 15 * 60 * 1000)) {
      return response.status(429).json({ message: "登录暂时不可用，请稍后重试。" });
    }
    const users = await database<{ id: string; email: string; passwordHash: string }[]>`
      SELECT id, email, password_hash AS "passwordHash" FROM users WHERE email = ${email}
    `;
    const user = users[0];
    const matches = await Bun.password.verify(password, user?.passwordHash ?? await dummyPasswordHash);
    if (!user || !matches) return response.status(401).json({ message: "邮箱或密码不正确。" });
    const session = await database.begin(async transaction => {
      const currentUsers = await transaction<{ id: string; email: string; passwordHash: string }[]>`
        SELECT id, email, password_hash AS "passwordHash"
        FROM users WHERE id = ${user.id} AND disabled_at IS NULL FOR UPDATE
      `;
      const currentUser = currentUsers[0];
      if (!currentUser) return null;
      if (currentUser.passwordHash !== user.passwordHash && !(await Bun.password.verify(password, currentUser.passwordHash))) return null;
      return auth.createSession(transaction, currentUser.id, request.get("user-agent") ?? null);
    });
    if (!session) return response.status(401).json({ message: "邮箱或密码不正确。" });
    auth.setSessionCookie(response, session.token);
    return response.json({ user: { id: user.id, email: user.email } });
  });
}
