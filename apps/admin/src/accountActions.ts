import { z } from "zod";
import { accountSchema, credentialSchema, hashPassword, newApiBindingSchema, passwordSchema } from "./store";
import type { AccountStore, AccountRecord } from "./store";

export function accountFailure(message: string, status = 400) {
  return Object.assign(new Error(message), { status, reason: "forbidden" });
}

export function requireAdmin(user: AccountRecord | undefined) {
  if (!user || user.disabled || user.role !== "admin") throw accountFailure("当前账号没有管理权限。", 403);
  return user;
}

const createSchema = z.object({ action: z.enum(["create", "createAdmin"]), account: accountSchema, displayName: z.string().trim().min(1).max(200), password: passwordSchema, credential: credentialSchema.optional() }).strict();
const changeSchema = z.discriminatedUnion("action", [
  createSchema,
  z.object({ action: z.literal("resetPassword"), account: accountSchema, password: passwordSchema }).strict(),
  z.object({ action: z.literal("setModel"), account: accountSchema, credential: credentialSchema, newApiBinding: newApiBindingSchema.optional() }).strict(),
  z.object({ action: z.enum(["enable", "disable", "revoke", "clearModel", "makeAdmin"]), account: accountSchema }).strict(),
]);
let activeHashes = 0;

export async function changeAccount(store: AccountStore, rawInput: unknown, adminId?: string, adminSessionHash?: string) {
  const input = changeSchema.parse(rawInput);
  if (adminId) {
    requireAdmin(await store.getUser(adminId));
    if (["createAdmin", "makeAdmin"].includes(input.action)) throw accountFailure("管理员授权请使用主机上的运营命令。", 403);
  }
  let passwordHash: string | undefined;
  if ("password" in input) {
    if (activeHashes >= 4) throw accountFailure("密码处理繁忙，请稍后重试。", 429);
    activeHashes += 1;
    try { passwordHash = await hashPassword(input.password); }
    finally { activeHashes -= 1; }
  }
  let id = "";
  await store.transaction(async tx => {
    if (adminId) {
      requireAdmin(await tx.getUser(adminId));
      const session = adminSessionHash && await tx.getSession(adminSessionHash, "admin");
      if (!session || session.user.id !== adminId) throw accountFailure("管理会话已失效，请重新登录。", 401);
    }
    const existing = await tx.findUser(input.account);
    if ("credential" in input && input.credential) {
      const linked = await tx.findCredential(input.credential.apiKey);
      if (linked && linked.id !== existing?.id) throw accountFailure("此 API Key 已绑定其他账号。", 409);
    }
    if (input.action === "setModel" && input.newApiBinding) {
      const linked = await tx.findBinding(input.newApiBinding.userId);
      if (linked && linked.id !== existing?.id) throw accountFailure("此 New API 客户已绑定其他 Cruio 账号。", 409);
    }
    if (input.action === "create" || input.action === "createAdmin") {
      if (existing) throw accountFailure("账号已存在。", 409);
      id = crypto.randomUUID();
      await tx.saveUser({ id, account: input.account, displayName: input.displayName, passwordHash: passwordHash!, disabled: false, modelCredential: input.credential ? store.encryptCredential(id, input.credential) : null, role: input.action === "createAdmin" ? "admin" : "user" });
      return;
    }
    if (!existing) throw accountFailure("账号不存在。", 404);
    id = existing.id;
    if (input.action === "disable" && existing.role === "admin" && !existing.disabled
      && await tx.countAdmins() === 1) throw accountFailure("不能停用最后一个可用的管理员账号。");
    if (input.action === "resetPassword") existing.passwordHash = passwordHash!;
    if (input.action === "disable") existing.disabled = true;
    if (input.action === "enable") existing.disabled = false;
    if (input.action === "makeAdmin") existing.role = "admin";
    if (input.action === "setModel") {
      existing.modelCredential = store.encryptCredential(id, input.credential);
      existing.newApiBinding = input.newApiBinding ?? null;
    }
    if (input.action === "clearModel") {
      existing.modelCredential = null;
      existing.newApiBinding = null;
    }
    await tx.saveUser(existing);
    if (input.action !== "disable") await tx.deleteSessions(id);
  });
  return id;
}
