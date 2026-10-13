import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { recordModelEvent, requireModelOperator } from "@/utils/generation/modelGovernance";
import { fail, verifyPassword, type User } from "@/utils/operations/access";

const schema = z.object({
  marketCode: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/),
  displayName: z.string().trim().min(1).max(120),
  serviceRole: z.string().trim().min(1).max(160),
  expectedMarketVersion: z.number().int().positive().optional(),
  isDefault: z.boolean(), currentPassword: z.string().min(8).max(256),
});

export function createOperationsGenerationMarketsRoute(database: Database) {
  return Router().post("/markets", validateFields(schema.shape), async (request, response) => {
    const operator = response.locals.user as User;
    const { marketCode, displayName, serviceRole, isDefault, expectedMarketVersion, currentPassword } = schema.parse(request.body);
    await verifyPassword(database, operator.id, currentPassword);
    const market = await database.begin(async transaction => {
      await requireModelOperator(database, operator, transaction);
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      const priorRows = await transaction<{ displayName: string; serviceRole: string; marketVersion: number }[]>`
        SELECT display_name AS "displayName", service_role AS "serviceRole", market_version AS "marketVersion"
        FROM generation_market_profiles WHERE market_code = ${marketCode} FOR UPDATE
      `;
      if (isDefault) await transaction`UPDATE generation_market_profiles SET is_default = false WHERE is_default = true AND market_code <> ${marketCode}`;
      const prior = priorRows[0];
      if ((prior && expectedMarketVersion !== Number(prior.marketVersion)) || (!prior && expectedMarketVersion !== undefined)) {
        throw fail(409, "市场配置已变化，请刷新后重试。");
      }
      const marketVersion = prior ? Number(prior.marketVersion) + (prior.serviceRole === serviceRole && prior.displayName === displayName ? 0 : 1) : 1;
      const rows = await transaction`
        INSERT INTO generation_market_profiles
          (market_code, display_name, service_role, market_version, is_default, created_by, updated_by)
        VALUES (${marketCode}, ${displayName}, ${serviceRole}, ${marketVersion}, ${isDefault}, ${operator.id}, ${operator.id})
        ON CONFLICT (market_code) DO UPDATE SET display_name = EXCLUDED.display_name, service_role = EXCLUDED.service_role,
          market_version = EXCLUDED.market_version, is_default = EXCLUDED.is_default, updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING market_code AS "marketCode", display_name AS "displayName", service_role AS "serviceRole",
          market_version AS "marketVersion", is_default AS "isDefault"
      `;
      await recordModelEvent(transaction, operator.id, "marketUpsert", null, marketCode,
        { marketVersion, serviceRoleChanged: !prior || prior.serviceRole !== serviceRole });
      return rows[0];
    });
    return response.status(200).json({ market });
  });
}
