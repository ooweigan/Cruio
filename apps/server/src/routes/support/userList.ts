import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit } from "@/utils/operations/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupportUserListRoute(database: Database) {
  return Router().get("/tickets", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const limit = parseLimit(request.query.limit, 30, 100);
    if (!limit) throw fail(400, "工单查询数量无效。");
    let cursor: { createdAt: string; id: string } | null = null;
    if (request.query.cursor !== undefined) {
      try {
        if (typeof request.query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(request.query.cursor)) throw new Error();
        const parsed = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
        if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
          || typeof parsed.id !== "string" || !idPattern.test(parsed.id)) throw new Error();
        cursor = { createdAt: parsed.createdAt, id: parsed.id };
      } catch { throw fail(400, "工单分页游标无效。"); }
    }
    const rows = await database<{ id: string; number: string; category: string; subject: string; status: string; createdAt: string; updatedAt: string }[]>`
      SELECT id, number, category, subject, status, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM support_tickets WHERE owner_id = ${user.id}
        AND (${cursor?.createdAt ?? null}::timestamptz IS NULL OR (created_at, id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}
    `;
    const tickets = rows.slice(0, limit);
    const last = tickets.at(-1);
    const nextCursor = rows.length > limit && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
    return response.json({ tickets, nextCursor });
  });
}
