import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { scriptDocumentSchema } from "@/utils/scripts/schema";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createScriptNewVersionRoute(database: Database) {
  return Router().post("/:scriptId/versions", async (request, response) => {
    const user = response.locals.user as User;
    const scriptId = request.params.scriptId;
    const baseVersion = request.body?.baseVersion;
    const parsed = scriptDocumentSchema.safeParse(request.body?.document);
    const description = z.string().trim().max(2000).optional().safeParse(request.body?.description);
    if (!uuidPattern.test(scriptId) || !Number.isSafeInteger(baseVersion) || baseVersion < 1 || !parsed.success || !description.success) {
      return response.status(400).json({ message: "剧本版本参数无效。" });
    }
    const document = parsed.data;
    if (document.source.kind === "rewrite"
      && (document.source.sourceScriptRef.scriptId !== scriptId || document.source.sourceScriptRef.version !== baseVersion)) {
      return response.status(400).json({ message: "剧本来源版本与当前编辑版本不一致。" });
    }
    const result = await database.begin(async transaction => {
      const scripts = await transaction<{ latestVersion: number }[]>`
        SELECT latest_version AS "latestVersion" FROM scripts
        WHERE id = ${scriptId} AND owner_id = ${user.id} AND deleted_at IS NULL FOR UPDATE
      `;
      if (!scripts[0]) return { status: 404, message: "剧本不存在或无权编辑。" };
      if (scripts[0].latestVersion !== baseVersion) return { status: 409, message: "剧本已有新版本，请重新打开后编辑。" };
      const version = baseVersion + 1;
      await transaction`
        INSERT INTO script_versions (script_id, version, document)
        VALUES (${scriptId}, ${version}, ${JSON.stringify(document)}::text::jsonb)
      `;
      await transaction`
        UPDATE scripts SET latest_version = ${version}, title = ${document.title}, description = COALESCE(${description.data ?? null}, description), updated_at = now()
        WHERE id = ${scriptId}
      `;
      return { scriptRef: { scriptId, version }, document };
    });
    if ("status" in result) return response.status(result.status ?? 500).json({ message: result.message });
    return response.status(201).json(result);
  });
}
