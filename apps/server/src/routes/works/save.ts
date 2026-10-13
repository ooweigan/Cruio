import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { getGenerationResultFile } from "@/utils/generation/resultFile";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkSaveRoute(database: Database, storageDirectory?: string) {
  return Router().post("/", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const { taskId, resultIds, title } = request.body ?? {};
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (typeof taskId !== "string" || !uuidPattern.test(taskId) || !Array.isArray(resultIds)
      || resultIds.length < 1 || resultIds.length > 32 || resultIds.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id))
      || new Set(resultIds).size !== resultIds.length || typeof title !== "string" || !title.trim() || title.trim().length > 160) {
      return response.status(400).json({ message: "作品保存信息无效。" });
    }
    const tasks = await database<{ projectId: string; status: string }[]>`
      SELECT project_id AS "projectId", status FROM generation_tasks WHERE id = ${taskId} AND user_id = ${user.id}
    `;
    const task = tasks[0];
    if (!task) return response.status(404).json({ message: "任务不存在。" });
    if (task.status !== "delivered") return response.status(409).json({ message: "结果尚未可靠交付，暂不能保存为作品。" });
    let saved: { workId: string; title: string; createdAt: Date; mediaType: string; previewUrl: string; created: boolean }[];
    try {
      saved = await database.begin(async transaction => {
      const results = await transaction<{ id: string; mediaType: string; mimeType: string; storageKey: string; size: number }[]>`
        SELECT id, media_type AS "mediaType", mime_type AS "mimeType", storage_key AS "storageKey", size
        FROM generation_results WHERE task_id = ${taskId} AND user_id = ${user.id}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(resultIds)}::text::jsonb))
        ORDER BY id FOR UPDATE
      `;
      if (results.length !== resultIds.length) throw Object.assign(new Error("部分候选结果不存在或不可访问。"), { status: 404 });
      const works = [];
      for (const result of results) {
        const file = await getGenerationResultFile(storageDirectory, user.id, result.storageKey, Number(result.size));
        if (!file) throw Object.assign(new Error("结果副本暂不可用，不能保存为作品。"), { status: 409 });
        const existing = await transaction<{ id: string; title: string; createdAt: Date; deletedAt: Date | null }[]>`
          SELECT works.id, works.title, works.created_at AS "createdAt", works.deleted_at AS "deletedAt"
          FROM generation_result_works JOIN works ON works.id = generation_result_works.work_id
          WHERE generation_result_works.result_id = ${result.id}
        `;
        if (existing[0]) {
          if (existing[0].deletedAt) throw Object.assign(new Error("该结果已保存的作品已删除，不能重复创建。"), { status: 409 });
          works.push({ workId: existing[0].id, title: existing[0].title, createdAt: existing[0].createdAt,
            mediaType: result.mediaType, previewUrl: `/api/generation/results/${result.id}/read`, created: false });
          continue;
        }
        const workId = randomUUID();
        const rows = await transaction<{ id: string; title: string; createdAt: Date }[]>`
          INSERT INTO works (id, project_id, title, media_type, preview_url)
          VALUES (${workId}, ${task.projectId}, ${title.trim()}, ${result.mediaType}, ${`/api/generation/results/${result.id}/read`})
          RETURNING id, title, created_at AS "createdAt"
        `;
        await transaction`INSERT INTO generation_result_works (result_id, work_id) VALUES (${result.id}, ${workId})`;
        works.push({ workId, title: rows[0].title, createdAt: rows[0].createdAt,
          mediaType: result.mediaType, previewUrl: `/api/generation/results/${result.id}/read`, created: true });
      }
      return works;
      });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
      if (status !== 500) return response.status(status).json({ message: error instanceof Error ? error.message : "无法保存作品。" });
      throw error;
    }
    const created = saved.some(work => work.created);
    return response.status(created ? 201 : 200).json({ works: saved.map(({ created: _created, ...work }) => work) });
  });
}
