import { Router } from "express";
import type { Database } from "@/db/database";
import { readGenerationTask } from "@/utils/generation/taskView";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGenerationTaskGetRoute(database: Database) {
  return Router().get("/:taskId", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const taskId = request.params.taskId;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (!uuidPattern.test(taskId)) return response.status(404).json({ message: "任务不存在。" });
    const task = await readGenerationTask(database, user.id, taskId);
    if (!task) return response.status(404).json({ message: "任务不存在。" });
    return response.json({ task });
  });
}
