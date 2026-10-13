import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";

export const privacyCategories = ["access", "copy", "correction", "supplement", "deletion", "restriction", "explanation", "accountClosure"] as const;
export const privacyObjectTypes = ["account", "asset", "task", "work", "ledger", "credential", "supportTicket", "externalMapping"] as const;
export const privacyObjectStatuses = ["pending", "processing", "awaitingUser", "partial", "completed", "restricted", "softDeleted", "retained", "refused"] as const;
export const privacyReasonCodes = ["outsideImplementedScope", "sourceFactProtection", "externalStateUnverified", "needsUserDetail", "retentionReview", "other"] as const;

export type PrivacyCategory = typeof privacyCategories[number];
export type PrivacyObjectType = typeof privacyObjectTypes[number];
export type PrivacyObjectStatus = typeof privacyObjectStatuses[number];
export type PrivacyRequestObject = { objectType: PrivacyObjectType; objectId: string | null };

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const timestampPattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export function isValidPrivacyTimestamp(value: string) {
  if (!timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  date.setUTCHours(Number(hourText), Number(minuteText), Number(secondText), 0);
  return date.getUTCFullYear() === Number(yearText) && date.getUTCMonth() === Number(monthText) - 1
    && date.getUTCDate() === Number(dayText) && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59;
}

export async function verifyPrivacyObjectOwner(database: Database, userId: string, item: PrivacyRequestObject) {
  if (item.objectType === "account" || item.objectType === "externalMapping") {
    if (item.objectId !== null) throw fail(400, "账户与当前未接入的外部映射不接收伪造对象编号。");
    return;
  }
  if (!item.objectId || !uuidPattern.test(item.objectId)) throw fail(400, "隐私申请对象编号无效。");
  const rows = item.objectType === "asset"
    ? await database`SELECT id FROM media_assets WHERE id = ${item.objectId} AND owner_id = ${userId}`
    : item.objectType === "task"
      ? await database`SELECT id FROM generation_tasks WHERE id = ${item.objectId} AND user_id = ${userId}`
      : item.objectType === "work"
        ? await database`SELECT works.id FROM works JOIN projects ON projects.id = works.project_id WHERE works.id = ${item.objectId} AND projects.owner_id = ${userId}`
        : item.objectType === "ledger"
          ? await database`SELECT id FROM credit_ledger WHERE id = ${item.objectId} AND user_id = ${userId}`
          : item.objectType === "credential"
            ? await database`SELECT evidence.entry_id FROM credit_evidence AS evidence JOIN credit_ledger AS ledger ON ledger.id = evidence.entry_id WHERE evidence.entry_id = ${item.objectId} AND ledger.user_id = ${userId}`
            : await database`SELECT id FROM support_tickets WHERE id = ${item.objectId} AND owner_id = ${userId}`;
  if (!rows[0]) throw fail(404, "申请对象不存在。");
}

export async function verifyPrivacySourceOutcome(
  database: Database,
  userId: string,
  item: PrivacyRequestObject,
  action: PrivacyCategory,
  status: PrivacyObjectStatus,
) {
  if (status === "restricted") {
    if (action !== "restriction" || item.objectType !== "asset" || !item.objectId) return false;
    const rows = await database`SELECT id FROM media_assets WHERE id = ${item.objectId} AND owner_id = ${userId} AND status = 'revoked' AND revoked_at IS NOT NULL FOR SHARE`;
    return Boolean(rows[0]);
  }
  if (status === "softDeleted") {
    if (action !== "deletion" || item.objectType !== "work" || !item.objectId) return false;
    const rows = await database`
      SELECT works.id FROM works JOIN projects ON projects.id = works.project_id
      WHERE works.id = ${item.objectId} AND projects.owner_id = ${userId} AND works.deleted_at IS NOT NULL
      FOR SHARE OF works, projects
    `;
    return Boolean(rows[0]);
  }
  return false;
}
