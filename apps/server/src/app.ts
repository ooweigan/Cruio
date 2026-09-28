import { createHash, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createDatabase, type Database } from "./db/database";

const sessionCookieName = "cruio_session";
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 30;

type AuthenticatedUser = { id: string; email: string };
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

function setSessionCookie(response: Response, token: string) {
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionLifetimeMs,
    path: "/",
  });
}

function clearSessionCookie(response: Response) {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

async function createSession(database: Database, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await database`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (${randomUUID()}, ${userId}, ${hashToken(token)}, ${expiresAt})
  `;
  return token;
}

async function currentUser(database: Database, request: Request) {
  const token = readCookie(request, sessionCookieName);
  if (!token) return null;
  const users = await database<AuthenticatedUser[]>`
    SELECT users.id, users.email
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${hashToken(token)}
      AND sessions.expires_at > now()
  `;
  return users[0] ?? null;
}

export async function createApp(options: { database?: Database } = {}) {
  const database = options.database ?? (await createDatabase());
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.get("/api/health", async (_request, response) => {
    await database`SELECT 1`;
    response.json({ status: "ok", service: "cruio", database: "connected" });
  });

  app.post("/api/auth/register", async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    if (!validEmail(email) || typeof password !== "string" || password.length < 8) {
      response.status(400).json({ message: "请输入有效邮箱和至少 8 位密码。" });
      return;
    }
    const existing = await database`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      response.status(409).json({ message: "该邮箱已注册。" });
      return;
    }

    const user: AuthenticatedUser = { id: randomUUID(), email };
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    await database`
      INSERT INTO users (id, email, password_hash)
      VALUES (${user.id}, ${user.email}, ${passwordHash})
    `;
    setSessionCookie(response, await createSession(database, user.id));
    response.status(201).json({ user });
  });

  app.post("/api/auth/login", async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    const rows = await database<(AuthenticatedUser & { passwordHash: string })[]>`
      SELECT id, email, password_hash AS "passwordHash" FROM users WHERE email = ${email}
    `;
    const user = rows[0];
    if (!user || typeof password !== "string" || !(await Bun.password.verify(password, user.passwordHash))) {
      response.status(401).json({ message: "邮箱或密码不正确。" });
      return;
    }
    setSessionCookie(response, await createSession(database, user.id));
    response.json({ user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/logout", async (request, response) => {
    const token = readCookie(request, sessionCookieName);
    if (token) await database`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
    clearSessionCookie(response);
    response.status(204).end();
  });

  app.use(["/api/projects", "/api/workflows"], async (request, response, next) => {
    const user = await currentUser(database, request);
    if (!user) {
      response.status(401).json({ message: "请先登录。" });
      return;
    }
    response.locals.user = user;
    next();
  });

  app.get("/api/auth/me", async (request, response) => {
    const user = await currentUser(database, request);
    if (!user) {
      response.status(401).json({ message: "请先登录。" });
      return;
    }
    response.json({ user });
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
      WHERE works.project_id = ${request.params.projectId} AND projects.owner_id = ${user.id}
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

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error.message);
    response.status(500).json({ message: "服务器暂时无法处理请求。" });
  });

  return app;
}
