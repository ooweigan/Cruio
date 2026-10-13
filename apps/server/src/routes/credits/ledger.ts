import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit } from "@/utils/operations/access";

type User = { id: string };

export function createCreditsLedgerRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const user = response.locals.user as User;
    const limit = parseLimit(request.query.limit, 30, 100);
    if (!limit) throw fail(400, "账单查询数量无效。");
    const cursor = typeof request.query.cursor === "string" ? request.query.cursor : null;
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor)) {
      return response.status(400).json({ message: "账单游标无效。" });
    }
    const accountRows = await database<{ balance: string; reserved: string }[]>`
      SELECT balance, reserved FROM credit_accounts WHERE user_id = ${user.id}
    `;
    const balance = Number(accountRows[0]?.balance ?? 0);
    const reserved = Number(accountRows[0]?.reserved ?? 0);
    const entries = await database<{
      id: string; entryType: string; amount: string; balanceAfter: string; reservedAfter: string;
      createdAt: Date; publicReason: string | null; relatedEntryId: string | null;
    }[]>`
      SELECT id, entry_type AS "entryType", amount, balance_after AS "balanceAfter",
        reserved_after AS "reservedAfter", created_at AS "createdAt",
        public_reason AS "publicReason", related_entry_id AS "relatedEntryId"
      FROM credit_ledger
      WHERE user_id = ${user.id}
        AND (${cursor}::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM credit_ledger WHERE id = ${cursor}::uuid AND user_id = ${user.id}))
      ORDER BY created_at DESC, id DESC LIMIT ${limit}
    `;
    return response.json({
      account: { balance, available: Math.max(0, balance - reserved), reserved, debt: Math.max(0, -balance) },
      entries: entries.map(entry => ({
        id: entry.id, type: entry.entryType, amount: Number(entry.amount),
        balanceAfter: Number(entry.balanceAfter), reservedAfter: Number(entry.reservedAfter),
        createdAt: entry.createdAt, reason: entry.publicReason ?? (entry.entryType === "reserve" ? "生成任务积分预占" : entry.entryType === "settle" ? "生成任务积分结算" : entry.entryType === "release" ? "生成任务积分释放" : "积分账务记录"),
        relatedEntryId: entry.relatedEntryId,
      })),
    });
  });
}
