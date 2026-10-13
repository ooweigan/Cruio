import { z } from "zod";

const identifier = z.string().uuid();
const version = z.number().int().positive();
const scriptRef = z.object({ scriptId: identifier, version }).strict();
const scriptSpanRef = scriptRef.extend({ blockId: identifier }).strict();
const shotRef = z.object({ shotListId: identifier, version, shotId: identifier }).strict();
const referencePackRef = z.object({ packId: identifier, version }).strict();

const shot = z.object({
  shotId: identifier,
  label: z.string().max(80).optional(),
  groupId: identifier.optional(),
  content: z.object({
    description: z.string().max(20000),
    narrativePurpose: z.string().max(5000).optional(),
  }).strict(),
  sourceSpans: z.array(scriptSpanRef).max(100).optional(),
  subjects: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(["character", "location", "prop", "product"]),
    referencePackRef: referencePackRef.optional(),
  }).strict()).max(100).optional(),
  speechRefs: z.array(scriptSpanRef).max(100).optional(),
  plannedDurationMs: z.number().int().positive().max(86400000).optional(),
  continuityNotes: z.string().max(5000).optional(),
  derivedFrom: z.array(shotRef).max(100).optional(),
}).strict();

export const shotListDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  sourceScope: scriptRef.optional(),
  groups: z.array(z.object({ groupId: identifier, name: z.string().trim().min(1).max(160) }).strict()).max(100).optional(),
  shots: z.array(shot).max(2000),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("manual") }).strict(),
    z.object({ kind: z.literal("revision"), parent: z.object({ shotListId: identifier, version }).strict() }).strict(),
  ]).optional(),
}).strict().superRefine((document, context) => {
  const groupIds = new Set(document.groups?.map(group => group.groupId));
  if (groupIds.size !== (document.groups?.length ?? 0)) context.addIssue({ code: "custom", message: "分组 ID 不可重复", path: ["groups"] });
  const shotIds = new Set(document.shots.map(item => item.shotId));
  if (shotIds.size !== document.shots.length) context.addIssue({ code: "custom", message: "镜头 ID 不可重复", path: ["shots"] });
  document.shots.forEach((item, index) => {
    if (item.groupId && !groupIds.has(item.groupId)) context.addIssue({ code: "custom", message: "镜头分组不存在", path: ["shots", index, "groupId"] });
  });
});

export type ShotListDocument = z.infer<typeof shotListDocumentSchema>;
