import { randomUUID } from "node:crypto";
import type { Database } from "@/db/database";

type GenerationSettlementRow = {
  id: string;
  userId: string;
  quoteId: string;
  status: string;
  credits: number | string;
};

type CreditAccountRow = { balance: number | string; reserved: number | string };
type LedgerRow = { entryType: string; amount: number | string; reservedDelta: number | string };

function toCreditAmount(value: number | string, label: string) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`积分账务数据无效：${label}。`);
  }
  return amount;
}

async function lockGenerationSettlement(transaction: Database, taskId: string) {
  const tasks = await transaction<GenerationSettlementRow[]>`
    SELECT tasks.id, tasks.user_id AS "userId", tasks.quote_id AS "quoteId", tasks.status,
      quotes.credits
    FROM generation_tasks AS tasks
    JOIN generation_quotes AS quotes ON quotes.id = tasks.quote_id
    WHERE tasks.id = ${taskId}
    FOR UPDATE OF tasks
  `;
  const task = tasks[0];
  if (!task) throw Object.assign(new Error("生成任务不存在。"), { status: 404 });
  const quote = toCreditAmount(task.credits, "报价积分");
  const accounts = await transaction<CreditAccountRow[]>`
    SELECT balance, reserved FROM credit_accounts WHERE user_id = ${task.userId} FOR UPDATE
  `;
  const account = accounts[0];
  if (!account) throw new Error("积分账户缺失，无法完成任务结算。");
  const ledger = await transaction<LedgerRow[]>`
    SELECT entry_type AS "entryType", amount, reserved_delta AS "reservedDelta"
    FROM credit_ledger WHERE task_id = ${task.id} ORDER BY created_at, id
  `;
  const reserveEntries = ledger.filter(entry => entry.entryType === "reserve");
  if (reserveEntries.length !== 1) throw new Error("任务预占账本缺失或重复，无法结算。");
  const reserve = reserveEntries[0];
  if (Number(reserve.amount) !== 0 || Number(reserve.reservedDelta) !== quote) {
    throw new Error("任务预占账本与已确认报价不一致，无法安全结算。");
  }
  const taskReserved = ledger.reduce((total, entry) => total + Number(entry.reservedDelta), 0);
  if (!Number.isSafeInteger(taskReserved) || taskReserved < 0) {
    throw new Error("任务预占账本不平，需核查后再处理。");
  }
  return { task, quote, account, ledger, taskReserved };
}

/**
 * ACT: Current published offers charge one fixed price per task; variable usage settlement
 * needs a versioned pricing rule before this helper can release a delivery difference.
 * Must share the transaction that records reliable delivery.
 */
export async function settleGenerationTask(transaction: Database, taskId: string) {
  const { task, quote, account, ledger, taskReserved } = await lockGenerationSettlement(transaction, taskId);
  if (task.status !== "delivered") {
    throw Object.assign(new Error("只有已可靠交付的任务才能实结积分。"), { status: 409 });
  }
  const results = await transaction<{ id: string }[]>`
    SELECT id FROM generation_results WHERE task_id = ${task.id} AND user_id = ${task.userId} LIMIT 1
  `;
  if (!results[0]) throw new Error("任务没有已保存的交付结果，不能实结积分。");
  const settle = quote;
  const existingSettle = ledger.find(entry => entry.entryType === "settle");
  const existingRelease = ledger.find(entry => entry.entryType === "release");
  if (existingSettle) {
    const settled = -Number(existingSettle.amount);
    const released = existingRelease ? -Number(existingRelease.reservedDelta) : 0;
    const remaining = ledger.reduce((total, entry) => total + Number(entry.reservedDelta), 0);
    if (settled !== settle || Number(existingSettle.reservedDelta) !== -settle
      || released !== 0 || remaining !== 0 || existingRelease) {
      throw Object.assign(new Error("任务已有不同的积分结算记录，需要核查。"), { status: 409 });
    }
    return { settled, released, idempotent: true };
  }
  if (existingRelease || taskReserved !== quote) {
    throw Object.assign(new Error("任务预占已被处理或账本不平，不能实结。"), { status: 409 });
  }

  const accountReserved = toCreditAmount(account.reserved, "账户预占");
  if (accountReserved < quote) throw new Error("账户预占与任务报价不一致，无法安全结算。");
  const afterSettle = await transaction<CreditAccountRow[]>`
    UPDATE credit_accounts
    SET balance = balance - ${settle}, reserved = reserved - ${settle}, updated_at = now()
    WHERE user_id = ${task.userId}
    RETURNING balance, reserved
  `;
  await transaction`
    INSERT INTO credit_ledger
      (id, user_id, task_id, quote_id, entry_type, amount, balance_after, reserved_after, reserved_delta, reason)
    VALUES (${randomUUID()}, ${task.userId}, ${task.id}, ${task.quoteId}, 'settle', ${-settle},
      ${afterSettle[0].balance}, ${afterSettle[0].reserved}, ${-settle}, '可靠交付后积分实结')
  `;
  const released = 0;
  return { settled: settle, released, idempotent: false };
}

/** Must be called inside the transaction that records a confirmed final failure. */
export async function releaseGenerationTask(transaction: Database, taskId: string, reason: string) {
  const { task, quote, account, ledger, taskReserved } = await lockGenerationSettlement(transaction, taskId);
  if (task.status !== "failed") {
    throw Object.assign(new Error("只有明确最终失败的任务才能释放预占积分。"), { status: 409 });
  }
  if (!reason.trim()) throw new Error("释放预占必须记录原因。");
  if (ledger.some(entry => entry.entryType === "settle")) {
    throw Object.assign(new Error("已实结的任务不能释放全部预占。"), { status: 409 });
  }
  const existingRelease = ledger.find(entry => entry.entryType === "release");
  if (existingRelease) {
    const released = -Number(existingRelease.reservedDelta);
    const remaining = ledger.reduce((total, entry) => total + Number(entry.reservedDelta), 0);
    if (released !== quote || Number(existingRelease.amount) !== 0 || remaining !== 0) {
      throw Object.assign(new Error("任务释放记录与报价不一致，需要核查。"), { status: 409 });
    }
    return { released, idempotent: true };
  }
  if (taskReserved !== quote) throw Object.assign(new Error("任务预占已被处理或账本不平，不能释放。"), { status: 409 });
  const accountReserved = toCreditAmount(account.reserved, "账户预占");
  if (accountReserved < quote) throw new Error("账户预占与任务报价不一致，无法安全释放。");
  const updated = await transaction<CreditAccountRow[]>`
    UPDATE credit_accounts SET reserved = reserved - ${quote}, updated_at = now()
    WHERE user_id = ${task.userId}
    RETURNING balance, reserved
  `;
  await transaction`
    INSERT INTO credit_ledger
      (id, user_id, task_id, quote_id, entry_type, amount, balance_after, reserved_after, reserved_delta, reason)
    VALUES (${randomUUID()}, ${task.userId}, ${task.id}, ${task.quoteId}, 'release', 0,
      ${updated[0].balance}, ${updated[0].reserved}, ${-quote}, ${reason.trim()})
  `;
  return { released: quote, idempotent: false };
}
