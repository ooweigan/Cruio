import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = ["generation", "credits", "access", "other"] as const;

export function createSupportTicketCreateRoute(database: Database) {
  return Router().post("/tickets", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const body = request.body ?? {};
    const category = body.category;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const relatedTaskId = body.relatedTaskId ?? null;
    const relatedLedgerId = body.relatedLedgerId ?? null;
    if (!categories.includes(category) || subject.length < 2 || subject.length > 120 || description.length < 10 || description.length > 4000
      || (relatedTaskId !== null && (typeof relatedTaskId !== "string" || !idPattern.test(relatedTaskId)))
      || (relatedLedgerId !== null && (typeof relatedLedgerId !== "string" || !idPattern.test(relatedLedgerId)))
      || (category === "generation" && !relatedTaskId) || (category === "credits" && !relatedLedgerId)) {
      throw fail(400, "工单信息无效：生成任务问题需关联本人任务，积分问题需关联本人账单记录。");
    }
    if (relatedTaskId) {
      const tasks = await database`SELECT id FROM generation_tasks WHERE id = ${relatedTaskId} AND user_id = ${user.id}`;
      if (!tasks[0]) throw fail(404, "关联任务不存在。");
    }
    if (relatedLedgerId) {
      const entries = await database`SELECT id FROM credit_ledger WHERE id = ${relatedLedgerId} AND user_id = ${user.id}`;
      if (!entries[0]) throw fail(404, "关联账单记录不存在。");
    }
    const ticketId = randomUUID();
    const ticketNumber = `CS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${ticketId.slice(0, 8).toUpperCase()}`;
    const ticket = await database.begin(async transaction => {
      const rows = await transaction`
        INSERT INTO support_tickets
          (id, number, owner_id, category, subject, description, status, assigned_role, related_task_id, related_ledger_id)
        VALUES (${ticketId}, ${ticketNumber}, ${user.id}, ${category}, ${subject}, ${description}, 'new', 'support',
          ${relatedTaskId}, ${relatedLedgerId})
        RETURNING id, number, category, subject, status, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      `;
      await transaction`
        INSERT INTO support_ticket_events (id, ticket_id, actor_id, actor_role, event_type, details)
        VALUES (${randomUUID()}, ${ticketId}, ${user.id}, 'user', 'created', ${JSON.stringify({ message: "用户提交了工单。" })}::text::jsonb)
      `;
      return rows[0];
    });
    return response.status(201).json({ ticket });
  });
}
