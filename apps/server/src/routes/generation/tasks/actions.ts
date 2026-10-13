import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { releaseGenerationTask } from "@/utils/generation/settlement";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = ["continueQuery", "retrieveResult", "requestCancel"] as const;

export function createGenerationTaskActionsRoute(database: Database) {
  return Router().post("/:taskId/actions", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const taskId = request.params.taskId;
    const { action, idempotencyKey } = request.body ?? {};
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (typeof taskId !== "string" || !idPattern.test(taskId)) return response.status(404).json({ message: "任务不存在。" });
    if (!actions.includes(action) || typeof idempotencyKey !== "string" || !idPattern.test(idempotencyKey)) {
      return response.status(400).json({ message: "任务操作信息无效。" });
    }
    const result = await database.begin(async transaction => {
      const rows = await transaction<{
        id: string; status: string; claimToken: string | null; claimUntil: Date | null; submissionStartedAt: Date | null;
      }[]>`
        SELECT id, status, worker_claim_token AS "claimToken", worker_claimed_until AS "claimUntil",
          submission_started_at AS "submissionStartedAt"
        FROM generation_tasks WHERE id = ${taskId} AND user_id = ${user.id} FOR UPDATE
      `;
      const task = rows[0];
      if (!task) return { status: 404, message: "任务不存在。" };
      const previous = await transaction<{ eventType: string }[]>`
        SELECT event_type AS "eventType" FROM generation_task_events
        WHERE task_id = ${taskId} AND actor_id = ${user.id} AND idempotency_key = ${idempotencyKey}
      `;
      if (previous[0]) return previous[0].eventType === action
        ? { status: 200, message: "操作已记录。", idempotent: true }
        : { status: 409, message: "幂等标识已用于其他操作。" };

      const leaseActive = task.claimToken && task.claimUntil && new Date(task.claimUntil).getTime() > Date.now();
      if (action === "requestCancel" && task.status === "queued" && !task.submissionStartedAt && !leaseActive) {
        await transaction`
          INSERT INTO generation_task_events (id, task_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
          VALUES (${randomUUID()}, ${taskId}, ${user.id}, 'user', ${action}, 'user', ${idempotencyKey},
            '{"message":"已记录取消请求；任务尚未提交，正在释放预占。"}'::jsonb)
        `;
        const updated = await transaction<{ id: string }[]>`
          UPDATE generation_tasks SET status = 'failed', safe_error = '任务在提交前收到取消请求。',
            worker_claim_token = NULL, worker_claimed_until = NULL, updated_at = now()
          WHERE id = ${taskId} AND status = 'queued' AND submission_started_at IS NULL
            AND (worker_claimed_until IS NULL OR worker_claimed_until <= now()) RETURNING id
        `;
        if (!updated[0]) return { status: 409, message: "任务状态已变化，请刷新后查看。" };
        await releaseGenerationTask(transaction, taskId, "用户取消请求；平台确认供应商提交尚未开始");
        return { status: 200, message: "已确认任务尚未提交，预占积分已释放。" };
      }
      if (action === "requestCancel") {
        if (["delivered", "failed"].includes(task.status)) return { status: 409, message: "任务已结束，不能再请求取消。" };
        await transaction`
          INSERT INTO generation_task_events (id, task_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
          VALUES (${randomUUID()}, ${taskId}, ${user.id}, 'user', ${action}, 'user', ${idempotencyKey},
            '{"message":"已记录取消请求；当前渠道未接入自动取消命令，任务仍可能继续执行并会继续查询原任务。"}'::jsonb)
        `;
        if (!leaseActive) await transaction`UPDATE generation_tasks SET last_checked_at = NULL, updated_at = now() WHERE id = ${taskId}`;
        return { status: 200, message: "已记录取消请求；当前渠道未接入自动取消命令，任务仍可能继续执行。" };
      }
      if (!["unknown", "running"].includes(task.status)) return { status: 409, message: "当前任务状态不支持继续查询或取回。" };
      if (leaseActive) return { status: 409, message: "原任务正在处理中，请稍后刷新。" };
      await transaction`
        INSERT INTO generation_task_events (id, task_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${taskId}, ${user.id}, 'user', ${action}, 'user', ${idempotencyKey},
          ${JSON.stringify({ message: action === "retrieveResult" ? "已请求从原任务重新取得结果。" : "已请求继续查询原任务状态。" })}::text::jsonb)
      `;
      await transaction`UPDATE generation_tasks SET last_checked_at = NULL, updated_at = now() WHERE id = ${taskId}`;
      return { status: 200, message: action === "retrieveResult" ? "已请求重新取得原任务结果。" : "已请求继续查询原任务。" };
    });
    return response.status(result.status).json({ message: result.message, ...(result.idempotent ? { idempotent: true } : {}) });
  });
}
