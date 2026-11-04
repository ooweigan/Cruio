import express, { Router } from "express";
import type { ErrorRequestHandler, Request } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { accountSchema, tokenHash } from "./store";
import type { AccountRecord, AccountStore } from "./store";
import { accountFailure, changeAccount, requireAdmin } from "./accountActions";
import { adminPage, loginPage } from "./adminPage";
import type { NewApiSelection } from "./adminPage";
import { getNewApiBinding, getNewApiCustomers, getNewApiTokens } from "./newApi";

type AdminOptions = {
  authenticate: (account: string, password: string, ip: string | undefined) => Promise<AccountRecord>;
  limit: (key: string, count: number, duration: number) => void;
  sessionHours: number;
};

export function createAdminRouter(store: AccountStore, options: AdminOptions) {
  const router = Router();
  const cookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/admin" };
  async function session(req: Request) {
    const token = req.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("cruioAdmin="))?.slice(11);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw accountFailure("管理会话已失效，请重新登录。", 401);
    const found = await store.getSession(tokenHash(token), "admin");
    if (!found) throw accountFailure("管理会话已失效，请重新登录。", 401);
    return { user: requireAdmin(found.user), csrf: tokenHash(`csrf:${token}`), current: found.current };
  }
  const show = async (req: Request, message?: string, error = false) => {
    const auth = await session(req);
    const selected = req.path === "/create" ? "new" : typeof req.query.selected === "string" ? req.query.selected : typeof req.body?.userId === "string" ? req.body.userId : undefined;
    let newApi: NewApiSelection | undefined;
    if (req.method === "GET" && req.query.newApi === "1" && z.uuid().safeParse(selected).success && await store.getUser(selected!)) {
      const page = z.coerce.number().int().min(1).max(500000).catch(1);
      newApi = { keyword: typeof req.query.newApiQuery === "string" ? req.query.newApiQuery.trim().slice(0, 128) : "", page: page.parse(req.query.newApiPage), tokenPage: page.parse(req.query.newApiTokenPage) };
      try {
        options.limit(`adminNewApi:${auth.user.id}`, 60, 60000);
        newApi.customers = await getNewApiCustomers(newApi.keyword, newApi.page);
        if (req.query.newApiUserId) {
          const userId = z.coerce.number().int().positive().safeParse(req.query.newApiUserId);
          if (!userId.success) throw accountFailure("请选择有效的 New API 客户。");
          const linked = await store.findBinding(userId.data);
          if (linked && linked.id !== selected) throw accountFailure("该客户已绑定其他 Cruio 账号。", 409);
          newApi.tokens = await getNewApiTokens(userId.data, newApi.tokenPage);
        }
      } catch (error) {
        newApi.error = (error as { reason?: string }).reason && error instanceof Error ? error.message : "暂时无法读取 New API 客户，请稍后重试。";
      }
      await session(req);
    }
    return adminPage(store, {
      admin: auth.user, csrf: auth.csrf, selected, newApi,
      query: typeof req.query.q === "string" ? req.query.q.slice(0, 320) : "", filter: typeof req.query.filter === "string" ? req.query.filter : "all",
      page: z.coerce.number().int().positive().catch(1).parse(req.query.page), message, error,
    });
  };
  router.use((_req, res, next) => {
    res.set({ "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 20 }));
  router.use((req, _res, next) => {
    if (req.method === "POST" && req.get("origin") !== `${req.protocol}://${req.get("host")}`) throw accountFailure("管理操作必须从本站页面发起。", 403);
    next();
  });
  router.get("/", async (req, res) => {
    try { res.type("html").send(await show(req, req.query.saved === "1" ? "操作已保存。" : undefined)); }
    catch (error) {
      if ([401, 403].includes((error as { status?: number }).status ?? 0)) return res.type("html").send(loginPage());
      throw error;
    }
  });
  router.post("/login", async (req, res) => {
    const input = z.object({ account: accountSchema, password: z.string().min(1).max(1024) }).strict().parse(req.body);
    const user = await options.authenticate(input.account, input.password, req.ip);
    requireAdmin(await store.getUser(user.id));
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + options.sessionHours * 3600000).toISOString();
    await store.transaction(async tx => {
      const currentUser = requireAdmin(await tx.getUser(user.id));
      if (currentUser.passwordHash !== user.passwordHash) throw accountFailure("账户信息已变更，请重新登录。", 401);
      await tx.trimSessions(user.id, "admin", 4);
      await tx.insertSession({ tokenHash: tokenHash(token), userId: user.id, expiresAt, purpose: "admin" });
    });
    res.cookie("cruioAdmin", token, { ...cookieOptions, maxAge: options.sessionHours * 3600000 });
    res.redirect(303, "/admin");
  });
  router.use(async (req, _res, next) => {
    const auth = await session(req);
    if (req.method === "POST") {
      if (typeof req.body?.csrf !== "string" || req.body.csrf !== auth.csrf) throw accountFailure("页面已过期，请刷新后重试。", 403);
      options.limit(`adminWrite:${auth.user.id}`, 60, 60000);
    }
    next();
  });
  router.post("/logout", async (req, res) => {
    const auth = await session(req);
    await store.transaction(tx => tx.deleteSession(auth.current.tokenHash, "admin"));
    res.clearCookie("cruioAdmin", cookieOptions);
    res.redirect(303, "/admin");
  });
  router.post("/bindNewApi", async (req, res) => {
    const auth = await session(req);
    const input = z.object({ csrf: z.string(), userId: z.uuid(), newApiUserId: z.coerce.number().int().positive(), newApiTokenId: z.coerce.number().int().positive() }).strict().parse(req.body);
    const user = await store.getUser(input.userId);
    if (!user) throw accountFailure("账户不存在。", 404);
    const linked = await store.findBinding(input.newApiUserId);
    if (linked && linked.id !== user.id) throw accountFailure("该客户已绑定其他 Cruio 账号。", 409);
    const binding = await getNewApiBinding(input.newApiUserId, input.newApiTokenId);
    await session(req);
    await changeAccount(store, { action: "setModel", account: user.account, ...binding }, auth.user.id, auth.current.tokenHash);
    res.redirect(303, `/admin?selected=${user.id}&saved=1`);
  });
  router.post("/:action", async (req, res) => {
    const auth = await session(req);
    const action = z.enum(["create", "resetPassword", "enable", "disable", "revoke", "clearModel"]).parse(req.params.action);
    if (action === "create") {
      const id = await changeAccount(store, { action, account: req.body.account, displayName: req.body.displayName, password: req.body.password }, auth.user.id, auth.current.tokenHash);
      return res.redirect(303, `/admin?selected=${id}&saved=1`);
    }
    const id = z.uuid().parse(req.body.userId);
    const user = await store.getUser(id);
    if (!user) throw accountFailure("账户不存在。", 404);
    if (action === "disable" && id === auth.user.id) throw accountFailure("请使用另一位管理员停用当前账号。");
    const input: Record<string, unknown> = { action, account: user.account };
    if (action === "resetPassword") input.password = req.body.password;
    if (action === "clearModel" && req.body.confirm !== "yes") throw accountFailure("请确认解除 API Key 绑定。");
    await session(req);
    await changeAccount(store, input, auth.user.id, auth.current.tokenHash);
    res.redirect(303, `/admin?selected=${id}&saved=1`);
  });
  const errorHandler: ErrorRequestHandler = async (error, req, res, _next) => {
    const invalid = error instanceof z.ZodError || error?.type === "entity.parse.failed" || error?.type === "entity.too.large" || error?.type === "parameters.too.many";
    const known = error?.reason && Number.isInteger(error.status);
    const status = invalid ? 400 : known ? error.status : 503;
    const message = invalid ? "输入无效，请检查必填项、API Key 格式和密码长度（至少 6 位）。" : known ? error.message : "操作未完成，请检查账户存储或服务配置后重试。";
    if (known && error.retryAfter) res.set("Retry-After", String(error.retryAfter));
    res.status(status).type("html");
    if (req.path === "/login") return void res.send(loginPage(message));
    try { res.send(await show(req, message, true)); }
    catch { res.send(loginPage(message)); }
  };
  router.use(errorHandler);
  return router;
}
