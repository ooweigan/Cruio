import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { shotListDocumentSchema } from "@/utils/shotLists/schema";
import { validateShotListSources } from "@/utils/shotLists/validateSources";

export function createShotListCreateRoute(database: Database) {
  return Router().post("/", async (request, response) => {
    const user = response.locals.user as { id: string };
    const parsed = shotListDocumentSchema.safeParse(request.body?.document);
    const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
    if (!parsed.success || description.length > 2000) return response.status(400).json({ message: "镜头清单内容或简介无效。" });
    const document = parsed.data;
    if (!(await validateShotListSources(database, user.id, document))) {
      return response.status(400).json({ message: "来源剧本版本或文本块不存在，或无权使用。" });
    }
    const shotListId = randomUUID();
    await database.begin(async transaction => {
      await transaction`
        INSERT INTO shot_lists (id, owner_id, title, description)
        VALUES (${shotListId}, ${user.id}, ${document.title}, ${description})
      `;
      await transaction`
        INSERT INTO shot_list_versions (shot_list_id, version, document)
        VALUES (${shotListId}, 1, ${JSON.stringify(document)}::text::jsonb)
      `;
    });
    return response.status(201).json({ shotListRef: { shotListId, version: 1 }, document });
  });
}
