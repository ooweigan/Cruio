import { stat } from "node:fs/promises";
import { Router } from "express";
import type { Response } from "express";
import type { Database } from "@/db/database";
import { createPrivateMediaService } from "@/utils/privateMedia";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createHeadRoute(database: Database, storageDirectory?: string) {
  const media = createPrivateMediaService(database, storageDirectory);
  return Router().head("/", async (request, response: Response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) return response.status(401).end();
    const mediaId = typeof request.query.id === "string" ? request.query.id : "";
    if (!idPattern.test(mediaId)) return response.status(404).end();
    const asset = await media.getActive(user.id, mediaId);
    if (!asset) return response.status(404).end();
    try {
      await stat(asset.filePath);
    } catch {
      return response.status(404).end();
    }
    return response.status(200)
      .set("Content-Type", asset.mediaType)
      .set("Content-Length", String(asset.size))
      .set("Accept-Ranges", "bytes")
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`)
      .end();
  });
}
