import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";

export function createScriptRemoveRoute(database: Database) {
  return Router().delete("/:scriptId", validateFields({ scriptId: z.string().uuid() }, "params"), async (request, response) => {
    const user = response.locals.user as { id: string };
    // ACT: 从库列表移除，但保留版本正文，已有画布和分镜的固定引用继续可读。
    const removed = await database`
      UPDATE scripts SET deleted_at = now(), updated_at = now()
      WHERE id = ${request.params.scriptId} AND owner_id = ${user.id} AND deleted_at IS NULL
      RETURNING id
    `;
    if (!removed[0]) return response.status(404).json({ message: "剧本不存在或无权删除。" });
    return response.status(204).end();
  });
}
