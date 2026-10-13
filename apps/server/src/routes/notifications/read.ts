import { Router } from "express";
import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";

type User = { id: string };
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const taskEventPattern = new RegExp(`^task:(${uuidPattern}):(accepted|unknown|failed|delivered)$`, "i");
const creditEventPattern = new RegExp(`^credit:(${uuidPattern})$`, "i");
const ticketEventPattern = new RegExp(`^ticket:(${uuidPattern})$`, "i");

export function createNotificationsReadRoute(database: Database) {
  return Router().post("/read", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const eventIds = request.body?.eventIds;
    if (!Array.isArray(eventIds) || eventIds.length < 1 || eventIds.length > 100
      || eventIds.some((eventId: unknown) => typeof eventId !== "string"
        || (!taskEventPattern.test(eventId) && !creditEventPattern.test(eventId) && !ticketEventPattern.test(eventId)))) {
      throw fail(400, "通知已读请求无效。");
    }
    const uniqueIds = [...new Set(eventIds as string[])];
    await database.begin(async transaction => {
      for (const eventId of uniqueIds) {
        const taskMatch = taskEventPattern.exec(eventId);
        if (taskMatch) {
          const visible = await transaction`
            SELECT 1 FROM generation_task_attempts attempts
            JOIN generation_tasks tasks ON tasks.id = attempts.task_id
            WHERE tasks.user_id = ${user.id} AND tasks.id = ${taskMatch[1]} AND attempts.phase = ${taskMatch[2]} LIMIT 1
          `;
          if (!visible[0]) throw fail(404, "通知不存在。");
        } else if (creditEventPattern.test(eventId)) {
          const creditMatch = creditEventPattern.exec(eventId);
          const visible = await transaction`
            SELECT 1 FROM credit_ledger WHERE user_id = ${user.id} AND id = ${creditMatch?.[1]}
              AND entry_type IN ('topup', 'refund', 'reversal', 'settle', 'release') LIMIT 1
          `;
          if (!visible[0]) throw fail(404, "通知不存在。");
        } else {
          const ticketMatch = ticketEventPattern.exec(eventId);
          const visible = await transaction`
            SELECT 1 FROM support_ticket_events events JOIN support_tickets tickets ON tickets.id = events.ticket_id
            WHERE tickets.owner_id = ${user.id} AND events.id = ${ticketMatch?.[1]}
              AND events.event_type IN ('supportReply', 'statusChanged') LIMIT 1
          `;
          if (!visible[0]) throw fail(404, "通知不存在。");
        }
        await transaction`
          INSERT INTO notification_read_receipts (user_id, event_id, read_at)
          VALUES (${user.id}, ${eventId}, now())
          ON CONFLICT (user_id, event_id) DO NOTHING
        `;
      }
    });
    return response.json({ markedRead: uniqueIds.length });
  });
}
