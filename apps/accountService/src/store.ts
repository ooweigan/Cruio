import { SQL } from "bun";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { chmod, lstat, mkdir, readFile, rm, rmdir, writeAtomic } from "@toonflow/file";
import { z } from "zod";

export const accountSchema = z.string().trim().min(1).max(320).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const passwordSchema = z.string().min(6).max(1024);
export const apiKeySchema = z.string().trim().min(16).max(8192).refine(value => !/\s/.test(value));
export const credentialSchema = z.object({ apiKey: apiKeySchema }).strict();
export const newApiBindingSchema = z.object({
  userId: z.number().int().positive(),
  tokenId: z.number().int().positive(),
  username: z.string().min(1).max(128),
  tokenName: z.string().max(128),
}).strict();
// 兼容读取旧加密记录；旧地址和模型清单不再参与权限判断。
const storedCredentialSchema = credentialSchema.extend({ apiUrl: z.string().optional(), modelIds: z.array(z.string()).optional() }).transform(({ apiKey }) => ({ apiKey }));
const userSchema = z.object({
  id: z.uuid(), account: accountSchema, displayName: z.string().trim().min(1).max(200),
  passwordHash: z.string().startsWith("$argon2id$").max(1024), disabled: z.boolean(),
  modelCredential: z.string().max(1000000).nullable(),
  role: z.enum(["user", "admin"]).default("user"),
  // 保留旧版本元数据，不再读取或更新 NewAPI 用户映射。
  newApiAccount: z.unknown().optional(),
  newApiBinding: newApiBindingSchema.nullable().optional(),
}).strict();
const sessionSchema = z.object({ tokenHash: z.string().regex(/^[a-f0-9]{64}$/), userId: z.uuid(), expiresAt: z.iso.datetime(), purpose: z.enum(["client", "admin"]).default("client") }).strict();
const stateSchema = z.object({ version: z.literal(1), users: z.array(userSchema).max(10000), sessions: z.array(sessionSchema).max(50000) }).strict();
export type AccountRecord = z.infer<typeof userSchema>;
export type IdentityState = z.infer<typeof stateSchema>;
export type AccountSession = z.infer<typeof sessionSchema>;

export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function hashPassword(password: string) { return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 }); }

export async function openStore(options: { initialize?: boolean; migrateJson?: boolean } = {}) {
  const directory = process.env.CRUIO_IDENTITY_DATA_DIR;
  if (!directory || !isAbsolute(directory)) throw new Error("CRUIO_IDENTITY_DATA_DIR 必须为独立的绝对数据目录");
  const address = process.env.CRUIO_IDENTITY_DATABASE_URL;
  try {
    if (!address || !["postgres:", "postgresql:"].includes(new URL(address).protocol)) throw new Error();
  } catch { throw new Error("请配置 CRUIO_IDENTITY_DATABASE_URL，必须为 PostgreSQL 连接地址"); }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error("账户数据目录不能是符号链接");
  await chmod(directory, 0o700);
  const sql = new SQL(address!, { max: 5, connectionTimeout: 10, idleTimeout: 30 });
  let credentialKey: Buffer | undefined;
  let ownsLock = false;
  const lockDirectory = join(directory, "processLock");
  try {
    if (options.initialize || options.migrateJson) {
      await acquireProcessLock(lockDirectory);
      ownsLock = true;
      await writeAtomic(join(lockDirectory, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { exclusive: true, mode: 0o600 });
      await sql.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(714209883)`;
        await tx`CREATE TABLE IF NOT EXISTS "accountMeta" (
          id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL CHECK (version = 1),
          "keyFingerprint" text NOT NULL, "migrationDigest" text
        )`;
        await tx`CREATE TABLE IF NOT EXISTS "accountUsers" (
          id uuid PRIMARY KEY, account text NOT NULL UNIQUE CHECK (length(account) BETWEEN 1 AND 320 AND account = btrim(account)),
          "displayName" text NOT NULL CHECK (length("displayName") BETWEEN 1 AND 200),
          "passwordHash" text NOT NULL CHECK ("passwordHash" LIKE '$argon2id$%'), disabled boolean NOT NULL,
          role text NOT NULL CHECK (role IN ('user', 'admin')), "modelCredential" text,
          "credentialFingerprint" text UNIQUE, "newApiAccount" jsonb,
          "newApiUserId" bigint UNIQUE CHECK ("newApiUserId" > 0),
          "newApiTokenId" bigint UNIQUE CHECK ("newApiTokenId" > 0),
          "newApiUsername" text, "newApiTokenName" text,
          CHECK (("modelCredential" IS NULL) = ("credentialFingerprint" IS NULL)),
          CHECK (("newApiUserId" IS NULL AND "newApiTokenId" IS NULL AND "newApiUsername" IS NULL AND "newApiTokenName" IS NULL)
            OR ("newApiUserId" IS NOT NULL AND "newApiTokenId" IS NOT NULL AND "newApiUsername" IS NOT NULL AND "newApiTokenName" IS NOT NULL AND "modelCredential" IS NOT NULL))
        )`;
        await tx`CREATE TABLE IF NOT EXISTS "accountSessions" (
          "tokenHash" text PRIMARY KEY CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
          "userId" uuid NOT NULL REFERENCES "accountUsers"(id) ON DELETE CASCADE,
          "expiresAt" timestamptz NOT NULL, purpose text NOT NULL CHECK (purpose IN ('client', 'admin')),
          sequence bigint GENERATED ALWAYS AS IDENTITY
        )`;
        await tx`CREATE INDEX IF NOT EXISTS "accountSessionsUserIndex" ON "accountSessions" ("userId", purpose, sequence)`;
        await tx`CREATE INDEX IF NOT EXISTS "accountSessionsExpiryIndex" ON "accountSessions" ("expiresAt")`;
      });
    }
    const metadata = await sql`SELECT * FROM "accountMeta" WHERE id = 1`;
    const keyPath = join(directory, "credentialKey.bin");
    try {
      if (!(await lstat(keyPath)).isFile()) throw new Error();
      await chmod(keyPath, 0o600);
      credentialKey = await readFile(keyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !options.initialize || metadata.length) throw new Error("缺少原凭证加密密钥，请恢复备份，不得重新生成");
      try { await lstat(join(directory, "accounts.json")); throw new Error("检测到旧账户文件，请先执行 migrateJson，不能初始化空库"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      credentialKey = randomBytes(32);
      await writeAtomic(keyPath, credentialKey, { exclusive: true, mode: 0o600 });
    }
    if (credentialKey.length !== 32) throw new Error("凭证加密密钥无效");
    const key = credentialKey;
    const keyFingerprint = tokenHash(key.toString("hex"));
    if (metadata.length && (metadata[0].version !== 1 || metadata[0].keyFingerprint !== keyFingerprint)) throw new Error("数据库版本或凭证加密密钥不匹配，请核对配置与备份");

    function decryptCredential(user: AccountRecord) {
      if (!user.modelCredential) return null;
      const value = Buffer.from(user.modelCredential, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAAD(Buffer.from(user.id));
      decipher.setAuthTag(value.subarray(12, 28));
      return storedCredentialSchema.parse(JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8")));
    }
    function credentialFingerprint(apiKey: string) { return createHmac("sha256", key).update(apiKey).digest("hex"); }
    function decodeUser(row: Record<string, unknown> | undefined) {
      if (!row) return undefined;
      return userSchema.parse({
        id: row.id, account: row.account, displayName: row.displayName, passwordHash: row.passwordHash,
        disabled: row.disabled, role: row.role, modelCredential: row.modelCredential,
        ...(row.newApiAccount == null ? {} : { newApiAccount: row.newApiAccount }),
        newApiBinding: row.newApiUserId == null ? null : {
          userId: Number(row.newApiUserId), tokenId: Number(row.newApiTokenId), username: row.newApiUsername, tokenName: row.newApiTokenName,
        },
      });
    }
    function decodeSession(row: Record<string, unknown>) {
      return sessionSchema.parse({ tokenHash: row.tokenHash, userId: row.userId, expiresAt: new Date(row.expiresAt as string | Date).toISOString(), purpose: row.purpose });
    }
    function queries(db: SQL) {
      return {
        async getUser(id: string) { return decodeUser((await db`SELECT * FROM "accountUsers" WHERE id = ${id}`)[0]); },
        async findUser(account: string) { return decodeUser((await db`SELECT * FROM "accountUsers" WHERE account = ${account}`)[0]); },
        async findCredential(apiKey: string) { return decodeUser((await db`SELECT * FROM "accountUsers" WHERE "credentialFingerprint" = ${credentialFingerprint(apiKey)}`)[0]); },
        async findBinding(userId: number) { return decodeUser((await db`SELECT * FROM "accountUsers" WHERE "newApiUserId" = ${userId}`)[0]); },
        async getSession(hash: string, purpose: "client" | "admin") {
          const rows = await db`SELECT row_to_json(u) AS "user", row_to_json(s) AS "session" FROM "accountSessions" s
            JOIN "accountUsers" u ON u.id = s."userId" WHERE s."tokenHash" = ${hash} AND s.purpose = ${purpose} AND s."expiresAt" > now()`;
          if (!rows.length) return undefined;
          return { user: decodeUser(rows[0].user)!, current: decodeSession(rows[0].session) };
        },
        async countAdmins() { return Number((await db`SELECT count(*) AS count FROM "accountUsers" WHERE role = 'admin' AND NOT disabled`)[0].count); },
        async listUsers(): Promise<AccountRecord[]> { return (await db`SELECT * FROM "accountUsers" ORDER BY account COLLATE "C"`).map((row: Record<string, unknown>) => decodeUser(row)!); },
        async read() {
          // 单条语句取得一致快照；只用于管理列表，登录与鉴权始终按索引查询。
          const [row] = await db`SELECT
            (SELECT coalesce(json_agg(u ORDER BY account COLLATE "C"), '[]') FROM "accountUsers" u) AS users,
            (SELECT coalesce(json_agg(s), '[]') FROM "accountSessions" s WHERE "expiresAt" > now()) AS sessions`;
          return { users: row.users.map(decodeUser) as AccountRecord[], sessions: row.sessions.map(decodeSession) as AccountSession[] };
        },
        async saveUser(value: AccountRecord) {
          const user = userSchema.parse(value);
          const binding = user.newApiBinding;
          const credential = decryptCredential(user);
          const fingerprint = credential ? credentialFingerprint(credential.apiKey) : null;
          await db`INSERT INTO "accountUsers" (id, account, "displayName", "passwordHash", disabled, role, "modelCredential", "credentialFingerprint", "newApiAccount", "newApiUserId", "newApiTokenId", "newApiUsername", "newApiTokenName")
            VALUES (${user.id}, ${user.account}, ${user.displayName}, ${user.passwordHash}, ${user.disabled}, ${user.role}, ${user.modelCredential}, ${fingerprint}, ${JSON.stringify(user.newApiAccount ?? null)}::jsonb, ${binding?.userId ?? null}, ${binding?.tokenId ?? null}, ${binding?.username ?? null}, ${binding?.tokenName ?? null})
            ON CONFLICT (id) DO UPDATE SET account = excluded.account, "displayName" = excluded."displayName", "passwordHash" = excluded."passwordHash", disabled = excluded.disabled,
              role = excluded.role, "modelCredential" = excluded."modelCredential", "credentialFingerprint" = excluded."credentialFingerprint", "newApiAccount" = excluded."newApiAccount",
              "newApiUserId" = excluded."newApiUserId", "newApiTokenId" = excluded."newApiTokenId", "newApiUsername" = excluded."newApiUsername", "newApiTokenName" = excluded."newApiTokenName"`;
        },
        async insertSession(value: AccountSession) {
          const session = sessionSchema.parse(value);
          await db`INSERT INTO "accountSessions" ("tokenHash", "userId", "expiresAt", purpose) VALUES (${session.tokenHash}, ${session.userId}, ${session.expiresAt}, ${session.purpose})`;
        },
        async trimSessions(userId: string, purpose: "client" | "admin", keep: number) {
          await db`DELETE FROM "accountSessions" WHERE "tokenHash" IN
            (SELECT "tokenHash" FROM "accountSessions" WHERE "userId" = ${userId} AND purpose = ${purpose} ORDER BY sequence DESC OFFSET ${keep})`;
        },
        async deleteSession(hash: string, purpose: "client" | "admin") { await db`DELETE FROM "accountSessions" WHERE "tokenHash" = ${hash} AND purpose = ${purpose}`; },
        async deleteSessions(userId: string) { await db`DELETE FROM "accountSessions" WHERE "userId" = ${userId}`; },
      };
    }
    if (options.initialize || options.migrateJson) {
      let legacy: IdentityState | undefined;
      let digest: string | null = null;
      if (options.migrateJson) {
        const path = join(directory, "accounts.json");
        const info = await lstat(path);
        if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("旧账户文件无效或超过 32 MiB");
        const content = await readFile(path, "utf8");
        legacy = stateSchema.parse(JSON.parse(content));
        digest = tokenHash(content);
        const ids = new Set(legacy.users.map(user => user.id));
        if (ids.size !== legacy.users.length || legacy.sessions.some(session => !ids.has(session.userId))) throw new Error("旧账户数据关系无效");
      } else {
        try { await lstat(join(directory, "accounts.json")); throw new Error("检测到旧账户文件，请执行 migrateJson"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await sql.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(714209883)`;
        const meta = await tx`SELECT * FROM "accountMeta" WHERE id = 1`;
        if (meta.length) {
          if (meta[0].keyFingerprint !== keyFingerprint || meta[0].version !== 1 || options.migrateJson && meta[0].migrationDigest !== digest) throw new Error("目标数据库已初始化，不能覆盖或重复导入其他数据");
          return;
        }
        const [counts] = await tx`SELECT (SELECT count(*) FROM "accountUsers") + (SELECT count(*) FROM "accountSessions") AS count`;
        if (Number(counts.count)) throw new Error("目标数据库非空，拒绝覆盖");
        const db = queries(tx);
        for (const user of legacy?.users ?? []) {
          // 不使用 upsert 合并旧数据，重复 ID、账号或绑定必须使整个迁移回滚。
          if (await db.getUser(user.id)) throw new Error("旧账户 ID 重复");
          await db.saveUser(user);
        }
        for (const session of legacy?.sessions ?? []) await db.insertSession(session);
        await tx`INSERT INTO "accountMeta" (id, version, "keyFingerprint", "migrationDigest") VALUES (1, 1, ${keyFingerprint}, ${digest})`;
      });
    } else if (!metadata.length) throw new Error("账户数据库尚未初始化，请先执行 initialize 或 migrateJson");
    const result = {
      ...queries(sql), decryptCredential,
      encryptCredential(userId: string, credential: z.infer<typeof credentialSchema>) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(Buffer.from(userId));
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
        return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
      },
      async transaction<T>(change: (tx: ReturnType<typeof queries>) => Promise<T>): Promise<T> {
        return await sql.begin(async tx => {
          // ACT: 账号管理及会话写入共用数据库事务锁，保证最后管理员、绑定和会话限额的跨进程一致性。
          // 只锁短数据库操作，不含密码计算或外部请求；高写入吞吐时可拆为用户行锁与独立管理员锁。
          await tx`SET LOCAL lock_timeout = '10s'`;
          await tx`SET LOCAL statement_timeout = '15s'`;
          await tx`SELECT pg_advisory_xact_lock(714209883)`;
          await tx`DELETE FROM "accountSessions" WHERE "expiresAt" <= now()`;
          return change(queries(tx));
        }) as T;
      },
      async close() { await sql.close(); key.fill(0); },
    };
    return result;
  } catch (error) {
    await sql.close();
    credentialKey?.fill(0);
    if (error instanceof SQL.PostgresError) throw new Error("PostgreSQL 连接、结构或数据约束检查失败；请核对数据库配置和迁移来源，不会回退写入 JSON");
    throw error;
  } finally {
    if (ownsLock) await rm(lockDirectory, { recursive: true });
  }
}

export type AccountStore = Awaited<ReturnType<typeof openStore>>;

async function acquireProcessLock(lockDirectory: string) {
  try { await mkdir(lockDirectory, { mode: 0o700 }); return; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const ownerPath = join(lockDirectory, "owner.json");
  const ownerSchema = z.object({ pid: z.number().int().positive(), startedAt: z.iso.datetime() });
  let owner: z.infer<typeof ownerSchema>;
  try {
    if (!(await lstat(lockDirectory)).isDirectory() || !(await lstat(ownerPath)).isFile()) throw new Error();
    owner = ownerSchema.parse(JSON.parse(await readFile(ownerPath, "utf8")));
  } catch { throw new Error("账户锁信息缺失或无效；若服务刚在启动，请稍后重试，否则须人工核实 processLock，不能直接删除。"); }

  function requireStopped(pid: number) {
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw new Error(`无法确认账户进程 ${pid} 是否已停止，保留进程锁。`);
    }
    throw new Error(`账户数据目录正由进程 ${pid} 使用。若已启动，可直接访问后管；设置管理员前请先在原终端按 Ctrl+C 停止服务。`);
  }
  requireStopped(owner.pid);
  // 回收标记串行化多个启动命令；只回收明确已退出的本机进程，不按锁龄猜测。
  const recoveryDirectory = join(lockDirectory, "recovery");
  try { await mkdir(recoveryDirectory, { mode: 0o700 }); }
  catch { throw new Error("账户进程锁正在恢复，请稍后重试；若持续失败，请人工核实 processLock/recovery。"); }
  let removed = false;
  try {
    const current = ownerSchema.parse(JSON.parse(await readFile(ownerPath, "utf8")));
    if (current.pid !== owner.pid || current.startedAt !== owner.startedAt) throw new Error("账户进程锁已变化，请重新启动。");
    requireStopped(current.pid);
    await rm(lockDirectory, { recursive: true });
    removed = true;
    console.info(`已清理退出进程 ${owner.pid} 遗留的账户锁。`);
  } finally {
    if (!removed) await rmdir(recoveryDirectory);
  }
  // 重新竞争排他锁，不能假定回收者就是下一位持有者。
  try { await mkdir(lockDirectory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("另一个账户进程已开始启动，请勿重复运行。");
    throw error;
  }
}

