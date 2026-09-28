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

  app.use("/api/projects", async (request, response, next) => {
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
      SELECT id, name, version, created_at AS "createdAt", updated_at AS "updatedAt"
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
    const canvas: Canvas = validCanvas(request.body?.canvas)
      ? request.body.canvas
      : { nodes: [], edges: [] };
    const projects = await database`
      INSERT INTO projects (id, owner_id, name, canvas)
      VALUES (${randomUUID()}, ${user.id}, ${name}, ${JSON.stringify(canvas)}::text::jsonb)
      RETURNING id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    response.status(201).json({ project: projects[0] });
  });

  app.get("/api/projects/:projectId", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const projects = await database`
      SELECT id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projects WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
    `;
    if (!projects[0]) {
      response.status(404).json({ message: "项目不存在。" });
      return;
    }
    response.json({ project: projects[0] });
  });

  app.put("/api/projects/:projectId/canvas", async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    const version = request.body?.version;
    if (!validCanvas(request.body?.canvas) || !Number.isInteger(version) || version < 1) {
      response.status(400).json({ message: "画布数据或版本无效。" });
      return;
    }
    const projects = await database`
      UPDATE projects
      SET canvas = ${JSON.stringify(request.body.canvas)}::text::jsonb,
          version = version + 1,
          updated_at = now()
      WHERE id = ${request.params.projectId} AND owner_id = ${user.id} AND version = ${version}
      RETURNING id, name, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    if (!projects[0]) {
      const visible = await database`
        SELECT version FROM projects WHERE id = ${request.params.projectId} AND owner_id = ${user.id}
      `;
      if (visible[0]) {
        response.status(409).json({ message: "项目已在别处更新，请重新打开。", version: visible[0].version });
      } else {
        response.status(404).json({ message: "项目不存在。" });
      }
      return;
    }
    response.json({ project: projects[0] });
  });

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error.message);
    response.status(500).json({ message: "服务器暂时无法处理请求。" });
  });

  return app;
}
