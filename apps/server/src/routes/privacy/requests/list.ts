import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit } from "@/utils/operations/access";
import { isValidPrivacyTimestamp, privacyCategories, uuidPattern } from "@/utils/privacy/requests";

type User = { id: string };

export function createPrivacyRequestListRoute(database: Database) {
  return Router().get("/requests", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const limit = parseLimit(request.query.limit, 30, 100);
    if (!limit) throw fail(400, "隐私申请查询数量无效。");
    const category = request.query.category;
    if (category !== undefined && (typeof category !== "string" || !privacyCategories.includes(category as typeof privacyCategories[number]))) {
      throw fail(400, "隐私申请类别无效。");
    }
    let cursor: { createdAt: string; id: string } | null = null;
    if (request.query.cursor !== undefined) {
      try {
        if (typeof request.query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(request.query.cursor)) throw new Error();
        const parsed = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
        if (typeof parsed.createdAt !== "string" || !isValidPrivacyTimestamp(parsed.createdAt)
          || typeof parsed.id !== "string" || !uuidPattern.test(parsed.id)) throw new Error();
        cursor = { createdAt: parsed.createdAt, id: parsed.id };
      } catch { throw fail(400, "隐私申请分页游标无效。"); }
    }
    const rows = await database<{ id: string; number: string; category: string; status: string; subject: string; createdAt: string; updatedAt: string }[]>`
      SELECT id, number, category, status, subject, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM privacy_requests WHERE owner_id = ${user.id} AND (${category ?? null}::text IS NULL OR category = ${category ?? null})
        AND (${cursor?.createdAt ?? null}::timestamptz IS NULL
          OR (created_at, id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}
    `;
    const requests = rows.slice(0, limit);
    const last = requests.at(-1);
    const nextCursor = rows.length > limit && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
    return response.json({ requests, nextCursor });
  });
}
