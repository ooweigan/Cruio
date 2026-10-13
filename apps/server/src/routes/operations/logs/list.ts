import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { fail, requireRole, type User } from "@/utils/operations/access";

export default function createLogsListRoute(database: Database) {
  return Router().get("/", validateFields({
    query: z.string().max(254).optional(), category: z.enum(["all", "roles", "models", "account"]).optional(),
    from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
    page: z.string().regex(/^[1-9]\d{0,5}$/).optional(),
  }, "query"), async (request, response) => {
    await requireRole(database, response.locals.user as User, "admin");
    const query = String(request.query.query ?? "").trim();
    const category = String(request.query.category ?? "all");
    const from = request.query.from ? new Date(String(request.query.from)) : new Date(0);
    const to = request.query.to ? new Date(String(request.query.to)) : new Date();
    const page = Number(request.query.page ?? 1);
    if (from >= to) throw fail(400, "结束时间须晚于开始时间。");
    // ACT: 复用业务事件作为只读日志，元数据白名单不包含请求体、密钥或用户创作内容。
    const rows = await database`WITH events AS (
      SELECT 'grant:' || id AS id, 'roles' AS category, 'roleGranted' AS action, granted_by AS actor_id,
        user_id AS subject_id, role AS target, 'success' AS outcome, created_at AS occurred_at FROM staff_role_grants
      UNION ALL
      SELECT 'revoke:' || id, 'roles', 'roleRevoked', revoked_by, user_id, role, 'success', revoked_at
        FROM staff_role_grants WHERE revoked_at IS NOT NULL
      UNION ALL
      SELECT 'model:' || events.id, 'models', event_type, actor_id, NULL::uuid,
        COALESCE(models.model_id, events.market_code, ''), 'success', events.created_at
        FROM generation_model_management_events events LEFT JOIN generation_models models ON models.id = events.model_revision_id
      UNION ALL
      SELECT 'account:' || id, 'account', event_type, actor_user_id, subject_user_id, '', outcome, created_at FROM auth_security_events
    ), filtered AS (
      SELECT events.id, category, action, actors.email AS actor, subjects.email AS subject, target, outcome, occurred_at AS "occurredAt"
        FROM events LEFT JOIN users actors ON actors.id = events.actor_id LEFT JOIN users subjects ON subjects.id = events.subject_id
        WHERE (${category} = 'all' OR category = ${category}) AND occurred_at >= ${from} AND occurred_at < ${to}
          AND position(lower(${query}) IN lower(COALESCE(actors.email, '') || ' ' || COALESCE(subjects.email, '') || ' ' || target || ' ' || action)) > 0
    ) SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(item ORDER BY item."occurredAt" DESC, item.id DESC) FROM (
        SELECT * FROM filtered ORDER BY "occurredAt" DESC, id DESC LIMIT 30 OFFSET ${(page - 1) * 30}
      ) item), '[]'::jsonb) AS events`;
    response.json(success({ ...rows[0], page, pageSize: 30 }));
  });
}
