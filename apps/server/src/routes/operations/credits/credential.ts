import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { fail, requireRole, verifyPassword, type User } from "@/utils/operations/access";
import { validateFields } from "@/lib/middleware";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationsCreditsCredentialRoute(database: Database, privateDirectory: string) {
  return Router().post("/:entryId/credential", validateFields({
    currentPassword: z.string().min(8).max(256), purpose: z.string().trim().min(1).max(500),
  }), async (request, response) => {
    const operator = response.locals.user as User;
    const { currentPassword, purpose } = request.body ?? {};
    const entryId = typeof request.params.entryId === "string" ? request.params.entryId : "";
    if (!idPattern.test(entryId) || typeof purpose !== "string" || !purpose.trim() || purpose.length > 500) throw fail(400, "请提供有效凭据访问理由。");
    const rows = await database<{ userId: string; fileName: string; contentType: string; storagePath: string }[]>`
      SELECT ledger.user_id AS "userId", evidence.file_name AS "fileName", evidence.content_type AS "contentType", evidence.storage_path AS "storagePath"
      FROM credit_evidence AS evidence JOIN credit_ledger AS ledger ON ledger.id = evidence.entry_id
      WHERE evidence.entry_id = ${entryId}
    `;
    const evidence = rows[0];
    if (!evidence) throw fail(404, "凭据不存在。");
    await verifyPassword(database, operator.id, currentPassword);
    await database.begin(async transaction => {
      await requireRole(database, operator, "creditOperator", evidence.userId, transaction);
      await transaction`
        INSERT INTO credit_evidence_access (id, entry_id, operator_id, purpose)
        VALUES (${randomUUID()}, ${entryId}, ${operator.id}, ${purpose.trim()})
      `;
    });
    const filePath = join(privateDirectory, evidence.storagePath);
    response.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff")
      .set("Content-Type", evidence.contentType).set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(evidence.fileName)}`);
    const stream = createReadStream(filePath);
    stream.on("error", error => response.destroy(error));
    return stream.pipe(response);
  });
}
