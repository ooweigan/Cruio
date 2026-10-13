import { z } from "zod";

const identifier = z.string().uuid();

const outlineItem = z.object({
  outlineItemId: identifier,
  text: z.string().max(20000),
  order: z.number().int().nonnegative(),
  heading: z.string().max(300).optional(),
});

const scriptBlock = z.object({
  blockId: identifier,
  kind: z.enum(["plainText", "sceneHeading", "action", "dialogue", "narration"]),
  text: z.string().max(100000),
  speakerRef: z.string().max(200).optional(),
});

const scriptSection = z.object({
  sectionId: identifier,
  heading: z.string().max(300).optional(),
  blocks: z.array(scriptBlock).max(2000),
});

const sourceRef = z.object({ scriptId: identifier, version: z.number().int().positive() });

export const scriptDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  language: z.string().trim().max(35).optional(),
  summary: z.string().max(20000).optional(),
  outline: z.array(outlineItem).max(1000).optional(),
  sections: z.array(scriptSection).min(1).max(1000),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("manual") }),
    z.object({ kind: z.literal("rewrite"), sourceScriptRef: sourceRef }),
  ]),
});

export type ScriptDocument = z.infer<typeof scriptDocumentSchema>;
