import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, parseLimit } from "@/utils/operations/access";
import { encodeNotificationCursor, listServiceNotifications } from "@/utils/notifications/projection";

type User = { id: string };
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const eventIdPattern = new RegExp(`^(?:task:${uuidPattern}:(?:accepted|unknown|failed|delivered)|credit:${uuidPattern}|ticket:${uuidPattern})$`, "i");

export function createNotificationsListRoute(database: Database) {
  return Router().get("/", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const limit = parseLimit(request.query.limit, 30, 100);
    if (!limit) throw fail(400, "通知查询数量无效。");
    const category = request.query.category;
    if (category !== undefined && category !== "task" && category !== "credits" && category !== "support") throw fail(400, "通知类别无效。");
    let cursor: { eventAt: string; eventId: string } | null = null;
    if (request.query.cursor !== undefined) {
      try {
        if (typeof request.query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(request.query.cursor)) throw new Error();
        const parsed = JSON.parse(Buffer.from(request.query.cursor, "base64url").toString("utf8")) as { eventAt?: unknown; eventId?: unknown };
        if (typeof parsed.eventAt !== "string" || !Number.isFinite(Date.parse(parsed.eventAt))
          || typeof parsed.eventId !== "string" || !eventIdPattern.test(parsed.eventId)) throw new Error();
        cursor = { eventAt: parsed.eventAt, eventId: parsed.eventId };
      } catch { throw fail(400, "通知分页游标无效。"); }
    }
    const rows = await listServiceNotifications(database, user.id, {
      limit, cursor, category: category === "task" || category === "credits" || category === "support" ? category : null,
    });
    const notifications = rows.slice(0, limit);
    const last = notifications.at(-1);
    const nextCursor = rows.length > limit && last ? encodeNotificationCursor(last.eventAt, last.eventId) : null;
    return response.json({ notifications, nextCursor });
  });
}
