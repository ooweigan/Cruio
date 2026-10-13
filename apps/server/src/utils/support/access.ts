import type { Database } from "@/db/database";
import { fail } from "@/utils/operations/access";

export type SupportRole = "support" | "modelOperator" | "creditOperator";
export type SupportTicket = {
  id: string; number: string; ownerId: string; category: string; subject: string; description: string;
  status: string; assignedRole: SupportRole; assignedUserId: string | null; relatedTaskId: string | null;
  relatedLedgerId: string | null; createdAt: string; updatedAt: string;
};

type RoleGrant = { role: SupportRole; scopeKind: string; scopeUserId: string | null };

export async function findSupportTicket(database: Database, ticketId: string) {
  const rows = await database<SupportTicket[]>`
    SELECT id, number, owner_id AS "ownerId", category, subject, description, status,
      assigned_role AS "assignedRole", assigned_user_id AS "assignedUserId",
      related_task_id AS "relatedTaskId", related_ledger_id AS "relatedLedgerId",
      created_at::text AS "createdAt", updated_at::text AS "updatedAt"
    FROM support_tickets WHERE id = ${ticketId}
  `;
  return rows[0] ?? null;
}

function grantCoversOwner(grant: RoleGrant, ownerId: string) {
  return grant.scopeKind === "global" || (grant.scopeKind === "user" && grant.scopeUserId === ownerId);
}

export async function supportOperatorRole(database: Database, operatorId: string, ticket: SupportTicket) {
  const grants = await database<RoleGrant[]>`
    SELECT role, scope_kind AS "scopeKind", scope_user_id AS "scopeUserId"
    FROM staff_role_grants
    WHERE user_id = ${operatorId} AND role IN ('support', 'modelOperator', 'creditOperator')
      AND revoked_at IS NULL AND expires_at > clock_timestamp()
  `;
  if (grants.some(grant => grant.role === "support" && grantCoversOwner(grant, ticket.ownerId))) return "support" as const;
  if (grants.some(grant => grant.role === ticket.assignedRole && grant.role !== "support" && grantCoversOwner(grant, ticket.ownerId))) {
    return ticket.assignedRole;
  }
  throw fail(404, "工单不存在。");
}

export async function requireSupportOperator(database: Database, operatorId: string) {
  const grants = await database<{ id: string }[]>`
    SELECT id FROM staff_role_grants WHERE user_id = ${operatorId} AND role = 'support'
      AND revoked_at IS NULL AND expires_at > clock_timestamp() LIMIT 1
  `;
  if (!grants[0]) throw fail(403, "当前账户没有有效的客服岗位授权。");
}

export async function readSupportRelatedSummary(database: Database, ticket: SupportTicket, role?: SupportRole) {
  const related: { kind: "task" | "ledger"; id: string; status?: string; type?: string; amount?: number; publicReason?: string | null; createdAt: string }[] = [];
  if (ticket.relatedTaskId && role !== "creditOperator") {
    const rows = await database<{ id: string; status: string; createdAt: string; updatedAt: string }[]>`
      SELECT id, status, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM generation_tasks WHERE id = ${ticket.relatedTaskId} AND user_id = ${ticket.ownerId}
    `;
    if (rows[0]) related.push({ kind: "task", ...rows[0] });
  }
  if (ticket.relatedLedgerId && role !== "modelOperator") {
    const rows = await database<{ id: string; type: string; amount: number; createdAt: string; publicReason: string | null }[]>`
      SELECT id, entry_type AS type, amount, created_at::text AS "createdAt", public_reason AS "publicReason"
      FROM credit_ledger WHERE id = ${ticket.relatedLedgerId} AND user_id = ${ticket.ownerId}
    `;
    if (rows[0]) related.push({ kind: "ledger", ...rows[0], amount: Number(rows[0].amount) });
  }
  return related;
}

export function safeTicketSummary(ticket: SupportTicket, related: Awaited<ReturnType<typeof readSupportRelatedSummary>>) {
  return {
    id: ticket.id, number: ticket.number, category: ticket.category,
    status: ticket.status, assignedRole: ticket.assignedRole, createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt, related,
  };
}
