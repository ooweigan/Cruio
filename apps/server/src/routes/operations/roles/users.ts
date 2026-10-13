import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit, requireRole, type User } from "@/utils/operations/access";

export function createOperationsRolesUsersRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    await requireRole(database, response.locals.user as User, "admin");
    const query = typeof request.query.query === "string" ? request.query.query.trim().toLowerCase() : "";
    const search = query ? `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : "%";
    const limit = parseLimit(request.query.limit, 20, 50);
    if (!limit) throw fail(400, "用户查询数量无效。");
    const users = await database`
      SELECT id, email FROM users WHERE email ILIKE ${search} ESCAPE '\\' ORDER BY email LIMIT ${limit}
    `;
    return response.json({ users });
  });
}
