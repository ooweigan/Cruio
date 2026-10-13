import { Router } from "express";
import type { Database } from "@/db/database";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkRemoveRoute(database: Database) {
  return Router().delete("/:workId", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const workId = request.params.workId;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (typeof workId !== "string" || !uuidPattern.test(workId)) return response.status(404).json({ message: "作品不存在。" });
    const removed = await database<{ id: string }[]>`
      UPDATE works SET deleted_at = now()
      FROM projects
      WHERE works.project_id = projects.id AND projects.owner_id = ${user.id}
        AND works.id = ${workId} AND works.deleted_at IS NULL
      RETURNING works.id
    `;
    if (!removed[0]) return response.status(404).json({ message: "作品不存在。" });
    return response.status(204).end();
  });
}
