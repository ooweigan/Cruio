import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupportTicketReopenRoute(database: Database) {
  return Router().post("/tickets/:ticketId/reopen", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const ticketId = request.params.ticketId;
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!user?.id) throw fail(401, "请先登录。");
    if (!idPattern.test(ticketId)) throw fail(404, "工单不存在。");
    if (reason.length < 3 || reason.length > 500) throw fail(400, "请说明申请重开的原因。");
    const ticket = await database.begin(async transaction => {
      const rows = await transaction<{ id: string; status: string }[]>`
        SELECT id, status FROM support_tickets WHERE id = ${ticketId} AND owner_id = ${user.id} FOR UPDATE
      `;
      if (!rows[0]) throw fail(404, "工单不存在。");
      if (rows[0].status !== "closed") throw fail(409, "只有已结案工单可以申请重开。");
      const updated = await transaction`
        UPDATE support_tickets SET status = 'processing', assigned_role = 'support', closed_at = NULL, updated_at = now()
        WHERE id = ${ticketId} AND owner_id = ${user.id}
        RETURNING id, number, status, updated_at::text AS "updatedAt"
      `;
      await transaction`
        INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
        VALUES (${randomUUID()}, ${ticketId}, ${user.id}, 'user', 'reopened', ${JSON.stringify({ reason })}::text::jsonb)
      `;
      return updated[0];
    });
    return response.json({ ticket });
  });
}
