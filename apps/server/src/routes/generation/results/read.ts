import { createReadStream } from "node:fs";
import { Router } from "express";
import type { Response } from "express";
import type { Database } from "@/db/database";
import { getGenerationResult } from "@/utils/generation/resultFile";

type User = { id: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGenerationResultReadRoute(database: Database, storageDirectory?: string) {
  return Router().get("/:resultId/read", async (request, response: Response) => {
    const user = response.locals.user as User | undefined;
    const resultId = request.params.resultId;
    if (!user?.id) return response.status(401).end();
    if (typeof resultId !== "string" || !uuidPattern.test(resultId)) return response.status(404).end();
    const result = await getGenerationResult(database, storageDirectory, user.id, resultId);
    if (!result) return response.status(404).end();

    const range = request.get("if-range") ? undefined : request.get("range");
    let start = 0;
    let end = result.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        return response.status(416).set("Content-Range", `bytes */${result.size}`).set("Accept-Ranges", "bytes").end();
      }
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          return response.status(416).set("Content-Range", `bytes */${result.size}`).set("Accept-Ranges", "bytes").end();
        }
        start = Math.max(0, result.size - suffix);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= result.size) {
        return response.status(416).set("Content-Range", `bytes */${result.size}`).set("Accept-Ranges", "bytes").end();
      }
      end = Math.min(end, result.size - 1);
    }
    const length = end - start + 1;
    response.status(range ? 206 : 200)
      .set("Content-Type", result.mimeType)
      .set("Content-Length", String(length))
      .set("Accept-Ranges", "bytes")
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Disposition", request.query.download === "true" ? "attachment" : "inline");
    if (range) response.set("Content-Range", `bytes ${start}-${end}/${result.size}`);

    const stream = createReadStream(result.filePath, { start, end });
    response.on("close", () => {
      if (!stream.destroyed) stream.destroy();
    });
    stream.on("error", error => {
      if (!response.headersSent) response.status(404).end();
      else response.destroy(error);
    });
    return stream.pipe(response);
  });
}
