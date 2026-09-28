import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { createApp } from "./app";
import { createDatabase, type Database } from "./db/database";
import { migrate } from "./db/migrate";

type Canvas = { nodes: unknown[]; edges: unknown[] };

let database: Database;
let server: Server;
let baseUrl: string;
const runId = crypto.randomUUID();
const emailA = `cp2-a-${runId}@cruio.test`;
const emailB = `cp2-b-${runId}@cruio.test`;

async function startServer() {
  const app = await createApp({ database });
  return await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, "127.0.0.1", () => resolve(nextServer));
  });
}

function addressFor(activeServer: Server) {
  const address = activeServer.address();
  if (!address || typeof address === "string") throw new Error("测试服务器未监听 TCP 端口。");
  return `http://127.0.0.1:${address.port}`;
}

function sessionCookie(response: Response) {
  const value = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!value) throw new Error("响应中缺少会话 Cookie。");
  return value;
}

beforeAll(async () => {
  database = await createDatabase();
  await migrate(database);
  server = await startServer();
  baseUrl = addressFor(server);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await database`DELETE FROM users WHERE email IN (${emailA}, ${emailB})`;
  await database.close();
});

describe("CP2 persistence and owner isolation", () => {
  test("A restores its canvas after restart while B cannot access it", async () => {
    const registerA = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "test-password-a" }),
    });
    expect(registerA.status).toBe(201);
    const cookieA = sessionCookie(registerA);

    const created = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ name: "A 的持久化项目" }),
    });
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { id: string } };
    const createdWorkflow = await fetch(`${baseUrl}/api/projects/${project.id}/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ name: "A 的工作流" }),
    });
    expect(createdWorkflow.status).toBe(201);
    const { workflow } = (await createdWorkflow.json()) as { workflow: { id: string; version: number } };
    const savedCanvas = {
      nodes: [{ id: "persisted", position: { x: 42, y: 64 }, data: { label: "来自 PostgreSQL" } }],
      edges: [],
    };
    const saved = await fetch(`${baseUrl}/api/projects/${project.id}/workflows/${workflow.id}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ canvas: savedCanvas, version: workflow.version }),
    });
    expect(saved.status).toBe(200);

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    server = await startServer();
    baseUrl = addressFor(server);

    const restored = await fetch(`${baseUrl}/api/projects/${project.id}/workflows/${workflow.id}`, {
      headers: { cookie: cookieA },
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { workflow: { canvas: Canvas } }).workflow.canvas).toEqual(savedCanvas);

    const registerB = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailB, password: "test-password-b" }),
    });
    expect(registerB.status).toBe(201);
    const cookieB = sessionCookie(registerB);

    const deniedRead = await fetch(`${baseUrl}/api/projects/${project.id}/workflows/${workflow.id}`, {
      headers: { cookie: cookieB },
    });
    expect(deniedRead.status).toBe(404);

    const deniedWrite = await fetch(`${baseUrl}/api/projects/${project.id}/workflows/${workflow.id}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieB },
      body: JSON.stringify({ canvas: { nodes: [], edges: [] }, version: 2 }),
    });
    expect(deniedWrite.status).toBe(404);
  });
});
