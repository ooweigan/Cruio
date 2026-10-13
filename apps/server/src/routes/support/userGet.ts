import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";
import { findSupportTicket, readSupportRelatedSummary } from "@/utils/support/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupportTicketGetRoute(database: Database) {
  return Router().get("/tickets/:ticketId", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const ticketId = request.params.ticketId;
    if (!user?.id) throw fail(401, "请先登录。");
    if (!idPattern.test(ticketId)) throw fail(404, "工单不存在。");
    const ticket = await findSupportTicket(database, ticketId);
    if (!ticket || ticket.ownerId !== user.id) throw fail(404, "工单不存在。");
    const messages = await database<{ id: string; authorRole: string; body: string; createdAt: string }[]>`
      SELECT id, author_role AS "authorRole", body, created_at::text AS "createdAt"
      FROM support_ticket_messages WHERE ticket_id = ${ticket.id} AND audience = 'user' ORDER BY created_at, id
    `;
    const related = await readSupportRelatedSummary(database, ticket);
    return response.json({ ticket: { ...ticket, messages, related } });
  });
}
