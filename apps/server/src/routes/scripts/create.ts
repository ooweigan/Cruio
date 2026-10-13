import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { scriptDocumentSchema } from "@/utils/scripts/schema";

type User = { id: string };

export function createScriptCreateRoute(database: Database) {
  return Router().post("/", async (request, response) => {
    const user = response.locals.user as User;
    const parsed = scriptDocumentSchema.safeParse(request.body?.document);
    const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
    if (!parsed.success || description.length > 2000) {
      return response.status(400).json({ message: "剧本内容或简介无效。" });
    }
    const document = parsed.data;
    const sourceScriptRef = document.source.kind === "rewrite" ? document.source.sourceScriptRef : undefined;
    if (sourceScriptRef) {
      const source = await database`
        SELECT 1 FROM scripts
        WHERE id = ${sourceScriptRef.scriptId}
          AND (owner_id = ${user.id} OR EXISTS (
            SELECT 1 FROM script_publications
            WHERE script_id = scripts.id AND version = ${sourceScriptRef.version} AND withdrawn_at IS NULL
          ))
          AND EXISTS (SELECT 1 FROM script_versions
            WHERE script_id = scripts.id AND version = ${sourceScriptRef.version})
      `;
      if (!source[0]) return response.status(404).json({ message: "来源剧本版本不存在或无权使用。" });
    }
    const scriptId = randomUUID();
    await database.begin(async transaction => {
      await transaction`
        INSERT INTO scripts (id, owner_id, title, description)
        VALUES (${scriptId}, ${user.id}, ${document.title}, ${description})
      `;
      await transaction`
        INSERT INTO script_versions (script_id, version, document)
        VALUES (${scriptId}, 1, ${JSON.stringify(document)}::text::jsonb)
      `;
    });
    return response.status(201).json({ scriptRef: { scriptId, version: 1 }, document });
  });
}
