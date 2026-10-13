import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { getGenerationResultFile } from "@/utils/generation/resultFile";

type User = { id: string };
type NodeRecord = { id?: unknown; type?: unknown; data?: Record<string, unknown> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function createGenerationResultAdoptRoute(database: Database, storageDirectory?: string) {
  return Router().post("/:resultId/adopt", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const resultId = request.params.resultId;
    const { projectId, workflowId, workflowVersion, canvasVersion, nodeId, nodeVersion, idempotencyKey } = request.body ?? {};
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (!uuidPattern.test(resultId) || typeof projectId !== "string" || !uuidPattern.test(projectId)
      || (workflowId !== undefined && (typeof workflowId !== "string" || !uuidPattern.test(workflowId)))
      || (workflowId ? !Number.isSafeInteger(workflowVersion) || workflowVersion < 1 : !Number.isSafeInteger(canvasVersion) || canvasVersion < 1)
      || typeof nodeId !== "string" || !nodeId || nodeId.length > 128
      || !Number.isSafeInteger(nodeVersion) || nodeVersion < 1
      || typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return response.status(400).json({ message: "采用请求无效。" });
    }
    try {
      const adoption = await database.begin(async transaction => {
        const results = await transaction<{
          taskId: string; projectId: string; mediaType: string; mimeType: string; sha256: string;
          operation: string; status: string; storageKey: string; size: number; snapshot: unknown;
        }[]>`
          SELECT tasks.id AS "taskId", tasks.project_id AS "projectId", tasks.snapshot,
            results.media_type AS "mediaType", results.mime_type AS "mimeType", results.sha256,
            quotes.operation, tasks.status, results.storage_key AS "storageKey", results.size
          FROM generation_results AS results
          JOIN generation_tasks AS tasks ON tasks.id = results.task_id
          JOIN generation_quotes AS quotes ON quotes.id = tasks.quote_id
          WHERE results.id = ${resultId} AND results.user_id = ${user.id} AND tasks.user_id = ${user.id}
        `;
        const result = results[0];
        if (!result || result.status !== "delivered" || result.projectId !== projectId) {
          throw Object.assign(new Error("结果尚未可靠交付或不属于当前项目。"), { status: 404 });
        }
        const taskSnapshot = typeof result.snapshot === "string" ? JSON.parse(result.snapshot) : result.snapshot;
        if (!isRecord(taskSnapshot) || taskSnapshot.nodeId !== nodeId
          || (taskSnapshot.workflowId ?? null) !== (workflowId ?? null)
          || (result.mediaType === "image" ? "image.generate" : "video.generate") !== result.operation) {
          throw Object.assign(new Error("结果与目标生成节点不匹配。"), { status: 409 });
        }
        const file = await getGenerationResultFile(storageDirectory, user.id, result.storageKey, Number(result.size));
        if (!file) throw Object.assign(new Error("结果副本暂不可用，不能采用。"), { status: 409 });

        let graph: unknown;
        let currentVersion: number;
        let currentGlobalWorkflowVersion: number | undefined;
        if (workflowId) {
          const rows = await transaction<{ canvas: unknown; bindingVersion: number; workflowVersion: number }[]>`
            SELECT workflow_versions.canvas, project_workflow_bindings.workflow_version AS "bindingVersion",
              workflows.version AS "workflowVersion"
            FROM project_workflow_bindings
            JOIN projects ON projects.id = project_workflow_bindings.project_id
            JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
            JOIN workflow_versions ON workflow_versions.workflow_id = workflows.id
              AND workflow_versions.version = project_workflow_bindings.workflow_version
            WHERE project_workflow_bindings.project_id = ${projectId}
              AND project_workflow_bindings.workflow_id = ${workflowId}
              AND projects.owner_id = ${user.id} AND workflows.owner_id = ${user.id}
            FOR UPDATE OF project_workflow_bindings
          `;
          if (!rows[0]) throw Object.assign(new Error("项目或工作流不存在。"), { status: 404 });
          graph = rows[0].canvas;
          currentVersion = rows[0].bindingVersion;
          currentGlobalWorkflowVersion = rows[0].workflowVersion;
        } else {
          const rows = await transaction<{ canvas: unknown; version: number }[]>`
            SELECT canvas, version FROM projects WHERE id = ${projectId} AND owner_id = ${user.id} FOR UPDATE
          `;
          if (!rows[0]) throw Object.assign(new Error("项目不存在。"), { status: 404 });
          graph = rows[0].canvas;
          currentVersion = rows[0].version;
        }

        const existing = await transaction<{
          resultId: string; projectId: string; workflowId: string | null; nodeId: string; nodeVersion: number;
          adoptionVersion: number; requestVersion: number | null; committedVersion: number | null; formalOutput: unknown;
        }[]>`
          SELECT result_id AS "resultId", project_id AS "projectId", workflow_id AS "workflowId",
            node_id AS "nodeId", node_version AS "nodeVersion", adoption_version AS "adoptionVersion",
            request_version AS "requestVersion", committed_version AS "committedVersion", formal_output AS "formalOutput"
          FROM generation_result_adoptions WHERE user_id = ${user.id} AND idempotency_key = ${idempotencyKey}
        `;
        if (existing[0]) {
          const prior = existing[0];
          if (prior.resultId !== resultId || prior.projectId !== projectId || prior.workflowId !== (workflowId ?? null)
            || prior.nodeId !== nodeId || prior.nodeVersion !== nodeVersion) {
            throw Object.assign(new Error("幂等标识已用于其他采用请求。"), { status: 409 });
          }
          const currentGraph = typeof graph === "string" ? JSON.parse(graph) : graph;
          const currentNodes = isRecord(currentGraph) && Array.isArray(currentGraph.nodes) ? currentGraph.nodes : [];
          const currentNode = currentNodes.find((item): item is NodeRecord => isRecord(item) && item.id === nodeId);
          const output = currentNode?.data?.formalOutput;
          if (prior.requestVersion !== (workflowId ? workflowVersion : canvasVersion)
            || prior.committedVersion === null || !isRecord(prior.formalOutput)) {
            throw Object.assign(new Error("幂等标识已用于其他画布版本。"), { status: 409 });
          }
          const currentFormalOutput = isRecord(output) && output.resultId === resultId
            && output.adoptionVersion === prior.adoptionVersion && currentVersion === prior.committedVersion;
          return {
            adoptionVersion: prior.adoptionVersion,
            canvasVersion: prior.committedVersion,
            ...(workflowId ? { workflowVersion: prior.committedVersion } : {}),
            formalOutput: typeof prior.formalOutput === "string" ? JSON.parse(prior.formalOutput) : prior.formalOutput,
            currentFormalOutput,
            idempotent: true,
          };
        }

        if (workflowId
          ? workflowVersion !== currentVersion || currentGlobalWorkflowVersion !== currentVersion
          : canvasVersion !== currentVersion) {
          throw Object.assign(new Error(workflowId ? "工作流或项目引用已更新，请刷新后重新采用。" : "画布已更新，请刷新后重新采用。"), { status: 409 });
        }

        const parsedGraph = typeof graph === "string" ? JSON.parse(graph) : graph;
        const graphNodes = isRecord(parsedGraph) && Array.isArray(parsedGraph.nodes) ? parsedGraph.nodes : [];
        const node: NodeRecord | undefined = graphNodes.find((item): item is NodeRecord => isRecord(item) && item.id === nodeId);
        const expectedType = result.mediaType === "image" ? "imageGenerationNode" : "videoGenerationNode";
        if (!node || node.type !== expectedType) throw Object.assign(new Error("目标节点不存在或输出类型不匹配。"), { status: 409 });
        const nodeData = isRecord(node.data) ? node.data : {};
        const currentNodeVersion = Number.isSafeInteger(nodeData.version) ? Number(nodeData.version) : 1;
        if (nodeVersion !== currentNodeVersion) throw Object.assign(new Error("生成节点已更新，请刷新后重新采用。"), { status: 409 });

        const adoptionVersions = await transaction<{ next: number }[]>`
          SELECT COALESCE(max(adoption_version), 0)::int + 1 AS next
          FROM generation_result_adoptions
          WHERE project_id = ${projectId} AND workflow_id IS NOT DISTINCT FROM ${workflowId ?? null} AND node_id = ${nodeId}
        `;
        const adoptionVersion = adoptionVersions[0].next;
        const formalOutput = {
          resultId,
          taskId: result.taskId,
          adoptionVersion,
          mediaType: result.mediaType,
          mimeType: result.mimeType,
          sha256: result.sha256,
        };
        const updatedCanvas = {
          ...(isRecord(parsedGraph) ? parsedGraph : {}),
          nodes: graphNodes.map(item => {
            if (!isRecord(item) || item.id !== nodeId) return item;
            return { ...item, data: { ...nodeData, formalOutput } };
          }),
        };
        let savedVersion: number;
        if (workflowId) {
          const workflows = await transaction<{ id: string; name: string; version: number }[]>`
            UPDATE workflows SET canvas = ${JSON.stringify(updatedCanvas)}::text::jsonb,
              version = version + 1, updated_at = now()
            WHERE id = ${workflowId} AND owner_id = ${user.id} AND version = ${currentVersion}
            RETURNING id, name, version
          `;
          if (!workflows[0]) throw Object.assign(new Error("工作流已在别处更新，请刷新后重新采用。"), { status: 409 });
          savedVersion = workflows[0].version;
          await transaction`
            INSERT INTO workflow_versions (workflow_id, version, canvas)
            VALUES (${workflows[0].id}, ${savedVersion}, ${JSON.stringify(updatedCanvas)}::text::jsonb)
          `;
          await transaction`
            UPDATE project_workflow_bindings SET workflow_version = ${savedVersion}
            WHERE project_id = ${projectId} AND workflow_id = ${workflowId} AND workflow_version = ${currentVersion}
          `;
          await transaction`UPDATE projects SET updated_at = now() WHERE id = ${projectId} AND owner_id = ${user.id}`;
        } else {
          const projects = await transaction<{ version: number }[]>`
            UPDATE projects SET canvas = ${JSON.stringify(updatedCanvas)}::text::jsonb,
              version = version + 1, updated_at = now()
            WHERE id = ${projectId} AND owner_id = ${user.id} AND version = ${currentVersion}
            RETURNING version
          `;
          if (!projects[0]) throw Object.assign(new Error("画布已在别处更新，请刷新后重新采用。"), { status: 409 });
          savedVersion = projects[0].version;
        }
        await transaction`
          INSERT INTO generation_result_adoptions
            (id, result_id, user_id, project_id, workflow_id, workflow_version, node_id, node_version,
              adoption_version, idempotency_key, request_version, committed_version, formal_output)
          VALUES (${randomUUID()}, ${resultId}, ${user.id}, ${projectId}, ${workflowId ?? null},
            ${workflowId ? savedVersion : null}, ${nodeId}, ${nodeVersion}, ${adoptionVersion}, ${idempotencyKey},
            ${currentVersion}, ${savedVersion}, ${JSON.stringify(formalOutput)}::text::jsonb)
        `;
        return {
          adoptionVersion,
          canvasVersion: savedVersion,
          ...(workflowId ? { workflowVersion: savedVersion } : {}),
          formalOutput,
          idempotent: false,
        };
      });
      return response.status(adoption.idempotent ? 200 : 201).json({ adoptedResultId: resultId, ...adoption });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
      if (status !== 500) return response.status(status).json({ message: error instanceof Error ? error.message : "无法采用生成结果。" });
      const duplicate = await database<{ resultId: string; projectId: string; workflowId: string | null; nodeId: string; nodeVersion: number }[]>`
        SELECT result_id AS "resultId", project_id AS "projectId", workflow_id AS "workflowId",
          node_id AS "nodeId", node_version AS "nodeVersion"
        FROM generation_result_adoptions WHERE user_id = ${user.id} AND idempotency_key = ${idempotencyKey}
      `;
      if (duplicate[0]) {
        if (duplicate[0].resultId !== resultId || duplicate[0].projectId !== projectId
          || duplicate[0].workflowId !== (workflowId ?? null) || duplicate[0].nodeId !== nodeId
          || duplicate[0].nodeVersion !== nodeVersion) {
          return response.status(409).json({ message: "幂等标识已用于其他采用请求。" });
        }
        return response.status(409).json({ message: "采用请求正在完成，请刷新画布确认正式输出。" });
      }
      throw error;
    }
  });
}
