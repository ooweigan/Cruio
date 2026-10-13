import { Router } from "express";
import type { Database } from "@/db/database";
import { getGenerationResult } from "@/utils/generation/resultFile";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkDownloadRoute(database: Database, storageDirectory?: string) {
  return Router().get("/:workId/download", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const workId = request.params.workId;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (typeof workId !== "string" || !uuidPattern.test(workId)) return response.status(404).json({ message: "作品不存在。" });
    const rows = await database<{ resultId: string; taskStatus: string }[]>`
      SELECT results.id AS "resultId", tasks.status AS "taskStatus"
      FROM works
      JOIN projects ON projects.id = works.project_id
      JOIN generation_result_works ON generation_result_works.work_id = works.id
      JOIN generation_results AS results ON results.id = generation_result_works.result_id
      JOIN generation_tasks AS tasks ON tasks.id = results.task_id
      WHERE works.id = ${workId} AND works.deleted_at IS NULL
        AND projects.owner_id = ${user.id} AND results.user_id = ${user.id} AND tasks.user_id = ${user.id}
    `;
    const work = rows[0];
    if (!work) return response.status(404).json({ message: "作品不存在。" });
    if (work.taskStatus !== "delivered" || !(await getGenerationResult(database, storageDirectory, user.id, work.resultId))) {
      return response.status(409).json({ message: "作品文件当前不可下载。" });
    }
    return response.redirect(302, `/api/generation/results/${encodeURIComponent(work.resultId)}/read?download=true`);
  });
}
