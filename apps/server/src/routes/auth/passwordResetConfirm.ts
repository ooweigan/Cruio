import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

export function createAuthPasswordResetConfirmRoute(database: Database) {
  return Router().post("/", validateFields({ token: z.string().min(32).max(128), password: z.string().min(8).max(256) }), async (request: Request, response) => {
    const { token, password } = request.body as { token: string; password: string };
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`passwordResetConfirm:${ip}`, 8, 15 * 60 * 1000)) {
      return response.status(429).json({ message: "请求过于频繁，请稍后重试。" });
    }
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const reset = await auth.completeAuthToken({ database, tokenHash: auth.hashAuthToken(token), purpose: "passwordReset", passwordHash });
    if (!reset.success) return response.status(400).json({ message: "重设链接已失效或已使用，请重新申请。" });
    return response.json({ message: "密码已更新，其他活动会话已退出。请使用新密码登录。" });
  });
}
