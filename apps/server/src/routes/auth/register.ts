import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

export function createAuthRegisterRoute(input: { database: Database; dataDirectory?: string }) {
  const { database } = input;
  return Router().post("/", validateFields({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(256),
  }), async (request: Request, response) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    const password = request.body?.password as string;
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`register:${ip}`, 10, 15 * 60 * 1000)
      || !auth.takeAuthRateLimit(`register:${ip}:${email}`, 3, 60 * 60 * 1000)) {
      return response.status(429).json({ message: "请求过于频繁，请稍后重试。" });
    }
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const userId = randomUUID();
    const session = await database.begin(async transaction => {
      const users = await transaction<{ id: string; email: string }[]>`
        INSERT INTO users (id, email, password_hash) VALUES (${userId}, ${email}, ${passwordHash})
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email
      `;
      if (!users[0]) return null;
      const createdSession = await auth.createSession(transaction as Database, users[0].id, request.get("user-agent") ?? null);
      return { user: users[0], token: createdSession.token };
    });
    if (!session) return response.status(409).json({ message: "该邮箱已注册，请直接登录。" });
    auth.setSessionCookie(response, session.token);
    return response.status(201).json({ user: session.user });
  });
}
