import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";
import { findSupportTicket, readSupportRelatedSummary, safeTicketSummary, supportOperatorRole } from "@/utils/support/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupportOperationsGetRoute(database: Database) {
  return Router().get("/operations/:ticketId", async (request, response) => {
    const operator = response.locals.user as User | undefined;
    const ticketId = request.params.ticketId;
    if (!operator?.id) throw fail(401, "请先登录。");
    if (!idPattern.test(ticketId)) throw fail(404, "工单不存在。");
    const ticket = await findSupportTicket(database, ticketId);
    if (!ticket) throw fail(404, "工单不存在。");
    const role = await supportOperatorRole(database, operator.id, ticket);
    const related = await readSupportRelatedSummary(database, ticket, role);
    if (role !== "support") {
      const handoffs = await database<{ summary: string | null }[]>`
        SELECT details->>'summary' AS summary FROM support_ticket_events
        WHERE ticket_id = ${ticket.id} AND event_type = 'handedOff'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `;
      return response.json({ ticket: { ...safeTicketSummary(ticket, related), handoffSummary: handoffs[0]?.summary ?? null }, role });
    }
    const messages = await database<{ id: string; authorRole: string; audience: string; body: string; createdAt: string }[]>`
      SELECT id, author_role AS "authorRole", audience, body, created_at::text AS "createdAt"
      FROM support_ticket_messages WHERE ticket_id = ${ticket.id} ORDER BY created_at, id
    `;
    const events = await database<{ id: string; actorRole: string; eventType: string; details: Record<string, unknown>; createdAt: string }[]>`
      SELECT id, actor_role AS "actorRole", event_type AS "eventType", details, created_at::text AS "createdAt"
      FROM support_ticket_events WHERE ticket_id = ${ticket.id} ORDER BY created_at, id
    `;
    return response.json({ ticket: { ...ticket, messages, events, related }, role });
  });
}
