import { mkdirSync, readFileSync, writeAtomicSync } from "@toonflow/file";
import { join } from "node:path";
import { z } from "zod";
import { accountDirectory, failure } from "@/utils/account";
import { maxSystemPromptLength } from "@/agent/runtime/prompt";

const settingsSchema = z.strictObject({
  updateBoxSeenBuilds: z.array(z.string().max(200)).max(1000).optional(),
  ui: z.strictObject({
    theme: z.enum(["dark", "light", "system"]).optional(), language: z.string().max(32).optional(),
    primaryColor: z.string().regex(/^#[\da-f]{6}$/i).optional(), fontScale: z.number().min(85).max(125).optional(),
    mobileScale: z.number().min(50).max(100).optional(), radius: z.number().min(0).max(16).optional(), startupAnimation: z.boolean().optional(),
  }).optional(),
  general: z.strictObject({
    nodeMenu: z.array(z.json()).max(1000).optional(), canvasCompositingEnabled: z.boolean().optional(),
    canvasEdgeAnimationEnabled: z.boolean().optional(), canvasEdgeColorMode: z.enum(["none", "custom", "theme"]).optional(),
    canvasEdgeColor: z.string().regex(/^#[\da-f]{6}$/i).optional(), canvasShortcuts: z.record(z.string().max(100), z.string().max(200)).optional(),
  }).optional(),
  privacy: z.strictObject({ dataCollectionEnabled: z.boolean().optional(), anonymousId: z.string().max(256).optional() }).optional(),
  personalization: z.strictObject({ memoryEnabled: z.boolean().optional() }).optional(),
  agentSystemPrompt: z.string().max(maxSystemPromptLength).optional(),
  stores: z.record(z.string().max(8192).refine(key => key === "toonflow.projectList" || key.startsWith("toonflow:documentLayout:") || key.startsWith("toonflow:documentTree:")), z.json()).optional(),
});

export function validateSettings(value: unknown) {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.code === "unrecognized_keys" || issue.path[0] === "stores" && issue.code === "invalid_key")) {
      throw failure("forbidden", "设置包含不可修改的字段", 403);
    }
    throw parsed.error;
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > 5 * 1024 * 1024) throw Object.assign(new Error("个人设置不能超过 5 MB"), { status: 413 });
  return parsed.data;
}

export function getSettings(): Record<string, unknown> {
  try { return validateSettings(JSON.parse(readFileSync(join(accountDirectory(), "preferences.json"), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}

export function saveSettings(value: unknown) {
  const settings = validateSettings(value);
  const directory = accountDirectory();
  mkdirSync(directory, { recursive: true });
  writeAtomicSync(join(directory, "preferences.json"), JSON.stringify(settings, null, 2), { mode: 0o600 });
  return settings;
}
