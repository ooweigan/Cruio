import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Router } from "express";
import type { Response } from "express";
import type { Database } from "@/db/database";
import { createPrivateMediaService } from "@/utils/privateMedia";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createReadRoute(database: Database, storageDirectory?: string) {
  const media = createPrivateMediaService(database, storageDirectory);
  return Router().get("/", async (request, response: Response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    const mediaId = typeof request.query.id === "string" ? request.query.id : "";
    if (!idPattern.test(mediaId)) return response.status(404).json({ message: "素材不存在。" });
    const asset = await media.getActive(user.id, mediaId);
    if (!asset) return response.status(404).json({ message: "素材不存在。" });
    try {
      const file = await stat(asset.filePath);
      if (!file.isFile() || file.size !== asset.size) return response.status(404).json({ message: "素材文件不可用。" });
    } catch {
      return response.status(404).json({ message: "素材文件不可用。" });
    }
    const range = request.get("range");
    let start = 0;
    let end = asset.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return response.status(416).set("Content-Range", `bytes */${asset.size}`).end();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return response.status(416).set("Content-Range", `bytes */${asset.size}`).end();
        start = Math.max(0, asset.size - suffix);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.size) {
        return response.status(416).set("Content-Range", `bytes */${asset.size}`).end();
      }
      end = Math.min(end, asset.size - 1);
    }
    const length = end - start + 1;
    response.status(range ? 206 : 200)
      .set("Content-Type", asset.mediaType)
      .set("Content-Length", String(length))
      .set("Accept-Ranges", "bytes")
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
    if (range) response.set("Content-Range", `bytes ${start}-${end}/${asset.size}`);
    const stream = createReadStream(asset.filePath, { start, end });
    stream.on("error", error => {
      if (!response.headersSent) response.status(404).end();
      else response.destroy(error);
    });
    stream.pipe(response);
    return undefined;
  });
}
