import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

const genericMessage = "如果该邮箱需要验证，请查收验证说明；其他情况下可直接登录。";

export function createAuthResendVerificationRoute(input: { database: Database; dataDirectory: string }) {
  const { database, dataDirectory } = input;
  return Router().post("/", validateFields({ email: z.string().trim().email().max(254) }), async (request: Request, response) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    if (!auth.authEmailReady(dataDirectory)) return response.status(503).json({ message: "当前环境未配置邮箱投递，暂时无法完成邮箱验证。" });
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`resendVerification:${ip}`, 10, 15 * 60 * 1000)
      || !auth.takeAuthRateLimit(`resendVerification:${ip}:${email}`, 4, 60 * 60 * 1000)) {
      return response.status(429).json({ message: "请求过于频繁，请稍后重试。" });
    }
    const users = await database<{ id: string; emailVerifiedAt: Date | null }[]>`
      SELECT id, email_verified_at AS "emailVerifiedAt" FROM users WHERE email = ${email}
    `;
    let subject = "Cruio 账户验证请求";
    let text = `如你已有 Cruio 账户，可在此登录：${auth.authEmailLink("login")}\n如果并非你本人操作，请忽略此邮件。`;
    if (users[0] && !users[0].emailVerifiedAt) {
      const token = await auth.saveAuthToken(database, users[0].id, "emailVerification", new Date(Date.now() + 30 * 60 * 1000));
      if (token) {
        subject = "验证你的 Cruio 邮箱";
        text = `请在 30 分钟内打开此链接，验证邮箱并设置账户密码：${auth.authEmailLink("verifyEmail", token)}\n如果并非你本人操作，请忽略此邮件。`;
      }
    }
    try {
      const delivery = await auth.sendAuthEmail({ dataDirectory, to: email, subject, text });
      return response.status(202).json({ message: delivery === "outbox" ? "请求已写入本地开发邮件箱；请使用开发邮件完成验证。" : genericMessage });
    } catch {
      return response.status(503).json({ message: "暂时无法提交验证邮件，请稍后重试。" });
    }
  });
}
