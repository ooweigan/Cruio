import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, requireRole, verifyPassword } from "@/utils/operations/access";
import { isValidPrivacyTimestamp, privacyObjectStatuses, privacyReasonCodes, uuidPattern, verifyPrivacySourceOutcome } from "@/utils/privacy/requests";
import type { PrivacyObjectStatus, PrivacyRequestObject } from "@/utils/privacy/requests";

type User = { id: string; email: string };
type ObjectUpdate = { objectId: string; status: PrivacyObjectStatus; reasonCode: string | null; userReason: string; internalReason: string; evidenceRef: string | null };
const requestStatuses = ["received", "identityReview", "awaitingUser", "processing", "partiallyCompleted", "completed", "partiallyRefused", "appealReview", "closed"] as const;
const terminalObjectStatuses = new Set<PrivacyObjectStatus>(["partial", "completed", "restricted", "softDeleted", "retained", "refused"]);

export function createOperationsPrivacyRequestActionRoute(database: Database) {
  return Router().post("/:requestId/actions", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const requestId = request.params.requestId;
    const body = request.body ?? {};
    const { currentPassword, expectedUpdatedAt, idempotencyKey, requestStatus, userMessage, internalNote } = body;
    if (!uuidPattern.test(requestId) || typeof currentPassword !== "string" || !isValidPrivacyTimestamp(expectedUpdatedAt)
      || typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey)
      || (requestStatus !== undefined && !requestStatuses.includes(requestStatus))
      || (userMessage !== undefined && (typeof userMessage !== "string" || userMessage.trim().length > 1000))
      || (internalNote !== undefined && (typeof internalNote !== "string" || internalNote.trim().length > 2000))
      || !Array.isArray(body.objectUpdates) || body.objectUpdates.length > 20) {
      throw fail(400, "隐私申请操作信息无效。");
    }
    const objectUpdates: ObjectUpdate[] = body.objectUpdates.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw fail(400, "对象处理信息无效。");
      const item = entry as Record<string, unknown>;
      const status = item.status;
      const reasonCode = item.reasonCode ?? null;
      const userReason = typeof item.userReason === "string" ? item.userReason.trim() : "";
      const internalReason = typeof item.internalReason === "string" ? item.internalReason.trim() : "";
      const evidenceRef = item.evidenceRef ?? null;
      if (typeof item.objectId !== "string" || !uuidPattern.test(item.objectId)
        || typeof status !== "string" || !privacyObjectStatuses.includes(status as PrivacyObjectStatus)
        || (reasonCode !== null && (typeof reasonCode !== "string" || !privacyReasonCodes.includes(reasonCode as typeof privacyReasonCodes[number])))
        || userReason.length > 1000 || internalReason.length > 2000
        || (evidenceRef !== null && (typeof evidenceRef !== "string" || evidenceRef.length > 500))) {
        throw fail(400, "对象处理信息无效。");
      }
      return { objectId: item.objectId, status: status as PrivacyObjectStatus, reasonCode: reasonCode as string | null, userReason, internalReason, evidenceRef: evidenceRef as string | null };
    });
    if (new Set(objectUpdates.map(item => item.objectId)).size !== objectUpdates.length
      || (!requestStatus && !userMessage?.trim() && !internalNote?.trim() && objectUpdates.length === 0)) throw fail(400, "操作内容为空或对象重复。");
    if (objectUpdates.some(item => (["partial", "retained", "refused"].includes(item.status) && !item.reasonCode)
      || (item.status === "partial" && (!item.userReason || !item.evidenceRef)))) throw fail(400, "部分处理、保留或拒绝结果需要说明原因；部分处理还需受控证据引用。");
    await verifyPassword(database, user.id, currentPassword);
    const action = { requestStatus: requestStatus ?? null, userMessage: typeof userMessage === "string" ? userMessage.trim() : "", internalNote: typeof internalNote === "string" ? internalNote.trim() : "", objectUpdates };
    const actionHash = createHash("sha256").update(JSON.stringify(action)).digest("hex");
    const result = await database.begin(async transaction => {
      const rows = await transaction<{ id: string; ownerId: string; category: string; status: string; updatedAt: string }[]>`
        SELECT id, owner_id AS "ownerId", category, status, updated_at::text AS "updatedAt"
        FROM privacy_requests WHERE id = ${requestId} FOR UPDATE
      `;
      if (!rows[0]) throw fail(404, "隐私申请不存在。");
      try { await requireRole(transaction, user, "privacyOperator", rows[0].ownerId, transaction); }
      catch (error) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 403) throw fail(404, "隐私申请不存在。");
        throw error;
      }
      const prior = await transaction<{ details: { actionHash?: string } }[]>`
        SELECT details FROM privacy_request_events WHERE request_id = ${requestId} AND actor_id = ${user.id} AND idempotency_key = ${idempotencyKey}
      `;
      if (prior[0]) {
        if (prior[0].details?.actionHash !== actionHash) throw fail(409, "幂等标识已用于其他操作。");
        return { requestId, status: rows[0].status, idempotent: true };
      }
      if (rows[0].updatedAt !== expectedUpdatedAt) throw fail(409, "申请已更新，请刷新后重新核查。");
      const objects = await transaction<{ id: string; objectType: string; sourceId: string | null; requestedAction: string; status: PrivacyObjectStatus; userReason: string }[]>`
        SELECT id, object_type AS "objectType", source_id AS "sourceId", requested_action AS "requestedAction", status, user_reason AS "userReason"
        FROM privacy_request_objects WHERE request_id = ${requestId} ORDER BY id FOR UPDATE
      `;
      const priorStatusIsTerminal = ["completed", "partiallyCompleted", "partiallyRefused", "closed"].includes(rows[0].status);
      const reopeningForAppeal = priorStatusIsTerminal && requestStatus === "appealReview";
      if (requestStatus === "received" && rows[0].status !== "received") throw fail(409, "申请进入核查后不能退回已收到状态。");
      if (requestStatus === "identityReview" && !["received", "identityReview"].includes(rows[0].status)) throw fail(409, "当前状态不能退回身份核验阶段。");
      for (const update of objectUpdates) {
        const saved = objects.find(item => item.id === update.objectId);
        if (!saved) throw fail(404, "申请对象不存在。");
        if (terminalObjectStatuses.has(saved.status) && saved.status !== update.status && !reopeningForAppeal && rows[0].status !== "appealReview") {
          throw fail(409, "已形成的对象结论只能在申请复核期间调整。");
        }
        const source = { objectType: saved.objectType, objectId: saved.sourceId } as PrivacyRequestObject;
        if (update.status === "restricted" || update.status === "softDeleted") {
          if (!await verifyPrivacySourceOutcome(transaction, rows[0].ownerId, source, saved.requestedAction as never, update.status)) {
            throw fail(409, "对应源事实尚未确认该处理结果；状态未更新。");
          }
        }
        if (update.status === "completed" && (rows[0].category !== "explanation" || saved.requestedAction !== "explanation")) {
          throw fail(409, "当前申请类别没有已实现的完成交付操作，不能登记为已完成。");
        }
        await transaction`
          UPDATE privacy_request_objects SET status = ${update.status}, reason_code = ${update.reasonCode},
            user_reason = ${update.userReason}, internal_reason = ${update.internalReason}, evidence_ref = ${update.evidenceRef}, updated_at = clock_timestamp()
          WHERE id = ${update.objectId} AND request_id = ${requestId}
        `;
        if (update.userReason || terminalObjectStatuses.has(update.status)) {
          await transaction`
            INSERT INTO privacy_request_events (id, request_id, object_id, actor_id, actor_role, event_type, visibility, details)
            VALUES (${randomUUID()}, ${requestId}, ${update.objectId}, ${user.id}, 'privacyOperator', 'objectStatusChanged', 'user',
              ${JSON.stringify({ status: update.status, reason: update.userReason || "处理状态已更新。" })}::text::jsonb)
          `;
        }
        await transaction`
          INSERT INTO privacy_request_events (id, request_id, object_id, actor_id, actor_role, event_type, visibility, details)
          VALUES (${randomUUID()}, ${requestId}, ${update.objectId}, ${user.id}, 'privacyOperator', 'objectReviewed', 'operator',
            ${JSON.stringify({ status: update.status, reasonCode: update.reasonCode, internalReason: update.internalReason, evidenceRef: update.evidenceRef })}::text::jsonb)
        `;
      }
      const resultingObjects = objects.map(item => objectUpdates.find(update => update.objectId === item.id)?.status ?? item.status);
      let nextStatus = requestStatus ?? rows[0].status;
      const isTerminalRequest = priorStatusIsTerminal;
      if (isTerminalRequest && nextStatus !== "appealReview") throw fail(409, "已结束的申请只能进入复核，不能直接改回处理中状态。");
      if (nextStatus === "appealReview" && !userMessage?.trim()) throw fail(400, "进入复核时需要向申请人说明后续安排。");
      const hasExplanation = Boolean(userMessage?.trim()) || objects.some(item =>
        (objectUpdates.find(update => update.objectId === item.id)?.userReason ?? item.userReason).trim().length > 0,
      );
      if (nextStatus === "completed" && (rows[0].category !== "explanation" || resultingObjects.some(status => status !== "completed") || !hasExplanation)) {
        throw fail(409, "该申请尚无可核验的完整交付结果，不能关闭为已完成。");
      }
      if (nextStatus === "partiallyCompleted" && (resultingObjects.length === 0 || resultingObjects.some(status => !terminalObjectStatuses.has(status))
        || !resultingObjects.some(status => ["completed", "restricted", "softDeleted", "partial"].includes(status)) || !userMessage?.trim())) {
        throw fail(409, "部分完成需要逐对象处理结论和用户可见说明。");
      }
      if (nextStatus === "partiallyRefused" && (resultingObjects.length === 0 || resultingObjects.some(status => !terminalObjectStatuses.has(status))
        || !resultingObjects.includes("refused") || !userMessage?.trim())) throw fail(409, "部分拒绝需要逐对象结论和用户可见说明。");
      if (nextStatus === "closed" && (resultingObjects.some(status => !terminalObjectStatuses.has(status)) || !userMessage?.trim())) {
        throw fail(409, "所有对象均有明确结论并提供用户说明后才能关闭申请。");
      }
      if (requestStatus !== undefined && ["completed", "partiallyCompleted", "partiallyRefused"].includes(requestStatus)
        && rows[0].category !== "explanation" && requestStatus === "completed") throw fail(409, "当前申请没有已实现的源数据交付操作，不能登记为完成。");
      if (userMessage?.trim()) {
        await transaction`
          INSERT INTO privacy_request_events (id, request_id, actor_id, actor_role, event_type, visibility, details)
          VALUES (${randomUUID()}, ${requestId}, ${user.id}, 'privacyOperator', 'operatorReply', 'user',
            ${JSON.stringify({ message: userMessage.trim() })}::text::jsonb)
        `;
      }
      if (internalNote?.trim()) {
        await transaction`
          INSERT INTO privacy_request_events (id, request_id, actor_id, actor_role, event_type, visibility, details)
          VALUES (${randomUUID()}, ${requestId}, ${user.id}, 'privacyOperator', 'operatorNote', 'operator',
            ${JSON.stringify({ note: internalNote.trim() })}::text::jsonb)
        `;
      }
      await transaction`
        INSERT INTO privacy_request_events (id, request_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${requestId}, ${user.id}, 'privacyOperator', 'operatorAction', 'operator', ${idempotencyKey},
          ${JSON.stringify({ actionHash, requestStatus: nextStatus })}::text::jsonb)
      `;
      const changed = await transaction<{ status: string }[]>`
        UPDATE privacy_requests SET status = ${nextStatus},
          closed_at = CASE WHEN ${nextStatus} IN ('closed', 'completed', 'partiallyCompleted', 'partiallyRefused') THEN COALESCE(closed_at, clock_timestamp()) ELSE NULL END,
          updated_at = clock_timestamp()
        WHERE id = ${requestId} AND updated_at = ${expectedUpdatedAt}::timestamptz
        RETURNING status
      `;
      if (!changed[0]) throw fail(409, "申请已更新，请刷新后重新核查。");
      return { requestId, status: changed[0].status, idempotent: false };
    });
    return response.json(result);
  });
}
