import { createHash, randomUUID } from "node:crypto";
import createDashboardRoute from "@/routes/operations/dashboard/get";
import createUsersListRoute from "@/routes/operations/users/list";
import createUserStatusRoute from "@/routes/operations/users/status";
import createLogsListRoute from "@/routes/operations/logs/list";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { basename, resolve } from "node:path";
import { createDatabase, type Database } from "./db/database";
import { createHeadRoute } from "@/routes/media/head";
import { createListRoute } from "@/routes/media/list";
import { createReadRoute } from "@/routes/media/read";
import { createRetractRoute } from "@/routes/media/retract";
import { createStatusRoute } from "@/routes/media/status";
import { createUploadRoute } from "@/routes/media/upload";
import { createCreditsGetRoute } from "@/routes/credits/get";
import { createGenerationModelsRoute } from "@/routes/generation/models";
import { createGenerationQuoteRoute } from "@/routes/generation/quote";
import { createGenerationSubmitRoute } from "@/routes/generation/tasks/submit";
import { createGenerationTaskGetRoute } from "@/routes/generation/tasks/get";
import { createGenerationTaskListRoute } from "@/routes/generation/tasks/list";
import { createGenerationTaskActionsRoute } from "@/routes/generation/tasks/actions";
import { createOperationsGenerationTaskListRoute } from "@/routes/operations/generation/tasks/list";
import { createOperationsGenerationTaskReviewRoute } from "@/routes/operations/generation/tasks/review";
import { createOperationsGenerationTaskActionsRoute } from "@/routes/operations/generation/tasks/actions";
import { createOperationsGenerationModelsGetRoute } from "@/routes/operations/generation/models/get";
import { createOperationsGenerationModelRevisionRoute } from "@/routes/operations/generation/models/revision";
import { createOperationsGenerationModelPublishRoute } from "@/routes/operations/generation/models/publish";
import { createOperationsGenerationModelPauseRoute } from "@/routes/operations/generation/models/pause";
import { createPrivacyRequestCreateRoute } from "@/routes/privacy/requests/create";
import { createPrivacyRequestListRoute } from "@/routes/privacy/requests/list";
import { createPrivacyRequestGetRoute } from "@/routes/privacy/requests/get";
import { createPrivacyRequestSupplementRoute } from "@/routes/privacy/requests/supplement";
import { createOperationsPrivacyRequestListRoute } from "@/routes/operations/privacy/requests/list";
import { createOperationsPrivacyRequestGetRoute } from "@/routes/operations/privacy/requests/get";
import { createOperationsPrivacyRequestActionRoute } from "@/routes/operations/privacy/requests/actions";
import { createGenerationResultAdoptRoute } from "@/routes/generation/results/adopt";
import { createGenerationResultHeadRoute } from "@/routes/generation/results/head";
import { createGenerationResultReadRoute } from "@/routes/generation/results/read";
import { createWorkSaveRoute } from "@/routes/works/save";
import { createWorkDownloadRoute } from "@/routes/works/download";
import { createWorkRemoveRoute } from "@/routes/works/remove";
import { synchronizeGenerationModels } from "@/utils/generation/models";
import { findVideoToolchain } from "@/utils/generation/delivery";
import { createOperationsCreditsUsersRoute } from "@/routes/operations/credits/users";
import { createOperationsCreditsLedgerRoute } from "@/routes/operations/credits/ledger";
import { createOperationsCreditsPreviewRoute } from "@/routes/operations/credits/preview";
import { createOperationsCreditsTopupRoute } from "@/routes/operations/credits/topup";
import { createOperationsCreditsRefundRoute } from "@/routes/operations/credits/refund";
import { createOperationsCreditsReversalRoute } from "@/routes/operations/credits/reversal";
import { createOperationsCreditsCredentialRoute } from "@/routes/operations/credits/credential";
import { createOperationsReconciliationRoute } from "@/routes/operations/reconciliation";
import { createOperationsRolesGetRoute } from "@/routes/operations/roles/get";
import { createOperationsRolesUsersRoute } from "@/routes/operations/roles/users";
import { createOperationsRolesGrantRoute } from "@/routes/operations/roles/grant";
import { createOperationsRolesRevokeRoute } from "@/routes/operations/roles/revoke";
import { createCreditsLedgerRoute } from "@/routes/credits/ledger";
import { createAuthRegisterRoute } from "@/routes/auth/register";
import { createAuthLoginRoute } from "@/routes/auth/login";
import { createAuthResendVerificationRoute } from "@/routes/auth/resendVerification";
import { createAuthVerifyEmailRoute } from "@/routes/auth/verifyEmail";
import { createAuthPasswordResetRequestRoute } from "@/routes/auth/passwordResetRequest";
import { createAuthPasswordResetConfirmRoute } from "@/routes/auth/passwordResetConfirm";
import { createAuthSessionsRoute } from "@/routes/auth/sessions";
import { createAuthRevokeOtherSessionsRoute } from "@/routes/auth/sessionsRevokeOthers";
import { createAuthRevokeSessionRoute } from "@/routes/auth/sessionsRevokeOne";
import { createNotificationsListRoute } from "@/routes/notifications/list";
import { createNotificationsReadRoute } from "@/routes/notifications/read";
import { createSupportUserListRoute } from "@/routes/support/userList";
import { createSupportTicketCreateRoute } from "@/routes/support/create";
import { createSupportTicketGetRoute } from "@/routes/support/userGet";
import { createSupportUserReplyRoute } from "@/routes/support/userReply";
import { createSupportTicketReopenRoute } from "@/routes/support/reopen";
import { createSupportQueueRoute } from "@/routes/support/queue";
import { createSupportOperationsGetRoute } from "@/routes/support/operationsGet";
import { createSupportOperationsActionRoute } from "@/routes/support/operationsAction";
import { createScriptListRoute } from "@/routes/scripts/list";
import { createScriptCreateRoute } from "@/routes/scripts/create";
import { createScriptGetRoute } from "@/routes/scripts/get";
import { createScriptRemoveRoute } from "@/routes/scripts/remove";
import { createScriptNewVersionRoute } from "@/routes/scripts/newVersion";
import { createShotListListRoute } from "@/routes/shotLists/list";
import { createShotListCreateRoute } from "@/routes/shotLists/create";
import { createShotListGetRoute } from "@/routes/shotLists/get";
import { createShotListNewVersionRoute } from "@/routes/shotLists/newVersion";

const sessionCookieName = "cruio_session";
type AuthenticatedUser = { id: string; email: string; emailVerifiedAt: Date | null };
type Canvas = { nodes: unknown[]; edges: unknown[] };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [cookieName, ...parts] = cookie.trim().split("=");
    if (cookieName === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function clearSessionCookie(response: Response) {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

function validCanvas(value: unknown): value is Canvas {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Canvas>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function workflowReferences(canvas: Canvas) {
  const ids = new Set<string>();
  for (const node of canvas.nodes) {
    if (!node || typeof node !== "object" || (node as { type?: unknown }).type !== "workflowReference") continue;
    const workflowId = (node as { data?: { workflowId?: unknown } }).data?.workflowId;
    if (!validId(workflowId)) return null;
    ids.add(workflowId);
  }
  return [...ids];
}

async function currentUser(database: Database, request: Request) {
  const token = readCookie(request, sessionCookieName);
  if (!token) return null;
  const users = await database<AuthenticatedUser[]>`
    SELECT users.id, users.email, users.email_verified_at AS "emailVerifiedAt"
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${hashToken(token)}
      AND sessions.expires_at > now() AND users.disabled_at IS NULL
  `;
  return users[0] ?? null;
}

export async function createApp(options: { database?: Database; dataDirectory?: string; storageDirectory?: string; generationConfigFile?: string } = {}) {
  const database = options.database ?? (await createDatabase());
  const dataDirectory = options.dataDirectory ?? resolve(import.meta.dir, basename(import.meta.dir) === "src" ? "../../../data" : "../../data");
  const storageDirectory = options.storageDirectory ?? resolve(dataDirectory, "privateMedia");
  await synchronizeGenerationModels(database, options.generationConfigFile ?? process.env.CRUIO_GENERATION_MODELS_FILE);
  const videoRuntimeAvailable = Boolean(await findVideoToolchain(dataDirectory));
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((_request, response, next) => {
    response.locals.database = database;
    next();
  });
  app.get("/api/health", async (_request, response) => {
    await database`SELECT 1`;
    response.json({ status: "ok", service: "cruio", database: "connected" });
  });

  app.use("/api/auth/register", createAuthRegisterRoute({ database, dataDirectory }));
  app.use("/api/auth/login", createAuthLoginRoute(database));
  app.use("/api/auth/resendVerification", createAuthResendVerificationRoute({ database, dataDirectory }));
  app.use("/api/auth/verifyEmail", createAuthVerifyEmailRoute(database));
  app.use("/api/auth/passwordReset/request", createAuthPasswordResetRequestRoute({ database, dataDirectory }));
  app.use("/api/auth/passwordReset/confirm", createAuthPasswordResetConfirmRoute(database));

  app.post("/api/auth/logout", async (request, response) => {
    const token = readCookie(request, sessionCookieName);
    if (token) await database`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
    clearSessionCookie(response);
    response.status(204).end();
  });

  app.use(["/api/projects", "/api/workflows", "/api/scripts", "/api/shotLists", "/api/media", "/api/generation", "/api/credits", "/api/works", "/api/operations", "/api/account", "/api/notifications", "/api/support", "/api/privacy", "/api/auth/me", "/api/auth/sessions"], async (request, response, next) => {
    const user = await currentUser(database, request);
    if (!user) {
      response.status(401).json({ message: "请先登录。" });
      return;
    }
    response.locals.user = user;
    next();
  });

  app.use("/api/auth/sessions", createAuthSessionsRoute(database));
  app.use("/api/auth/sessions", createAuthRevokeSessionRoute(database));
  app.use("/api/auth/sessions/revokeOthers", createAuthRevokeOtherSessionsRoute(database));
  app.use("/api/scripts", createScriptListRoute(database));
  app.use("/api/scripts", createScriptCreateRoute(database));
  app.use("/api/scripts", createScriptGetRoute(database));
  app.use("/api/scripts", createScriptNewVersionRoute(database));
  app.use("/api/scripts", createScriptRemoveRoute(database));
  app.use("/api/shotLists", createShotListListRoute(database));
  app.use("/api/shotLists", createShotListCreateRoute(database));
  app.use("/api/shotLists", createShotListGetRoute(database));
  app.use("/api/shotLists", createShotListNewVersionRoute(database));

  app.get("/api/auth/me", async (request, response) => {
    const user = await currentUser(database, request);
    if (!user) {
      response.status(401).json({ message: "请先登录。" });
      return;
    }
    const roles = await database<{ id: string; role: string; scopeKind: string; scopeUserId: string | null; expiresAt: Date; reason: string }[]>`
      SELECT id, role, scope_kind AS "scopeKind", scope_user_id AS "scopeUserId", expires_at AS "expiresAt", reason
      FROM staff_role_grants WHERE user_id = ${user.id} AND revoked_at IS NULL AND expires_at > now()
      ORDER BY role, expires_at
    `;
    response.json({ user, roles });
  });

  app.get("/api/projects", async (_request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const projects = await database`
      SELECT
        projects.id,
        projects.name,
        projects.created_at AS "createdAt",
        projects.updated_at AS "updatedAt",
        (SELECT count(*)::int FROM project_workflow_bindings
          WHERE project_workflow_bindings.project_id = projects.id) AS "workflowCount",
        (SELECT count(*)::int FROM works WHERE works.project_id = projects.id) AS "workCount"
      FROM projects WHERE owner_id = ${user.id} ORDER BY updated_at DESC
    `;
    response.json({ projects });
  });

  app.post("/api/projects", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (!name || name.length > 120) {
      response.status(400).json({ message: "项目名称需为 1–120 个字符。" });
      return;
    }
    const projects = await database`
      INSERT INTO projects (id, owner_id, name)
      VALUES (${randomUUID()}, ${user.id}, ${name})
      RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    response.status(201).json({ project: { ...projects[0], workflowCount: 0, workCount: 0 } });
  });

  app.get("/api/projects/:projectId", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    if (!validId(request.params.projectId)) {
      response.status(404).json({ message: "项目不存在。" });
      return;
    }
    const projects = await database`
      SELECT id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projects WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
    `;
    if (!projects[0]) {
      response.status(404).json({ message: "项目不存在。" });
      return;
    }
    const workflows = await database`
      SELECT
        workflows.id,
        workflows.name,
        project_workflow_bindings.workflow_version AS version,
        workflows.version AS "latestVersion",
        workflows.created_at AS "createdAt",
        workflows.updated_at AS "updatedAt",
        jsonb_array_length(workflow_versions.canvas->'nodes') AS "nodeCount"
      FROM project_workflow_bindings
      JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
      JOIN workflow_versions ON workflow_versions.workflow_id = workflows.id
        AND workflow_versions.version = project_workflow_bindings.workflow_version
      WHERE project_workflow_bindings.project_id = ${request.params.projectId}
        AND workflows.owner_id = ${user.id}
      ORDER BY project_workflow_bindings.created_at DESC
    `;
    const works = await database`
      SELECT works.id, works.title, works.media_type AS "mediaType",
        works.preview_url AS "previewUrl", works.created_at AS "createdAt"
      FROM works
      JOIN projects ON projects.id = works.project_id
      WHERE works.project_id = ${request.params.projectId} AND projects.owner_id = ${user.id} AND works.deleted_at IS NULL
      ORDER BY works.created_at DESC
    `;
    response.json({ project: { ...projects[0], workflows, works } });
  });

  app.put("/api/projects/:projectId/canvas", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const version = request.body?.version;
    if (!validId(request.params.projectId) || !validCanvas(request.body?.canvas) || !Number.isInteger(version) || version < 1) {
      response.status(400).json({ message: "画布数据或版本无效。" });
      return;
    }
    const owned = await database`
      SELECT 1 FROM projects WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
    `;
    if (!owned[0]) {
      response.status(404).json({ message: "项目不存在。" });
      return;
    }
    const references = workflowReferences(request.body.canvas);
    if (!references) {
      response.status(400).json({ message: "工作流引用无效。" });
      return;
    }
    if (references.length) {
      const allowed = await database`
        SELECT count(*)::int AS count
        FROM project_workflow_bindings
        JOIN projects ON projects.id = project_workflow_bindings.project_id
        JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
        WHERE projects.id = ${request.params.projectId} AND projects.owner_id = ${user.id}
          AND workflows.owner_id = ${user.id}
          AND project_workflow_bindings.workflow_id IN (
            SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(references)}::text::jsonb)
          )
      `;
      if (allowed[0]?.count !== references.length) {
        response.status(400).json({ message: "画布只能引用当前项目已引入的工作流。" });
        return;
      }
    }
    const projects = await database`
      UPDATE projects SET canvas = ${JSON.stringify(request.body.canvas)}::text::jsonb,
        version = version + 1, updated_at = now()
      WHERE id = ${request.params.projectId} AND owner_id = ${user.id} AND version = ${version}
      RETURNING id, name, canvas, version, updated_at AS "updatedAt"
    `;
    if (projects[0]) {
      response.json({ project: projects[0] });
      return;
    }
    const visible = await database`
      SELECT version FROM projects WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
    `;
    response.status(visible[0] ? 409 : 404).json({
      message: visible[0] ? "项目画布已在别处更新，请重新打开。" : "项目不存在。",
    });
  });

  app.get("/api/workflows", async (_request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const workflows = await database`
      SELECT id, name, version, created_at AS "createdAt", updated_at AS "updatedAt",
        jsonb_array_length(canvas->'nodes') AS "nodeCount"
      FROM workflows WHERE owner_id = ${user.id} ORDER BY updated_at DESC
    `;
    response.json({ workflows });
  });

  app.post("/api/workflows", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (!name || name.length > 120) {
      response.status(400).json({ message: "工作流名称需为 1–120 个字符。" });
      return;
    }
    const canvas: Canvas = validCanvas(request.body?.canvas) ? request.body.canvas : { nodes: [], edges: [] };
    const workflow = await database.begin(async (transaction) => {
      const rows = await transaction`
        INSERT INTO workflows (id, owner_id, name, canvas)
        VALUES (${randomUUID()}, ${user.id}, ${name}, ${JSON.stringify(canvas)}::text::jsonb)
        RETURNING id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      await transaction`
        INSERT INTO workflow_versions (workflow_id, version, canvas)
        VALUES (${rows[0].id}, 1, ${JSON.stringify(canvas)}::text::jsonb)
      `;
      return rows[0];
    });
    response.status(201).json({ workflow });
  });

  app.get("/api/workflows/:workflowId", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    if (!validId(request.params.workflowId)) {
      response.status(404).json({ message: "工作流不存在。" });
      return;
    }
    const workflows = await database`
      SELECT id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM workflows WHERE id = ${request.params.workflowId} AND owner_id = ${user.id}
    `;
    if (!workflows[0]) {
      response.status(404).json({ message: "工作流不存在。" });
      return;
    }
    response.json({ workflow: workflows[0] });
  });

  app.put("/api/workflows/:workflowId/canvas", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const version = request.body?.version;
    if (!validId(request.params.workflowId) || !validCanvas(request.body?.canvas) || !Number.isInteger(version) || version < 1) {
      response.status(400).json({ message: "画布数据或版本无效。" });
      return;
    }
    const workflow = await database.begin(async (transaction) => {
      const rows = await transaction`
        UPDATE workflows SET canvas = ${JSON.stringify(request.body.canvas)}::text::jsonb,
          version = version + 1, updated_at = now()
        WHERE id = ${request.params.workflowId} AND owner_id = ${user.id} AND version = ${version}
        RETURNING id, name, canvas, version, updated_at AS "updatedAt"
      `;
      if (!rows[0]) return null;
      await transaction`
        INSERT INTO workflow_versions (workflow_id, version, canvas)
        VALUES (${rows[0].id}, ${rows[0].version}, ${JSON.stringify(request.body.canvas)}::text::jsonb)
      `;
      return rows[0];
    });
    if (workflow) {
      response.json({ workflow });
      return;
    }
    const visible = await database`
      SELECT version FROM workflows WHERE id = ${request.params.workflowId} AND owner_id = ${user.id}
    `;
    response.status(visible[0] ? 409 : 404).json({
      message: visible[0] ? "工作流已在别处更新，请重新打开。" : "工作流不存在。",
    });
  });

  app.post("/api/projects/:projectId/workflowBindings", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const workflowId = request.body?.workflowId;
    if (!validId(request.params.projectId) || !validId(workflowId)) {
      response.status(400).json({ message: "项目或工作流无效。" });
      return;
    }
    const bindings = await database`
      INSERT INTO project_workflow_bindings (project_id, workflow_id, workflow_version)
      SELECT projects.id, workflows.id, workflows.version
      FROM projects CROSS JOIN workflows
      WHERE projects.id = ${request.params.projectId} AND projects.owner_id = ${user.id}
        AND workflows.id = ${workflowId} AND workflows.owner_id = ${user.id}
      ON CONFLICT (project_id, workflow_id) DO NOTHING
      RETURNING workflow_id AS "workflowId", workflow_version AS version
    `;
    if (!bindings[0]) {
      const existing = await database`
        SELECT 1 FROM project_workflow_bindings
        JOIN projects ON projects.id = project_workflow_bindings.project_id
        JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
        WHERE projects.id = ${request.params.projectId} AND projects.owner_id = ${user.id}
          AND workflows.id = ${workflowId} AND workflows.owner_id = ${user.id}
      `;
      response.status(existing[0] ? 409 : 404).json({ message: existing[0] ? "项目已引入该工作流。" : "项目或工作流不存在。" });
      return;
    }
    await database`UPDATE projects SET updated_at = now() WHERE id = ${request.params.projectId}`;
    response.status(201).json({ binding: bindings[0] });
  });

  app.put("/api/projects/:projectId/workflowBindings/:workflowId", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    if (!validId(request.params.projectId) || !validId(request.params.workflowId)) {
      response.status(404).json({ message: "项目工作流引用不存在。" });
      return;
    }
    const bindings = await database`
      UPDATE project_workflow_bindings SET workflow_version = workflows.version
      FROM projects, workflows
      WHERE project_workflow_bindings.project_id = projects.id
        AND project_workflow_bindings.workflow_id = workflows.id
        AND projects.id = ${request.params.projectId} AND projects.owner_id = ${user.id}
        AND workflows.id = ${request.params.workflowId} AND workflows.owner_id = ${user.id}
      RETURNING project_workflow_bindings.workflow_id AS "workflowId",
        project_workflow_bindings.workflow_version AS version
    `;
    if (!bindings[0]) {
      response.status(404).json({ message: "项目工作流引用不存在。" });
      return;
    }
    await database`UPDATE projects SET updated_at = now() WHERE id = ${request.params.projectId}`;
    response.json({ binding: bindings[0] });
  });

  app.post("/api/projects/:projectId/workflows", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (!validId(request.params.projectId) || !name || name.length > 120) {
      response.status(400).json({ message: "工作流名称需为 1–120 个字符。" });
      return;
    }
    const canvas: Canvas = validCanvas(request.body?.canvas)
      ? request.body.canvas
      : { nodes: [], edges: [] };
    const workflow = await database.begin(async (transaction) => {
      const projects = await transaction`
        SELECT id FROM projects WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
      `;
      if (!projects[0]) return null;
      const rows = await transaction`
        INSERT INTO workflows (id, owner_id, name, canvas)
        VALUES (${randomUUID()}, ${user.id}, ${name}, ${JSON.stringify(canvas)}::text::jsonb)
        RETURNING id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      await transaction`
        INSERT INTO workflow_versions (workflow_id, version, canvas)
        VALUES (${rows[0].id}, 1, ${JSON.stringify(canvas)}::text::jsonb)
      `;
      await transaction`
        INSERT INTO project_workflow_bindings (project_id, workflow_id, workflow_version)
        VALUES (${request.params.projectId}, ${rows[0].id}, 1)
      `;
      await transaction`UPDATE projects SET updated_at = now() WHERE id = ${request.params.projectId}`;
      return rows[0];
    });
    if (!workflow) {
      response.status(404).json({ message: "项目不存在。" });
      return;
    }
    response.status(201).json({ workflow });
  });

  app.get("/api/projects/:projectId/workflows/:workflowId", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    if (!validId(request.params.projectId) || !validId(request.params.workflowId)) {
      response.status(404).json({ message: "工作流不存在。" });
      return;
    }
    const workflows = await database`
      SELECT workflows.id, project_workflow_bindings.project_id AS "projectId", workflows.name,
        workflow_versions.canvas, project_workflow_bindings.workflow_version AS version,
        workflows.created_at AS "createdAt", workflows.updated_at AS "updatedAt"
      FROM project_workflow_bindings
      JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
      JOIN workflow_versions ON workflow_versions.workflow_id = workflows.id
        AND workflow_versions.version = project_workflow_bindings.workflow_version
      JOIN projects ON projects.id = project_workflow_bindings.project_id
      WHERE workflows.id = ${request.params.workflowId}
        AND project_workflow_bindings.project_id = ${request.params.projectId}
        AND workflows.owner_id = ${user.id}
        AND projects.owner_id = ${user.id}
    `;
    if (!workflows[0]) {
      response.status(404).json({ message: "工作流不存在。" });
      return;
    }
    await database`
      UPDATE projects SET updated_at = now()
      WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
    `;
    response.json({ workflow: workflows[0] });
  });

  app.put("/api/projects/:projectId/workflows/:workflowId/canvas", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const version = request.body?.version;
    if (!validId(request.params.projectId) || !validId(request.params.workflowId) ||
      !validCanvas(request.body?.canvas) || !Number.isInteger(version) || version < 1) {
      response.status(400).json({ message: "画布数据或版本无效。" });
      return;
    }
    const workflow = await database.begin(async (transaction) => {
      const bindings = await transaction`
        SELECT project_workflow_bindings.workflow_version AS version
        FROM project_workflow_bindings
        JOIN projects ON projects.id = project_workflow_bindings.project_id
        JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
        WHERE project_workflow_bindings.project_id = ${request.params.projectId}
          AND project_workflow_bindings.workflow_id = ${request.params.workflowId}
          AND projects.owner_id = ${user.id} AND workflows.owner_id = ${user.id}
        FOR UPDATE OF project_workflow_bindings
      `;
      if (!bindings[0] || bindings[0].version !== version) return null;
      const rows = await transaction`
        UPDATE workflows SET canvas = ${JSON.stringify(request.body.canvas)}::text::jsonb,
          version = workflows.version + 1, updated_at = now()
        WHERE id = ${request.params.workflowId} AND owner_id = ${user.id}
          AND version = ${version}
        RETURNING id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      if (!rows[0]) return null;
      await transaction`
        INSERT INTO workflow_versions (workflow_id, version, canvas)
        VALUES (${rows[0].id}, ${rows[0].version}, ${JSON.stringify(request.body.canvas)}::text::jsonb)
      `;
      await transaction`
        UPDATE project_workflow_bindings SET workflow_version = ${rows[0].version}
        WHERE project_id = ${request.params.projectId} AND workflow_id = ${rows[0].id}
      `;
      await transaction`UPDATE projects SET updated_at = now() WHERE id = ${request.params.projectId}`;
      return { ...rows[0], projectId: request.params.projectId };
    });
    if (!workflow) {
      const visible = await database`
        SELECT project_workflow_bindings.workflow_version AS version
        FROM project_workflow_bindings
        JOIN projects ON projects.id = project_workflow_bindings.project_id
        JOIN workflows ON workflows.id = project_workflow_bindings.workflow_id
        WHERE project_workflow_bindings.workflow_id = ${request.params.workflowId}
          AND project_workflow_bindings.project_id = ${request.params.projectId}
          AND projects.owner_id = ${user.id} AND workflows.owner_id = ${user.id}
      `;
      if (visible[0]) {
        response.status(409).json({ message: "工作流已在别处更新，请重新打开。", version: visible[0].version });
      } else {
        response.status(404).json({ message: "工作流不存在。" });
      }
      return;
    }
    response.json({ workflow });
  });

  app.use("/api/media/upload", createUploadRoute(database, storageDirectory));
  app.use("/api/media/list", createListRoute(database, storageDirectory));
  app.use("/api/media/read", createHeadRoute(database, storageDirectory));
  app.use("/api/media/read", createReadRoute(database, storageDirectory));
  app.use("/api/media/status", createStatusRoute(database, storageDirectory));
  app.use("/api/media/retract", createRetractRoute(database, storageDirectory));
  app.use("/api/generation/models", createGenerationModelsRoute(database, videoRuntimeAvailable));
  app.use("/api/generation/quotes", createGenerationQuoteRoute(database, videoRuntimeAvailable, storageDirectory));
  app.use("/api/generation/tasks", createGenerationTaskActionsRoute(database));
  app.use("/api/generation/tasks", createGenerationSubmitRoute(database, storageDirectory));
  app.use("/api/generation/tasks", createGenerationTaskListRoute(database));
  app.use("/api/generation/tasks", createGenerationTaskGetRoute(database));
  app.use("/api/generation/results", createGenerationResultAdoptRoute(database, storageDirectory));
  app.use("/api/generation/results", createGenerationResultHeadRoute(database, storageDirectory));
  app.use("/api/generation/results", createGenerationResultReadRoute(database, storageDirectory));
  app.use("/api/credits", createCreditsGetRoute(database));
  app.use("/api/credits/ledger", createCreditsLedgerRoute(database));
  app.use("/api/operations/credits/users", createOperationsCreditsUsersRoute(database));
  app.use("/api/operations/credits/users", createOperationsCreditsLedgerRoute(database));
  app.use("/api/operations/credits/preview", createOperationsCreditsPreviewRoute(database, resolve(dataDirectory, "privateCredits")));
  app.use("/api/operations/credits", createOperationsCreditsTopupRoute(database, resolve(dataDirectory, "privateCredits")));
  app.use("/api/operations/credits", createOperationsCreditsRefundRoute(database, resolve(dataDirectory, "privateCredits")));
  app.use("/api/operations/credits", createOperationsCreditsReversalRoute(database, resolve(dataDirectory, "privateCredits")));
  app.use("/api/operations/credits/entries", createOperationsCreditsCredentialRoute(database, resolve(dataDirectory, "privateCredits")));
  app.use("/api/operations/reconciliation", createOperationsReconciliationRoute(database, storageDirectory));
  app.use("/api/operations/dashboard", createDashboardRoute(database));
  app.use("/api/operations/users", createUsersListRoute(database));
  app.use("/api/operations/users/status", createUserStatusRoute(database));
  app.use("/api/operations/logs", createLogsListRoute(database));
  app.use("/api/operations/roles", createOperationsRolesGetRoute(database));
  app.use("/api/operations/roles/users", createOperationsRolesUsersRoute(database));
  app.use("/api/operations/roles", createOperationsRolesGrantRoute(database));
  app.use("/api/operations/roles", createOperationsRolesRevokeRoute(database));
  app.use("/api/works", createWorkSaveRoute(database, storageDirectory));
  app.use("/api/works", createWorkDownloadRoute(database, storageDirectory));
  app.use("/api/works", createWorkRemoveRoute(database));
  app.use("/api/operations/generation/tasks", createOperationsGenerationTaskListRoute(database));
  app.use("/api/operations/generation/tasks", createOperationsGenerationTaskActionsRoute(database));
  app.use("/api/operations/generation/tasks", createOperationsGenerationTaskReviewRoute(database, storageDirectory));
  app.use("/api/operations/generation/models", createOperationsGenerationModelsGetRoute(database));
  app.use("/api/operations/generation/models", createOperationsGenerationModelRevisionRoute(database));
  app.use("/api/operations/generation/models", createOperationsGenerationModelPublishRoute(database));
  app.use("/api/operations/generation/models", createOperationsGenerationModelPauseRoute(database));
  app.use("/api/notifications", createNotificationsListRoute(database));
  app.use("/api/notifications", createNotificationsReadRoute(database));
  app.use("/api/support", createSupportUserListRoute(database));
  app.use("/api/support", createSupportTicketCreateRoute(database));
  app.use("/api/support", createSupportTicketGetRoute(database));
  app.use("/api/support", createSupportUserReplyRoute(database));
  app.use("/api/support", createSupportTicketReopenRoute(database));
  app.use("/api/support", createSupportQueueRoute(database));
  app.use("/api/support", createSupportOperationsGetRoute(database));
  app.use("/api/support", createSupportOperationsActionRoute(database));
  app.use("/api/privacy", createPrivacyRequestCreateRoute(database));
  app.use("/api/privacy", createPrivacyRequestListRoute(database));
  app.use("/api/privacy", createPrivacyRequestGetRoute(database));
  app.use("/api/privacy", createPrivacyRequestSupplementRoute(database));
  app.use("/api/operations/privacy/requests", createOperationsPrivacyRequestListRoute(database));
  app.use("/api/operations/privacy/requests", createOperationsPrivacyRequestGetRoute(database));
  app.use("/api/operations/privacy/requests", createOperationsPrivacyRequestActionRoute(database));

  app.use((error: Error & { status?: number; code?: string }, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error.message);
    const status = error.status && error.status >= 400 && error.status <= 599 ? error.status : error.code === "23505" ? 409 : 500;
    response.status(status).json({ message: status === 500 ? "服务器暂时无法处理请求。" : error.message });
  });

  return app;
}
