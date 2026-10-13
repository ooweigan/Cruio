import { Router } from "express";
import type { Database } from "@/db/database";
import { getGenerationResult } from "@/utils/generation/resultFile";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGenerationResultHeadRoute(database: Database, storageDirectory?: string) {
  return Router().head("/:resultId/read", async (request, response) => {
    const user = response.locals.user as User | undefined;
    const resultId = request.params.resultId;
    if (!user?.id) return response.status(401).end();
    if (typeof resultId !== "string" || !uuidPattern.test(resultId)) return response.status(404).end();
    const result = await getGenerationResult(database, storageDirectory, user.id, resultId);
    if (!result) return response.status(404).end();
    return response.status(200)
      .set("Content-Type", result.mimeType)
      .set("Content-Length", String(result.size))
      .set("Accept-Ranges", "bytes")
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Disposition", request.query.download === "true" ? "attachment" : "inline")
      .end();
  });
}
