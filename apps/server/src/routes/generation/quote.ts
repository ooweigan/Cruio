import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Router } from "express";
import type { Database } from "@/db/database";
import { adapterBlock, hashOutput, resolveOpenAiImageSize } from "@/utils/generation/provider";
import type { GenerationSnapshot } from "@/utils/generation/provider";
import { getGenerationResultFile } from "@/utils/generation/resultFile";

type User = { id: string };
type NodeRecord = { id?: unknown; type?: unknown; data?: Record<string, unknown> };
type ModelRow = {
  id: string; providerId: string; providerLabel: string; channelKind: string; region: string;
  protocol: string; adapterVersion: string; endpoint: string; credentialEnv: string; modelId: string; modelVersion: string; configVersion: number;
  operation: string; capabilities: Record<string, unknown>; costReference: Record<string, unknown>;
  creditPrice: number | null; configuredAt: Date;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]));
}

function validParameters(input: Record<string, unknown>, allowed: unknown) {
  if (!isRecord(allowed)) return Object.keys(input).length === 0;
  return Object.entries(input).every(([key, value]) => {
    if (!Object.hasOwn(allowed, key)) return false;
    const rule = allowed[key];
    if (Array.isArray(rule)) return rule.some(item => JSON.stringify(item) === JSON.stringify(value));
    if (!isRecord(rule)) return typeof value === typeof rule;
    if (Array.isArray(rule.enum)) return rule.enum.some(item => JSON.stringify(item) === JSON.stringify(value));
    return typeof value === "number" && Number.isFinite(value)
      && (typeof rule.min !== "number" || value >= rule.min)
      && (typeof rule.max !== "number" || value <= rule.max);
  });
}

export function createGenerationQuoteRoute(database: Database, videoRuntimeAvailable = false, storageDirectory?: string) {
  return Router().post("/", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    const projectId = body?.projectId;
    const workflowId = body?.workflowId;
    const operation = body?.operation;
    const modelId = body?.modelId;
    const nodeId = body?.nodeId;
    const nodeVersion = body?.nodeVersion;
    const prompt = body?.prompt;
    const parameters = body?.parameters ?? {};
    const assetIds = body?.assetIds ?? [];
    const formalInputs = body?.formalInputs ?? [];
    const blocks: string[] = [];
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (typeof projectId !== "string" || !uuidPattern.test(projectId)
      || (workflowId !== undefined && (typeof workflowId !== "string" || !uuidPattern.test(workflowId)))
      || typeof modelId !== "string" || !uuidPattern.test(modelId)
      || typeof nodeId !== "string" || nodeId.length < 1 || nodeId.length > 128
      || !Number.isSafeInteger(nodeVersion) || Number(nodeVersion) < 1
      || (operation !== "image.generate" && operation !== "video.generate")
      || typeof prompt !== "string" || !prompt.trim() || prompt.length > 100000
      || !isRecord(parameters) || JSON.stringify(parameters).length > 100000
      || !Array.isArray(assetIds) || assetIds.length > 32 || assetIds.some(id => typeof id !== "string" || !uuidPattern.test(id))
      || !Array.isArray(formalInputs) || formalInputs.length > 32) {
      return response.status(400).json({ message: "报价输入无效。" });
    }
    const projectRows = workflowId
      ? await database<{ canvas: unknown; version: number; workflowVersion: number }[]>`
        SELECT workflow_versions.canvas, projects.version,
          project_workflow_bindings.workflow_version AS "workflowVersion"
        FROM projects
        JOIN project_workflow_bindings ON project_workflow_bindings.project_id = projects.id
        JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
        JOIN workflow_versions ON workflow_versions.workflow_id = workflows.id
          AND workflow_versions.version = project_workflow_bindings.workflow_version
        WHERE projects.id = ${projectId} AND projects.owner_id = ${user.id}
          AND workflows.id = ${workflowId} AND workflows.owner_id = ${user.id}
      `
      : await database<{ canvas: unknown; version: number; workflowVersion: number }[]>`
        SELECT canvas, version, version AS "workflowVersion"
        FROM projects WHERE id = ${projectId} AND owner_id = ${user.id}
      `;
    const project = projectRows[0];
    if (!project) return response.status(404).json({ message: "项目或工作流不存在。" });
    const canvas = typeof project.canvas === "string" ? JSON.parse(project.canvas) : project.canvas;
    const canvasNodes = isRecord(canvas) && Array.isArray(canvas.nodes) ? canvas.nodes : [];
    const node = canvasNodes.length
      ? canvasNodes.find((item): item is NodeRecord => isRecord(item) && item.id === nodeId)
      : undefined;
    const expectedType = operation === "image.generate" ? "imageGenerationNode" : "videoGenerationNode";
    if (!node || node.type !== expectedType) blocks.push("node_missing_or_operation_mismatch");
    const requestedVersion = body?.workflowVersion;
    if (workflowId && requestedVersion !== project.workflowVersion) blocks.push("workflow_version_changed");
    if (!workflowId && body?.canvasVersion !== project.version) blocks.push("canvas_version_changed");
    const nodeData = node && isRecord(node.data) ? node.data : {};
    if (nodeData.disabled === true) blocks.push("node_disabled");
    const serverPrompt = typeof nodeData.prompt === "string" ? nodeData.prompt.trim() : "";
    if (!serverPrompt || prompt.trim() !== serverPrompt) blocks.push("prompt_snapshot_mismatch");
    if (nodeData.version !== undefined && nodeData.version !== nodeVersion) blocks.push("node_version_changed");
    const parameterNames = operation === "image.generate"
      ? ["size", "ratio"]
      : ["duration", "resolution", "ratio", "mode", "generateAudio"];
    const serverParameters = Object.fromEntries(parameterNames.filter(key => nodeData[key] !== undefined).map(key => [key, nodeData[key]]));
    if (!sameJson(parameters, serverParameters)) blocks.push("parameter_snapshot_mismatch");
    const canvasEdges = isRecord(canvas) && Array.isArray(canvas.edges) ? canvas.edges : [];
    const referenceInputs: NonNullable<GenerationSnapshot["referenceInputs"]> = [];
    const connectedAssets: string[] = [];
    for (const edge of canvasEdges) {
      if (!isRecord(edge) || edge.target !== nodeId) continue;
      const source = canvasNodes.find(item => isRecord(item) && item.id === edge.source);
      const targetHandle = typeof edge.targetHandle === "string" ? edge.targetHandle : "in";
      const sourceHandle = typeof edge.sourceHandle === "string" ? edge.sourceHandle : "out";
      if (!isRecord(source) || !isRecord(source.data) || targetHandle !== "in") {
        blocks.push("unsupported_input_node");
        continue;
      }
      if (source.type === "mediaNode" && sourceHandle === "out" && typeof source.data.assetId === "string" && uuidPattern.test(source.data.assetId)) {
        connectedAssets.push(source.data.assetId);
        referenceInputs.push({ kind: "asset", assetId: source.data.assetId, sourceNodeId: String(source.id), sourceHandle, targetHandle, role: "reference_image" });
        continue;
      }
      if ((source.type === "imageGenerationNode" || source.type === "videoGenerationNode") && sourceHandle === "out"
        && isRecord(source.data.formalOutput)) {
        const output = source.data.formalOutput;
        if (output.mediaType !== "image" || typeof output.resultId !== "string" || !uuidPattern.test(output.resultId)
          || typeof output.taskId !== "string" || !uuidPattern.test(output.taskId)
          || !Number.isSafeInteger(output.adoptionVersion) || typeof output.mimeType !== "string"
          || typeof output.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(output.sha256)) {
          blocks.push("formal_input_unavailable");
          continue;
        }
        const adoptions = await database<{
          adoptionVersion: number; formalOutput: unknown; storageKey: string; size: number; sha256: string;
          mimeType: string; mediaType: string; taskId: string; taskStatus: string; sourceSnapshot: unknown;
        }[]>`
          SELECT adoptions.adoption_version AS "adoptionVersion", adoptions.formal_output AS "formalOutput",
            results.storage_key AS "storageKey", results.size, results.sha256, results.mime_type AS "mimeType",
            results.media_type AS "mediaType", tasks.id AS "taskId", tasks.status AS "taskStatus", tasks.snapshot AS "sourceSnapshot"
          FROM generation_result_adoptions AS adoptions
          JOIN generation_results AS results ON results.id = adoptions.result_id
          JOIN generation_tasks AS tasks ON tasks.id = results.task_id
          WHERE adoptions.user_id = ${user.id} AND adoptions.project_id = ${projectId}
            AND adoptions.workflow_id IS NOT DISTINCT FROM ${workflowId ?? null} AND adoptions.node_id = ${String(source.id)}
            AND adoptions.result_id = ${output.resultId} AND adoptions.adoption_version = ${output.adoptionVersion}
            AND results.user_id = ${user.id} AND tasks.user_id = ${user.id}
        `;
        const adoption = adoptions[0];
        const storedOutput = adoption && (typeof adoption.formalOutput === "string" ? JSON.parse(adoption.formalOutput) : adoption.formalOutput);
        const file = adoption && adoption.taskId === output.taskId && adoption.taskStatus === "delivered"
          && adoption.mediaType === "image" && adoption.mimeType === output.mimeType
          && adoption.sha256.trim() === output.sha256 && isRecord(storedOutput)
          && storedOutput.resultId === output.resultId && storedOutput.taskId === output.taskId
          && storedOutput.adoptionVersion === output.adoptionVersion && storedOutput.mediaType === output.mediaType
          && storedOutput.mimeType === output.mimeType && storedOutput.sha256 === output.sha256
          ? await getGenerationResultFile(storageDirectory, user.id, adoption.storageKey, Number(adoption.size)) : null;
        if (!adoption || !file) {
          blocks.push("formal_input_unavailable");
          continue;
        }
        const sourceSnapshot = typeof adoption.sourceSnapshot === "string" ? JSON.parse(adoption.sourceSnapshot) : adoption.sourceSnapshot;
        const sourceInputRisk = isRecord(sourceSnapshot) && isRecord(sourceSnapshot.inputRisk) ? sourceSnapshot.inputRisk : null;
        const sourceRisk = sourceInputRisk?.containsRealPerson === false ? "clear"
          : sourceInputRisk?.containsRealPerson === true ? "realPerson" : "unknown";
        try {
          if (hashOutput(await readFile(file.filePath)) !== output.sha256) blocks.push("formal_input_unavailable");
        } catch { blocks.push("formal_input_unavailable"); }
        referenceInputs.push({ kind: "formalOutput", resultId: output.resultId, taskId: output.taskId,
          adoptionVersion: Number(output.adoptionVersion), mediaType: output.mediaType, mimeType: output.mimeType,
          sha256: output.sha256, sourceNodeId: String(source.id), sourceHandle, targetHandle, role: "reference_image", sourceRisk });
        continue;
      }
      blocks.push("unsupported_input_node");
    }
    const requestedAssets = (assetIds as string[]).toSorted();
    if (JSON.stringify(requestedAssets) !== JSON.stringify([...connectedAssets].toSorted())) blocks.push("asset_port_snapshot_mismatch");
    const requestedFormal = formalInputs.map((item) => isRecord(item) ? [item.sourceNodeId, item.resultId, item.adoptionVersion, item.sourceHandle, item.targetHandle, item.role] : []);
    const resolvedFormal = referenceInputs.filter(input => input.kind === "formalOutput")
      .map(input => [input.sourceNodeId, input.resultId, input.adoptionVersion, input.sourceHandle, input.targetHandle, input.role]);
    if (JSON.stringify(requestedFormal) !== JSON.stringify(resolvedFormal)) blocks.push("formal_input_snapshot_mismatch");

    const models = await database<ModelRow[]>`
      SELECT id, provider_id AS "providerId", provider_label AS "providerLabel", channel_kind AS "channelKind",
        region, protocol, adapter_version AS "adapterVersion", endpoint, credential_env AS "credentialEnv", model_id AS "modelId",
        model_version AS "modelVersion", operation, capabilities, cost_reference AS "costReference",
        credit_price AS "creditPrice", verified_at AS "configuredAt", config_version AS "configVersion"
      FROM generation_models WHERE id = ${modelId} AND operation = ${operation}
        AND published = true AND is_current = true
    `;
    const model = models[0];
    if (!model || !process.env[model.credentialEnv]) blocks.push("model_unavailable");
    if (!model?.creditPrice) blocks.push("pricing_unconfigured");
    if (model && !validParameters(serverParameters, model.capabilities.parameters)) blocks.push("unsupported_parameters");
    if (operation === "video.generate" && !videoRuntimeAvailable) blocks.push("video_validation_tools_unavailable");

    if (model && typeof model.capabilities.maxPromptLength === "number" && serverPrompt.length > model.capabilities.maxPromptLength) {
      blocks.push("prompt_too_long");
    }
    let connectedAssetTypes: string[] = referenceInputs.filter(input => input.kind === "formalOutput").map(input => input.mimeType);
    let realPersonInput = false;
    if (connectedAssets.length) {
      const assets = await database<{ id: string; mediaType: string; authorizationDeclared: boolean; containsRealPerson: boolean; subjectIsAdult: boolean }[]>`
        SELECT id, media_type AS "mediaType", authorization_declared AS "authorizationDeclared",
          contains_real_person AS "containsRealPerson", subject_is_adult AS "subjectIsAdult"
        FROM media_assets WHERE owner_id = ${user.id} AND status = 'active' AND media_type LIKE 'image/%'
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(connectedAssets)}::text::jsonb))
      `;
      if (assets.length !== new Set(connectedAssets).size) blocks.push("asset_missing_revoked_or_unsupported");
      if (assets.some(asset => !asset.mediaType.startsWith("image/"))) blocks.push("unsupported_reference_media_type");
      if (assets.some(asset => !asset.authorizationDeclared)) blocks.push("asset_authorization_missing");
      realPersonInput = assets.some(asset => asset.containsRealPerson);
      if (assets.some(asset => asset.containsRealPerson && !asset.subjectIsAdult)) blocks.push("real_person_minor_not_allowed");
      connectedAssetTypes = [...connectedAssetTypes, ...assets.map(asset => asset.mediaType)];
    }
    const derivedHumanRisk = referenceInputs.some(input => input.kind === "formalOutput" && input.sourceRisk !== "clear");
    if (model
      && typeof model.capabilities.maxReferenceImages === "number" && referenceInputs.length > model.capabilities.maxReferenceImages) {
      blocks.push("too_many_references");
    }
    if (model) {
      const snapshotForAdapter: GenerationSnapshot = {
        operation: operation as GenerationSnapshot["operation"], prompt: serverPrompt, parameters: serverParameters,
        assetIds: connectedAssets, referenceInputs, nodeId, model: { protocol: model.protocol, endpoint: model.endpoint,
          credentialEnv: model.credentialEnv, modelId: model.modelId, capabilities: model.capabilities },
      };
      const adapterIssue = adapterBlock({ id: model.id, providerId: model.providerId,
        protocol: model.protocol as "openai_images" | "volcengine_ark_video", endpoint: model.endpoint,
        credentialEnv: model.credentialEnv, modelId: model.modelId,
        operation: operation as "image.generate" | "video.generate", capabilities: model.capabilities },
      snapshotForAdapter, connectedAssetTypes);
      if (adapterIssue) blocks.push(adapterIssue);
      let savedModel: unknown;
      try { savedModel = typeof nodeData.model === "string" ? JSON.parse(nodeData.model) : nodeData.model; } catch { savedModel = null; }
      if (!Array.isArray(savedModel) || savedModel[0] !== model.providerId || savedModel[1] !== model.modelId) {
        blocks.push("model_snapshot_mismatch");
      }
    }
    if (blocks.length || !model?.creditPrice || !node) {
      return response.status(409).json({ message: "报价条件未满足，请刷新画布和模型配置后重试。", quote: { quoteId: null, credits: null, expiresAt: null, plan: null, blocks } });
    }
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const plan = {
      operation,
      model: { providerId: model.providerId, providerLabel: model.providerLabel, channelKind: model.channelKind,
        region: model.region, modelId: model.modelId, modelVersion: model.modelVersion,
        revisionId: model.id, adapterVersion: model.adapterVersion, configVersion: model.configVersion,
        configuredAt: model.configuredAt },
      market: null,
      governance: null,
      inputRisk: { containsRealPerson: realPersonInput || derivedHumanRisk,
        sourceDeclaration: realPersonInput ? "userDeclaredRealPerson" : derivedHumanRisk ? "inheritedOrUnknown"
          : connectedAssets.length ? "declaredNoRealPerson" : "noneDeclared" },
      notices: ["本次生成会向所选模型供应渠道发送提示词及引用输入。"],
      prompt: serverPrompt,
      parameters: serverParameters,
      providerParameters: operation === "image.generate"
        ? { size: resolveOpenAiImageSize(serverParameters) ?? "auto" }
        : serverParameters,
      assetIds: connectedAssets,
      referenceInputs,
      projectId,
      projectVersion: project.version,
      workflowId: workflowId ?? null,
      workflowVersion: workflowId ? project.workflowVersion : null,
      nodeId,
      nodeVersion,
    };
    const snapshot = {
      ...plan,
      model: { ...plan.model, protocol: model.protocol, endpoint: model.endpoint,
        credentialEnv: model.credentialEnv, capabilities: model.capabilities, costReference: model.costReference },
    };
    await database`
      INSERT INTO generation_quotes (id, user_id, project_id, model_id, operation, credits, plan, snapshot, expires_at)
      VALUES (${id}, ${user.id}, ${projectId}, ${model.id}, ${operation}, ${model.creditPrice},
        ${JSON.stringify(plan)}::text::jsonb, ${JSON.stringify(snapshot)}::text::jsonb, ${expiresAt})
    `;
    const accounts = await database`
      INSERT INTO credit_accounts (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING balance, reserved
    `;
    const available = Number(accounts[0].balance - accounts[0].reserved);
    if (available < model.creditPrice) blocks.push("insufficient_credits");
    return response.json({ quote: { quoteId: id, credits: model.creditPrice, expiresAt, plan, blocks } });
  });
}
