import express from "express";
import type { ErrorRequestHandler, Request } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AccountErrorReason } from "@toonflow/server/accountProtocol";
import { accountSchema, hashPassword, tokenHash } from "./store";
import { createAdminRouter } from "./admin";
import type { AccountRecord, AccountStore } from "./store";
import { getNewApiWallet, redeemNewApiCode } from "./newApi";

function failure(status: number, reason: AccountErrorReason, message: string, retryAfter?: number) {
  return Object.assign(new Error(message), { status, reason, retryAfter });
}

export async function createApp(store: AccountStore) {
  const app = express();
  app.disable("x-powered-by");
  const trustedProxy = process.env.CRUIO_IDENTITY_TRUST_PROXY?.split(",").map(value => value.trim()).filter(Boolean);
  if (trustedProxy?.length) app.set("trust proxy", trustedProxy);
  const sessionHours = Number(process.env.CRUIO_IDENTITY_SESSION_HOURS ?? 8);
  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 168) throw new Error("会话时长须为 1–168 小时整数");
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  const attempts = new Map<string, { count: number; until: number }>();
  let activePasswords = 0;

  function limit(key: string, count: number, duration: number) {
    const now = Date.now();
    for (const [name, entry] of attempts) if (entry.until <= now) attempts.delete(name);
    const entry = attempts.get(key);
    if (entry && entry.count >= count || !entry && attempts.size >= 10000) {
      throw failure(429, "rateLimited", "操作过于频繁，请稍后重试。", Math.max(1, Math.ceil(((entry?.until ?? now + 60000) - now) / 1000)));
    }
    if (entry) entry.count += 1;
    else attempts.set(key, { count: 1, until: now + duration });
  }

  app.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    // 身份协议仍只供客户端内置服务调用；管理页面单独验证同源表单和管理会话。
    if (req.path.toLowerCase().startsWith("/api/account") && req.get("origin")) return next(failure(403, "forbidden", "此接口仅供账户服务连接使用。"));
    if (process.env.NODE_ENV === "production" && !req.secure) return next(failure(403, "forbidden", "账户服务必须通过 HTTPS 访问。"));
    limit(`request:${req.ip}`, 600, 60000);
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));

  function grant(user: AccountRecord, expiresAt: string) {
    const credential = store.decryptCredential(user);
    const available = !!credential;
    return {
      user: { id: user.id, displayName: user.displayName, account: user.account }, expiresAt,
      modelAccess: available
        ? { status: "available", message: "API Key 已绑定，模型权限由 NewAPI 控制" }
        : { status: "notProvisioned", message: "模型服务尚未开通，请联系运营。" },
      modelCredential: available ? credential : null,
    };
  }

  async function session(req: Request) {
    const authorization = req.get("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw failure(401, "sessionExpired", "登录已失效，请重新登录。");
    const hash = tokenHash(authorization.slice(7));
    const found = await store.getSession(hash, "client");
    if (!found) throw failure(401, "sessionExpired", "登录已失效，请重新登录。");
    const { current, user } = found;
    if (user.disabled) throw failure(403, "accountDisabled", "此账号暂时无法使用，请联系运营。");
    return { current, user };
  }

  async function authenticate(account: string, password: string, ip: string | undefined) {
    limit(`loginIp:${ip}`, 30, 15 * 60000);
    limit(`loginAccount:${tokenHash(account)}`, 10, 15 * 60000);
    if (activePasswords >= 4) throw failure(429, "rateLimited", "登录请求较多，请稍后重试。", 5);
    activePasswords += 1;
    try {
      const user = await store.findUser(account);
      const verified = await Bun.password.verify(password, user?.passwordHash ?? dummyHash);
      if (!verified || !user) throw failure(401, "invalidCredentials", "账号或密码不正确，请重试。");
      if (user.disabled) throw failure(403, "accountDisabled", "此账号暂时无法使用，请联系运营。");
      return user;
    } finally { activePasswords -= 1; }
  }

  app.get("/", (_req, res) => { res.redirect("/admin"); });
  app.use("/admin", createAdminRouter(store, { authenticate, limit, sessionHours }));

  app.post("/api/account/login", async (req, res) => {
    const input = z.object({ account: accountSchema, password: z.string().min(1).max(1024) }).strict().safeParse(req.body);
    if (!input.success) throw failure(400, "invalidCredentials", "请填写有效的账号和密码。");
    const user = await authenticate(input.data.account, input.data.password, req.ip);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionHours * 3600000).toISOString();
    let data: ReturnType<typeof grant> & { token: string };
    await store.transaction(async tx => {
      const currentUser = await tx.getUser(user.id);
      if (!currentUser || currentUser.disabled || currentUser.passwordHash !== user.passwordHash) throw failure(401, "invalidCredentials", "账户信息已变更，请重新登录。");
      await tx.trimSessions(user.id, "client", 9);
      await tx.insertSession({ tokenHash: tokenHash(token), userId: user.id, expiresAt, purpose: "client" });
      data = { ...grant(currentUser, expiresAt), token };
    });
    res.json({ code: 200, data: data!, message: "登录成功" });
  });

  app.get("/api/account/session", async (req, res) => {
    const { current, user } = await session(req);
    res.json({ code: 200, data: grant(user, current.expiresAt), message: "会话有效" });
  });

  app.get("/api/account/wallet", async (req, res) => {
    const { user } = await session(req);
    limit(`wallet:${user.id}`, 60, 60000);
    const data = await getNewApiWallet(user);
    const current = (await session(req)).user;
    if (current.newApiBinding?.userId !== user.newApiBinding?.userId || current.newApiBinding?.tokenId !== user.newApiBinding?.tokenId) throw failure(409, "walletUnavailable", "账户绑定已变化，请重新登录。");
    res.json({ code: 200, data, message: "余额已更新" });
  });

  app.post("/api/account/redeem", async (req, res) => {
    const { user } = await session(req);
    limit(`redeem:${user.id}`, 5, 60000);
    const input = z.object({ key: z.string().trim().min(1).max(128).regex(/^\S+$/) }).strict().safeParse(req.body);
    if (!input.success) throw failure(400, "redemptionRejected", "请输入有效的兑换码。");
    const data = await redeemNewApiCode(user, input.data.key);
    res.json({ code: 200, data, message: "兑换成功" });
  });

  app.post("/api/account/logout", async (req, res) => {
    const authorization = req.get("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw failure(401, "sessionExpired", "登录已失效。");
    const hash = tokenHash(authorization.slice(7));
    const user = await store.transaction(async tx => {
      const found = await tx.getSession(hash, "client");
      await tx.deleteSession(hash, "client");
      return found?.user;
    });
    // 身份会话已撤销；静态模型令牌仍由运营管理，不冒充调用了 NewAPI 撤销接口。
    res.json({ code: 200, data: { remoteRevoked: !user?.modelCredential }, message: "Cruio 身份会话已退出" });
  });

  app.use((_req, res) => { res.status(404).json({ code: 404, data: null, message: "接口不存在" }); });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const known = error?.reason && Number.isInteger(error.status);
    const malformed = error?.type === "entity.parse.failed" || error?.type === "entity.too.large";
    const status = known ? error.status : malformed ? 400 : 503;
    if (known && error.retryAfter) res.set("Retry-After", String(error.retryAfter));
    res.status(status).json({ code: status, data: { reason: known ? error.reason : malformed ? "invalidCredentials" : "accountServiceUnavailable", ...(known && error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, message: known ? error.message : malformed ? "请求格式无效或内容过大。" : "账户服务暂时不可用，请联系运营。" });
    if (!known && !malformed) console.error("账户请求处理失败；请检查存储权限、容量及服务配置。");
  };
  app.use(errorHandler);
  return app;
}
