import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@/db/database";
import { fail, verifyPassword } from "@/utils/operations/access";
import { privacyCategories, privacyObjectTypes, uuidPattern, verifyPrivacyObjectOwner } from "@/utils/privacy/requests";
import type { PrivacyRequestObject } from "@/utils/privacy/requests";

type User = { id: string };

export function createPrivacyRequestCreateRoute(database: Database) {
  return Router().post("/requests", async (request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) throw fail(401, "请先登录。");
    const body = request.body ?? {};
    const category = body.category;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const idempotencyKey = body.idempotencyKey;
    if (!privacyCategories.includes(category) || subject.length < 2 || subject.length > 120
      || description.length < 10 || description.length > 3000
      || typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey)
      || !Array.isArray(body.objects) || body.objects.length > 20) {
      throw fail(400, "隐私申请信息无效。");
    }
    const objects: PrivacyRequestObject[] = body.objects.map((entry: unknown): PrivacyRequestObject => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw fail(400, "申请对象信息无效。");
      const item = entry as Record<string, unknown>;
      if (typeof item.objectType !== "string" || !privacyObjectTypes.includes(item.objectType as typeof privacyObjectTypes[number])) {
        throw fail(400, "申请对象类型无效。");
      }
      const objectId = item.objectId ?? null;
      if (objectId !== null && (typeof objectId !== "string" || !uuidPattern.test(objectId))) throw fail(400, "申请对象编号无效。");
      return { objectType: item.objectType as typeof privacyObjectTypes[number], objectId: objectId as string | null };
    });
    if ((category === "explanation" && objects.length > 20) || (category !== "explanation" && objects.length === 0)
      || (category === "accountClosure" && (objects.length !== 1 || objects[0].objectType !== "account"))) {
      throw fail(400, "该类申请需要明确选择处理对象；账户关闭申请须指向本人账户。");
    }
    const objectKeys = objects.map(item => `${item.objectType}:${item.objectId ?? ""}`);
    if (new Set(objectKeys).size !== objectKeys.length) throw fail(400, "申请对象不能重复。");
    await verifyPassword(database, user.id, body.currentPassword);
    for (const item of objects) await verifyPrivacyObjectOwner(database, user.id, item);

    const id = randomUUID();
    const number = `PR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;
    const result = await database.begin(async transaction => {
      const inserted = await transaction<{ id: string; number: string; status: string; createdAt: string; updatedAt: string }[]>`
        INSERT INTO privacy_requests (id, number, owner_id, category, status, subject, description, idempotency_key)
        VALUES (${id}, ${number}, ${user.id}, ${category}, 'received', ${subject}, ${description}, ${idempotencyKey})
        ON CONFLICT (owner_id, idempotency_key) DO NOTHING
        RETURNING id, number, status, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      `;
      if (!inserted[0]) {
        const existing = await transaction<{ id: string; number: string; category: string; status: string; subject: string; description: string;
          createdAt: string; updatedAt: string }[]>`
          SELECT id, number, category, status, subject, description, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
          FROM privacy_requests WHERE owner_id = ${user.id} AND idempotency_key = ${idempotencyKey}
        `;
        if (!existing[0] || existing[0].category !== category || existing[0].subject !== subject || existing[0].description !== description) {
          throw fail(409, "幂等标识已用于其他隐私申请。");
        }
        const savedObjects = await transaction<{ objectType: string; objectId: string | null }[]>`
          SELECT object_type AS "objectType", source_id AS "objectId" FROM privacy_request_objects
          WHERE request_id = ${existing[0].id} ORDER BY object_type, source_id NULLS FIRST
        `;
        const requested = [...objects].sort((a, b) => `${a.objectType}:${a.objectId ?? ""}`.localeCompare(`${b.objectType}:${b.objectId ?? ""}`));
        const saved = savedObjects.map(item => `${item.objectType}:${item.objectId ?? ""}`);
        if (JSON.stringify(saved) !== JSON.stringify(requested.map(item => `${item.objectType}:${item.objectId ?? ""}`))) {
          throw fail(409, "幂等标识已用于其他隐私申请。");
        }
        return { request: existing[0], idempotent: true };
      }
      const requestId = inserted[0].id;
      for (const item of objects) {
        await transaction`
          INSERT INTO privacy_request_objects (id, request_id, object_type, source_id, requested_action, status)
          VALUES (${randomUUID()}, ${requestId}, ${item.objectType}, ${item.objectId}, ${category}, 'pending')
        `;
      }
      await transaction`
        INSERT INTO privacy_request_events (id, request_id, actor_id, actor_role, event_type, visibility, idempotency_key, details)
        VALUES (${randomUUID()}, ${requestId}, ${user.id}, 'user', 'requestCreated', 'user', ${`created:${idempotencyKey}`},
          ${JSON.stringify({ message: "隐私申请已收到，等待核验处理范围。" })}::text::jsonb)
      `;
      return { request: inserted[0], idempotent: false };
    });
    return response.status(result.idempotent ? 200 : 201).json(result);
  });
}
