import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit } from "@/utils/operations/access";
import type { SupportRole } from "@/utils/support/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupportQueueRoute(database: Database) {
  return Router().get("/queue", async (request, response) => {
    const operator = response.locals.user as User | undefined;
    if (!operator?.id) throw fail(401, "请先登录。");
    const limit = parseLimit(request.query.limit, 30, 100);
    if (!limit) throw fail(400, "工单队列数量无效。");
    let cursor: { updatedAt: string; id: string } | null = null;
    if (request.query.cursor !== undefined) {
      try {
        if (typeof request.query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(request.query.cursor)) throw new Error();
        const parsed = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
        if (typeof parsed.updatedAt !== "string" || !Number.isFinite(Date.parse(parsed.updatedAt))
          || typeof parsed.id !== "string" || !idPattern.test(parsed.id)) throw new Error();
        cursor = { updatedAt: parsed.updatedAt, id: parsed.id };
      } catch { throw fail(400, "工单队列游标无效。"); }
    }
    const grants = await database<{ role: SupportRole }[]>`
      SELECT DISTINCT role FROM staff_role_grants WHERE user_id = ${operator.id}
        AND role IN ('support', 'modelOperator', 'creditOperator') AND revoked_at IS NULL AND expires_at > clock_timestamp()
    `;
    if (!grants.length) throw fail(403, "当前账户没有有效的客服或业务核查岗位授权。");
    const rows = await database<{
      id: string; number: string; category: string; subject: string; status: string;
      assignedRole: SupportRole; relatedTaskId: string | null; relatedLedgerId: string | null;
      createdAt: string; updatedAt: string;
    }[]>`
      SELECT tickets.id, tickets.number, tickets.category,
        CASE WHEN EXISTS (
          SELECT 1 FROM staff_role_grants support_grants WHERE support_grants.user_id = ${operator.id}
            AND support_grants.role = 'support' AND support_grants.revoked_at IS NULL
            AND support_grants.expires_at > clock_timestamp()
            AND (support_grants.scope_kind = 'global' OR (support_grants.scope_kind = 'user' AND support_grants.scope_user_id = tickets.owner_id))
        ) THEN tickets.subject ELSE '关联业务待核查' END AS subject, tickets.status,
        tickets.assigned_role AS "assignedRole",
        CASE WHEN EXISTS (
          SELECT 1 FROM staff_role_grants support_grants WHERE support_grants.user_id = ${operator.id}
            AND support_grants.role = 'support' AND support_grants.revoked_at IS NULL
            AND support_grants.expires_at > clock_timestamp()
            AND (support_grants.scope_kind = 'global' OR (support_grants.scope_kind = 'user' AND support_grants.scope_user_id = tickets.owner_id))
        ) OR tickets.assigned_role = 'modelOperator' THEN tickets.related_task_id ELSE NULL END AS "relatedTaskId",
        CASE WHEN EXISTS (
          SELECT 1 FROM staff_role_grants support_grants WHERE support_grants.user_id = ${operator.id}
            AND support_grants.role = 'support' AND support_grants.revoked_at IS NULL
            AND support_grants.expires_at > clock_timestamp()
            AND (support_grants.scope_kind = 'global' OR (support_grants.scope_kind = 'user' AND support_grants.scope_user_id = tickets.owner_id))
        ) OR tickets.assigned_role = 'creditOperator' THEN tickets.related_ledger_id ELSE NULL END AS "relatedLedgerId",
        tickets.created_at::text AS "createdAt", tickets.updated_at::text AS "updatedAt"
      FROM support_tickets tickets
      WHERE tickets.status NOT IN ('closed', 'withdrawn', 'duplicate')
        AND EXISTS (
          SELECT 1 FROM staff_role_grants grants
          WHERE grants.user_id = ${operator.id} AND grants.revoked_at IS NULL AND grants.expires_at > clock_timestamp()
            AND (grants.scope_kind = 'global' OR (grants.scope_kind = 'user' AND grants.scope_user_id = tickets.owner_id))
            AND (grants.role = 'support' OR grants.role = tickets.assigned_role)
        )
        AND (${cursor?.updatedAt ?? null}::timestamptz IS NULL
          OR (tickets.updated_at, tickets.id) > (${cursor?.updatedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY tickets.updated_at, tickets.id LIMIT ${limit + 1}
    `;
    const tickets = rows.slice(0, limit);
    const nextCursor = rows.length > limit && tickets.at(-1)
      ? Buffer.from(JSON.stringify({ updatedAt: tickets.at(-1)!.updatedAt, id: tickets.at(-1)!.id })).toString("base64url") : null;
    return response.json({ tickets, nextCursor });
  });
}
