import { z } from "zod";
import { accountWalletSchema, accountRedemptionSchema } from "@toonflow/server/accountProtocol";
import type { AccountErrorReason } from "@toonflow/server/accountProtocol";
import { apiKeySchema, newApiBindingSchema } from "./store";
import type { AccountRecord } from "./store";

function failure(message: string, status = 503, reason: AccountErrorReason = "walletUnavailable") {
  return Object.assign(new Error(message), { status, reason });
}

const customerSchema = z.object({
  id: z.number().int().positive(), username: z.string().min(1).max(128),
  displayName: z.string().max(128), group: z.string().min(1).max(128), status: z.number().int(),
});
export type NewApiCustomer = z.infer<typeof customerSchema>;
const tokenSchema = z.object({
  id: z.number().int().positive(), name: z.string().max(128), group: z.string().max(128),
  status: z.number().int(), expiresAt: z.number().int(),
});
export type NewApiToken = z.infer<typeof tokenSchema>;

async function requestNewApi<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
  const address = process.env.CRUIO_IDENTITY_NEW_API_URL;
  const token = process.env.CRUIO_IDENTITY_NEW_API_SECRET;
  let url: URL;
  try {
    url = new URL(address ?? "");
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)
      || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error();
    if (!token || token.length < 32 || /\s/.test(token)) throw new Error();
  } catch { throw failure("尚未配置 New API 账户连接，请联系运营。"); }
  let response: Response;
  try {
    response = await fetch(new URL(path, url), {
      method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    if (path === "/api/cruio/redeem") throw failure("暂未收到兑换结果，请先刷新余额确认到账情况。", 503, "redemptionUncertain");
    throw failure("暂时无法连接 New API，请稍后重试。");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw failure("New API 集成凭据无效或权限不足，请联系运营。");
    const rejected = z.object({ success: z.literal(false), code: z.literal("redemptionRejected") }).safeParse(data);
    if (path === "/api/cruio/redeem" && rejected.success) throw failure("兑换未完成，请检查兑换码是否有效、已使用或已过期。", 400, "redemptionRejected");
    if (path === "/api/cruio/redeem") throw failure("暂未确认兑换结果，请先刷新余额确认到账情况。", 503, "redemptionUncertain");
    throw failure("New API 账户连接不可用，请检查绑定、接口版本与配置。");
  }
  const result = z.object({ success: z.literal(true), data: schema }).safeParse(data);
  if (!result.success) throw failure(path === "/api/cruio/redeem" ? "兑换结果暂时无法确认，请先刷新余额。" : "New API 返回的数据无效，请检查接口版本与配置。", 503, path === "/api/cruio/redeem" ? "redemptionUncertain" : "walletUnavailable");
  return result.data.data;
}

export async function getNewApiCustomers(keyword: string, page: number) {
  const query = new URLSearchParams({ p: String(page), page_size: "20", ...(keyword ? { keyword } : {}) });
  return requestNewApi(`/api/cruio/users?${query}`, z.object({ items: z.array(customerSchema).max(20), total: z.number().int().nonnegative() }));
}

export async function getNewApiTokens(userId: number, page: number) {
  return requestNewApi(`/api/cruio/tokens?userId=${userId}&p=${page}`, z.object({ customer: customerSchema, items: z.array(tokenSchema).max(20), total: z.number().int().nonnegative() }));
}

export async function getNewApiBinding(userId: number, tokenId: number) {
  const { apiKey, ...newApiBinding } = await requestNewApi("/api/cruio/bind", newApiBindingSchema.extend({ apiKey: apiKeySchema }), { userId, tokenId });
  return { newApiBinding, credential: { apiKey } };
}

function requireBinding(user: AccountRecord) {
  if (!user.newApiBinding || !user.modelCredential) throw failure("当前账号尚未关联 New API 客户，请联系运营完成绑定。", 409);
  return user.newApiBinding;
}

export function getNewApiWallet(user: AccountRecord) {
  const binding = requireBinding(user);
  return requestNewApi(`/api/cruio/wallet?userId=${binding.userId}&tokenId=${binding.tokenId}`, accountWalletSchema);
}

export function redeemNewApiCode(user: AccountRecord, key: string) {
  const binding = requireBinding(user);
  return requestNewApi("/api/cruio/redeem", accountRedemptionSchema, { userId: binding.userId, tokenId: binding.tokenId, key });
}
