import { Router } from "express";
import type { Database } from "@/db/database";
import { getGenerationResultFile } from "@/utils/generation/resultFile";
import { fail, parseLimit, requireRole, type User } from "@/utils/operations/access";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const taskLimit = 100;

function parseDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function createOperationsReconciliationRoute(database: Database, storageDirectory: string) {
  return Router().get("/", async (request, response) => {
    const operator = response.locals.user as User;
    const userId = typeof request.query.userId === "string" ? request.query.userId : null;
    if (userId && !uuidPattern.test(userId)) throw fail(400, "用户标识无效。");
    if (userId) await requireRole(database, operator, "creditOperator", userId);
    else await requireRole(database, operator, "creditOperator");

    const limit = parseLimit(request.query.limit, 20, 50);
    if (!limit) throw fail(400, "用户分页数量无效。");
    const offsetValue = request.query.offset === undefined ? "0" : request.query.offset;
    if (typeof offsetValue !== "string" || !/^\d+$/.test(offsetValue) || !Number.isSafeInteger(Number(offsetValue))) {
      throw fail(400, "用户分页位置无效。");
    }
    const offset = Number(offsetValue);
    if (offset > 1_000_000) throw fail(400, "用户分页位置超出范围。");
    const defaultTo = request.query.to === undefined
      ? (await database<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]?.now ?? null
      : null;
    const to = request.query.to === undefined ? defaultTo : parseDate(request.query.to);
    const from = request.query.from === undefined
      ? to ? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000) : null
      : parseDate(request.query.from);
    if (!from || !to || from >= to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw fail(400, "核对时间窗无效；请使用 UTC ISO 时间且窗口不超过 366 天。");
    }

    const grants = await database<{ scopeKind: string; scopeUserId: string | null }[]>`
      SELECT scope_kind AS "scopeKind", scope_user_id AS "scopeUserId"
      FROM staff_role_grants WHERE user_id = ${operator.id} AND role = 'creditOperator'
        AND revoked_at IS NULL AND expires_at > clock_timestamp()
    `;
    if (!grants.length) throw fail(403, "当前账户没有积分运营权限。");
    const global = grants.some(grant => grant.scopeKind === "global");
    const users = await database<{ id: string; email: string; balance: string; reserved: string; ledgerBalance: string; ledgerReserved: string; ledgerCount: number }[]>`
      SELECT users.id, users.email, COALESCE(accounts.balance, 0) AS balance, COALESCE(accounts.reserved, 0) AS reserved,
        COALESCE(ledger.amount_total, 0) AS "ledgerBalance", COALESCE(ledger.reserved_total, 0) AS "ledgerReserved",
        COALESCE(ledger.entry_count, 0) AS "ledgerCount"
      FROM users LEFT JOIN credit_accounts AS accounts ON accounts.user_id = users.id
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS amount_total, SUM(reserved_delta) AS reserved_total, COUNT(*) AS entry_count
        FROM credit_ledger WHERE user_id = users.id
      ) AS ledger ON true
      WHERE (${userId}::uuid IS NULL OR users.id = ${userId}::uuid)
        AND (${global} OR EXISTS (
          SELECT 1 FROM staff_role_grants scoped WHERE scoped.user_id = ${operator.id} AND scoped.role = 'creditOperator'
            AND scoped.scope_kind = 'user' AND scoped.scope_user_id = users.id
            AND scoped.revoked_at IS NULL AND scoped.expires_at > clock_timestamp()
        ))
      ORDER BY users.email, users.id LIMIT ${limit + 1} OFFSET ${offset}
    `;
    if (userId && !users.length) throw fail(404, "用户不存在。");
    const hasMoreUsers = users.length > limit;
    const pageUsers = users.slice(0, limit);
    const pageUserIds = pageUsers.map(user => user.id);
    const accountRows = pageUsers.map(user => {
      const balance = Number(user.balance);
      const reserved = Number(user.reserved);
      const ledgerBalance = Number(user.ledgerBalance);
      const ledgerReserved = Number(user.ledgerReserved);
      const issues: string[] = [];
      if (balance !== ledgerBalance) issues.push("账户余额与全量账本金额合计不一致");
      if (reserved !== ledgerReserved) issues.push("账户预占与全量账本预占变动合计不一致");
      return { user: { id: user.id, email: user.email }, balance, reserved, ledgerBalance, ledgerReserved,
        difference: balance - ledgerBalance, differenceReserved: reserved - ledgerReserved,
        entryCount: Number(user.ledgerCount), issues };
    });

    const tasks = await database<{
      id: string; userId: string; status: string; createdAt: Date; updatedAt: Date; quoted: string;
      reserveCount: number; reserveAmount: string; reserveDelta: string;
      settleCount: number; settleAmount: string; settleDelta: string;
      releaseCount: number; releaseAmount: string; releaseDelta: string;
    }[]>`
      SELECT tasks.id, tasks.user_id AS "userId", tasks.status, tasks.created_at AS "createdAt", tasks.updated_at AS "updatedAt",
        quotes.credits AS quoted,
        COUNT(*) FILTER (WHERE ledger.entry_type = 'reserve') AS "reserveCount",
        COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'reserve'), 0) AS "reserveAmount",
        COALESCE(SUM(ledger.reserved_delta) FILTER (WHERE ledger.entry_type = 'reserve'), 0) AS "reserveDelta",
        COUNT(*) FILTER (WHERE ledger.entry_type = 'settle') AS "settleCount",
        COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'settle'), 0) AS "settleAmount",
        COALESCE(SUM(ledger.reserved_delta) FILTER (WHERE ledger.entry_type = 'settle'), 0) AS "settleDelta",
        COUNT(*) FILTER (WHERE ledger.entry_type = 'release') AS "releaseCount",
        COALESCE(SUM(ledger.amount) FILTER (WHERE ledger.entry_type = 'release'), 0) AS "releaseAmount",
        COALESCE(SUM(ledger.reserved_delta) FILTER (WHERE ledger.entry_type = 'release'), 0) AS "releaseDelta"
      FROM generation_tasks tasks JOIN generation_quotes quotes ON quotes.id = tasks.quote_id
      LEFT JOIN credit_ledger ledger ON ledger.task_id = tasks.id
      WHERE tasks.created_at >= ${from} AND tasks.created_at < ${to}
        AND (${userId}::uuid IS NULL OR tasks.user_id = ${userId}::uuid)
        AND EXISTS (SELECT 1 FROM staff_role_grants grants WHERE grants.user_id = ${operator.id}
          AND grants.role = 'creditOperator' AND grants.revoked_at IS NULL AND grants.expires_at > clock_timestamp()
          AND (grants.scope_kind = 'global' OR grants.scope_user_id = tasks.user_id))
      GROUP BY tasks.id, tasks.user_id, tasks.status, tasks.created_at, tasks.updated_at, quotes.credits
      ORDER BY tasks.created_at DESC, tasks.id LIMIT ${taskLimit + 1}
    `;
    const tasksTruncated = tasks.length > taskLimit;
    const mappedTasks = await Promise.all(tasks.slice(0, taskLimit).map(async task => {
      const quoted = Number(task.quoted);
      const reserve = { count: Number(task.reserveCount), amount: Number(task.reserveAmount), reservedDelta: Number(task.reserveDelta) };
      const settle = { count: Number(task.settleCount), amount: Number(task.settleAmount), reservedDelta: Number(task.settleDelta) };
      const release = { count: Number(task.releaseCount), amount: Number(task.releaseAmount), reservedDelta: Number(task.releaseDelta) };
      const results = await database<{ id: string; userId: string; storageKey: string; mediaType: string; mimeType: string; size: string }[]>`
        SELECT id, user_id AS "userId", storage_key AS "storageKey", media_type AS "mediaType", mime_type AS "mimeType", size
        FROM generation_results WHERE task_id = ${task.id} ORDER BY created_at, id
      `;
      const resultSummaries = await Promise.all(results.map(async result => ({
        id: result.id, mediaType: result.mediaType, mimeType: result.mimeType, recordedSize: Number(result.size),
        fileAccessible: Boolean(await getGenerationResultFile(storageDirectory, result.userId, result.storageKey, Number(result.size))),
      })));
      const issues: string[] = [];
      const terminalCount = settle.count + release.count;
      if (reserve.count !== 1 || reserve.reservedDelta !== quoted || reserve.amount !== 0) issues.push("预占账本缺失、重复或金额与报价不符");
      if (terminalCount > 1 || (settle.count > 0 && release.count > 0)) issues.push("存在重复或双终结账本记录");
      if (task.status === "unknown" && release.count > 0) issues.push("未知任务已记录预占释放");
      if (task.status === "unknown" && settle.count > 0) issues.push("未知任务已记录积分实结");
      if (task.status === "delivered" && (settle.count !== 1 || settle.amount !== -quoted || settle.reservedDelta !== -quoted)) issues.push("可靠交付任务的实结账本缺失或总额不符");
      if (task.status === "delivered" && !results.length) issues.push("可靠交付任务缺少结果记录");
      if (task.status === "delivered" && resultSummaries.some(result => !result.fileAccessible)) issues.push("可靠结果文件缺失或大小不符");
      if (task.status !== "delivered" && results.length) issues.push("未标记可靠交付的任务存在结果记录");
      if (task.status === "failed" && (release.count !== 1 || release.amount !== 0 || release.reservedDelta !== -quoted)) issues.push("失败任务未正确释放预占");
      const netReservedDelta = reserve.reservedDelta + settle.reservedDelta + release.reservedDelta;
      if (task.status !== "delivered" && task.status !== "failed" && netReservedDelta !== quoted) {
        issues.push("未终结任务预占总额与报价不符");
      }
      if (task.status === "delivered" && netReservedDelta !== 0) issues.push("任务预占总额未归零");
      if (task.status === "failed" && netReservedDelta !== 0) issues.push("失败任务预占总额未归零");
      return { id: task.id, userId: task.userId, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, quoted,
        reserve, settle, release, results: resultSummaries, issues };
    }));

    const external = await database<{ userId: string; type: string; count: number; netAmount: string; relatedPresentCount: number; relatedMissingCount: number; evidencePresentCount: number; evidenceMissingCount: number }[]>`
      SELECT ledger.user_id AS "userId", ledger.entry_type AS type, COUNT(*) AS count, SUM(ledger.amount) AS "netAmount",
        COUNT(*) FILTER (WHERE ledger.related_entry_id IS NOT NULL AND related.id IS NOT NULL) AS "relatedPresentCount",
        COUNT(*) FILTER (WHERE ledger.related_entry_id IS NOT NULL AND related.id IS NULL) AS "relatedMissingCount",
        COUNT(*) FILTER (WHERE evidence.entry_id IS NOT NULL) AS "evidencePresentCount",
        COUNT(*) FILTER (WHERE evidence.entry_id IS NULL) AS "evidenceMissingCount"
      FROM credit_ledger ledger LEFT JOIN credit_ledger related ON related.id = ledger.related_entry_id
      LEFT JOIN credit_evidence evidence ON evidence.entry_id = ledger.id
      WHERE ledger.entry_type IN ('topup', 'refund', 'reversal') AND ledger.created_at >= ${from} AND ledger.created_at < ${to}
        AND (${userId}::uuid IS NULL OR ledger.user_id = ${userId}::uuid)
        AND EXISTS (SELECT 1 FROM staff_role_grants grants WHERE grants.user_id = ${operator.id}
          AND grants.role = 'creditOperator' AND grants.revoked_at IS NULL AND grants.expires_at > clock_timestamp()
          AND (grants.scope_kind = 'global' OR grants.scope_user_id = ledger.user_id))
      GROUP BY ledger.user_id, ledger.entry_type ORDER BY ledger.user_id, ledger.entry_type
    `;
    const externalSummary = external.map(row => ({ userId: row.userId, type: row.type, count: Number(row.count), netAmount: Number(row.netAmount),
      relatedPresentCount: Number(row.relatedPresentCount), relatedMissingCount: Number(row.relatedMissingCount),
      evidencePresentCount: Number(row.evidencePresentCount), evidenceMissingCount: Number(row.evidenceMissingCount) }));
    const issueCount = accountRows.reduce((sum, account) => sum + account.issues.length, 0)
      + mappedTasks.reduce((sum, task) => sum + task.issues.length, 0)
      + externalSummary.reduce((sum, item) => sum + item.relatedMissingCount + item.evidenceMissingCount, 0);
    return response.json({
      scope: { kind: global ? "global" : "users", userIds: global ? null : grants.map(grant => grant.scopeUserId).filter((id): id is string => Boolean(id)) },
      window: { from, to, timezone: "UTC", taskRange: "createdAt", ledgerRange: "allTime", externalRange: "createdAt" },
      users: { items: accountRows, limit, offset, hasMore: hasMoreUsers, nextOffset: hasMoreUsers ? offset + limit : null },
      tasks: { items: mappedTasks, limit: taskLimit, truncated: tasksTruncated },
      external: externalSummary,
      summary: { accountCount: accountRows.length, taskCount: mappedTasks.length, externalEntryCount: externalSummary.reduce((sum, item) => sum + item.count, 0), issueCount },
      generatedAt: new Date(),
    });
  });
}
