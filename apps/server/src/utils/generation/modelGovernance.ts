import { randomUUID } from "node:crypto";
import type { Database } from "@/db/database";
import { fail, requireRole, type User } from "@/utils/operations/access";
import type { GenerationModel, GenerationSnapshot } from "@/utils/generation/provider";

export const governanceChecks = [
  "providerAuthorization", "allowedInputTypes", "dataRegion", "retention", "training", "deletion",
  "aiLabeling", "identityFiling", "securityAssessment", "complaintsHandling", "privacyRequestBoundary",
] as const;
const requiredGovernanceChecks = ["providerAuthorization", "allowedInputTypes", "dataRegion", "retention", "training", "deletion"] as const;

export function governanceReviewReady(checks: unknown, allowedInputs: string[]) {
  if (!checks || typeof checks !== "object" || Array.isArray(checks) || !Array.isArray(allowedInputs)) return false;
  const record = checks as Record<string, { status?: unknown }>;
  return requiredGovernanceChecks.every(key => record[key]?.status === "verified")
    && governanceChecks.every(key => ["verified", "notApplicable"].includes(String(record[key]?.status)))
    && allowedInputs.includes("text");
}

export async function requireModelOperator(database: Database, user: User, transaction?: Database) {
  return requireRole(database, user, "modelOperator", undefined, transaction);
}

export async function recordModelEvent(
  database: Database,
  actorId: string,
  eventType: string,
  modelRevisionId: string | null,
  marketCode: string | null,
  details: Record<string, unknown>,
) {
  await database`
    INSERT INTO generation_model_management_events (id, actor_id, event_type, model_revision_id, market_code, details)
    VALUES (${randomUUID()}, ${actorId}, ${eventType}, ${modelRevisionId}, ${marketCode}, ${JSON.stringify(details)}::text::jsonb)
  `;
}

export function validateGovernanceChecks(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const checks = value as Record<string, unknown>;
  return Object.keys(checks).length === governanceChecks.length && Object.keys(checks).every(key => governanceChecks.includes(key as typeof governanceChecks[number]))
    && governanceChecks.every(key => {
    const item = checks[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const check = item as Record<string, unknown>;
    if (Object.keys(check).some(field => !["status", "evidenceRef", "conclusion"].includes(field))) return false;
    if (!["verified", "unknown", "notApplicable"].includes(String(check.status))) return false;
    if (typeof check.conclusion !== "string" || !check.conclusion.trim() || check.conclusion.length > 1000) return false;
    if (check.status === "verified" || check.status === "notApplicable") {
      return typeof check.evidenceRef === "string" && /^https:\/\/\S{1,1000}$/.test(check.evidenceRef);
    }
    return check.evidenceRef === undefined || check.evidenceRef === "" || (typeof check.evidenceRef === "string" && /^https:\/\/\S{1,1000}$/.test(check.evidenceRef));
  });
}

export function evidenceMatchesChecks(checks: Record<string, unknown>, refs: { checkKey: string; url: string }[]) {
  return governanceChecks.every(key => {
    const check = checks[key] as { status: string; evidenceRef?: string };
    return check.status === "unknown" || refs.some(ref => ref.checkKey === key && ref.url === check.evidenceRef);
  });
}

export function failIfInvalidCurrentPassword(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 256) throw fail(400, "请重新确认当前账户密码。");
}

export async function appendModelRevision(transaction: Database, modelId: string, published: boolean) {
  const rows = await transaction<{
    id: string; providerId: string; providerLabel: string; channelKind: string; region: string; protocol: string;
    endpoint: string; credentialEnv: string; modelId: string; modelVersion: string; operation: string;
    capabilities: unknown; costReference: unknown; creditPrice: number | null; verifiedAt: Date;
    adapterVersion: string; configVersion: number;
  }[]>`
    SELECT id, provider_id AS "providerId", provider_label AS "providerLabel", channel_kind AS "channelKind", region,
      protocol, endpoint, credential_env AS "credentialEnv", model_id AS "modelId", model_version AS "modelVersion",
      operation, capabilities, cost_reference AS "costReference", credit_price AS "creditPrice",
      verified_at AS "verifiedAt", adapter_version AS "adapterVersion", config_version AS "configVersion"
    FROM generation_models WHERE id = ${modelId} AND is_current = true FOR UPDATE
  `;
  const source = rows[0];
  if (!source) throw fail(409, "模型映射版本已变化，请刷新后重试。");
  await transaction`UPDATE generation_models SET is_current = false, updated_at = now() WHERE id = ${source.id}`;
  const nextVersion = Number(source.configVersion) + 1;
  const id = randomUUID();
  await transaction`
    INSERT INTO generation_models (id, provider_id, provider_label, channel_kind, region, protocol, endpoint, credential_env,
      model_id, model_version, operation, capabilities, cost_reference, credit_price, verified_at, adapter_version,
      published, config_version, is_current)
    VALUES (${id}, ${source.providerId}, ${source.providerLabel}, ${source.channelKind}, ${source.region}, ${source.protocol},
      ${source.endpoint}, ${source.credentialEnv}, ${source.modelId}, ${source.modelVersion}, ${source.operation},
      ${JSON.stringify(source.capabilities)}::text::jsonb, ${JSON.stringify(source.costReference)}::text::jsonb,
      ${source.creditPrice}, ${source.verifiedAt}, ${source.adapterVersion}, ${published}, ${nextVersion}, true)
  `;
  return { source, id, configVersion: nextVersion };
}

export async function withGenerationDispatchAuthorization<T>(
  database: Database,
  taskId: string,
  claimToken: string,
  dispatch: (input: { task: { id: string; userId: string; snapshot: GenerationSnapshot }; model: GenerationModel }) => Promise<T>,
) {
  return database.begin(async transaction => {
    const tasks = await transaction<{ id: string; userId: string; status: string; providerTaskId: string | null;
      claimToken: string | null; claimedUntil: Date | null; submissionStartedAt: Date | null; modelId: string; snapshot: unknown }[]>`
      SELECT id, user_id AS "userId", status, provider_task_id AS "providerTaskId", snapshot,
        worker_claim_token AS "claimToken", worker_claimed_until AS "claimedUntil",
        submission_started_at AS "submissionStartedAt", (snapshot->'model'->>'revisionId')::uuid AS "modelId"
      FROM generation_tasks WHERE id = ${taskId} FOR UPDATE
    `;
    const taskRow = tasks[0];
    const denied = () => Object.assign(new Error("模型配置或素材状态已变化，任务未提交。"), {
      definiteFailure: true, failureKind: "dispatchPreconditionFailed",
    });
    if (!taskRow || taskRow.status !== "running" || taskRow.claimToken !== claimToken
      || !taskRow.claimedUntil || taskRow.claimedUntil.getTime() <= Date.now()
      || !taskRow.submissionStartedAt || taskRow.providerTaskId) throw denied();
    const snapshot = (typeof taskRow.snapshot === "string" ? JSON.parse(taskRow.snapshot) : taskRow.snapshot) as GenerationSnapshot;
    if (!taskRow.modelId) throw denied();
    const models = await transaction<{ id: string; providerId: string; protocol: GenerationModel["protocol"];
      endpoint: string; credentialEnv: string; modelId: string; operation: GenerationModel["operation"];
      capabilities: Record<string, unknown>; isCurrent: boolean; published: boolean }[]>`
      SELECT id, provider_id AS "providerId", protocol, endpoint, credential_env AS "credentialEnv",
        model_id AS "modelId", operation, capabilities, is_current AS "isCurrent", published
      FROM generation_models WHERE id = ${taskRow.modelId} FOR SHARE
    `;
    const modelRow = models[0];
    if (!modelRow?.isCurrent || !modelRow.published || !process.env[modelRow.credentialEnv]) throw denied();
    const assetIds = Array.isArray(snapshot.assetIds) ? snapshot.assetIds.toSorted() : [];
    const assets = assetIds.length ? await transaction<{ id: string; status: string; authorizationDeclared: boolean;
      containsRealPerson: boolean; subjectIsAdult: boolean }[]>`
      SELECT id, status, authorization_declared AS "authorizationDeclared", contains_real_person AS "containsRealPerson",
        subject_is_adult AS "subjectIsAdult" FROM media_assets WHERE owner_id = ${taskRow.userId}
        AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(assetIds)}::text::jsonb))
      ORDER BY id FOR SHARE
    ` : [];
    if (assets.length !== new Set(assetIds).size || assets.some(asset => asset.status !== "active" || !asset.authorizationDeclared)) throw denied();
    if (assets.some(asset => asset.containsRealPerson && !asset.subjectIsAdult)) throw denied();
    return await dispatch({ task: { id: taskRow.id, userId: taskRow.userId, snapshot },
      model: { id: modelRow.id, providerId: modelRow.providerId, protocol: modelRow.protocol,
        endpoint: modelRow.endpoint, credentialEnv: modelRow.credentialEnv, modelId: modelRow.modelId,
        operation: modelRow.operation, capabilities: modelRow.capabilities } });
  });
}
