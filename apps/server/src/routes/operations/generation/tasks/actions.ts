import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, requireRole, type User } from "@/utils/operations/access";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsGenerationTaskActionsRoute(database: Database) {
  return Router().post("/:taskId/actions", async (request, response) => {
    const operator = response.locals.user as User;
    const taskId = request.params.taskId;
    const { action, idempotencyKey } = request.body ?? {};
    if (typeof taskId !== "string" || !idPattern.test(taskId)
      || !["continueQuery", "retrieveResult"].includes(action)
      || typeof idempotencyKey !== "string" || !idPattern.test(idempotencyKey)) {
      throw fail(400, "原任务查询请求无效。");
    }
    const owners = await database<{ userId: string }[]>`SELECT user_id AS "userId" FROM generation_tasks WHERE id = ${taskId}`;
    if (!owners[0]) throw fail(404, "任务不存在。");
    const result = await database.begin(async transaction => {
      try { await requireRole(database, operator, "modelOperator", owners[0].userId, transaction); }
      catch (error) {
        if (typeof error === "object" && error && "status" in error && Number(error.status) === 403) throw fail(404, "任务不存在。");
        throw error;
      }
      const rows = await transaction<{ id: string; status: string; claimToken: string | null; claimUntil: Date | null }[]>`
        SELECT id, status, worker_claim_token AS "claimToken", worker_claimed_until AS "claimUntil"
        FROM generation_tasks WHERE id = ${taskId} FOR UPDATE
      `;
      const task = rows[0];
      if (!task) throw fail(404, "任务不存在。");
      const prior = await transaction<{ eventType: string }[]>`
        SELECT event_type AS "eventType" FROM generation_task_events
        WHERE task_id = ${taskId} AND actor_id = ${operator.id} AND idempotency_key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].eventType !== `operator${action[0].toUpperCase()}${action.slice(1)}`) throw fail(409, "幂等标识已用于其他操作。");
        return { idempotent: true };
      }
      if (!["unknown", "running"].includes(task.status)) throw fail(409, "当前状态不能继续查询或取回原任务。");
      if (task.claimToken && task.claimUntil && new Date(task.claimUntil).getTime() > Date.now()) {
        throw fail(409, "原任务仍在处理中，请稍后刷新待办。");
      }
      const eventType = `operator${action[0].toUpperCase()}${action.slice(1)}`;
      await transaction`
        INSERT INTO generation_task_events (id, task_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${taskId}, ${operator.id}, 'modelOperator', ${eventType}, 'operator', ${idempotencyKey},
          ${JSON.stringify({ message: action === "retrieveResult" ? "运营已请求从原任务重新取得结果。" : "运营已请求继续查询原任务。" })}::text::jsonb)
      `;
      await transaction`UPDATE generation_tasks SET last_checked_at = NULL, updated_at = now() WHERE id = ${taskId}`;
      return { idempotent: false };
    });
    return response.json({ message: result.idempotent ? "该原任务查询请求已登记。" : "已登记对原任务的查询请求。", idempotent: result.idempotent });
  });
}
