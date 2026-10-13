import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "@/db/database";
import { defaultStorageDirectory } from "@/utils/privateMedia";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getGenerationResultFile(storageDirectory: string | undefined, ownerId: string, storageKey: string, expectedSize: number) {
  if (!uuidPattern.test(ownerId) || !uuidPattern.test(storageKey) || !Number.isSafeInteger(expectedSize) || expectedSize <= 0) return null;
  const root = resolve(storageDirectory ?? defaultStorageDirectory, "generationResults");
  const filePath = resolve(root, ownerId, storageKey);
  if (!filePath.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) return null;
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== expectedSize) return null;
    return { filePath, size: info.size };
  } catch {
    return null;
  }
}

export async function getGenerationResult(database: Database, storageDirectory: string | undefined, ownerId: string, resultId: string) {
  const rows = await database<{
    mediaType: string;
    mimeType: string;
    storageKey: string;
    size: number | string;
    taskStatus: string;
  }[]>`
    SELECT results.media_type AS "mediaType", results.mime_type AS "mimeType",
      results.storage_key AS "storageKey", results.size, tasks.status AS "taskStatus"
    FROM generation_results AS results JOIN generation_tasks AS tasks ON tasks.id = results.task_id
    WHERE results.id = ${resultId} AND results.user_id = ${ownerId} AND tasks.user_id = ${ownerId}
  `;
  const result = rows[0];
  if (!result || result.taskStatus !== "delivered") return null;
  const file = await getGenerationResultFile(storageDirectory, ownerId, result.storageKey, Number(result.size));
  return file ? { mediaType: result.mediaType, mimeType: result.mimeType, ...file } : null;
}
