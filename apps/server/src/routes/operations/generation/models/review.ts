import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Database } from "@/db/database";
import { validateFields } from "@/lib/middleware";
import { evidenceMatchesChecks, governanceChecks, recordModelEvent, requireModelOperator, validateGovernanceChecks } from "@/utils/generation/modelGovernance";
import { fail, verifyPassword, type User } from "@/utils/operations/access";

const schema = z.object({
  modelRevisionId: z.string().uuid(), configVersion: z.number().int().positive(), marketCode: z.string().min(2).max(32),
  expectedMarketVersion: z.number().int().positive(),
  status: z.enum(["inReview", "verified", "restricted"]),
  responsibleName: z.string().trim().min(1).max(120), responsibleRole: z.string().trim().min(1).max(160),
  checks: z.record(z.string(), z.unknown()), allowedInputs: z.array(z.enum(["text", "image", "video", "audio", "realPersonImage"])).max(8),
  evidenceRefs: z.array(z.object({ checkKey: z.string().min(1).max(64), url: z.string().url().max(1000), label: z.string().trim().min(1).max(160) })).max(32),
  conclusion: z.string().trim().min(1).max(2000), currentPassword: z.string().min(8).max(256),
});

export function createOperationsGenerationModelReviewRoute(database: Database) {
  return Router().post("/review", validateFields(schema.shape), async (request, response) => {
    const operator = response.locals.user as User;
    const body = schema.parse(request.body);
    await verifyPassword(database, operator.id, body.currentPassword);
    if (!validateGovernanceChecks(body.checks)) throw fail(400, "市场核对清单不完整；每项须明确状态、结论，已核验项须附证据来源。");
    if (body.evidenceRefs.some(item => !governanceChecks.includes(item.checkKey as typeof governanceChecks[number]))) {
      throw fail(400, "证据来源必须关联清单中的核验项目。");
    }
    if (!evidenceMatchesChecks(body.checks, body.evidenceRefs)) throw fail(400, "已核验或不适用项目必须关联对应证据来源。");
    const checked = body.checks as Record<string, { status: string }>;
    const requiredChecks = ["providerAuthorization", "allowedInputTypes", "dataRegion", "retention", "training", "deletion"];
    if (body.status === "verified" && (requiredChecks.some(key => checked[key].status !== "verified")
      || governanceChecks.some(key => checked[key].status === "unknown") || !body.allowedInputs.includes("text"))) {
      throw fail(400, "所有市场适用事项均须核验，或附证据标明不适用；未知项不能标记为已核验。");
    }
    const review = await database.begin(async transaction => {
      await requireModelOperator(database, operator, transaction);
      await transaction`SELECT pg_advisory_xact_lock(1729461102)`;
      const modelRows = await transaction<{ id: string; configVersion: number; operation: string; isCurrent: boolean }[]>`
        SELECT id, config_version AS "configVersion", operation, is_current AS "isCurrent"
        FROM generation_models WHERE id = ${body.modelRevisionId} FOR SHARE
      `;
      const model = modelRows[0];
      if (!model || !model.isCurrent || Number(model.configVersion) !== body.configVersion) throw fail(409, "模型修订已过期，请刷新。");
      const marketRows = await transaction<{ marketVersion: number }[]>`
        SELECT market_version AS "marketVersion" FROM generation_market_profiles WHERE market_code = ${body.marketCode} FOR SHARE
      `;
      if (!marketRows[0]) throw fail(404, "目标市场尚未配置。");
      if (Number(marketRows[0].marketVersion) !== body.expectedMarketVersion) throw fail(409, "市场配置已变化，请刷新后重试。");
      const previous = await transaction<{ reviewVersion: number }[]>`
        SELECT review_version AS "reviewVersion" FROM generation_model_market_reviews
        WHERE model_revision_id = ${model.id} AND market_code = ${body.marketCode} ORDER BY review_version DESC LIMIT 1 FOR UPDATE
      `;
      await transaction`
        UPDATE generation_model_market_reviews SET is_current = false
        WHERE model_revision_id = ${model.id} AND market_code = ${body.marketCode} AND is_current = true
      `;
      const id = randomUUID();
      const reviewVersion = Number(previous[0]?.reviewVersion ?? 0) + 1;
      await transaction`
        INSERT INTO generation_model_market_reviews
          (id, model_revision_id, market_code, market_version, review_version, status, responsible_name, responsible_role,
            checks, allowed_inputs, evidence_refs, conclusion, created_by)
        VALUES (${id}, ${model.id}, ${body.marketCode}, ${marketRows[0].marketVersion}, ${reviewVersion}, ${body.status},
          ${body.responsibleName}, ${body.responsibleRole}, ${JSON.stringify(body.checks)}::text::jsonb,
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(body.allowedInputs)}::text::jsonb)),
          ${JSON.stringify(body.evidenceRefs)}::text::jsonb, ${body.conclusion}, ${operator.id})
      `;
      await recordModelEvent(transaction, operator.id, "reviewRecorded", model.id, body.marketCode,
        { configVersion: model.configVersion, reviewVersion, status: body.status });
      return { id, modelRevisionId: model.id, configVersion: model.configVersion, marketCode: body.marketCode,
        marketVersion: Number(marketRows[0].marketVersion), reviewVersion, status: body.status };
    });
    return response.status(201).json({ review });
  });
}
