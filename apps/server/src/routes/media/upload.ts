import { Router } from "express";
import type { Request, Response } from "express";
import type { Database } from "@/db/database";
import { createPrivateMediaService, mediaLimit, mediaTypes, validateMediaContent, type MediaSource, type MediaType } from "@/utils/privateMedia";

type User = { id: string };

function queryString(request: Request, name: string) {
  const value = request.query[name];
  return typeof value === "string" ? value : "";
}

export function createUploadRoute(database: Database, storageDirectory?: string) {
  const media = createPrivateMediaService(database, storageDirectory);
  return Router().post("/", async (request: Request, response: Response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    if (request.get("content-type")?.split(";")[0].trim() !== "application/octet-stream") {
      return response.status(415).json({ message: "请使用 application/octet-stream 上传。" });
    }
    const fileName = queryString(request, "fileName").trim();
    const mediaType = queryString(request, "mediaType") as MediaType;
    const source = queryString(request, "source") as MediaSource;
    const usage = queryString(request, "usage").trim();
    const authorizationDeclared = queryString(request, "authorizationDeclared");
    const containsRealPerson = queryString(request, "containsRealPerson");
    const subjectIsAdult = queryString(request, "subjectIsAdult");
    if (!fileName || fileName.length > 255 || /[\\/\0]/.test(fileName) || fileName === "." || fileName === "..") {
      return response.status(400).json({ message: "文件名无效。" });
    }
    if (!Object.hasOwn(mediaTypes, mediaType)) {
      return response.status(415).json({ message: "暂不支持此媒体类型。" });
    }
    if (!(source === "self_created" || source === "licensed" || source === "third_party_authorized") || usage.length < 1 || usage.length > 200) {
      return response.status(400).json({ message: "请填写有效来源和用途。" });
    }
    if (authorizationDeclared !== "true" || !["true", "false"].includes(containsRealPerson) || !["true", "false"].includes(subjectIsAdult)) {
      return response.status(400).json({ message: "请确认素材授权及真人信息声明。" });
    }
    if (containsRealPerson === "true" && subjectIsAdult !== "true") {
      return response.status(400).json({ message: "不接受未成年人真人素材；真人素材必须确认当事人为成年人。" });
    }
    const contentLength = Number(request.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > mediaLimit) {
      return response.status(413).json({ message: "素材不得超过 20 MiB。" });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > mediaLimit) return response.status(413).json({ message: "素材不得超过 20 MiB。" });
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks, size);
    if (!(await validateMediaContent(mediaType, bytes))) {
      return response.status(400).json({ message: "文件内容与声明类型不匹配，或媒体结构无效。" });
    }
    const asset = await media.create({
      userId: user.id,
      fileName,
      mediaType,
      bytes,
      source,
      usage,
      authorizationDeclared: true,
      containsRealPerson: containsRealPerson === "true",
      subjectIsAdult: subjectIsAdult === "true",
    });
    return response.status(201).json({ media: {
      id: asset.id,
      fileName: asset.fileName,
      mediaType: asset.mediaType,
      size: asset.size,
      source: asset.source,
      usage: asset.usage,
      authorizationDeclared: asset.authorizationDeclared,
      containsRealPerson: asset.containsRealPerson,
      subjectIsAdult: asset.subjectIsAdult,
      status: asset.status,
      createdAt: asset.createdAt,
    } });
  });
}
