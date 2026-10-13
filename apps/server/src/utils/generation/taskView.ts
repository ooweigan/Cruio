import type { Database } from "@/db/database";

type TaskRow = {
  id: string; status: string; snapshot: Record<string, unknown>; safeError: string | null;
  createdAt: Date; updatedAt: Date; projectId: string; quoted: number;
};

export async function readGenerationTask(database: Database, userId: string, taskId: string) {
  const rows = await database<TaskRow[]>`
    SELECT tasks.id, tasks.status, tasks.snapshot, tasks.safe_error AS "safeError",
      tasks.created_at AS "createdAt", tasks.updated_at AS "updatedAt", tasks.project_id AS "projectId",
      quotes.credits AS quoted
    FROM generation_tasks AS tasks JOIN generation_quotes AS quotes ON quotes.id = tasks.quote_id
    WHERE tasks.id = ${taskId} AND tasks.user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return null;
  const snapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
  const model = snapshot.model as Record<string, unknown>;
  const ledger = await database<{
    hasReserve: boolean;
    reserveCount: number;
    reserveAmount: number | string;
    reservedDelta: number | string;
    settleCount: number;
    settlementAmount: number | string;
    settlementDelta: number | string;
    releaseCount: number;
    releaseAmount: number | string;
    releaseDelta: number | string;
  }[]>`
    SELECT count(*) FILTER (WHERE entry_type = 'reserve') > 0 AS "hasReserve",
      count(*) FILTER (WHERE entry_type = 'reserve') AS "reserveCount",
      COALESCE(sum(amount) FILTER (WHERE entry_type = 'reserve'), 0) AS "reserveAmount",
      COALESCE(sum(reserved_delta) FILTER (WHERE entry_type = 'reserve'), 0) AS "reservedDelta",
      count(*) FILTER (WHERE entry_type = 'settle') AS "settleCount",
      COALESCE(sum(amount) FILTER (WHERE entry_type = 'settle'), 0) AS "settlementAmount",
      COALESCE(sum(reserved_delta) FILTER (WHERE entry_type = 'settle'), 0) AS "settlementDelta",
      count(*) FILTER (WHERE entry_type = 'release') AS "releaseCount",
      COALESCE(sum(amount) FILTER (WHERE entry_type = 'release'), 0) AS "releaseAmount",
      COALESCE(sum(reserved_delta) FILTER (WHERE entry_type = 'release'), 0) AS "releaseDelta"
    FROM credit_ledger WHERE task_id = ${row.id}
  `;
  const quote = Number(row.quoted);
  const hasReserve = ledger[0]?.hasReserve ?? false;
  const reserveCount = Number(ledger[0]?.reserveCount ?? 0);
  const reserveAmount = Number(ledger[0]?.reserveAmount ?? 0);
  const reservedInitially = Number(ledger[0]?.reservedDelta ?? 0);
  const settleCount = Number(ledger[0]?.settleCount ?? 0);
  const settlementAmount = Number(ledger[0]?.settlementAmount ?? 0);
  const settlementDelta = Number(ledger[0]?.settlementDelta ?? 0);
  const releaseCount = Number(ledger[0]?.releaseCount ?? 0);
  const releaseAmount = Number(ledger[0]?.releaseAmount ?? 0);
  const releaseDelta = Number(ledger[0]?.releaseDelta ?? 0);
  const settled = Math.max(0, -settlementAmount);
  const released = Math.max(0, -releaseDelta);
  const rawReserved = hasReserve ? reservedInitially + settlementDelta + releaseDelta : 0;
  const ledgerNeedsReview = (hasReserve && (reserveCount !== 1 || reserveAmount !== 0 || reservedInitially !== quote))
    || settleCount > 1 || settlementAmount > 0 || settlementAmount !== settlementDelta
    || releaseCount > 1 || releaseAmount !== 0 || releaseDelta > 0
    || rawReserved < 0 || settled > reservedInitially || released > reservedInitially;
  const reserved = Math.max(0, rawReserved);
  const results = row.status === "delivered" ? await database<{
    id: string; mediaType: string; mimeType: string;
  }[]>`
    SELECT id, media_type AS "mediaType", mime_type AS "mimeType"
    FROM generation_results WHERE task_id = ${row.id} AND user_id = ${userId} ORDER BY created_at
  ` : [];
  const latestAdoptions = typeof snapshot.nodeId === "string" ? await database<{
    resultId: string; adoptionVersion: number;
  }[]>`
    SELECT result_id AS "resultId", adoption_version AS "adoptionVersion"
    FROM generation_result_adoptions
    WHERE user_id = ${userId} AND project_id = ${row.projectId}
      AND workflow_id IS NOT DISTINCT FROM ${typeof snapshot.workflowId === "string" ? snapshot.workflowId : null}
      AND node_id = ${snapshot.nodeId}
    ORDER BY adoption_version DESC, created_at DESC LIMIT 1
  ` : [];
  const latestAdoption = latestAdoptions[0];
  const adopted = latestAdoption && results.some(result => result.id === latestAdoption.resultId)
    ? latestAdoption : undefined;
  const cancelledBeforeSubmit = row.status === "failed" && row.safeError === "任务在提交前收到取消请求。";
  const failure = cancelledBeforeSubmit
    ? "任务已在供应商提交前取消，预占积分已释放。"
    : row.status === "unknown"
    ? `任务状态待核查，${reserved > 0 ? "预占积分仍保留。" : "账本未记录剩余预占。"}`
    : row.status === "failed" ? `${row.safeError ?? "生成未能交付。"}${released > 0 ? "预占积分已释放。" : reserved > 0 ? "预占积分尚未释放。" : ""}` : undefined;
  const attempts = await database<{ phase: string; safeError: string | null; createdAt: Date }[]>`
    SELECT phase, safe_error AS "safeError", created_at AS "createdAt"
    FROM generation_task_attempts WHERE task_id = ${row.id} ORDER BY created_at
  `;
  const events = await database<{ eventType: string; details: { message?: string }; createdAt: Date }[]>`
    SELECT event_type AS "eventType", details, created_at AS "createdAt"
    FROM generation_task_events WHERE task_id = ${row.id} AND visibility = 'user' ORDER BY created_at
  `;
  const timeline = [
    ...attempts.map(attempt => ({ type: attempt.phase, message: attempt.safeError ?? undefined, createdAt: attempt.createdAt })),
    ...events.map(event => ({ type: event.eventType, message: event.details?.message, createdAt: event.createdAt })),
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  return {
    taskId: row.id,
    status: cancelledBeforeSubmit ? "cancelled" : row.status,
    operation: snapshot.operation,
    nodeId: snapshot.nodeId,
    workflowId: typeof snapshot.workflowId === "string" ? snapshot.workflowId : null,
    adoptedResultId: adopted?.resultId ?? null,
    adoptionVersion: adopted?.adoptionVersion ?? null,
    modelSnapshot: { providerLabel: model.providerLabel, modelId: model.modelId, modelVersion: model.modelVersion, region: model.region },
    credits: { quoted: quote, reserved, settled, released, ...(ledgerNeedsReview ? { needsReview: true } : {}) },
    blocks: [],
    timeline,
    results: results.map(result => ({ resultId: result.id, mediaType: result.mediaType, mimeType: result.mimeType,
      previewUrl: `/api/generation/results/${result.id}/read`, downloadUrl: `/api/generation/results/${result.id}/read?download=true` })),
    ...(failure ? { failure } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
