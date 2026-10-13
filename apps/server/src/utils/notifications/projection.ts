import type { Database } from "@/db/database";

export type ServiceNotification = {
  eventId: string;
  category: "task" | "credits" | "support";
  sourceType: "task" | "creditLedger" | "supportTicket";
  sourceId: string;
  title: string;
  summary: string;
  currentStatus: string | null;
  href: string;
  templateVersion: string;
  eventAt: string;
  readAt: string | null;
};

export async function listServiceNotifications(database: Database, userId: string, options: {
  limit: number;
  cursor: { eventAt: string; eventId: string } | null;
  category: "task" | "credits" | "support" | null;
}) {
  return database<ServiceNotification[]>`
    WITH taskEvents AS (
      SELECT DISTINCT ON (attempts.task_id, attempts.phase)
        'task:' || attempts.task_id::text || ':' || attempts.phase AS "eventId",
        'task'::text AS category,
        'task'::text AS "sourceType",
        tasks.id AS "sourceId",
        CASE attempts.phase
          WHEN 'accepted' THEN '任务已提交'
          WHEN 'unknown' THEN '任务曾进入待核查'
          WHEN 'failed' THEN '任务未可靠交付'
          ELSE '任务已可靠交付'
        END AS title,
        CASE attempts.phase
          WHEN 'accepted' THEN '供应商已受理该任务，可在任务中心查看后续状态。'
          WHEN 'unknown' THEN '任务曾处于待核查状态；当前状态以任务中心显示为准，积分预占请查看账单。'
          WHEN 'failed' THEN '该任务曾记录无法交付状态；积分预占处理请查看账单。'
          ELSE '该任务已记录可靠交付；积分结算状态请查看账单。'
        END AS summary,
        tasks.status AS "currentStatus",
        '/tasks' AS href,
        'm12.service.v1' AS "templateVersion",
        attempts.created_at AS "eventAt"
      FROM generation_task_attempts attempts
      JOIN generation_tasks tasks ON tasks.id = attempts.task_id AND tasks.user_id = ${userId}
      WHERE attempts.phase IN ('accepted', 'unknown', 'failed', 'delivered')
      ORDER BY attempts.task_id, attempts.phase, attempts.created_at, attempts.id
    ), creditEvents AS (
      SELECT
        'credit:' || ledger.id::text AS "eventId",
        'credits'::text AS category,
        'creditLedger'::text AS "sourceType",
        ledger.id AS "sourceId",
        CASE ledger.entry_type
          WHEN 'topup' THEN '积分已入账'
          WHEN 'refund' THEN '积分账务已扣回'
          WHEN 'reversal' THEN '积分账务记录已冲正'
          WHEN 'settle' THEN '任务积分已结算'
          ELSE '任务积分预占已释放'
        END AS title,
        CASE ledger.entry_type
          WHEN 'topup' THEN '账本已记录积分入账，可查看对应账单记录。'
          WHEN 'refund' THEN '账本已记录积分扣回；这不是平台退款确认。'
          WHEN 'reversal' THEN '账本已记录冲正，可查看对应账单记录。'
          WHEN 'settle' THEN '可靠交付后的积分结算已记录。'
          ELSE '任务积分预占释放已记录。'
        END AS summary,
        ledger.entry_type AS "currentStatus",
        CASE WHEN ledger.task_id IS NULL THEN '/credits' ELSE '/tasks' END AS href,
        'm12.service.v1' AS "templateVersion",
        ledger.created_at AS "eventAt"
      FROM credit_ledger ledger
      WHERE ledger.user_id = ${userId} AND ledger.entry_type IN ('topup', 'refund', 'reversal', 'settle', 'release')
    ), supportEvents AS (
      SELECT
        'ticket:' || events.id::text AS "eventId",
        'support'::text AS category,
        'supportTicket'::text AS "sourceType",
        tickets.id AS "sourceId",
        CASE events.event_type WHEN 'supportReply' THEN '客服回复了工单' ELSE '工单状态有更新' END AS title,
        CASE
          WHEN events.event_type = 'supportReply' THEN '客服已回复，请在工单对话中查看。'
          WHEN events.details->>'status' = 'waitingUser' THEN '工单等待你补充信息，请打开工单查看客服说明。'
          WHEN events.details->>'status' = 'waitingBusiness' THEN '工单正在等待业务模块核查，关联任务或积分状态保持不变。'
          WHEN events.details->>'status' = 'waitingExternal' THEN '工单正在等待外部核查。'
          WHEN events.details->>'status' = 'solutionPending' THEN '工单已有处理说明，请查看客服回复并确认。'
          WHEN events.details->>'status' = 'closed' THEN '工单已结案；结案不会自动改变关联任务或积分状态。'
          ELSE '工单状态已更新，请查看当前处理进度。'
        END AS summary,
        tickets.status AS "currentStatus",
        '/support?ticketId=' || tickets.id::text AS href,
        'm12.service.v1' AS "templateVersion",
        events.created_at AS "eventAt"
      FROM support_ticket_events events
      JOIN support_tickets tickets ON tickets.id = events.ticket_id AND tickets.owner_id = ${userId}
      WHERE events.event_type IN ('supportReply', 'statusChanged')
    ), events AS (
      SELECT * FROM taskEvents
      UNION ALL
      SELECT * FROM creditEvents
      UNION ALL
      SELECT * FROM supportEvents
    )
    SELECT events."eventId", events.category, events."sourceType", events."sourceId", events.title,
      events.summary, events."currentStatus", events.href, events."templateVersion",
      events."eventAt"::text AS "eventAt", receipts.read_at::text AS "readAt"
    FROM events
    LEFT JOIN notification_read_receipts receipts
      ON receipts.user_id = ${userId} AND receipts.event_id = events."eventId"
    WHERE (${options.category}::text IS NULL OR events.category = ${options.category})
      AND (${options.cursor?.eventAt ?? null}::timestamptz IS NULL
      OR (events."eventAt", events."eventId") < (${options.cursor?.eventAt ?? null}::timestamptz, ${options.cursor?.eventId ?? null}))
    ORDER BY events."eventAt" DESC, events."eventId" DESC
    LIMIT ${options.limit + 1}
  `;
}

export function encodeNotificationCursor(eventAt: string, eventId: string) {
  return Buffer.from(JSON.stringify({ eventAt, eventId })).toString("base64url");
}
