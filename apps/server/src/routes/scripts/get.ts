import { Router } from "express";
import type { Database } from "@/db/database";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createScriptGetRoute(database: Database) {
  return Router().get("/:scriptId/versions/:version", async (request, response) => {
    const user = response.locals.user as User;
    const scriptId = request.params.scriptId;
    const version = Number(request.params.version);
    if (!uuidPattern.test(scriptId) || !Number.isSafeInteger(version) || version < 1) {
      return response.status(404).json({ message: "剧本版本不存在。" });
    }
    const rows = await database`
      SELECT scripts.id AS "scriptId", scripts.owner_id AS "ownerId", scripts.description,
        script_versions.version, script_versions.document, script_versions.created_at AS "createdAt",
        scripts.owner_id = ${user.id} AND scripts.deleted_at IS NULL AS "editable"
      FROM scripts JOIN script_versions ON script_versions.script_id = scripts.id
      WHERE scripts.id = ${scriptId} AND script_versions.version = ${version}
        AND (scripts.owner_id = ${user.id} OR EXISTS (
          SELECT 1 FROM script_publications
          WHERE script_id = scripts.id AND version = script_versions.version AND withdrawn_at IS NULL
        ))
    `;
    if (!rows[0]) return response.status(404).json({ message: "剧本版本不存在或无权查看。" });
    return response.json({ script: rows[0] });
  });
}
