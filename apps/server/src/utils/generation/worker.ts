import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "@/db/database";
import { releaseGenerationTask, settleGenerationTask } from "@/utils/generation/settlement";
import { withGenerationDispatchAuthorization } from "@/utils/generation/modelGovernance";
import {
  adapterBlock, clearStagedProviderResponse, queryArkTask, readStagedArkAcceptance, readStagedOpenAiOutput,
  retrieveArkOutput, submitGeneration, validateImageOutput,
} from "@/utils/generation/provider";
import type { GenerationModel, GenerationSnapshot, ProviderStatus } from "@/utils/generation/provider";
import {
  findVideoToolchain, persistGenerationOutputs, removeStoredGenerationOutput, validateVideoOutput,
} from "@/utils/generation/delivery";
import type { VideoToolchain } from "@/utils/generation/delivery";

const leaseMs = 15 * 60 * 1000;
const submitTimeoutMs = 3 * 60 * 1000;
const queryTimeoutMs = 30 * 1000;
const downloadTimeoutMs = 90 * 1000;

type WorkerOptions = {
  database: Database;
  storageDirectory: string;
  dataDirectory: string;
  fetchImpl?: typeof fetch;
  videoToolchain?: VideoToolchain | null;
  signal?: AbortSignal;
  pollIntervalMs?: number;
};

type ClaimedTask = {
  id: string; userId: string; status: string; snapshot: GenerationSnapshot; providerTaskId: string | null;
  providerStatus: string | null; claimToken: string; attemptNumber: number; modelId: string; claimedFromQueue: boolean;
};

function decodeJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

async function claimTask(database: Database): Promise<ClaimedTask | null> {
  return database.begin(async transaction => {
    const candidates = await transaction<{
      id: string; userId: string; status: string; snapshot: unknown; providerTaskId: string | null;
      providerStatus: string | null; modelId: string; attemptNumber: number;
    }[]>`
      SELECT tasks.id, tasks.user_id AS "userId", tasks.status, tasks.snapshot,
        tasks.provider_task_id AS "providerTaskId", tasks.provider_status AS "providerStatus",
        quotes.model_id AS "modelId",
        (SELECT COALESCE(max(attempt_number), 0) + 1 FROM generation_task_attempts WHERE task_id = tasks.id) AS "attemptNumber"
      FROM generation_tasks AS tasks JOIN generation_quotes AS quotes ON quotes.id = tasks.quote_id
      WHERE (tasks.status = 'queued'
        OR (tasks.status IN ('running', 'unknown') AND (tasks.provider_task_id IS NOT NULL OR tasks.status = 'running' OR tasks.status = 'unknown')))
        AND (tasks.worker_claimed_until IS NULL OR tasks.worker_claimed_until < now())
        AND (tasks.last_checked_at IS NULL OR tasks.last_checked_at < now() - interval '10 seconds')
      ORDER BY CASE WHEN tasks.status = 'queued' THEN 0 ELSE 1 END, tasks.created_at
      LIMIT 1 FOR UPDATE OF tasks SKIP LOCKED
    `;
    const candidate = candidates[0];
    if (!candidate) return null;
    const claimToken = randomUUID();
    const tasks = await transaction<{ id: string }[]>`
      UPDATE generation_tasks SET worker_claim_token = ${claimToken},
        worker_claimed_until = now() + (${leaseMs} * interval '1 millisecond'),
        submission_started_at = CASE WHEN status = 'queued' THEN now() ELSE submission_started_at END,
        status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
        last_checked_at = now(), updated_at = now()
      WHERE id = ${candidate.id} RETURNING id
    `;
    if (!tasks[0]) return null;
    if (candidate.status === "queued") {
      await transaction`
        INSERT INTO generation_task_attempts (id, task_id, attempt_number, phase)
        VALUES (${randomUUID()}, ${candidate.id}, ${candidate.attemptNumber}, 'submitting')
      `;
    }
    return {
      ...candidate,
      status: candidate.status === "queued" ? "running" : candidate.status,
      snapshot: decodeJson<GenerationSnapshot>(candidate.snapshot), claimToken, claimedFromQueue: candidate.status === "queued",
    };
  });
}

async function modelForTask(_database: Database, task: ClaimedTask): Promise<GenerationModel | null> {
  const snapshot = task.snapshot.model;
  if (!snapshot || (snapshot.protocol !== "openai_images" && snapshot.protocol !== "volcengine_ark_video")
    || typeof snapshot.endpoint !== "string" || typeof snapshot.credentialEnv !== "string" || typeof snapshot.modelId !== "string") return null;
  return { id: task.modelId, providerId: snapshot.providerId ?? "", protocol: snapshot.protocol as GenerationModel["protocol"],
    endpoint: snapshot.endpoint, credentialEnv: snapshot.credentialEnv, modelId: snapshot.modelId,
    operation: task.snapshot.operation, capabilities: snapshot.capabilities };
}

async function activeAssetTypes(database: Database, task: ClaimedTask) {
  let assetTypes: string[] = [];
  if (task.snapshot.assetIds.length) {
    const assets = await database<{ id: string; mediaType: string }[]>`
      SELECT id, media_type AS "mediaType" FROM media_assets
      WHERE owner_id = ${task.userId} AND status = 'active'
        AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(task.snapshot.assetIds)}::text::jsonb))
      ORDER BY id FOR SHARE
    `;
    if (assets.length !== new Set(task.snapshot.assetIds).size) throw Object.assign(new Error("reference_unavailable"), { definiteFailure: true });
    assetTypes = assets.map(asset => asset.mediaType);
  }
  return [...assetTypes, ...(task.snapshot.referenceInputs ?? []).filter(input => input.kind === "formalOutput").map(input => input.mimeType)];
}

async function setTaskUnknown(input: { database: Database; task: ClaimedTask; message: string; providerTaskId?: string; providerStatus?: string; requestId?: string;
  stagedFailure?: { sha256: string; byteLength: number; failureKind: string } }) {
  await input.database.begin(async transaction => {
    const rows = await transaction<{ status: string; claimToken: string | null }[]>`
      SELECT status, worker_claim_token AS "claimToken" FROM generation_tasks WHERE id = ${input.task.id} FOR UPDATE
    `;
    if (rows[0]?.claimToken !== input.task.claimToken || ["delivered", "failed"].includes(rows[0]?.status ?? "")) return;
    await transaction`
      UPDATE generation_tasks SET status = 'unknown', provider_task_id = COALESCE(${input.providerTaskId ?? null}, provider_task_id),
        provider_status = COALESCE(${input.providerStatus ?? null}, provider_status),
        provider_request_id = COALESCE(${input.requestId ?? null}, provider_request_id), safe_error = ${input.message},
        worker_claim_token = NULL, worker_claimed_until = NULL, last_checked_at = now(), updated_at = now()
      WHERE id = ${input.task.id}
    `;
    const attempts = await transaction<{ attemptNumber: number }[]>`
      SELECT COALESCE(max(attempt_number), 0) + 1 AS "attemptNumber" FROM generation_task_attempts WHERE task_id = ${input.task.id}
    `;
    const attemptId = randomUUID();
    await transaction`
      INSERT INTO generation_task_attempts (id, task_id, attempt_number, phase, provider_task_id, provider_status, provider_request_id, safe_error)
      VALUES (${attemptId}, ${input.task.id}, ${attempts[0].attemptNumber}, 'unknown',
        ${input.providerTaskId ?? null}, ${input.providerStatus ?? null}, ${input.requestId ?? null}, ${input.message})
    `;
    if (input.stagedFailure) {
      await transaction`
        INSERT INTO generation_task_events (id, task_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${input.task.id}, ${input.task.userId}, 'worker', 'stagedOutputUnusable', 'operator',
          ${`openaiStage:${attemptId}`},
          ${JSON.stringify({ attemptId, stageSha256: input.stagedFailure.sha256, byteLength: input.stagedFailure.byteLength,
            failureKind: input.stagedFailure.failureKind })}::text::jsonb)
      `;
    }
  });
}

async function setTaskFailed(input: { database: Database; task: ClaimedTask; message: string; providerTaskId?: string; providerStatus?: string; requestId?: string }) {
  await input.database.begin(async transaction => {
    const rows = await transaction<{ status: string; claimToken: string | null }[]>`
      SELECT status, worker_claim_token AS "claimToken" FROM generation_tasks WHERE id = ${input.task.id} FOR UPDATE
    `;
    if (rows[0]?.claimToken !== input.task.claimToken || ["delivered", "failed"].includes(rows[0]?.status ?? "")) return;
    await transaction`
      UPDATE generation_tasks SET status = 'failed', provider_task_id = COALESCE(${input.providerTaskId ?? null}, provider_task_id),
        provider_status = COALESCE(${input.providerStatus ?? null}, provider_status),
        provider_request_id = COALESCE(${input.requestId ?? null}, provider_request_id), safe_error = ${input.message},
        worker_claim_token = NULL, worker_claimed_until = NULL, last_checked_at = now(), updated_at = now()
      WHERE id = ${input.task.id}
    `;
    const attempts = await transaction<{ attemptNumber: number }[]>`
      SELECT COALESCE(max(attempt_number), 0) + 1 AS "attemptNumber" FROM generation_task_attempts WHERE task_id = ${input.task.id}
    `;
    await transaction`
      INSERT INTO generation_task_attempts (id, task_id, attempt_number, phase, provider_task_id, provider_status, provider_request_id, safe_error)
      VALUES (${randomUUID()}, ${input.task.id}, ${attempts[0].attemptNumber}, 'failed',
        ${input.providerTaskId ?? null}, ${input.providerStatus ?? null}, ${input.requestId ?? null}, ${input.message})
    `;
    await releaseGenerationTask(transaction, input.task.id, input.message);
  });
}

async function saveAccepted(input: { database: Database; task: ClaimedTask; taskId: string; providerStatus: string; requestId?: string }) {
  await input.database.begin(async transaction => {
    const rows = await transaction<{ status: string; claimToken: string | null }[]>`
      SELECT status, worker_claim_token AS "claimToken" FROM generation_tasks WHERE id = ${input.task.id} FOR UPDATE
    `;
    if (rows[0]?.claimToken !== input.task.claimToken || ["delivered", "failed"].includes(rows[0]?.status ?? "")) return;
    await transaction`
      UPDATE generation_tasks SET status = 'running', provider_task_id = ${input.taskId}, provider_status = ${input.providerStatus},
        provider_request_id = ${input.requestId ?? null}, worker_claim_token = NULL, worker_claimed_until = NULL,
        safe_error = NULL, last_checked_at = now(), updated_at = now() WHERE id = ${input.task.id}
    `;
    const attempts = await transaction<{ attemptNumber: number }[]>`
      SELECT COALESCE(max(attempt_number), 0) + 1 AS "attemptNumber" FROM generation_task_attempts WHERE task_id = ${input.task.id}
    `;
    await transaction`
      INSERT INTO generation_task_attempts (id, task_id, attempt_number, phase, provider_task_id, provider_status, provider_request_id)
      VALUES (${randomUUID()}, ${input.task.id}, ${attempts[0].attemptNumber}, 'accepted', ${input.taskId}, ${input.providerStatus}, ${input.requestId ?? null})
    `;
  });
}

async function setProviderStatus(input: { database: Database; task: ClaimedTask; providerStatus: ProviderStatus }) {
  await input.database.begin(async transaction => {
    const rows = await transaction<{ status: string; claimToken: string | null }[]>`
      SELECT status, worker_claim_token AS "claimToken" FROM generation_tasks WHERE id = ${input.task.id} FOR UPDATE
    `;
    if (rows[0]?.claimToken !== input.task.claimToken || ["delivered", "failed"].includes(rows[0]?.status ?? "")) return;
    const safeError = input.providerStatus.safeError ?? (input.providerStatus.status === "unknown" ? "供应商原任务查询仍报告未知状态。" : null);
    await transaction`
      UPDATE generation_tasks SET status = ${input.providerStatus.status === "unknown" ? "unknown" : "running"},
        provider_status = ${input.providerStatus.rawStatus}, provider_usage = ${input.providerStatus.usage ? JSON.stringify(input.providerStatus.usage) : null}::text::jsonb,
        provider_request_id = COALESCE(${input.providerStatus.requestId ?? null}, provider_request_id),
        safe_error = ${safeError}, worker_claim_token = NULL, worker_claimed_until = NULL,
        last_checked_at = now(), updated_at = now() WHERE id = ${input.task.id}
    `;
    const attempts = await transaction<{ attemptNumber: number }[]>`
      SELECT COALESCE(max(attempt_number), 0) + 1 AS "attemptNumber" FROM generation_task_attempts WHERE task_id = ${input.task.id}
    `;
    await transaction`
      INSERT INTO generation_task_attempts (id, task_id, attempt_number, phase, provider_task_id, provider_status, provider_request_id, safe_error)
      VALUES (${randomUUID()}, ${input.task.id}, ${attempts[0].attemptNumber},
        ${input.providerStatus.status === "unknown" ? "unknown" : "polling"}, ${input.task.providerTaskId},
        ${input.providerStatus.rawStatus}, ${input.providerStatus.requestId ?? null}, ${safeError})
    `;
  });
}

async function deliver(input: {
  database: Database; task: ClaimedTask; outputs: { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4"; mediaType: "image" | "video"; usage?: Record<string, unknown> }[];
  storageDirectory: string; providerTaskId?: string; providerStatus?: string; requestId?: string; usage?: Record<string, unknown>;
}) {
  const deliveredFiles: { id: string; storageKey: string; filePath?: string }[] = [];
  try {
    const results = await input.database.begin(async transaction => {
      const files = await persistGenerationOutputs({
        transaction, taskId: input.task.id, userId: input.task.userId, snapshot: input.task.snapshot,
        storageDirectory: input.storageDirectory, outputs: input.outputs, claimToken: input.task.claimToken,
        providerTaskId: input.providerTaskId, providerStatus: input.providerStatus, providerUsage: input.usage,
      });
      deliveredFiles.push(...files.map(file => ({ id: file.id, storageKey: file.storageKey })));
      await settleGenerationTask(transaction, input.task.id);
      return files;
    });
    await clearStagedProviderResponse(input.storageDirectory, input.task.userId, input.task.id).catch(() => undefined);
    return results;
  } catch (error) {
    for (const file of deliveredFiles) {
      try {
        const committed = await input.database<{ id: string }[]>`
          SELECT id FROM generation_results WHERE id = ${file.id} AND task_id = ${input.task.id} AND storage_key = ${file.storageKey}
        `;
        if (!committed.length) await removeStoredGenerationOutput(input.storageDirectory, input.task.userId, file.storageKey);
      } catch { /* A lost commit acknowledgement must never delete a possibly committed result. */ }
    }
    throw error;
  }
}

async function processTask(options: WorkerOptions, task: ClaimedTask, toolchain: VideoToolchain | null) {
  const staged = task.snapshot.operation === "image.generate"
    ? await readStagedOpenAiOutput(options.storageDirectory, task.userId, task.id)
    : { kind: "missing" as const };
  if (staged.kind === "transientIo" || staged.kind === "tooLarge") {
    await setTaskUnknown({ database: options.database, task,
      message: staged.kind === "tooLarge" ? "供应商原响应超过平台核验上限，保留待核查且不会重复提交。" : "暂时无法读取供应商原响应，保留待核查且不会重复提交。" });
    return;
  }
  if (staged.kind === "staged") {
    const outputs = [];
    let decodeFailed = false;
    let validationUnavailable = false;
    for (const output of staged.outputs) {
      try { outputs.push(await validateImageOutput(output.bytes)); }
      catch (error) {
        if (typeof error === "object" && error && "contentInvalid" in error) decodeFailed = true;
        else validationUnavailable = true;
      }
    }
    if (validationUnavailable) {
      await setTaskUnknown({ database: options.database, task, message: "暂时无法完成图片解码核验，保留原响应且不会重复提交。" });
      return;
    }
    if (outputs.length && (staged.failureKind || decodeFailed)) {
      await setTaskUnknown({ database: options.database, task, message: "原响应包含可解码图片，但还有图片内容未能完整核验；保留原响应继续核查。" });
      return;
    }
    if (outputs.length) {
      await deliver({ ...options, task, outputs, requestId: undefined });
      return;
    }
    await setTaskUnknown({ database: options.database, task, message: "供应商原响应已读取，但没有可安全交付的图片；等待核查且不会重复提交。",
      stagedFailure: { sha256: staged.sha256, byteLength: staged.byteLength,
        failureKind: decodeFailed ? "imageDecodeInvalid" : staged.failureKind ?? "responseHasNoImageOutputs" } });
    return;
  }

  const model = await modelForTask(options.database, task);
  if (!model) {
    if (task.claimedFromQueue) await setTaskFailed({ database: options.database, task, message: "模型配置快照不完整，任务未提交。" });
    else await setTaskUnknown({ database: options.database, task, message: "模型配置快照不完整，等待运营核查。" });
    return;
  }
  if (model.protocol === "volcengine_ark_video") {
    if (!toolchain) {
      if (task.claimedFromQueue) await setTaskFailed({ database: options.database, task, message: "视频完整性校验工具不可用，任务未提交。" });
      else await setTaskUnknown({ database: options.database, task, message: "视频完整性校验工具不可用，已提交任务保留待核查。" });
      return;
    }
    if (task.providerTaskId) {
      let status: ProviderStatus;
      try {
        status = await queryArkTask({ model, providerTaskId: task.providerTaskId, fetchImpl: options.fetchImpl,
          signal: options.signal ? AbortSignal.any([AbortSignal.timeout(queryTimeoutMs), options.signal]) : AbortSignal.timeout(queryTimeoutMs) });
      } catch {
        await setTaskUnknown({ database: options.database, task, message: "暂时无法查询原供应商任务，系统会继续核查。", providerTaskId: task.providerTaskId });
        return;
      }
      if (status.status === "failed" && !status.outputUrl) {
        await setTaskFailed({ database: options.database, task, message: status.safeError ?? "供应商已确认生成失败。", providerTaskId: task.providerTaskId, providerStatus: status.rawStatus, requestId: status.requestId });
        return;
      }
      if (status.status !== "succeeded" && !(status.status === "failed" && status.outputUrl)) {
        await setProviderStatus({ database: options.database, task, providerStatus: status });
        return;
      }
      if (!status.outputUrl) {
        await setTaskUnknown({ database: options.database, task, message: "供应商已报告成功，但未提供可取回的视频地址。", providerTaskId: task.providerTaskId, providerStatus: status.rawStatus, requestId: status.requestId });
        return;
      }
      let output;
      try {
        output = await retrieveArkOutput({ url: status.outputUrl, allowedHosts: model.capabilities.resultHosts,
          fetchImpl: options.fetchImpl, signal: options.signal ? AbortSignal.any([AbortSignal.timeout(downloadTimeoutMs), options.signal]) : AbortSignal.timeout(downloadTimeoutMs) });
        await validateVideoOutput(output.bytes, toolchain, options.signal);
      } catch {
        await setTaskUnknown({ database: options.database, task, message: "供应商结果暂不可验证或转存，系统会继续查询原任务。", providerTaskId: task.providerTaskId, providerStatus: status.rawStatus, requestId: status.requestId });
        return;
      }
      await deliver({ ...options, task, outputs: [output], providerTaskId: task.providerTaskId, providerStatus: status.rawStatus,
        requestId: status.requestId, usage: status.usage });
      return;
    }
    if (!task.claimedFromQueue && !task.providerTaskId) {
      const acceptance = await readStagedArkAcceptance(options.storageDirectory, task.userId, task.id).catch(() => null);
      if (acceptance) {
        await saveAccepted({ database: options.database, task, taskId: acceptance.taskId, providerStatus: acceptance.providerStatus });
        return;
      }
      await setTaskUnknown({ database: options.database, task, message: "提交确认结果不可恢复，禁止重复提交，等待运营核查。" });
      return;
    }
  }

  if (!task.claimedFromQueue || task.providerTaskId) {
    await setTaskUnknown({ database: options.database, task, message: "已提交任务缺少可恢复的供应商结果，禁止重复提交，等待运营核查。" });
    return;
  }
  let assetTypes: string[];
  try { assetTypes = await activeAssetTypes(options.database, task); } catch {
    await setTaskFailed({ database: options.database, task, message: "参考素材已撤回或不可用，任务未提交。" });
    return;
  }
  const block = adapterBlock(model, task.snapshot, assetTypes);
  if (block) {
    await setTaskFailed({ database: options.database, task, message: `当前模型或节点设置暂不支持本次提交（${block}）。` });
    return;
  }
  try {
    if (!task.claimedFromQueue || task.providerTaskId) {
      await setTaskUnknown({ database: options.database, task, message: "仅允许尚未提交的排队任务进入首次供应商外发校验。" });
      return;
    }
    const result = await withGenerationDispatchAuthorization(options.database, task.id, task.claimToken, dispatch => submitGeneration({
      model: dispatch.model, snapshot: dispatch.task.snapshot, userId: dispatch.task.userId, database: options.database,
      storageDirectory: options.storageDirectory, taskId: dispatch.task.id, fetchImpl: options.fetchImpl,
      signal: options.signal ? AbortSignal.any([AbortSignal.timeout(submitTimeoutMs), options.signal]) : AbortSignal.timeout(submitTimeoutMs),
    }));
    if (result.kind === "accepted") {
      await saveAccepted({ database: options.database, task, taskId: result.taskId, providerStatus: result.providerStatus });
      return;
    }
    const outputs = [];
    for (const output of result.outputs) outputs.push(await validateImageOutput(output.bytes));
    await deliver({ ...options, task, outputs, requestId: result.requestId, usage: result.outputs[0]?.usage });
  } catch (error) {
    const candidate = error as Error & { definiteFailure?: boolean; failureKind?: string; requestUnknown?: boolean; requestId?: string };
    if (candidate.definiteFailure) {
      const message = candidate.failureKind === "providerRejected" ? "供应商明确拒绝本次生成请求，任务未提交。"
        : candidate.failureKind === "governanceDenied" ? "素材授权或渠道准入核验未通过，任务未提交。"
          : candidate.failureKind === "dispatchPreconditionFailed" ? "模型配置或素材状态已变化，任务未提交。"
          : candidate.failureKind === "credentialUnavailable" ? "模型凭据当前不可用，任务未提交。"
            : candidate.failureKind === "referenceUnavailable" ? "参考素材或上游结果当前不可用，任务未提交。"
              : "本地准备或校验未通过，任务未提交。";
      await setTaskFailed({ database: options.database, task, message, requestId: candidate.requestId });
      return;
    }
    await setTaskUnknown({ database: options.database, task, message: "供应商受理或结果状态暂时无法确认，系统不会重复提交。", requestId: candidate.requestId });
  }
}

export async function runGenerationWorkerOnce(options: WorkerOptions) {
  const task = await claimTask(options.database);
  if (!task) return false;
  const toolchain = options.videoToolchain === undefined ? await findVideoToolchain(options.dataDirectory) : options.videoToolchain;
  try {
    await processTask(options, task, toolchain);
  } catch (error) {
    if ((error as { definiteFailure?: boolean }).definiteFailure) {
      await setTaskFailed({ database: options.database, task, message: "本地素材校验失败，任务未提交。" });
    } else {
      await setTaskUnknown({ database: options.database, task, message: "任务执行状态暂时无法确认，系统将保留预占并继续恢复。" });
    }
  }
  return true;
}

export function startGenerationWorker(options: WorkerOptions) {
  const controller = new AbortController();
  const intervalMs = Math.max(1_000, options.pollIntervalMs ?? 2_000);
  let active = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveStopped: (() => void) | undefined;
  const stoppedPromise = new Promise<void>(resolvePromise => { resolveStopped = resolvePromise; });

  async function tick() {
    if (stopped) return resolveStopped?.();
    if (!active) {
      active = true;
      try { await runGenerationWorkerOnce({ ...options, signal: controller.signal }); }
      catch { /* State changes are recorded by the worker; a later tick resumes durable tasks. */ }
      finally { active = false; }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
    else resolveStopped?.();
  }
  timer = setTimeout(tick, 0);

  return {
    async stop() {
      if (stopped) return stoppedPromise;
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      if (!active) resolveStopped?.();
      await stoppedPromise;
    },
  };
}
