import { Router } from "express";
import type { Database } from "@/db/database";

export function createShotListListRoute(database: Database) {
  return Router().get("/", async (_request, response) => {
    const user = response.locals.user as { id: string };
    const shotLists = await database`
      SELECT shot_lists.id AS "shotListId", title, description,
        latest_version AS "latestVersion", created_at AS "createdAt", updated_at AS "updatedAt",
        (SELECT jsonb_agg(version ORDER BY version DESC) FROM shot_list_versions
          WHERE shot_list_id = shot_lists.id) AS versions
      FROM shot_lists WHERE owner_id = ${user.id}
      ORDER BY updated_at DESC
    `;
    return response.json({ shotLists });
  });
}
