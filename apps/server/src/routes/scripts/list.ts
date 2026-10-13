import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import type { Database } from "@/db/database";

type User = { id: string };

export function createScriptListRoute(database: Database) {
  return Router().get("/", validateFields({ scope: z.enum(["public", "private"]).optional() }, "query"), async (request, response) => {
    const user = response.locals.user as User;
    const publicOnly = request.query.scope === "public";
    const privateOnly = request.query.scope === "private";
    const scripts = await database`
      SELECT scripts.id AS "scriptId",
        CASE WHEN scripts.owner_id = ${user.id} AND NOT ${publicOnly} THEN scripts.title ELSE
          (SELECT version.document->>'title' FROM script_versions AS version
            JOIN script_publications AS publication
              ON publication.script_id = version.script_id AND publication.version = version.version
            WHERE version.script_id = scripts.id AND publication.withdrawn_at IS NULL
            ORDER BY version.version DESC LIMIT 1)
        END AS title,
        CASE WHEN scripts.owner_id = ${user.id} AND NOT ${publicOnly} THEN scripts.description ELSE '' END AS description,
        CASE WHEN scripts.owner_id = ${user.id} AND NOT ${publicOnly} THEN scripts.latest_version ELSE
          (SELECT max(version) FROM script_publications
            WHERE script_id = scripts.id AND withdrawn_at IS NULL)
        END AS "latestVersion",
        scripts.created_at AS "createdAt", scripts.updated_at AS "updatedAt",
        scripts.owner_id = ${user.id} AND NOT ${publicOnly} AS "editable",
        CASE WHEN scripts.owner_id = ${user.id} AND NOT ${publicOnly} THEN 'private' ELSE 'public' END AS scope,
        CASE WHEN scripts.owner_id = ${user.id} AND NOT ${publicOnly} THEN
          (SELECT jsonb_agg(version ORDER BY version DESC) FROM script_versions WHERE script_id = scripts.id)
        ELSE
          (SELECT jsonb_agg(version ORDER BY version DESC) FROM script_publications
            WHERE script_id = scripts.id AND withdrawn_at IS NULL)
        END AS versions
      FROM scripts
      WHERE scripts.deleted_at IS NULL AND ((NOT ${publicOnly} AND scripts.owner_id = ${user.id})
        OR (NOT ${privateOnly} AND EXISTS (SELECT 1 FROM script_publications
          WHERE script_id = scripts.id AND withdrawn_at IS NULL)))
      ORDER BY scripts.owner_id = ${user.id} DESC, scripts.updated_at DESC
    `;
    return response.json({ scripts });
  });
}
