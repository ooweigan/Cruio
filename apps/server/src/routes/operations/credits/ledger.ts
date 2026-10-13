import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit, requireRole, type User } from "@/utils/operations/access";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsCreditsLedgerRoute(database: Database) {
  return Router().get("/:userId/ledger", async (request, response) => {
    const operator = response.locals.user as User;
    const userId = request.params.userId;
    if (!idPattern.test(userId)) throw fail(404, "用户不存在。");
    await requireRole(database, operator, "creditOperator", userId);
    const limit = parseLimit(request.query.limit, 30, 100);
    if (!limit) throw fail(400, "账单查询数量无效。");
    const accountRows = await database<{ balance: string; reserved: string }[]>`SELECT balance, reserved FROM credit_accounts WHERE user_id = ${userId}`;
    const balance = Number(accountRows[0]?.balance ?? 0); const reserved = Number(accountRows[0]?.reserved ?? 0);
    const entries = await database<{
      id: string; entryType: string; amount: string; balanceAfter: string; reservedAfter: string; createdAt: Date;
      publicReason: string | null; channel: string | null; externalReference: string | null; relatedEntryId: string | null;
    }[]>`
      SELECT id, entry_type AS "entryType", amount, balance_after AS "balanceAfter", reserved_after AS "reservedAfter",
        created_at AS "createdAt", public_reason AS "publicReason", channel, external_reference AS "externalReference",
        related_entry_id AS "relatedEntryId"
      FROM credit_ledger WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT ${limit}
    `;
    return response.json({ account: { balance, available: Math.max(0, balance - reserved), reserved, debt: Math.max(0, -balance) }, entries: entries.map(entry => ({
      id: entry.id, type: entry.entryType, amount: Number(entry.amount), balanceAfter: Number(entry.balanceAfter), reservedAfter: Number(entry.reservedAfter),
      createdAt: entry.createdAt, reason: entry.publicReason ?? "账务摘要", channel: entry.channel, externalReference: entry.externalReference,
      relatedEntryId: entry.relatedEntryId,
    })) });
  });
}
