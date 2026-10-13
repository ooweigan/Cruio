import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Router } from "express";
import type { Database } from "@/db/database";
import { hashOutput } from "@/utils/generation/provider";
import { getGenerationResultFile } from "@/utils/generation/resultFile";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGenerationSubmitRoute(database: Database, storageDirectory?: string) {
  return Router().post("/", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const quoteId = request.body?.quoteId;
    const idempotencyKey = request.body?.idempotencyKey;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (typeof quoteId !== "string" || !uuidPattern.test(quoteId)
      || typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return response.status(400).json({ message: "报价或幂等标识无效。" });
    }
    const existing = await database<{ id: string; status: string; quoteId: string; createdAt: Date }[]>`
      SELECT id, status, quote_id AS "quoteId", created_at AS "createdAt"
      FROM generation_tasks WHERE user_id = ${user.id} AND idempotency_key = ${idempotencyKey}
    `;
    if (existing[0]) {
      if (existing[0].quoteId !== quoteId) return response.status(409).json({ message: "幂等标识已用于其他报价。" });
      return response.json({ task: { taskId: existing[0].id, status: existing[0].status, createdAt: existing[0].createdAt } });
    }
    try {
      const task = await database.begin(async transaction => {
        const quotes = await transaction<{ id: string; projectId: string; modelId: string; credits: number; plan: Record<string, unknown>; snapshot: Record<string, unknown>; expiresAt: Date; confirmedAt: Date | null }[]>`
          SELECT id, project_id AS "projectId", model_id AS "modelId", credits, plan, snapshot,
            expires_at AS "expiresAt", confirmed_at AS "confirmedAt"
          FROM generation_quotes WHERE id = ${quoteId} AND user_id = ${user.id} FOR UPDATE
        `;
        const quote = quotes[0];
        if (!quote) throw Object.assign(new Error("报价不存在。"), { status: 404 });
        const tasksForQuote = await transaction<{ id: string; status: string; createdAt: Date; idempotencyKey: string }[]>`
          SELECT id, status, created_at AS "createdAt", idempotency_key AS "idempotencyKey"
          FROM generation_tasks WHERE quote_id = ${quoteId} FOR UPDATE
        `;
        if (tasksForQuote[0]) {
          if (tasksForQuote[0].idempotencyKey !== idempotencyKey) {
            throw Object.assign(new Error("该报价已提交，请查询原任务。"), { status: 409 });
          }
          return { ...tasksForQuote[0], idempotent: true };
        }
        if (quote.confirmedAt || quote.expiresAt.getTime() <= Date.now()) {
          throw Object.assign(new Error("报价已确认或已过期，请重新报价。"), { status: 409 });
        }
        const snapshot = typeof quote.snapshot === "string" ? JSON.parse(quote.snapshot) : quote.snapshot;
        const plan = typeof quote.plan === "string" ? JSON.parse(quote.plan) : quote.plan;
        const model = snapshot.model as Record<string, unknown>;
        const models = await transaction<{ protocol: string; adapterVersion: string; endpoint: string; modelVersion: string; configVersion: number; credentialEnv: string; published: boolean }[]>`
          SELECT protocol, adapter_version AS "adapterVersion", endpoint, model_version AS "modelVersion", config_version AS "configVersion",
            credential_env AS "credentialEnv", published
          FROM generation_models WHERE id = ${quote.modelId} AND is_current = true AND published = true FOR SHARE
        `;
        const currentModel = models[0];
        if (!currentModel || currentModel.protocol !== model.protocol || currentModel.adapterVersion !== model.adapterVersion
          || currentModel.endpoint !== model.endpoint
          || currentModel.modelVersion !== model.modelVersion || currentModel.configVersion !== model.configVersion
          || currentModel.credentialEnv !== model.credentialEnv
          || typeof model.credentialEnv !== "string" || !process.env[model.credentialEnv]) {
          throw Object.assign(new Error("模型配置已变化或渠道暂不可用，请重新报价。"), { status: 409 });
        }
        const projectVersion = Number(snapshot.projectVersion);
        let currentCanvas: unknown;
        if (snapshot.workflowId) {
          const current = await transaction<{ version: number; canvas: unknown }[]>`
            SELECT project_workflow_bindings.workflow_version AS version, workflow_versions.canvas
            FROM project_workflow_bindings
            JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
            JOIN workflow_versions ON workflow_versions.workflow_id = workflows.id
              AND workflow_versions.version = project_workflow_bindings.workflow_version
            WHERE project_workflow_bindings.project_id = ${quote.projectId}
              AND project_workflow_bindings.workflow_id = ${snapshot.workflowId}
              AND workflows.owner_id = ${user.id} FOR UPDATE OF project_workflow_bindings
          `;
          if (!current[0] || current[0].version !== snapshot.workflowVersion) {
            throw Object.assign(new Error("工作流已更新，请重新获取报价。"), { status: 409 });
          }
          currentCanvas = current[0].canvas;
        } else {
          const current = await transaction<{ version: number; canvas: unknown }[]>`
            SELECT version, canvas FROM projects WHERE id = ${quote.projectId} AND owner_id = ${user.id} FOR UPDATE
          `;
          if (!current[0] || current[0].version !== projectVersion) {
            throw Object.assign(new Error("画布已更新，请重新获取报价。"), { status: 409 });
          }
          currentCanvas = current[0].canvas;
        }
        currentCanvas = typeof currentCanvas === "string" ? JSON.parse(currentCanvas) : currentCanvas;
        const currentNode = currentCanvas && typeof currentCanvas === "object" && Array.isArray((currentCanvas as { nodes?: unknown }).nodes)
          ? (currentCanvas as { nodes: { id?: unknown; type?: unknown; data?: { disabled?: unknown } }[] }).nodes.find(node => node.id === snapshot.nodeId)
          : undefined;
        const expectedType = snapshot.operation === "image.generate" ? "imageGenerationNode" : "videoGenerationNode";
        if (!currentNode || currentNode.type !== expectedType) {
          throw Object.assign(new Error("生成节点已变化，请重新获取报价。"), { status: 409 });
        }
        if (currentNode.data?.disabled === true) {
          throw Object.assign(new Error("节点已禁用，请先启用节点并重新获取报价。"), { status: 409 });
        }
        const referenceInputs = Array.isArray(snapshot.referenceInputs) ? snapshot.referenceInputs : [];
        const graphNodes = (currentCanvas as { nodes?: unknown[] }).nodes ?? [];
        for (const input of referenceInputs) {
          if (!input || typeof input !== "object" || (input as { kind?: unknown }).kind !== "formalOutput") continue;
          const formalInput = input as { sourceNodeId?: unknown; resultId?: unknown; taskId?: unknown; adoptionVersion?: unknown; mediaType?: unknown; mimeType?: unknown; sha256?: unknown };
          const source = graphNodes.find(item => item && typeof item === "object" && (item as { id?: unknown }).id === formalInput.sourceNodeId) as { data?: Record<string, unknown> } | undefined;
          const output = source?.data?.formalOutput;
          const matchesCurrent = output && typeof output === "object"
            && (output as Record<string, unknown>).resultId === formalInput.resultId
            && (output as Record<string, unknown>).taskId === formalInput.taskId
            && (output as Record<string, unknown>).adoptionVersion === formalInput.adoptionVersion
            && (output as Record<string, unknown>).mediaType === formalInput.mediaType
            && (output as Record<string, unknown>).mimeType === formalInput.mimeType
            && (output as Record<string, unknown>).sha256 === formalInput.sha256;
          if (!matchesCurrent) throw Object.assign(new Error("上游正式输出已变化，请重新获取报价。"), { status: 409 });
          const adoptions = await transaction<{ storageKey: string; size: number; sha256: string; mimeType: string; mediaType: string; taskId: string; taskStatus: string; formalOutput: unknown }[]>`
            SELECT results.storage_key AS "storageKey", results.size, results.sha256, results.mime_type AS "mimeType",
              results.media_type AS "mediaType", tasks.id AS "taskId", tasks.status AS "taskStatus", adoptions.formal_output AS "formalOutput"
            FROM generation_result_adoptions AS adoptions
            JOIN generation_results AS results ON results.id = adoptions.result_id
            JOIN generation_tasks AS tasks ON tasks.id = results.task_id
            WHERE adoptions.user_id = ${user.id} AND adoptions.project_id = ${quote.projectId}
              AND adoptions.workflow_id IS NOT DISTINCT FROM ${snapshot.workflowId ?? null}
              AND adoptions.node_id = ${String(formalInput.sourceNodeId)} AND adoptions.result_id = ${String(formalInput.resultId)}
              AND adoptions.adoption_version = ${Number(formalInput.adoptionVersion)}
              AND results.user_id = ${user.id} AND tasks.user_id = ${user.id}
          `;
          const adoption = adoptions[0];
          const recorded = adoption && (typeof adoption.formalOutput === "string" ? JSON.parse(adoption.formalOutput) : adoption.formalOutput);
          const file = adoption && adoption.taskId === formalInput.taskId && adoption.taskStatus === "delivered"
            && adoption.mediaType === "image" && adoption.mediaType === formalInput.mediaType
            && adoption.mimeType === formalInput.mimeType && adoption.sha256.trim() === formalInput.sha256
            && recorded && typeof recorded === "object" && (recorded as Record<string, unknown>).resultId === formalInput.resultId
            && (recorded as Record<string, unknown>).taskId === formalInput.taskId
            && (recorded as Record<string, unknown>).adoptionVersion === formalInput.adoptionVersion
            && (recorded as Record<string, unknown>).mimeType === formalInput.mimeType
            && (recorded as Record<string, unknown>).sha256 === formalInput.sha256
            ? await getGenerationResultFile(storageDirectory, user.id, adoption.storageKey, Number(adoption.size)) : null;
          if (!adoption || !file) throw Object.assign(new Error("上游正式结果不可用，请重新获取报价。"), { status: 409 });
          try {
            if (hashOutput(await readFile(file.filePath)) !== formalInput.sha256) throw new Error("上游正式结果哈希不匹配。");
          } catch {
            throw Object.assign(new Error("上游正式结果不可用，请重新获取报价。"), { status: 409 });
          }
        }
        const assetIds = Array.isArray(snapshot.assetIds) ? snapshot.assetIds.filter((id: unknown): id is string => typeof id === "string") : [];
        if (assetIds.length) {
          const activeAssets = await transaction<{ id: string; authorizationDeclared: boolean; containsRealPerson: boolean; subjectIsAdult: boolean }[]>`
            SELECT id, authorization_declared AS "authorizationDeclared", contains_real_person AS "containsRealPerson",
              subject_is_adult AS "subjectIsAdult" FROM media_assets WHERE owner_id = ${user.id} AND status = 'active'
              AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(assetIds)}::text::jsonb))
            ORDER BY id FOR SHARE
          `;
          if (activeAssets.length !== new Set(assetIds).size || activeAssets.some(asset => !asset.authorizationDeclared
            || (asset.containsRealPerson && !asset.subjectIsAdult))) {
            throw Object.assign(new Error("素材已撤回或不可用，请重新获取报价。"), { status: 409 });
          }
        }
        const account = await transaction<{ balance: number; reserved: number }[]>`
          INSERT INTO credit_accounts (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING
          RETURNING balance, reserved
        `;
        const lockedAccount = account[0] ?? (await transaction<{ balance: number; reserved: number }[]>`
          SELECT balance, reserved FROM credit_accounts WHERE user_id = ${user.id} FOR UPDATE
        `)[0];
        const available = Number(lockedAccount.balance) - Number(lockedAccount.reserved);
        if (available < quote.credits) throw Object.assign(new Error("可用积分不足。"), { status: 409 });
        const changed = await transaction<{ id: string }[]>`
          UPDATE generation_quotes SET confirmed_at = now()
          WHERE id = ${quote.id} AND confirmed_at IS NULL AND expires_at > now()
          RETURNING id
        `;
        if (!changed[0]) throw Object.assign(new Error("报价已确认或已过期，请重新报价。"), { status: 409 });
        const taskId = randomUUID();
        const rows = await transaction<{ id: string; status: string; createdAt: Date }[]>`
          INSERT INTO generation_tasks (id, user_id, project_id, quote_id, idempotency_key, status, snapshot)
          VALUES (${taskId}, ${user.id}, ${quote.projectId}, ${quote.id}, ${idempotencyKey}, 'queued', ${JSON.stringify(snapshot)}::text::jsonb)
          RETURNING id, status, created_at AS "createdAt"
        `;
        const updated = await transaction<{ balance: number; reserved: number }[]>`
          UPDATE credit_accounts SET reserved = reserved + ${quote.credits}, updated_at = now()
          WHERE user_id = ${user.id} RETURNING balance, reserved
        `;
        await transaction`
          INSERT INTO credit_ledger (id, user_id, task_id, quote_id, entry_type, amount, reserved_delta, balance_after, reserved_after, reason)
          VALUES (${randomUUID()}, ${user.id}, ${taskId}, ${quote.id}, 'reserve', 0, ${quote.credits},
            ${updated[0].balance}, ${updated[0].reserved}, '确认生成报价并预占')
        `;
        return { ...rows[0], plan, idempotent: false };
      });
      return response.status(task.idempotent ? 200 : 201).json({ task: { taskId: task.id, status: task.status, createdAt: task.createdAt } });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
      if (status !== 500) return response.status(status).json({ message: error instanceof Error ? error.message : "无法提交任务。" });
      if (String(error).includes("generation_tasks_user_id_idempotency_key_key")) {
        const duplicate = await database<{ id: string; status: string; quoteId: string; createdAt: Date }[]>`
          SELECT id, status, quote_id AS "quoteId", created_at AS "createdAt"
          FROM generation_tasks WHERE user_id = ${user.id} AND idempotency_key = ${idempotencyKey}
        `;
        if (duplicate[0]?.quoteId === quoteId) {
          return response.json({ task: { taskId: duplicate[0].id, status: duplicate[0].status, createdAt: duplicate[0].createdAt } });
        }
        if (duplicate[0]) return response.status(409).json({ message: "幂等标识已用于其他报价。" });
      }
      throw error;
    }
  });
}
