import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { commitCreditOperation } from "@/utils/operations/creditTransactions";
import type { User } from "@/utils/operations/access";
import { validateFields } from "@/lib/middleware";

export function createOperationsCreditsTopupRoute(database: Database, privateDirectory: string) {
  return Router().post("/topups", validateFields({
    previewToken: z.string().min(32), amount: z.number().int().positive(), channel: z.string().min(1).max(120),
    externalReference: z.string().min(1).max(200), idempotencyKey: z.string().min(8).max(180),
    reason: z.string().min(1).max(500), currentPassword: z.string().min(8).max(256),
  }), async (request, response) => {
    const result = await commitCreditOperation({ database, privateDirectory, operator: response.locals.user as User, operation: "topup", body: request.body ?? {} });
    const { balance, reserved } = result.account;
    return response.status(result.idempotent ? 200 : 201).json({ ...result, account: { balance, reserved, available: Math.max(0, balance - reserved), debt: Math.max(0, -balance) } });
  });
}
