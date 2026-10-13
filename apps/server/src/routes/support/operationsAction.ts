import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";
import { findSupportTicket, supportOperatorRole, type SupportRole } from "@/utils/support/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ticketStatuses = ["new", "processing", "waitingUser", "waitingExternal", "solutionPending", "closed"];

export function createSupportOperationsActionRoute(database: Database) {
  return Router().post("/operations/:ticketId/action", async (request, response) => {
    const operator = response.locals.user as User | undefined;
    const ticketId = request.params.ticketId;
    const body = request.body ?? {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!operator?.id) throw fail(401, "请先登录。");
    if (!idPattern.test(ticketId)) throw fail(404, "工单不存在。");
    const ticket = await findSupportTicket(database, ticketId);
    if (!ticket) throw fail(404, "工单不存在。");
    const action = body.action;
    if (typeof body.text === "string" && body.text.length > 4000) throw fail(400, "操作说明不能超过 4000 个字符。");
    const result = await database.begin(async transaction => {
      const locked = await transaction<{ status: string; assignedRole: SupportRole }[]>`
        SELECT status, assigned_role AS "assignedRole" FROM support_tickets WHERE id = ${ticket.id} FOR UPDATE
      `;
      if (!locked[0]) throw fail(404, "工单不存在。");
      const currentTicket = { ...ticket, status: locked[0].status, assignedRole: locked[0].assignedRole };
      const role = await supportOperatorRole(transaction, operator.id, currentTicket);
      const terminal = ["closed", "withdrawn", "duplicate", "safetyEscalated"].includes(locked[0].status);
      if (action === "reply") {
        if (role !== "support" || text.length < 1 || text.length > 4000) throw fail(400, "只有客服可以发送用户可见回复。");
        if (["closed", "withdrawn", "duplicate", "safetyEscalated"].includes(locked[0].status)) throw fail(409, "工单已结束，不能继续回复。");
        await transaction`
          INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, audience, body)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, 'support', 'user', ${text})
        `;
        await transaction`UPDATE support_tickets SET updated_at = now() WHERE id = ${ticket.id}`;
        await transaction`
          INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'supportReply', ${JSON.stringify({ message: "客服发送了用户可见回复。" })}::text::jsonb)
        `;
        return { action, status: locked[0].status };
      }
      if (action === "internalNote") {
        if (text.length < 1 || text.length > 3000) throw fail(400, "内部核查备注需为 1–3000 个字符。");
        await transaction`
          INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, audience, body)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'internal', ${text})
        `;
        await transaction`UPDATE support_tickets SET updated_at = now() WHERE id = ${ticket.id}`;
        await transaction`
          INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'internalNote', ${JSON.stringify({ message: "记录了内部核查备注。" })}::text::jsonb)
        `;
        return { action, status: locked[0].status };
      }
      if (action === "setStatus") {
        if (role !== "support" || typeof body.status !== "string" || !ticketStatuses.includes(body.status) || text.length > 1000) {
          throw fail(400, "当前岗位不能设置该工单状态。");
        }
        if (body.status === "closed" && text.length < 20) throw fail(400, "结案时请记录源事实结果引用或无后续行动解释。");
        if (["waitingUser", "waitingExternal", "solutionPending"].includes(body.status) && !text) throw fail(400, "请说明当前等待事项或已核实的处理结果。");
        if (["closed", "withdrawn", "duplicate", "safetyEscalated"].includes(locked[0].status)) throw fail(409, "已结束工单不能直接更改状态。");
        if (["closed", "waitingUser", "waitingExternal", "solutionPending"].includes(body.status)) {
          await transaction`
            INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, audience, body)
            VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, 'support', 'user', ${text})
          `;
        }
        const updated = await transaction`
          UPDATE support_tickets SET status = ${body.status}, closed_at = ${body.status === "closed" ? new Date() : null}, updated_at = now()
          WHERE id = ${ticket.id} RETURNING status, updated_at::text AS "updatedAt"
        `;
        await transaction`
          INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'statusChanged', ${JSON.stringify({ status: body.status, explanation: text })}::text::jsonb)
        `;
        return { action, ...updated[0] };
      }
      if (action === "handoff") {
        if (terminal) throw fail(409, "已结束工单不能转交；请由用户申请重开后继续处理。");
        const assignedRole = body.assignedRole as SupportRole;
        const validTarget = role === "support"
          ? ((assignedRole === "modelOperator" && Boolean(ticket.relatedTaskId)) || (assignedRole === "creditOperator" && Boolean(ticket.relatedLedgerId)))
          : assignedRole === "support";
        if (!validTarget || text.length < 3 || text.length > 1000) throw fail(400, "转交岗位或核查摘要无效。");
        const recipients = await transaction<{ id: string }[]>`
          SELECT id FROM staff_role_grants WHERE role = ${assignedRole} AND revoked_at IS NULL AND expires_at > clock_timestamp()
            AND (scope_kind = 'global' OR (scope_kind = 'user' AND scope_user_id = ${ticket.ownerId})) LIMIT 1
        `;
        if (!recipients[0]) throw fail(409, "目标业务岗位当前没有覆盖此用户的有效授权。");
        const status = assignedRole === "support" ? "processing" : "waitingBusiness";
        await transaction`
          UPDATE support_tickets SET assigned_role = ${assignedRole}, status = ${status}, updated_at = now()
          WHERE id = ${ticket.id}
        `;
        await transaction`
          INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, audience, body)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'internal', ${text})
        `;
        await transaction`
          INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'handedOff',
            ${JSON.stringify({ assignedRole, summary: text })}::text::jsonb)
        `;
        await transaction`
          INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
          VALUES (${randomUUID()}, ${ticket.id}, ${operator.id}, ${role}, 'statusChanged',
            ${JSON.stringify({ status })}::text::jsonb)
        `;
        return { action, assignedRole, status };
      }
      throw fail(400, "工单操作无效。");
    });
    return response.json({ ticket: result });
  });
}
