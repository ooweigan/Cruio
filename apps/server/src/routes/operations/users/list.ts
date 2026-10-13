import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { requireRole, type User } from "@/utils/operations/access";

export default function createUsersListRoute(database: Database) {
  return Router().get("/", validateFields({
    query: z.string().max(254).optional(), status: z.enum(["all", "active", "disabled"]).optional(),
    page: z.string().regex(/^[1-9]\d{0,5}$/).optional(),
  }, "query"), async (request, response) => {
    await requireRole(database, response.locals.user as User, "admin");
    const query = String(request.query.query ?? "").trim();
    const status = String(request.query.status ?? "all");
    const page = Number(request.query.page ?? 1);
    const [counts, users] = await Promise.all([
      database`SELECT count(*)::int AS total FROM users WHERE position(lower(${query}) IN lower(email)) > 0
        AND (${status} = 'all' OR (${status} = 'disabled') = (disabled_at IS NOT NULL))`,
      database`SELECT users.id, email, created_at AS "createdAt", email_verified_at AS "emailVerifiedAt", disabled_at AS "disabledAt",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('role', role, 'scopeKind', scope_kind, 'expiresAt', expires_at) ORDER BY role)
          FROM staff_role_grants WHERE user_id = users.id AND revoked_at IS NULL AND expires_at > now()), '[]'::jsonb) AS roles
        FROM users WHERE position(lower(${query}) IN lower(email)) > 0
          AND (${status} = 'all' OR (${status} = 'disabled') = (disabled_at IS NOT NULL))
        ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
    ]);
    response.json(success({ users, total: counts[0].total, page, pageSize: 20 }));
  });
}
