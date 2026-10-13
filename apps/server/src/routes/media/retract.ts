import { Router } from "express";
import type { Response } from "express";
import type { Database } from "@/db/database";
import { createPrivateMediaService } from "@/utils/privateMedia";

type User = { id: string };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createRetractRoute(database: Database, storageDirectory?: string) {
  const media = createPrivateMediaService(database, storageDirectory);
  return Router().delete("/", async (request, response: Response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    const mediaId = typeof request.query.id === "string" ? request.query.id : "";
    if (!idPattern.test(mediaId)) return response.status(404).json({ message: "素材不存在。" });
    const asset = await media.revoke(user.id, mediaId);
    if (!asset) return response.status(404).json({ message: "素材不存在或已撤回。" });
    return response.json({ media: {
      id: asset.id,
      status: asset.status,
      revokedAt: asset.revokedAt,
    } });
  });
}
