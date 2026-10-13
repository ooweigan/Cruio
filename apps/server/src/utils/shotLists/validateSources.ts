import type { Database } from "@/db/database";
import type { ShotListDocument } from "@/utils/shotLists/schema";

type ScriptRef = { scriptId: string; version: number };

export async function validateShotListSources(database: Database, userId: string, document: ShotListDocument) {
  const refs = new Map<string, { ref: ScriptRef; blockIds: Set<string> }>();
  const addRef = (ref: ScriptRef, blockId?: string) => {
    const key = `${ref.scriptId}:${ref.version}`;
    const entry = refs.get(key) ?? { ref, blockIds: new Set<string>() };
    if (blockId) entry.blockIds.add(blockId);
    refs.set(key, entry);
  };
  if (document.sourceScope) addRef(document.sourceScope);
  for (const shot of document.shots) {
    for (const span of [...(shot.sourceSpans ?? []), ...(shot.speechRefs ?? [])]) addRef(span, span.blockId);
  }
  if (refs.size > 30) return false;
  for (const { ref, blockIds } of refs.values()) {
    const rows = await database<{ document: { sections?: { blocks?: { blockId?: string }[] }[] } }[]>`
      SELECT script_versions.document FROM scripts
      JOIN script_versions ON script_versions.script_id = scripts.id
      WHERE scripts.id = ${ref.scriptId} AND script_versions.version = ${ref.version}
        AND (scripts.owner_id = ${userId} OR EXISTS (
          SELECT 1 FROM script_publications WHERE script_id = scripts.id
          AND version = script_versions.version AND withdrawn_at IS NULL
        ))
    `;
    if (!rows[0]) return false;
    const availableBlocks = new Set(rows[0].document.sections?.flatMap(section => section.blocks?.map(block => block.blockId) ?? []) ?? []);
    if ([...blockIds].some(blockId => !availableBlocks.has(blockId))) return false;
  }
  return true;
}
