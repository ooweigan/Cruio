import { Router } from "express";
import type { Database } from "@/db/database";
import { shotListDocumentSchema } from "@/utils/shotLists/schema";
import { validateShotListSources } from "@/utils/shotLists/validateSources";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createShotListNewVersionRoute(database: Database) {
  return Router().post("/:shotListId/versions", async (request, response) => {
    const user = response.locals.user as { id: string };
    const shotListId = request.params.shotListId;
    const baseVersion = request.body?.baseVersion;
    const parsed = shotListDocumentSchema.safeParse(request.body?.document);
    if (!uuidPattern.test(shotListId) || !Number.isSafeInteger(baseVersion) || baseVersion < 1 || !parsed.success) {
      return response.status(400).json({ message: "镜头清单版本参数或内容无效。" });
    }
    const document = parsed.data;
    if (document.provenance?.kind === "revision"
      && (document.provenance.parent.shotListId !== shotListId || document.provenance.parent.version !== baseVersion)) {
      return response.status(400).json({ message: "来源清单版本与当前编辑版本不一致。" });
    }
    if (!(await validateShotListSources(database, user.id, document))) {
      return response.status(400).json({ message: "来源剧本版本或文本块不存在，或无权使用。" });
    }
    const result = await database.begin(async transaction => {
      const rows = await transaction<{ latestVersion: number }[]>`
        SELECT latest_version AS "latestVersion" FROM shot_lists
        WHERE id = ${shotListId} AND owner_id = ${user.id} FOR UPDATE
      `;
      if (!rows[0]) return { status: 404, message: "镜头清单不存在或无权编辑。" };
      if (rows[0].latestVersion !== baseVersion) return { status: 409, message: "镜头清单已有新版本，请重新打开后编辑。" };
      const version = baseVersion + 1;
      await transaction`
        INSERT INTO shot_list_versions (shot_list_id, version, document)
        VALUES (${shotListId}, ${version}, ${JSON.stringify(document)}::text::jsonb)
      `;
      await transaction`
        UPDATE shot_lists SET latest_version = ${version}, title = ${document.title}, updated_at = now()
        WHERE id = ${shotListId}
      `;
      return { shotListRef: { shotListId, version }, document };
    });
    if ("status" in result) return response.status(result.status ?? 500).json({ message: result.message });
    return response.status(201).json(result);
  });
}
