import { Router } from "express";
import type { Database } from "@/db/database";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createShotListGetRoute(database: Database) {
  return Router().get("/:shotListId/versions/:version", async (request, response) => {
    const user = response.locals.user as { id: string };
    const shotListId = request.params.shotListId;
    const version = Number(request.params.version);
    if (!uuidPattern.test(shotListId) || !Number.isSafeInteger(version) || version < 1) {
      return response.status(404).json({ message: "镜头清单版本不存在。" });
    }
    const rows = await database`
      SELECT shot_lists.id AS "shotListId", shot_lists.description,
        shot_list_versions.version, shot_list_versions.document,
        shot_list_versions.created_at AS "createdAt"
      FROM shot_lists JOIN shot_list_versions ON shot_list_versions.shot_list_id = shot_lists.id
      WHERE shot_lists.id = ${shotListId} AND shot_lists.owner_id = ${user.id}
        AND shot_list_versions.version = ${version}
    `;
    if (!rows[0]) return response.status(404).json({ message: "镜头清单版本不存在或无权查看。" });
    return response.json({ shotList: rows[0] });
  });
}
