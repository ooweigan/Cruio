import { Router, type Request } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import * as auth from "@/utils/auth";

const genericMessage = "如果该邮箱对应已验证账户，密码重设说明会发送到该邮箱。";

export function createAuthPasswordResetRequestRoute(input: { database: Database; dataDirectory: string }) {
  const { database, dataDirectory } = input;
  return Router().post("/", validateFields({ email: z.string().trim().email().max(254) }), async (request: Request, response) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    if (!auth.authEmailReady(dataDirectory)) return response.status(503).json({ message: "当前环境未配置邮箱投递，暂时无法处理密码重设。" });
    const ip = request.ip || "unknown";
    if (!auth.takeAuthRateLimit(`passwordReset:${ip}`, 10, 15 * 60 * 1000)
      || !auth.takeAuthRateLimit(`passwordReset:${ip}:${email}`, 4, 60 * 60 * 1000)) {
      return response.status(429).json({ message: "请求过于频繁，请稍后重试。" });
    }
    const users = await database<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${email} AND email_verified_at IS NOT NULL
    `;
    let subject = "Cruio 密码重设请求";
    let text = `如果你并未请求重设密码，请忽略此邮件。你也可以返回登录：${auth.authEmailLink("login")}`;
    if (users[0]) {
      const token = await auth.saveAuthToken(database, users[0].id, "passwordReset", new Date(Date.now() + 20 * 60 * 1000));
      if (token) text = `请在 20 分钟内使用此链接重设密码：${auth.authEmailLink("passwordReset", token)}\n如果你并未请求重设密码，请忽略此邮件。`;
    }
    try {
      const delivery = await auth.sendAuthEmail({ dataDirectory, to: email, subject, text });
      return response.status(202).json({ message: delivery === "outbox" ? "请求已写入本地开发邮件箱；如存在已验证账户，请使用邮件重设密码。" : genericMessage });
    } catch {
      return response.status(503).json({ message: "暂时无法提交密码重设邮件，请稍后重试。" });
    }
  });
}
