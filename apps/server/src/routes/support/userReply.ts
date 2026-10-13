import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupportUserReplyRoute(database: Database) {
  return Router().post("/tickets/:ticketId/reply", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const ticketId = request.params.ticketId;
    const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
    if (!user?.id) throw fail(401, "请先登录。");
    if (!idPattern.test(ticketId)) throw fail(404, "工单不存在。");
    if (body.length < 1 || body.length > 4000) throw fail(400, "回复内容需为 1–4000 个字符。");
    const result = await database.begin(async transaction => {
      const tickets = await transaction<{ id: string; status: string }[]>`
        SELECT id, status FROM support_tickets WHERE id = ${ticketId} AND owner_id = ${user.id} FOR UPDATE
      `;
      const ticket = tickets[0];
      if (!ticket) throw fail(404, "工单不存在。");
      if (["closed", "withdrawn", "duplicate", "safetyEscalated"].includes(ticket.status)) throw fail(409, "该工单已结束，请申请重开或新建关联工单。");
      const messages = await transaction`
        INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, audience, body)
        VALUES (${randomUUID()}, ${ticket.id}, ${user.id}, 'user', 'user', ${body})
      `;
      const nextStatus = ticket.status === "waitingUser" ? "processing" : ticket.status;
      await transaction`
        UPDATE support_tickets SET status = ${nextStatus}, updated_at = now() WHERE id = ${ticket.id}
      `;
      await transaction`
        INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
        VALUES (${randomUUID()}, ${ticket.id}, ${user.id}, 'user', 'userReply', ${JSON.stringify({ message: "用户补充了工单信息。" })}::text::jsonb)
      `;
      return { id: ticket.id, status: nextStatus };
    });
    return response.status(201).json({ ticket: result });
  });
}
