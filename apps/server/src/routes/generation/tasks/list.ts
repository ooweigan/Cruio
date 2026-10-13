import { Router } from "express";
import type { Database } from "@/db/database";
import { readGenerationTask } from "@/utils/generation/taskView";
import { fail, parseLimit } from "@/utils/operations/access";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGenerationTaskListRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const projectId = request.query.projectId;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (projectId !== undefined && (typeof projectId !== "string" || !uuidPattern.test(projectId))) return response.status(400).json({ message: "项目标识无效。" });
    const limit = parseLimit(request.query.limit, 100, 100);
    if (!limit) throw fail(400, "任务分页数量无效。");
    let cursor: { createdAt: string; id: string } | null = null;
    if (request.query.cursor !== undefined) {
      try {
        if (typeof request.query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(request.query.cursor)) throw new Error();
        const parsed = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
        if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
          || typeof parsed.id !== "string" || !uuidPattern.test(parsed.id)) throw new Error();
        cursor = { createdAt: parsed.createdAt, id: parsed.id };
      } catch { throw fail(400, "任务分页游标无效。"); }
    }
    if (typeof projectId === "string") {
      const projects = await database`SELECT 1 FROM projects WHERE id = ${projectId} AND owner_id = ${user.id}`;
      if (!projects[0]) return response.status(404).json({ message: "项目不存在。" });
    }
    const rows = await database<{ id: string; cursorCreatedAt: string }[]>`
      SELECT id, created_at::text AS "cursorCreatedAt" FROM generation_tasks
      WHERE user_id = ${user.id} AND (${projectId ?? null}::uuid IS NULL OR project_id = ${projectId ?? null}::uuid)
        AND (${cursor?.createdAt ?? null}::timestamptz IS NULL OR (created_at, id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    const tasks = await Promise.all(page.map(row => readGenerationTask(database, user.id, row.id)));
    const lastRow = page.at(-1);
    const nextCursor = rows.length > limit && lastRow
      ? Buffer.from(JSON.stringify({ createdAt: lastRow.cursorCreatedAt, id: lastRow.id })).toString("base64url") : null;
    return response.json({ tasks: tasks.filter(Boolean), nextCursor });
  });
}
