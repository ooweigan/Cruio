import { Router } from "express";
import type { Response } from "express";
import type { Database } from "@/db/database";
import { createPrivateMediaService } from "@/utils/privateMedia";

type User = { id: string };

export function createListRoute(database: Database, storageDirectory?: string) {
  const media = createPrivateMediaService(database, storageDirectory);
  return Router().get("/", async (_request, response: Response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    const assets = await media.list(user.id);
    return response.json({ media: assets });
  });
}
