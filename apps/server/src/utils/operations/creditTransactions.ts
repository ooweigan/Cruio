import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, chmod, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@/db/database";
import { fail, requireRole, verifyPassword, type User } from "@/utils/operations/access";

type Operation = "topup" | "refund" | "reversal";
type Preview = {
  id: string; operatorId: string; targetUserId: string; operation: Operation; amount: string | null; relatedEntryId: string | null;
  channel: string | null; externalReference: string | null; fileName: string; contentType: string; tempPath: string;
  balanceSnapshot: string; reservedSnapshot: string; expiresAt: Date; consumedAt: Date | null;
};

export async function commitCreditOperation(input: {
  database: Database; privateDirectory: string; operator: User; operation: Operation; body: Record<string, unknown>;
}) {
  const { database, privateDirectory, operator, operation, body } = input;
  const token = body.previewToken;
  const idempotencyKey = body.idempotencyKey;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (typeof token !== "string" || token.length < 32 || typeof idempotencyKey !== "string"
    || idempotencyKey.length < 8 || idempotencyKey.length > 180 || !reason || reason.length > 500) {
    throw fail(400, "请提供有效预览、幂等编号和操作理由。");
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const previews = await database<Preview[]>`
    SELECT id, operator_id AS "operatorId", target_user_id AS "targetUserId", operation, amount,
      related_entry_id AS "relatedEntryId", channel, external_reference AS "externalReference", file_name AS "fileName",
      content_type AS "contentType", temp_path AS "tempPath", balance_snapshot AS "balanceSnapshot",
      reserved_snapshot AS "reservedSnapshot", expires_at AS "expiresAt", consumed_at AS "consumedAt"
    FROM credit_operation_previews WHERE token_hash = ${tokenHash} AND operator_id = ${operator.id}
  `;
  const preview = previews[0];
  if (!preview || preview.operation !== operation) throw fail(409, "积分操作预览已失效，请重新预览。");
  const amount = preview.amount === null ? null : Number(preview.amount);
  if (operation !== "reversal" && Number(body.amount) !== amount) throw fail(409, "操作金额与已确认预览不一致。");
  const entryIdInput = typeof body.entryId === "string" ? body.entryId : "";
  const channelInput = typeof body.channel === "string" ? body.channel.trim() : null;
  const externalReferenceInput = typeof body.externalReference === "string" ? body.externalReference.trim() : null;
  if (operation !== "topup" && entryIdInput !== preview.relatedEntryId) throw fail(409, "关联账本记录与已确认预览不一致。");
  if (operation !== "reversal" && (channelInput !== preview.channel || externalReferenceInput !== preview.externalReference)) {
    throw fail(409, "外部凭据编号与已确认预览不一致。");
  }
  await requireRole(database, operator, "creditOperator", preview.targetUserId);
  await verifyPassword(database, operator.id, body.currentPassword);
  const prior = await database<{ id: string; entryType: string; userId: string; amount: string; relatedEntryId: string | null; channel: string | null; externalReference: string | null }[]>`
    SELECT id, entry_type AS "entryType", user_id AS "userId", amount, related_entry_id AS "relatedEntryId",
      channel, external_reference AS "externalReference"
    FROM credit_ledger WHERE operated_by = ${operator.id} AND idempotency_key = ${idempotencyKey}
  `;
  if (prior[0]) {
    const requestedAmount = operation === "reversal" ? null : operation === "refund" ? -amount! : amount;
    if (prior[0].entryType !== (operation === "reversal" ? "reversal" : operation) || prior[0].userId !== preview.targetUserId
      || (requestedAmount !== null && Number(prior[0].amount) !== requestedAmount)
      || (operation !== "topup" && prior[0].relatedEntryId !== preview.relatedEntryId)
      || prior[0].channel !== preview.channel || prior[0].externalReference !== preview.externalReference) throw fail(409, "幂等编号已用于其他积分操作。");
    await database`UPDATE credit_operation_previews SET consumed_at = COALESCE(consumed_at, now()) WHERE id = ${preview.id}`;
    await unlink(preview.tempPath).catch(() => undefined);
    const accounts = await database<{ balance: string; reserved: string }[]>`SELECT balance, reserved FROM credit_accounts WHERE user_id = ${preview.targetUserId}`;
    return { entry: { id: prior[0].id, type: prior[0].entryType, amount: Number(prior[0].amount), relatedEntryId: prior[0].relatedEntryId },
      account: { balance: Number(accounts[0]?.balance ?? 0), reserved: Number(accounts[0]?.reserved ?? 0) }, idempotent: true };
  }

  const entryId = randomUUID();
  const evidenceRelativePath = `evidence/${entryId}.evidence`;
  const finalPath = join(privateDirectory, evidenceRelativePath);
  await mkdir(join(privateDirectory, "evidence"), { recursive: true, mode: 0o700 });
  await chmod(privateDirectory, 0o700);
  await chmod(join(privateDirectory, "evidence"), 0o700);
  let committed = false;
  let evidenceMoved = false;
  let safeToRestore = false;
  try {
    const result = await database.begin(async transaction => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${operator.id}:${idempotencyKey}`}, 0))`;
      await requireRole(database, operator, "creditOperator", preview.targetUserId, transaction);
      const concurrent = await transaction<{ id: string; entryType: string; userId: string; amount: string; relatedEntryId: string | null; channel: string | null; externalReference: string | null }[]>`
        SELECT id, entry_type AS "entryType", user_id AS "userId", amount, related_entry_id AS "relatedEntryId", channel,
          external_reference AS "externalReference"
        FROM credit_ledger WHERE operated_by = ${operator.id} AND idempotency_key = ${idempotencyKey}
      `;
      if (concurrent[0]) {
        const requestedAmount = operation === "reversal" ? null : operation === "refund" ? -amount! : amount;
        if (concurrent[0].entryType !== (operation === "reversal" ? "reversal" : operation) || concurrent[0].userId !== preview.targetUserId
          || (requestedAmount !== null && Number(concurrent[0].amount) !== requestedAmount)
          || (operation !== "topup" && concurrent[0].relatedEntryId !== preview.relatedEntryId)
          || concurrent[0].channel !== preview.channel || concurrent[0].externalReference !== preview.externalReference) throw fail(409, "幂等编号已用于其他积分操作。");
        const accounts = await transaction<{ balance: string; reserved: string }[]>`
          SELECT balance, reserved FROM credit_accounts WHERE user_id = ${preview.targetUserId}
        `;
        await transaction`UPDATE credit_operation_previews SET consumed_at = COALESCE(consumed_at, now()) WHERE id = ${preview.id}`;
        return { entry: { id: concurrent[0].id, type: concurrent[0].entryType, amount: Number(concurrent[0].amount), relatedEntryId: concurrent[0].relatedEntryId },
          account: { balance: Number(accounts[0]?.balance ?? 0), reserved: Number(accounts[0]?.reserved ?? 0) }, idempotent: true };
      }
      const freshPreviews = await transaction<Preview[]>`
        SELECT id, operator_id AS "operatorId", target_user_id AS "targetUserId", operation, amount,
          related_entry_id AS "relatedEntryId", channel, external_reference AS "externalReference", file_name AS "fileName",
          content_type AS "contentType", temp_path AS "tempPath", balance_snapshot AS "balanceSnapshot",
          reserved_snapshot AS "reservedSnapshot", expires_at AS "expiresAt", consumed_at AS "consumedAt"
        FROM credit_operation_previews WHERE id = ${preview.id} FOR UPDATE
      `;
      const freshPreview = freshPreviews[0];
      if (!freshPreview || freshPreview.consumedAt || new Date(freshPreview.expiresAt).getTime() <= Date.now()) throw fail(409, "积分操作预览已使用或过期。");
      await transaction`INSERT INTO credit_accounts (user_id) VALUES (${preview.targetUserId}) ON CONFLICT (user_id) DO NOTHING`;
      const accounts = await transaction<{ balance: string; reserved: string }[]>`
        SELECT balance, reserved FROM credit_accounts WHERE user_id = ${preview.targetUserId} FOR UPDATE
      `;
      const account = accounts[0];
      if (Number(account.balance) !== Number(preview.balanceSnapshot) || Number(account.reserved) !== Number(preview.reservedSnapshot)) {
        throw fail(409, "用户积分账户在预览后发生变化，请重新预览。",);
      }
      let delta = operation === "topup" ? amount! : operation === "refund" ? -amount! : 0;
      let entryType = operation;
      if (operation === "refund") {
        const tops = await transaction<{ amount: string }[]>`
          SELECT amount FROM credit_ledger WHERE id = ${preview.relatedEntryId} AND user_id = ${preview.targetUserId} AND entry_type = 'topup' FOR SHARE
        `;
        if (!tops[0]) throw fail(404, "原充值记录不存在。");
        const topupReversals = await transaction`
          SELECT id FROM credit_ledger WHERE entry_type = 'reversal' AND related_entry_id = ${preview.relatedEntryId}
        `;
        if (topupReversals.length) throw fail(409, "原充值记录已冲正，不能再扣回。");
        const refunded = await transaction<{ amount: string }[]>`
          SELECT COALESCE(-SUM(entry.amount), 0) - COALESCE((SELECT SUM(reversal.amount) FROM credit_ledger AS reversal
            WHERE reversal.entry_type = 'reversal' AND reversal.related_entry_id IN (
              SELECT refunds.id FROM credit_ledger AS refunds WHERE refunds.entry_type = 'refund' AND refunds.related_entry_id = ${preview.relatedEntryId}
            )), 0) AS amount
          FROM credit_ledger AS entry WHERE entry.entry_type = 'refund' AND entry.related_entry_id = ${preview.relatedEntryId}
        `;
        if (amount! > Number(tops[0].amount) - Number(refunded[0].amount)) throw fail(409, "退款金额超过原充值可扣回余额。");
      } else if (operation === "reversal") {
        const targets = await transaction<{ amount: string; entryType: string }[]>`
          SELECT amount, entry_type AS "entryType" FROM credit_ledger
          WHERE id = ${preview.relatedEntryId} AND user_id = ${preview.targetUserId} AND entry_type IN ('topup', 'refund') FOR UPDATE
        `;
        if (!targets[0]) throw fail(404, "可冲正记录不存在。");
        const reversed = await transaction`SELECT id FROM credit_ledger WHERE entry_type = 'reversal' AND related_entry_id = ${preview.relatedEntryId}`;
        if (reversed.length) throw fail(409, "该账本记录已冲正。");
        if (targets[0].entryType === "topup") {
          const activeRefunds = await transaction<{ total: string }[]>`
            SELECT COALESCE(SUM(refund.amount), 0) + COALESCE((SELECT SUM(reversal.amount) FROM credit_ledger AS reversal
              WHERE reversal.entry_type = 'reversal' AND reversal.related_entry_id IN (
                SELECT refunds.id FROM credit_ledger AS refunds WHERE refunds.entry_type = 'refund' AND refunds.related_entry_id = ${preview.relatedEntryId}
              )), 0) AS total
            FROM credit_ledger AS refund WHERE refund.entry_type = 'refund' AND refund.related_entry_id = ${preview.relatedEntryId}
          `;
          if (Number(activeRefunds[0].total) !== 0) throw fail(409, "请先冲正关联退款，再冲正该充值。");
        }
        delta = -Number(targets[0].amount);
        entryType = "reversal";
      }
      const balanceAfter = Number(account.balance) + delta;
      if (!Number.isSafeInteger(balanceAfter)) throw fail(409, "积分余额超出安全范围。");
      const next = await transaction<{ balance: string; reserved: string }[]>`
        UPDATE credit_accounts SET balance = ${balanceAfter}, updated_at = now()
        WHERE user_id = ${preview.targetUserId} RETURNING balance, reserved
      `;
      await rename(preview.tempPath, finalPath);
      evidenceMoved = true;
      const evidenceSha = createHash("sha256").update(Buffer.from(await Bun.file(finalPath).arrayBuffer())).digest("hex");
      const publicReason = operation === "topup" ? "线下或第三方成交积分入账" : operation === "refund" ? "外部退款凭据扣回积分" : "积分账本冲正";
      await transaction`
        INSERT INTO credit_ledger
          (id, user_id, entry_type, amount, balance_after, reserved_after, reserved_delta, reference, reason,
           channel, external_reference, operated_by, idempotency_key, public_reason, related_entry_id)
        VALUES (${entryId}, ${preview.targetUserId}, ${entryType}, ${delta}, ${next[0].balance}, ${next[0].reserved}, 0,
          ${preview.externalReference}, ${reason}, ${preview.channel}, ${preview.externalReference}, ${operator.id}, ${idempotencyKey},
          ${publicReason}, ${preview.relatedEntryId})
      `;
      await transaction`
        INSERT INTO credit_evidence (entry_id, file_name, content_type, storage_path, sha256)
        VALUES (${entryId}, ${preview.fileName}, ${preview.contentType}, ${evidenceRelativePath}, ${evidenceSha})
      `;
      await transaction`
        UPDATE credit_operation_previews SET consumed_at = now() WHERE id = ${preview.id}
      `;
      return { entry: { id: entryId, type: entryType, amount: delta, relatedEntryId: preview.relatedEntryId },
        account: { balance: Number(next[0].balance), reserved: Number(next[0].reserved) }, idempotent: false };
    });
    committed = true;
    if (result.idempotent) await unlink(preview.tempPath).catch(() => undefined);
    return result;
  } catch (error) {
    try {
      const durable = await database<{ id: string; entryType: string; amount: string; relatedEntryId: string | null }[]>`
        SELECT ledger.id, ledger.entry_type AS "entryType", ledger.amount, ledger.related_entry_id AS "relatedEntryId"
        FROM credit_ledger AS ledger JOIN credit_evidence AS evidence ON evidence.entry_id = ledger.id
        WHERE ledger.id = ${entryId}
      `;
      if (durable[0]) {
        committed = true;
        const accounts = await database<{ balance: string; reserved: string }[]>`SELECT balance, reserved FROM credit_accounts WHERE user_id = ${preview.targetUserId}`;
        return { entry: { id: durable[0].id, type: durable[0].entryType, amount: Number(durable[0].amount), relatedEntryId: durable[0].relatedEntryId },
          account: { balance: Number(accounts[0]?.balance ?? 0), reserved: Number(accounts[0]?.reserved ?? 0) }, idempotent: false };
      }
      safeToRestore = true;
    } catch (inspectionError) {
      // Keep the private file for reconciliation when the database commit outcome cannot be read.
      evidenceMoved = false;
      throw Object.assign(new Error("积分操作提交结果暂时无法确认，凭据已安全保留，请联系管理员核查。"), { cause: inspectionError });
    }
    throw error;
  } finally {
    if (!committed && safeToRestore && evidenceMoved) await rename(finalPath, preview.tempPath);
  }
}
