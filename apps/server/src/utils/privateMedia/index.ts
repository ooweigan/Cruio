import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import type { Database } from "@/db/database";

export const mediaLimit = 20 * 1024 * 1024;
export const mediaTypes = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
export type MediaType = keyof typeof mediaTypes;
export type MediaSource = "self_created" | "licensed" | "third_party_authorized";

const defaultStorageDirectory = resolve(import.meta.dir, "../../../../../data/privateMedia");
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MediaRecord = {
  id: string;
  ownerId: string;
  fileName: string;
  mediaType: MediaType;
  size: number;
  source: MediaSource;
  usage: string;
  authorizationDeclared: boolean;
  containsRealPerson: boolean;
  subjectIsAdult: boolean;
  status: "active" | "revoked";
  createdAt: Date;
  revokedAt: Date | null;
  filePath: string;
};

type MediaRow = Omit<MediaRecord, "filePath"> & { fileKey: string };

export async function validateMediaContent(mediaType: string, bytes: Uint8Array) {
  if (!Object.hasOwn(mediaTypes, mediaType) || bytes.length === 0 || bytes.length > mediaLimit) return false;
  try {
    const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000, animated: true });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) return false;
    const format = mediaTypes[mediaType as MediaType];
    if (metadata.format !== format) return false;
    const decoded = await sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000, animated: true })
      .raw().toBuffer({ resolveWithObject: true });
    return decoded.info.width === metadata.width && decoded.info.height === metadata.height && decoded.data.length > 0;
  } catch {
    return false;
  }
}

export function createPrivateMediaService(database: Database, storageDirectory = defaultStorageDirectory) {
  const root = resolve(storageDirectory);

  async function getRecord(userId: string, mediaId: string, activeOnly = true): Promise<MediaRecord | null> {
    if (!idPattern.test(userId) || !idPattern.test(mediaId)) return null;
    const rows = await database<MediaRow[]>`
      SELECT id, owner_id AS "ownerId", file_name AS "fileName", media_type AS "mediaType",
        size, source, usage, authorization_declared AS "authorizationDeclared",
        contains_real_person AS "containsRealPerson", subject_is_adult AS "subjectIsAdult",
        status, created_at AS "createdAt", revoked_at AS "revokedAt", id AS "fileKey"
      FROM media_assets
      WHERE owner_id = ${userId} AND id = ${mediaId} AND (${!activeOnly} OR status = 'active')
    `;
    const row = rows[0];
    if (!row) return null;
    return { ...row, filePath: resolve(root, row.ownerId, row.fileKey) };
  }

  async function create(input: {
    userId: string;
    fileName: string;
    mediaType: MediaType;
    bytes: Uint8Array;
    source: MediaSource;
    usage: string;
    authorizationDeclared: true;
    containsRealPerson: boolean;
    subjectIsAdult: boolean;
  }) {
    if (!idPattern.test(input.userId)) throw new Error("用户标识无效。");
    const id = randomUUID();
    const filePath = resolve(root, input.userId, id);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, input.bytes, { flag: "wx", mode: 0o600 });
    try {
      const rows = await database<MediaRow[]>`
        INSERT INTO media_assets
          (id, owner_id, file_name, media_type, size, source, usage, authorization_declared, contains_real_person, subject_is_adult)
        VALUES
          (${id}, ${input.userId}, ${input.fileName}, ${input.mediaType}, ${input.bytes.byteLength}, ${input.source}, ${input.usage}, ${input.authorizationDeclared}, ${input.containsRealPerson}, ${input.subjectIsAdult})
        RETURNING id, owner_id AS "ownerId", file_name AS "fileName", media_type AS "mediaType",
          size, source, usage, authorization_declared AS "authorizationDeclared",
          contains_real_person AS "containsRealPerson", subject_is_adult AS "subjectIsAdult",
          status, created_at AS "createdAt", revoked_at AS "revokedAt", id AS "fileKey"
      `;
      return { ...rows[0], filePath } satisfies MediaRecord;
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
  }

  async function list(userId: string) {
    if (!idPattern.test(userId)) return [];
    return database<Omit<MediaRow, "fileKey">[]>`
      SELECT id, owner_id AS "ownerId", file_name AS "fileName", media_type AS "mediaType",
        size, source, usage, authorization_declared AS "authorizationDeclared",
        contains_real_person AS "containsRealPerson", subject_is_adult AS "subjectIsAdult",
        status, created_at AS "createdAt", revoked_at AS "revokedAt"
      FROM media_assets WHERE owner_id = ${userId} AND status = 'active'
      ORDER BY created_at DESC
    `;
  }

  return {
    list,
    create,
    getActive: (userId: string, mediaId: string) => getRecord(userId, mediaId),
    getAny: (userId: string, mediaId: string) => getRecord(userId, mediaId, false),
    async readActive(userId: string, mediaId: string) {
      const metadata = await getRecord(userId, mediaId);
      if (!metadata) return null;
      const bytes = await readFile(metadata.filePath);
      return { metadata, bytes };
    },
    async revoke(userId: string, mediaId: string) {
      if (!idPattern.test(userId) || !idPattern.test(mediaId)) return null;
      const rows = await database<MediaRow[]>`
        UPDATE media_assets SET status = 'revoked', revoked_at = now()
        WHERE owner_id = ${userId} AND id = ${mediaId} AND status = 'active'
        RETURNING id, owner_id AS "ownerId", file_name AS "fileName", media_type AS "mediaType",
          size, source, usage, authorization_declared AS "authorizationDeclared",
          contains_real_person AS "containsRealPerson", subject_is_adult AS "subjectIsAdult",
          status, created_at AS "createdAt", revoked_at AS "revokedAt", id AS "fileKey"
      `;
      return rows[0] ? { ...rows[0], filePath: resolve(root, rows[0].ownerId, rows[0].fileKey) } : null;
    },
  };
}

export { defaultStorageDirectory };
