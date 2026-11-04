import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat } from "@toonflow/file";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import conf from "@/utils/conf";
import cruio from "@toonflow/providers/language/cruio";
import accountConfig from "./config";
import type { AccountBootstrap, AccountErrorReason, AccountSession } from "@/lib/accountProtocol";
import { accountWalletSchema, accountRedemptionSchema } from "@/lib/accountProtocol";

const serviceUrlSchema = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash
    && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
});
const grantSchema = z.object({
  token: z.string().min(16).max(16384).optional(),
  user: z.object({ id: z.string().min(1).max(256), displayName: z.string().min(1).max(200), account: z.string().min(1).max(320) }),
  expiresAt: z.iso.datetime(),
  modelAccess: z.object({ status: z.enum(["available", "notProvisioned", "unavailable"]), message: z.string().max(500) }),
  modelCredential: z.object({ apiKey: z.string().min(1).max(8192) }).nullable(),
}).refine(value => Date.parse(value.expiresAt) > Date.now() && (value.modelAccess.status !== "available" || !!value.modelCredential));
type Grant = z.infer<typeof grantSchema>;
type LocalSession = {
  cookie: string;
  contextId: string;
  grant: Grant;
  token: string;
  status: "authenticated" | "expired" | "disabled";
  controller: AbortController;
  responses: Set<Response>;
  openedFiles: Set<string>;
  expiredAt?: number;
  verifiedAt: number;
  verification?: Promise<void>;
  cleanups: Set<() => Promise<void>>;
  settling?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
};
const requestContext = new AsyncLocalStorage<LocalSession>();
const cookieName = "cruioSession";
let session: LocalSession | undefined;
let authenticating = false;
let loginAttempts: number[] = [];

export function failure(reason: AccountErrorReason, message: string, status: number, retryAfter?: number) {
  return Object.assign(new Error(message), { status, accountReason: reason, retryAfter });
}

function serviceUrl() {
  const parsed = serviceUrlSchema.safeParse(accountConfig.serviceUrl);
  if (!parsed.success) throw failure("accountServiceNotConfigured", "暂时无法登录，请稍后重试。", 503);
  return parsed.data.replace(/\/+$/, "");
}

function publicLink(value?: string) {
  if (!value || !serviceUrlSchema.safeParse(value).success) return null;
  return value;
}

export function bootstrap(): AccountBootstrap {
  return {
    configured: serviceUrlSchema.safeParse(accountConfig.serviceUrl).success,
    supportUrl: publicLink(process.env.CRUIO_ACCOUNT_SUPPORT_URL),
    termsUrl: publicLink(process.env.CRUIO_ACCOUNT_TERMS_URL),
    privacyUrl: publicLink(process.env.CRUIO_ACCOUNT_PRIVACY_URL),
    // ACT: 当前恢复凭证仅驻内存；接入系统安全存储前不承诺跨启动恢复。
    rememberSession: false,
  };
}

async function requestService<T>(path: string, options: { token?: string; body?: unknown; logout?: boolean }, schema: z.ZodType<T>) {
  const endpoint = `${serviceUrl()}/api/account/${path}`;
  let response: globalThis.Response;
  try {
    response = await fetch(endpoint, {
      method: options.body !== undefined || options.logout ? "POST" : "GET",
      headers: { Accept: "application/json", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
  } catch {
    if (path === "redeem") throw failure("redemptionUncertain", "暂未收到兑换结果，请先刷新余额确认到账情况。", 503);
    throw failure("accountServiceUnavailable", "暂时无法连接 Cruio，请稍后重试。", 503);
  }
  if (response.status === 401) throw failure(path === "login" ? "invalidCredentials" : "sessionExpired", path === "login" ? "账号或密码不正确" : "请重新登录，继续创作。", 401);
  if (response.status === 403) throw failure("accountDisabled", "此账号暂时无法使用，请联系支持。", 403);
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw failure("rateLimited", "操作过于频繁，请稍后重试", 429, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3600, Math.ceil(retryAfter)) : 60);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const walletError = z.object({ data: z.object({ reason: z.enum(["walletUnavailable", "redemptionRejected", "redemptionUncertain"]) }), message: z.string().max(500) }).safeParse(body);
    if (["wallet", "redeem"].includes(path) && walletError.success) throw failure(walletError.data.data.reason, walletError.data.message, response.status);
    if (path === "redeem") throw failure("redemptionUncertain", "暂未确认兑换结果，请先刷新余额确认到账情况。", 503);
    throw failure("accountServiceUnavailable", "暂时无法连接 Cruio，请稍后重试。", 503);
  }
  const result = z.object({ code: z.literal(200), data: schema }).safeParse(body);
  if (!result.success) throw failure(path === "redeem" ? "redemptionUncertain" : "accountServiceUnavailable", path === "redeem" ? "兑换结果暂时无法确认，请先刷新余额。" : "账户服务返回的数据无效，请稍后重试。", 503);
  return result.data.data;
}

function cookie(req: Request) {
  return req.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

function findSession(req: Request) {
  return session && cookie(req) === session.cookie ? session : undefined;
}

function stopSession(current: LocalSession, status: "expired" | "disabled") {
  current.expiredAt ??= Date.now();
  current.status = status;
  clearTimeout(current.timer);
  current.controller.abort(new Error("账户会话已结束"));
  current.grant.modelCredential = null;
  for (const response of current.responses) response.destroy();
  current.responses.clear();
  current.settling ??= Promise.allSettled([
    ...[...current.cleanups].map(cleanup => Promise.resolve().then(cleanup)),
    import("@/utils/browser").then(browser => browser.closeBrowsers()),
  ]).then(results => {
    if (results.some(result => result.status === "rejected")) throw new Error("暂时无法完成操作，请稍后重试。");
  });
  void current.settling.catch(() => {});
}

function scheduleExpiry(current: LocalSession) {
  clearTimeout(current.timer);
  const remaining = Date.parse(current.grant.expiresAt) - Date.now();
  current.timer = setTimeout(() => {
    if (Date.parse(current.grant.expiresAt) <= Date.now()) stopSession(current, "expired");
    else scheduleExpiry(current);
  }, Math.max(1, Math.min(remaining, 2147483647)));
  current.timer.unref();
}

function view(current?: LocalSession): AccountSession {
  if (!current) return { status: "anonymous", contextId: null, user: null, expiresAt: null, modelAccess: { status: "notProvisioned", message: "请先登录 Cruio" } };
  return { status: current.status, contextId: current.contextId, user: current.grant.user, expiresAt: current.grant.expiresAt, modelAccess: current.grant.modelAccess };
}

export function assertOrigin(req: Request) {
  const source = req.get("origin") ?? req.get("referer");
  let sameOrigin = false;
  try { sameOrigin = !!source && new URL(source).origin === `${req.protocol}://${req.get("host")}`; } catch { /* 无效来源统一拒绝。 */ }
  if (!sameOrigin || req.get("sec-fetch-site") === "cross-site") throw failure("forbidden", "仅允许 Cruio 页面访问账户接口", 403);
}

export async function login(req: Request, res: Response, input: { account: string; password: string }) {
  assertOrigin(req);
  if (session?.status === "authenticated") throw failure("accountConflict", "请先退出当前账号，再重新登录", 409);
  if (session && session.grant.user.account !== input.account) throw failure("accountConflict", "请使用原账号重新登录，或先退出当前账号", 409);
  if (authenticating) throw failure("accountConflict", "登录正在进行，请稍候", 409);
  loginAttempts = loginAttempts.filter(time => Date.now() - time < 60000);
  if (loginAttempts.length >= 5) throw failure("rateLimited", "登录尝试过于频繁，请稍后重试", 429, 60);
  loginAttempts.push(Date.now());
  authenticating = true;
  try {
    if (session?.settling) await session.settling;
    const grant = await requestService("login", { body: input }, grantSchema);
    if (!grant.token) throw failure("accountServiceUnavailable", "暂时无法登录，请稍后重试。", 503);
    if (session && session.grant.user.id !== grant.user.id) throw failure("accountConflict", "请先退出当前账号，再登录其他账号。", 409);
    const current: LocalSession = { cookie: randomBytes(32).toString("hex"), contextId: crypto.randomUUID(), grant, token: grant.token, status: "authenticated", controller: new AbortController(), responses: new Set(), openedFiles: new Set(session?.openedFiles), verifiedAt: Date.now(), cleanups: new Set() };
    session = current;
    scheduleExpiry(current);
    res.cookie(cookieName, current.cookie, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
    return view(current);
  } finally { authenticating = false; }
}

export async function getSession(req: Request) {
  const current = findSession(req);
  if (!current || current.status !== "authenticated") return view(current);
  try {
    await verifySession(current, true);
  } catch (error) {
    if (current.status === "authenticated") throw error;
  }
  return view(current);
}

async function verifySession(current: LocalSession, force = false) {
  if (!force && Date.now() - current.verifiedAt < 30000) return;
  if (current.verification) return current.verification;
  current.verification = (async () => {
    try {
      const grant = await requestService("session", { token: current.token }, grantSchema);
      if (session !== current || current.status !== "authenticated") throw failure("sessionExpired", "请重新登录，继续创作。", 401);
      if (grant.user.id !== current.grant.user.id) {
        stopSession(current, "expired");
        throw failure("sessionExpired", "请重新登录，继续创作。", 401);
      }
      current.grant = grant;
      if (grant.token) current.token = grant.token;
      current.verifiedAt = Date.now();
      scheduleExpiry(current);
    } catch (error) {
      const reason = (error as { accountReason?: string }).accountReason;
      if (reason === "sessionExpired" || reason === "accountDisabled") stopSession(current, reason === "accountDisabled" ? "disabled" : "expired");
      throw error;
    }
  })();
  try { await current.verification; }
  finally { current.verification = undefined; }
}

export async function verifyCurrent() {
  const current = context();
  // ACT: 模型调用最多复用 30 秒在线验证；过期刷新失败即拒绝新调用，本地保存不依赖联网。
  await verifySession(current);
  context();
}

export async function getWallet() {
  const current = context();
  const wallet = await requestService("wallet", { token: current.token }, accountWalletSchema);
  context();
  return wallet;
}

export async function redeem(key: string) {
  const current = context();
  const result = await requestService("redeem", { token: current.token, body: { key } }, accountRedemptionSchema);
  context();
  return result;
}

export async function logout(req: Request, res: Response) {
  assertOrigin(req);
  const current = findSession(req);
  if (current && req.get("x-cruio-context") !== current.contextId) throw failure("accountConflict", "登录状态已更新，请刷新页面后再退出。", 409);
  res.clearCookie(cookieName, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
  if (!current) return { remoteRevoked: true };
  stopSession(current, "expired");
  authenticating = true;
  try {
    await current.settling;
    session = undefined;
    return await requestService("logout", { token: current.token, logout: true }, z.object({ remoteRevoked: z.boolean() }));
  }
  catch { return { remoteRevoked: false }; }
  finally {
    if (session === current) session = undefined;
    current.token = "";
    delete current.grant.token;
    authenticating = false;
  }
}

export function context() {
  const current = requestContext.getStore();
  if (!current || current.status !== "authenticated" || current.controller.signal.aborted || Date.parse(current.grant.expiresAt) <= Date.now()) {
    throw failure("sessionExpired", "请重新登录，继续创作。", 401);
  }
  return current;
}

export function contextId() { return context().contextId; }
export function onSessionEnd(cleanup: () => Promise<void>) {
  const current = context();
  current.cleanups.add(cleanup);
  return () => current.cleanups.delete(cleanup);
}
export function signal(other?: AbortSignal) { return other ? AbortSignal.any([context().controller.signal, other]) : context().controller.signal; }
export function accountDirectory() { return join(dirname(conf.path), "accounts", createHash("sha256").update(context().grant.user.id).digest("hex")); }

export function modelCredential() {
  const current = context();
  if (current.grant.modelAccess.status === "notProvisioned") throw failure("modelNotProvisioned", "当前账号尚未开通 AI 创作，请联系支持。", 403);
  const credential = current.grant.modelCredential;
  if (current.grant.modelAccess.status !== "available" || !credential) throw failure("modelAuthorizationUnavailable", "暂时无法使用 AI 创作，请稍后重试。", 403);
  const providers = conf.get("settings", {}).customProviders;
  const provider = Array.isArray(providers) ? providers.find(item => item?.id === cruio.id) : undefined;
  const apiUrl = serviceUrlSchema.safeParse(provider?.apiUrl ?? cruio.apiUrl);
  if (!apiUrl.success) throw failure("modelAuthorizationUnavailable", "暂时无法使用 AI 创作，请联系支持。", 503);
  return { apiUrl: apiUrl.data, apiKey: credential.apiKey };
}

export function hasModelCredential() {
  const current = context();
  return current.grant.modelAccess.status === "available" && !!current.grant.modelCredential;
}

function fileIdentity(directory: string, path: string) {
  const value = `${directory}\0${path}`;
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function trackOpenedFile(res: Response, directory: string, path: string) {
  const current = requestContext.getStore();
  res.once("finish", () => {
    if (current?.status === "authenticated" && res.statusCode >= 200 && res.statusCode < 300) {
      // ACT: 只保留本次会话最多 1000 个已成功访问的文件；超出后需重登再保存。
      if (current.openedFiles.size < 1000) current.openedFiles.add(fileIdentity(directory, path));
    }
  });
}

export async function authorizeFileSave(directory: string, path: string, exclusive: boolean) {
  const current = requestContext.getStore();
  if (current !== session) throw failure("sessionExpired", "保存未完成，请重新登录后再试。", 401);
  if (current?.status === "authenticated") { context(); return; }
  if (!current || !["expired", "disabled"].includes(current.status) || !current.expiredAt || Date.now() - current.expiredAt > 300000
    || exclusive || !current.openedFiles.has(fileIdentity(directory, path)) || !(await lstat(path)).isFile()) {
    throw failure("sessionExpired", "保存未完成，请重新登录后再试。", 401);
  }
}

const publicRoutes = new Set(["GET /api/account/bootstrap", "GET /api/account/session", "POST /api/account/login", "POST /api/account/logout", "POST /api/desktop/ready"]);
const managementRoutes = /^\/api\/(?:providers(?:\/|$)|plugins(?:\/|$)|mcp(?:\/|$)|mobilelink(?:\/|$)|agents\/(?:a2a|connect|install|save|setenabled|uninstall)(?:\/|$)|(?:nodes|tools|ext)\/(?:install|save|setenabled|uninstall)(?:\/|$)|desktop\/(?:providerfile|plugins|devtools)(?:\/|$))/;

export function protect(req: Request, res: Response, next: NextFunction) {
  const path = req.path.toLowerCase().replace(/\/+$/, "");
  if (!/^\/(api|mcp|a2a)(\/|$)/.test(path)) return next();
  res.set("Cache-Control", "no-store");
  if (publicRoutes.has(`${req.method} ${path}`)) return next();
  const current = findSession(req);
  if (current?.status === "authenticated" && Date.parse(current.grant.expiresAt) <= Date.now()) stopSession(current, "expired");
  if (current && ["expired", "disabled"].includes(current.status) && current.expiredAt && Date.now() - current.expiredAt <= 300000
    && req.method === "PUT" && path === "/api/workspaces/files/write") {
    assertOrigin(req);
    if (req.get("x-cruio-context") !== current.contextId) return next(failure("accountConflict", "账号已切换，本次修改未保存。", 409));
    return requestContext.run(current, next);
  }
  if (!current || current.status !== "authenticated" || Date.parse(current.grant.expiresAt) <= Date.now()) {
    if (current?.status === "disabled") return next(failure("accountDisabled", "此账号暂时无法使用，请联系支持。", 403));
    return next(failure("sessionExpired", "请先登录 Cruio", 401));
  }
  if (req.get("origin") || !["GET", "HEAD"].includes(req.method)) assertOrigin(req);
  const expectedContext = req.get("x-cruio-context");
  if ((!["GET", "HEAD"].includes(req.method) || expectedContext) && expectedContext !== current.contextId) {
    return next(failure("accountConflict", "登录状态已更新，本次操作未完成，请重试。", 409));
  }
  if (managementRoutes.test(path) || /^\/(?:mcp|a2a)(?:\/|$)/.test(path)) {
    return next(failure("forbidden", "当前客户版本未开放此管理或外部接入能力", 403));
  }
  current.responses.add(res);
  res.once("close", () => current.responses.delete(res));
  requestContext.run(current, next);
}
