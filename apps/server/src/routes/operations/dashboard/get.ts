import { Router } from "express";
import type { Database } from "@/db/database";
import { success } from "@/lib/responseFormat";
import { requireRole, type User } from "@/utils/operations/access";

export default function createDashboardRoute(database: Database) {
  return Router().get("/", async (_request, response) => {
    await requireRole(database, response.locals.user as User, "admin");
    const [summary, daily, taskStates, modelTypes, recentUsers] = await Promise.all([
      database`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE disabled_at IS NOT NULL) AS "disabledUsers",
        (SELECT count(*)::int FROM generation_models WHERE is_current) AS models,
        (SELECT count(*)::int FROM generation_models WHERE is_current AND published) AS "publishedModels",
        (SELECT count(DISTINCT provider_id)::int FROM generation_models WHERE is_current) AS providers,
        (SELECT count(*)::int FROM generation_tasks) AS tasks`,
      database`SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        (SELECT count(*)::int FROM users WHERE created_at >= days.day AT TIME ZONE 'Asia/Shanghai'
          AND created_at < (days.day + interval '1 day') AT TIME ZONE 'Asia/Shanghai') AS users,
        (SELECT count(*)::int FROM generation_tasks WHERE created_at >= days.day AT TIME ZONE 'Asia/Shanghai'
          AND created_at < (days.day + interval '1 day') AT TIME ZONE 'Asia/Shanghai') AS tasks
        FROM generate_series(date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '6 days',
          date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai'), interval '1 day') AS days(day) ORDER BY day`,
      database`SELECT status, count(*)::int AS count FROM generation_tasks GROUP BY status ORDER BY status`,
      database`SELECT operation, count(*)::int AS count,
        count(*) FILTER (WHERE published)::int AS published FROM generation_models WHERE is_current GROUP BY operation ORDER BY operation`,
      database`SELECT id, email, created_at AS "createdAt", disabled_at AS "disabledAt" FROM users ORDER BY created_at DESC, id DESC LIMIT 5`,
    ]);
    response.json(success({ summary: summary[0], daily, taskStates, modelTypes, recentUsers, updatedAt: new Date().toISOString() }));
  });
}
