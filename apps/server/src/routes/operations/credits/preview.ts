import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { fail, requireRole, type User } from "@/utils/operations/access";
import { validateFields } from "@/lib/middleware";

type Account = { balance: string; reserved: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const evidenceTypes = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain"]);

function decodeEvidence(value: unknown) {
  if (typeof value !== "object" || !value) throw fail(400, "请附上本次操作凭据。");
  const file = value as { fileName?: unknown; contentType?: unknown; data?: unknown };
  if (typeof file.fileName !== "string" || typeof file.contentType !== "string" || typeof file.data !== "string"
    || !evidenceTypes.has(file.contentType) || file.fileName.length > 180) throw fail(400, "凭据格式无效。");
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(file.data);
  if (!match || match[1] !== file.contentType) throw fail(400, "凭据数据格式无效。");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 1024 * 1024) throw fail(400, "凭据文件需小于等于 1 MiB。");
  if (bytes.toString("base64") !== match[2]) throw fail(400, "凭据数据不是有效的 Base64。");
  const signatureValid = file.contentType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : file.contentType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : file.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : !bytes.includes(0);
  if (!signatureValid) throw fail(400, "凭据文件内容与类型不匹配。");
  return { bytes, fileName: file.fileName.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 180), contentType: file.contentType };
}

async function readAccount(transaction: Database, userId: string) {
  await transaction`INSERT INTO credit_accounts (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  const rows = await transaction<Account[]>`SELECT balance, reserved FROM credit_accounts WHERE user_id = ${userId} FOR UPDATE`;
  return rows[0];
}

export function createOperationsCreditsPreviewRoute(database: Database, privateDirectory: string) {
  return Router().post("/", validateFields({
    operation: z.enum(["topup", "refund", "reversal"]), userId: z.string().uuid(),
    amount: z.number().int().positive().max(2_000_000_000).optional(), entryId: z.string().uuid().optional(),
    channel: z.string().trim().min(1).max(120).optional(), externalReference: z.string().trim().min(1).max(200).optional(),
    credential: z.object({ fileName: z.string().min(1).max(180), contentType: z.string(), data: z.string().max(1_500_000) }),
  }), async (request, response) => {
    const operator = response.locals.user as User;
    const { operation, userId, amount, entryId, channel, externalReference } = request.body ?? {};
    if (!idPattern.test(userId ?? "") || !["topup", "refund", "reversal"].includes(operation)) throw fail(400, "预览信息无效。");
    const isReversal = operation === "reversal";
    const credits = amount;
    if (!isReversal && credits === undefined) throw fail(400, "积分数量无效。");
    const normalizedChannel = isReversal ? null : typeof channel === "string" ? channel.trim() : "";
    const normalizedReference = isReversal ? null : typeof externalReference === "string" ? externalReference.trim() : "";
    if (!isReversal && (!normalizedChannel || normalizedChannel.length > 120 || !normalizedReference || normalizedReference.length > 200)) {
      throw fail(400, "请填写渠道和外部凭据编号。");
    }
    await requireRole(database, operator, "creditOperator", userId);
    const expired = await database<{ tempPath: string | null }[]>`
      DELETE FROM credit_operation_previews WHERE expires_at <= clock_timestamp() RETURNING temp_path AS "tempPath"
    `;
    await Promise.all(expired.map(row => row.tempPath ? unlink(row.tempPath).catch(() => undefined) : Promise.resolve()));
    const evidence = decodeEvidence(request.body?.credential);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tempPath = join(privateDirectory, "pending", `${id}.evidence`);
    await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    await mkdir(join(privateDirectory, "pending"), { recursive: true, mode: 0o700 });
    await chmod(privateDirectory, 0o700);
    await chmod(join(privateDirectory, "pending"), 0o700);
    await writeFile(tempPath, evidence.bytes, { flag: "wx", mode: 0o600 });
    try {
      const impact = await database.begin(async transaction => {
        const account = await readAccount(transaction, userId);
        let effectiveDelta = operation === "topup" ? credits : operation === "refund" ? -credits : 0;
        let relatedEntryId: string | null = null;
        if (operation === "refund") {
          if (!idPattern.test(entryId ?? "")) throw fail(400, "退款必须关联原充值记录。");
          const tops = await transaction<{ id: string; amount: string }[]>`
            SELECT id, amount FROM credit_ledger WHERE id = ${entryId} AND user_id = ${userId} AND entry_type = 'topup' FOR SHARE
          `;
          if (!tops[0]) throw fail(404, "原充值记录不存在。");
          const topupReversals = await transaction`
            SELECT id FROM credit_ledger WHERE entry_type = 'reversal' AND related_entry_id = ${entryId}
          `;
          if (topupReversals.length) throw fail(409, "原充值记录已冲正，不能再扣回。");
          const totals = await transaction<{ refunded: string }[]>`
            SELECT COALESCE(-SUM(ledger.amount), 0) - COALESCE((
              SELECT SUM(reversal.amount) FROM credit_ledger AS reversal
              WHERE reversal.entry_type = 'reversal' AND reversal.related_entry_id IN (
                SELECT refunds.id FROM credit_ledger AS refunds WHERE refunds.entry_type = 'refund' AND refunds.related_entry_id = ${entryId}
              )
            ), 0) AS refunded
            FROM credit_ledger AS ledger WHERE ledger.entry_type = 'refund' AND ledger.related_entry_id = ${entryId}
          `;
          if (credits > Number(tops[0].amount) - Number(totals[0].refunded)) throw fail(409, "退款金额超过原充值可扣回余额。");
          relatedEntryId = entryId;
        } else if (operation === "reversal") {
          if (!idPattern.test(entryId ?? "")) throw fail(400, "请指定要冲正的账本记录。");
          const targets = await transaction<{ id: string; amount: string; entryType: string }[]>`
            SELECT id, amount, entry_type AS "entryType" FROM credit_ledger
            WHERE id = ${entryId} AND user_id = ${userId} AND entry_type IN ('topup', 'refund') FOR SHARE
          `;
          if (!targets[0]) throw fail(404, "可冲正记录不存在。");
          const reversed = await transaction`SELECT id FROM credit_ledger WHERE entry_type = 'reversal' AND related_entry_id = ${entryId}`;
          if (reversed.length) throw fail(409, "该账本记录已冲正。");
          if (targets[0].entryType === "topup") {
            const activeRefunds = await transaction<{ total: string }[]>`
            SELECT COALESCE(SUM(refund.amount), 0) + COALESCE((
                SELECT SUM(reversal.amount) FROM credit_ledger AS reversal
                WHERE reversal.entry_type = 'reversal' AND reversal.related_entry_id IN (
                  SELECT refunds.id FROM credit_ledger AS refunds WHERE refunds.entry_type = 'refund' AND refunds.related_entry_id = ${entryId}
                )
              ), 0) AS total FROM credit_ledger AS refund
              WHERE refund.entry_type = 'refund' AND refund.related_entry_id = ${entryId}
            `;
            if (Number(activeRefunds[0].total) !== 0) throw fail(409, "请先冲正关联退款，再冲正该充值。");
          }
          effectiveDelta = -Number(targets[0].amount);
          relatedEntryId = entryId;
        }
        const currentBalance = Number(account.balance); const reserved = Number(account.reserved);
        const balanceAfter = currentBalance + effectiveDelta;
        if (!Number.isSafeInteger(balanceAfter)) throw fail(409, "积分余额超出安全范围。");
        return { balance: currentBalance, reserved, amountDelta: effectiveDelta, balanceAfter, availableAfter: Math.max(0, balanceAfter - reserved), debtAfter: Math.max(0, -balanceAfter), relatedEntryId };
      });
      const created = new Date(Date.now() + 15 * 60 * 1000);
      await database`
        INSERT INTO credit_operation_previews
          (id, token_hash, operator_id, target_user_id, operation, amount, related_entry_id, channel, external_reference,
           file_name, content_type, temp_path, balance_snapshot, reserved_snapshot, expires_at)
        VALUES (${id}, ${createHash("sha256").update(token).digest("hex")}, ${operator.id}, ${userId}, ${operation},
          ${isReversal ? null : credits}, ${impact.relatedEntryId}, ${normalizedChannel}, ${normalizedReference},
          ${evidence.fileName}, ${evidence.contentType}, ${tempPath}, ${impact.balance}, ${impact.reserved}, ${created})
      `;
      return response.json({ previewToken: token, expiresAt: created, operation, userId, amount: isReversal ? null : credits,
        entryId: impact.relatedEntryId, topupEntryId: operation === "refund" ? impact.relatedEntryId : null,
        account: { balance: impact.balance, available: Math.max(0, impact.balance - impact.reserved), reserved: impact.reserved, debt: Math.max(0, -impact.balance) },
        impact: { amountDelta: impact.amountDelta, balanceAfter: impact.balanceAfter, availableAfter: impact.availableAfter, debtAfter: impact.debtAfter } });
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}
