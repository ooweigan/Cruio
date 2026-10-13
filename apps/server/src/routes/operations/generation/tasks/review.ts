import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, requireRole, verifyPassword, type User } from "@/utils/operations/access";
import { releaseGenerationTask } from "@/utils/generation/settlement";
import { readStagedArkAcceptance, readStagedOpenAiOutput, validateImageOutput } from "@/utils/generation/provider";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsGenerationTaskReviewRoute(database: Database, storageDirectory: string) {
  return Router().post("/:taskId/review", async (request, response) => {
    const operator = response.locals.user as User;
    const taskId = request.params.taskId;
    const { outcome, supplierEvidence, supplierReference, platformEvidence, platformAttemptId, reason, currentPassword, idempotencyKey, expectedUpdatedAt } = request.body ?? {};
    if (typeof taskId !== "string" || !idPattern.test(taskId) || outcome !== "finalUndeliverable"
      || typeof supplierEvidence !== "string" || supplierEvidence.trim().length < 20 || supplierEvidence.trim().length > 3000
      || typeof supplierReference !== "string" || supplierReference.trim().length < 6 || supplierReference.trim().length > 256
      || typeof platformEvidence !== "string" || platformEvidence.trim().length < 20 || platformEvidence.trim().length > 3000
      || typeof platformAttemptId !== "string" || !idPattern.test(platformAttemptId)
      || typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 1000
      || typeof idempotencyKey !== "string" || !idPattern.test(idempotencyKey)
      || typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
      throw fail(400, "最终无法交付核查信息无效；请填写供应商原任务证据、平台取得/访问失败证据和结论依据。 ");
    }
    await verifyPassword(database, operator.id, currentPassword);
    const taskOwner = await database<{ userId: string }[]>`SELECT user_id AS "userId" FROM generation_tasks WHERE id = ${taskId}`;
    if (!taskOwner[0]) throw fail(404, "任务不存在。");
    const result = await database.begin(async transaction => {
      try { await requireRole(database, operator, "modelOperator", taskOwner[0].userId, transaction); }
      catch (error) {
        if (typeof error === "object" && error && "status" in error && Number(error.status) === 403) throw fail(404, "任务不存在。");
        throw error;
      }
      const tasks = await transaction<{
        id: string; status: string; providerTaskId: string | null; snapshot: Record<string, unknown>;
        claimToken: string | null; claimUntil: Date | null;
      }[]>`
        SELECT id, status, provider_task_id AS "providerTaskId", snapshot, worker_claim_token AS "claimToken",
          worker_claimed_until AS "claimUntil"
        FROM generation_tasks WHERE id = ${taskId} AND user_id = ${taskOwner[0].userId} FOR UPDATE
      `;
      const task = tasks[0];
      if (!task) throw fail(404, "任务不存在。");
      const prior = await transaction<{ eventType: string }[]>`
        SELECT event_type AS "eventType" FROM generation_task_events
        WHERE task_id = ${taskId} AND actor_id = ${operator.id} AND idempotency_key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].eventType !== outcome) throw fail(409, "幂等标识已用于其他操作。");
        return { idempotent: true };
      }
      if (task.status === "delivered") throw fail(409, "任务已可靠交付，不能通过人工核查覆盖。");
      if (!["unknown", "failed", "running"].includes(task.status)) throw fail(409, "只有待核查、处理中或明确失败任务可登记最终无法交付。");
      const matches = await transaction<{ matches: boolean }[]>`
        SELECT updated_at = ${expectedUpdatedAt}::timestamptz AS matches FROM generation_tasks WHERE id = ${taskId}
      `;
      if (!matches[0]?.matches) throw fail(409, "任务状态已变化，请刷新核查记录。");
      if (task.claimToken && task.claimUntil && new Date(task.claimUntil).getTime() > Date.now()) {
        throw fail(409, "任务仍有活动处理租约，暂不能作最终核查。");
      }
      if (task.providerTaskId && supplierReference.trim() !== task.providerTaskId) {
        throw fail(400, "供应商证据引用必须与任务保存的原供应商任务标识一致。");
      }
      if (!task.providerTaskId && !supplierReference.trim().startsWith("未受理核查：")) {
        throw fail(400, "任务没有供应商任务标识；请以“未受理核查：”注明查询依据。");
      }
      const attempts = await transaction<{ id: string; safeError: string | null; phase: string; providerTaskId: string | null }[]>`
        SELECT id, phase, safe_error AS "safeError", provider_task_id AS "providerTaskId" FROM generation_task_attempts
        WHERE id = ${platformAttemptId} AND task_id = ${taskId}
      `;
      if (!attempts[0] || !["unknown", "failed"].includes(attempts[0].phase) || !attempts[0].safeError) {
        throw fail(400, "平台取得／访问失败证据必须关联本任务中真实记录的失败尝试。");
      }
      const snapshot = typeof task.snapshot === "string" ? JSON.parse(task.snapshot) as Record<string, unknown> : task.snapshot;
      const model = snapshot.model as Record<string, unknown> | undefined;
      let openAiStageEvidence: { sha256: string; byteLength: number; failureKind: string } | undefined;
      if (model?.protocol === "volcengine_ark_video") {
        let acceptance;
        try { acceptance = await readStagedArkAcceptance(storageDirectory, taskOwner[0].userId, taskId); }
        catch { throw fail(409, "检测到供应商响应暂存，先继续查询或取回原任务，不登记最终失败。"); }
        if (acceptance && (!task.providerTaskId || task.providerTaskId !== acceptance.taskId)) {
          throw fail(409, "暂存的供应商原任务标识尚未与任务状态核对一致，先恢复并查询原任务。");
        }
        if (acceptance && attempts[0].providerTaskId !== acceptance.taskId) {
          throw fail(409, "供应商原任务标识已恢复，但尚无该原任务的查询／取回失败记录；先继续查询原任务。");
        }
      } else if (model?.protocol === "openai_images") {
        const staged = await readStagedOpenAiOutput(storageDirectory, taskOwner[0].userId, taskId);
        if (staged.kind === "transientIo" || staged.kind === "tooLarge") {
          throw fail(409, "原响应暂时无法安全核验；请恢复读取后再继续，不登记最终失败。");
        }
        if (staged.kind === "staged") {
          let hasDeliverableOutput = false;
          let decodeFailed = false;
          let validationUnavailable = false;
          for (const output of staged.outputs) {
            try { await validateImageOutput(output.bytes); hasDeliverableOutput = true; }
            catch (error) {
              if (typeof error === "object" && error && "contentInvalid" in error) decodeFailed = true;
              else validationUnavailable = true;
            }
          }
          if (validationUnavailable) throw fail(409, "图片解码核验暂时不可用；恢复系统核验后再继续。");
          if (hasDeliverableOutput) throw fail(409, "原响应至少包含一张可完整解码的图片，须先完成原结果交付核验。");
          const failureKind = decodeFailed ? "imageDecodeInvalid" : staged.failureKind;
          if (!failureKind) throw fail(409, "原响应尚无可核验的失败内容记录，不能登记最终无法交付。");
          const evidence = await transaction<{ id: string }[]>`
            SELECT id FROM generation_task_events
            WHERE task_id = ${taskId} AND actor_role = 'worker' AND event_type = 'stagedOutputUnusable'
              AND visibility = 'operator' AND details->>'attemptId' = ${platformAttemptId}
              AND details->>'stageSha256' = ${staged.sha256} AND details->>'failureKind' = ${failureKind}
              AND (details->>'byteLength')::bigint = ${staged.byteLength}
            LIMIT 1
          `;
          if (!evidence.length) throw fail(409, "原响应内容尚未由同一次真实恢复尝试记录为不可用，先继续恢复核查。");
          openAiStageEvidence = { sha256: staged.sha256, byteLength: staged.byteLength, failureKind };
        }
      } else throw fail(409, "当前渠道没有可验证的私有结果暂存规则，任务继续待核查。");
      const results = await transaction`SELECT 1 FROM generation_results WHERE task_id = ${taskId} LIMIT 1`;
      if (results.length) throw fail(409, "任务仍有关联结果，须先核实结果是否可交付。");
      const updated = await transaction<{ id: string }[]>`
        UPDATE generation_tasks SET status = 'failed', safe_error = '经人工核查，任务结果无法交付。',
          worker_claim_token = NULL, worker_claimed_until = NULL, updated_at = now()
        WHERE id = ${taskId} AND status IN ('unknown', 'failed', 'running') AND updated_at = ${expectedUpdatedAt}::timestamptz
          AND (worker_claimed_until IS NULL OR worker_claimed_until <= now())
        RETURNING id
      `;
      if (!updated[0]) throw fail(409, "任务状态已变化，请刷新核查记录。");
      await releaseGenerationTask(transaction, taskId, `经受限模型运营核查最终无法交付：${reason.trim()}`);
      await transaction`
        INSERT INTO generation_task_events (id, task_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${taskId}, ${operator.id}, 'modelOperator', ${outcome}, 'operator', ${idempotencyKey},
          ${JSON.stringify({ supplierReference: supplierReference.trim(), supplierEvidence: supplierEvidence.trim(),
            platformAttemptId, platformEvidence: platformEvidence.trim(), reason: reason.trim(), ...(openAiStageEvidence ? { openAiStageEvidence } : {}) })}::text::jsonb)
      `;
      return { idempotent: false };
    });
    return response.json({ outcome, message: result.idempotent ? "该核查操作已登记。" : "最终无法交付已登记，预占积分已按账务规则释放。", idempotent: result.idempotent });
  });
}
