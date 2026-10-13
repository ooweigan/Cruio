import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit, type User } from "@/utils/operations/access";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createOperationsGenerationTaskListRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const operator = response.locals.user as User;
    const limit = parseLimit(request.query.limit, 50, 100);
    if (!limit) throw fail(400, "分页数量无效。");
    let cursor: { updatedAt: string; id: string } | null = null;
    if (request.query.cursor !== undefined) {
      try {
        if (typeof request.query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(request.query.cursor)) throw new Error();
        const parsed = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
        if (typeof parsed.updatedAt !== "string" || !Number.isFinite(Date.parse(parsed.updatedAt))
          || typeof parsed.id !== "string" || !idPattern.test(parsed.id)) throw new Error();
        cursor = { updatedAt: parsed.updatedAt, id: parsed.id };
      } catch { throw fail(400, "异常任务分页游标无效。"); }
    }
    const grants = await database<{ id: string }[]>`
      SELECT id FROM staff_role_grants WHERE user_id = ${operator.id} AND role = 'modelOperator'
        AND revoked_at IS NULL AND expires_at > clock_timestamp() LIMIT 1
    `;
    if (!grants[0]) throw fail(403, "当前账户没有有效的模型运营岗位授权。");
    const tasks = await database<{
      id: string; userId: string; status: string; projectId: string; modelId: string; providerTaskId: string | null;
      providerStatus: string | null; safeError: string | null; updatedAt: string; cursorUpdatedAt: string; createdAt: Date;
    }[]>`
      SELECT tasks.id, tasks.user_id AS "userId", tasks.status, tasks.project_id AS "projectId",
        quotes.model_id AS "modelId", tasks.provider_task_id AS "providerTaskId", tasks.provider_status AS "providerStatus",
        tasks.safe_error AS "safeError", tasks.updated_at::text AS "updatedAt", tasks.updated_at::text AS "cursorUpdatedAt",
        tasks.created_at AS "createdAt"
      FROM generation_tasks AS tasks JOIN generation_quotes AS quotes ON quotes.id = tasks.quote_id
      WHERE EXISTS (
        SELECT 1 FROM staff_role_grants grants WHERE grants.user_id = ${operator.id} AND grants.role = 'modelOperator'
          AND grants.revoked_at IS NULL AND grants.expires_at > clock_timestamp()
          AND (grants.scope_kind = 'global' OR (grants.scope_kind = 'user' AND grants.scope_user_id = tasks.user_id))
      ) AND (
        tasks.status = 'unknown'
        OR (tasks.status = 'running' AND tasks.updated_at < now() - interval '5 minutes'
          AND (tasks.worker_claimed_until IS NULL OR tasks.worker_claimed_until < now()))
        OR (tasks.status = 'failed' AND NOT EXISTS (
          SELECT 1 FROM credit_ledger WHERE task_id = tasks.id AND entry_type = 'release'
        ))
        OR (tasks.status <> 'delivered' AND EXISTS (SELECT 1 FROM generation_results WHERE task_id = tasks.id))
      ) AND (${cursor?.updatedAt ?? null}::timestamptz IS NULL
        OR (tasks.updated_at, tasks.id) > (${cursor?.updatedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY tasks.updated_at ASC, tasks.id ASC LIMIT ${limit + 1}
    `;
    const page = tasks.slice(0, limit);
    const enriched = await Promise.all(page.map(async task => {
      const events = await database<{ eventType: string; details: Record<string, unknown>; actorRole: string; createdAt: Date }[]>`
        SELECT event_type AS "eventType", details, actor_role AS "actorRole", created_at AS "createdAt"
        FROM generation_task_events WHERE task_id = ${task.id} ORDER BY created_at
      `;
      const attempts = await database<{
        id: string; phase: string; safeError: string | null; providerTaskId: string | null; providerStatus: string | null; createdAt: Date;
      }[]>`
        SELECT id, phase, safe_error AS "safeError", provider_task_id AS "providerTaskId",
          provider_status AS "providerStatus", created_at AS "createdAt"
        FROM generation_task_attempts WHERE task_id = ${task.id} ORDER BY created_at
      `;
      return { ...task, timeline: events, attempts };
    }));
    const lastTask = page.at(-1);
    const nextCursor = tasks.length > limit && lastTask
      ? Buffer.from(JSON.stringify({ updatedAt: lastTask.cursorUpdatedAt, id: lastTask.id })).toString("base64url") : null;
    return response.json({ tasks: enriched.map(({ cursorUpdatedAt: _cursorUpdatedAt, ...task }) => task), nextCursor });
  });
}
