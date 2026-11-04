import { z } from "zod";
import { accountSchema, apiKeySchema, openStore, passwordSchema } from "./store";
import { changeAccount } from "./accountActions";

async function readInput() {
  if (process.stdin.isTTY) throw new Error("敏感信息须通过标准输入传入，不接受命令行参数；用终端隐藏输入或秘密管理器管道提供");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("标准输入超过 1 MiB");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function manage() {
  const [command, rawAccount, displayName, ...extra] = process.argv.slice(2);
  if (["initialize", "migrateJson"].includes(command) && !rawAccount && !displayName && !extra.length) {
    const store = await openStore({ initialize: command === "initialize", migrateJson: command === "migrateJson" });
    try { console.info(`PostgreSQL 已就绪，账户数：${(await store.listUsers()).length}。原文件未修改。`); }
    finally { await store.close(); }
    return;
  }
  const commands = ["create", "createAdmin", "makeAdmin", "resetPassword", "disable", "enable", "revoke", "setModel", "clearModel", "list"];
  if (!commands.includes(command) || extra.length || !["create", "createAdmin"].includes(command) && displayName || command === "list" && rawAccount) {
    throw new Error("用法：manage initialize | migrateJson | create/createAdmin <账号> [显示名称] | makeAdmin/resetPassword/disable/enable/revoke/setModel/clearModel <账号> | list；create/createAdmin/resetPassword 从 stdin 读取密码，setModel 从 stdin 读取 API Key");
  }
  const account = command === "list" ? "" : accountSchema.parse(rawAccount);
  const password = ["create", "createAdmin", "resetPassword"].includes(command) ? passwordSchema.parse((await readInput()).replace(/\r?\n$/, "")) : undefined;
  const credential = command === "setModel" ? { apiKey: apiKeySchema.parse((await readInput()).trim()) } : undefined;
  const name = ["create", "createAdmin"].includes(command) ? z.string().trim().min(1).max(200).parse(displayName ?? account) : undefined;
  const store = await openStore();
  try {
    if (command === "list") {
      console.table((await store.listUsers()).map(user => ({ account: user.account, displayName: user.displayName, role: user.role, disabled: user.disabled, modelConfigured: !!user.modelCredential })));
      return;
    }
    await changeAccount(store, { action: command, account, ...(name ? { displayName: name } : {}), ...(password ? { password } : {}), ...(credential ? { credential } : {}) });
    console.info("账户操作已保存；变更账户的已有会话已撤销。模型平台令牌须由运营另行管理。");
  } finally { await store.close(); }
}

try { await manage(); }
catch (error) {
  const message = error instanceof z.ZodError || error instanceof SyntaxError
    ? "输入格式无效：密码至少 6 字符；API Key 须为无空白的有效格式。不会输出输入内容。"
    : error instanceof Error ? error.message : "账户操作失败";
  console.error(message);
  process.exitCode = 1;
}
