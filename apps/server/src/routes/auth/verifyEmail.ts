import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

export function createAuthVerifyEmailRoute(database: Database) {
  return Router().post("/", validateFields({ token: z.string().min(32).max(128), password: z.string().min(8).max(256) }), async (request: Request, response) => {
    const { token, password } = request.body as { token: string; password: string };
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`verifyEmail:${ip}`, 8, 15 * 60 * 1000)) {
      return response.status(429).json({ message: "请求过于频繁，请稍后重试。" });
    }
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const activated = await auth.completeAuthToken({ database, tokenHash: auth.hashAuthToken(token), purpose: "emailVerification", passwordHash });
    if (!activated.success) return response.status(400).json({ message: "验证链接已失效或已使用，请重新申请验证邮件。" });
    return response.json({ message: "邮箱验证完成，请使用刚设置的密码登录。" });
  });
}
