<template>
  <dialog ref="dialog" class="libraryEditor" aria-labelledby="scriptEditHeading" @cancel.prevent="closeEditor" @click="onBackdrop">
    <section class="editorLayout">
      <header class="editorHeader"><div><span class="eyebrow">私有剧本库</span><h2 id="scriptEditHeading">{{ scriptId ? '编辑剧本' : importFile ? '导入剧本' : '新建剧本' }}</h2><p>{{ scriptId ? '修改另存新版本，已采用的定稿不变。' : importFile ? importFile.name : '保存后可在项目画布中选择采用。' }}</p></div><button type="button" class="closeButton" aria-label="关闭剧本编辑" :disabled="saving" @click="closeEditor">×</button></header>
      <div class="editorBody">
        <p v-if="loading" class="statusMessage" role="status">正在读取剧本…</p>
        <div v-if="message" class="errorMessage" role="alert">{{ message }}<button v-if="loadFailed" type="button" @click="initialize">重试</button></div>
        <fieldset v-if="!loading && !loadFailed" :disabled="saving">
          <div class="documentDetails"><label class="fieldLabel">剧本标题<input v-model="draft.title" maxlength="160" required /></label><label class="fieldLabel">简介<textarea v-model="description" rows="2" maxlength="2000" /></label><div class="metadataFields"><label class="fieldLabel">语言<input v-model="draft.language" maxlength="35" /></label><label class="fieldLabel">梗概<textarea v-model="draft.summary" rows="2" maxlength="20000" /></label></div><details class="outlineEditor"><summary>提纲</summary><div v-for="(item, index) in draft.outline" :key="item.outlineItemId" class="outlineRow"><input v-model="item.text" :aria-label="`提纲 ${index + 1}`" maxlength="20000" /><button type="button" @click="draft.outline?.splice(index, 1)">删除</button></div><button type="button" class="textButton" @click="addOutline">＋ 添加提纲</button></details></div>
          <div class="documentContent"><div class="contentHeading"><h3>剧本正文</h3><span>{{ characterCount }} 字</span></div><section v-for="(section, sectionIndex) in draft.sections" :key="section.sectionId" class="scriptSection"><div class="sectionHeading"><input v-model="section.heading" :aria-label="`章节 ${sectionIndex + 1} 标题`" placeholder="章节标题" maxlength="300" /><button v-if="draft.sections.length > 1" type="button" @click="draft.sections.splice(sectionIndex, 1)">删除章节</button></div><div v-for="(block, blockIndex) in section.blocks" :key="block.blockId" class="scriptBlock"><div class="blockToolbar"><select v-model="block.kind" :aria-label="`章节 ${sectionIndex + 1} 段落 ${blockIndex + 1} 类型`"><option value="plainText">正文</option><option value="sceneHeading">场景标题</option><option value="action">动作</option><option value="dialogue">台词</option><option value="narration">旁白</option></select><button type="button" @click="section.blocks.splice(blockIndex, 1)">删除段落</button></div><input v-if="block.kind === 'dialogue'" v-model="block.speakerRef" :aria-label="`段落 ${blockIndex + 1} 说话角色`" placeholder="说话角色" maxlength="200" /><textarea v-model="block.text" :aria-label="`章节 ${sectionIndex + 1} 段落 ${blockIndex + 1} 正文`" rows="7" maxlength="100000" /></div><button type="button" class="textButton" @click="addBlock(section)">＋ 添加段落</button></section><button type="button" class="textButton" @click="addSection">＋ 添加章节</button></div>
        </fieldset>
      </div>
      <footer class="editorFooter"><span>{{ importFile ? '导入文件不会修改原文件' : '仅保存到当前账号的私有库' }}</span><div><button type="button" class="secondaryButton" :disabled="saving" @click="closeEditor">取消</button><button type="button" class="primaryButton" :disabled="saving || loading || loadFailed" @click="saveScript">{{ saving ? '正在保存…' : scriptId ? '保存新版本' : '保存到私有库' }}</button></div></footer>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "@/lib/cruioApi";

type ScriptBlock = { blockId: string; kind: "plainText" | "sceneHeading" | "action" | "dialogue" | "narration"; text: string; speakerRef?: string };
type ScriptSection = { sectionId: string; heading?: string; blocks: ScriptBlock[] };
type ScriptDocument = { title: string; language?: string; summary?: string; outline?: { outlineItemId: string; text: string; order: number; heading?: string }[]; sections: ScriptSection[]; source: { kind: "manual" } | { kind: "rewrite"; sourceScriptRef: { scriptId: string; version: number } } };
const props = defineProps<{ scriptId?: string; version?: number; importFile?: File }>();
const emit = defineEmits<{ saved: []; close: [] }>();
const dialog = ref<HTMLDialogElement>();
const draft = ref<ScriptDocument>({ title: "", language: "zh-CN", summary: "", outline: [], sections: [{ sectionId: crypto.randomUUID(), heading: "", blocks: [{ blockId: crypto.randomUUID(), kind: "plainText", text: "" }] }], source: { kind: "manual" } });
const description = ref("");
const loading = ref(false);
const saving = ref(false);
const loadFailed = ref(false);
const message = ref("");
let baseline = "";
let active = true;
const snapshot = () => JSON.stringify({ document: draft.value, description: description.value });
const dirty = computed(() => !loading.value && !loadFailed.value && snapshot() !== baseline);
const characterCount = computed(() => draft.value.sections.reduce((total, section) => total + section.blocks.reduce((count, block) => count + Array.from(block.text.replace(/\s/g, "")).length, 0), 0));

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("剧本 JSON 格式无效。");
  return value as Record<string, unknown>;
}
function readText(value: unknown, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error("剧本 JSON 中的文字字段必须是字符串。");
  return value;
}
async function readImport(file: File): Promise<ScriptDocument> {
  if (file.size > 1024 * 1024) throw new Error("导入文件不能超过 1 MB。");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!["txt", "md", "json"].includes(extension ?? "")) throw new Error("请选择 TXT、Markdown 或剧本 JSON 文件。");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error("文件编码无法读取，请将文件另存为 UTF-8 后导入。"); }
  if (!text.trim() || text.includes("\u0000")) throw new Error("文件没有可导入的剧本文字。");
  const title = file.name.replace(/\.[^.]+$/, "").slice(0, 160);
  if (extension !== "json") return { title, language: "zh-CN", sections: [{ sectionId: crypto.randomUUID(), blocks: (text.match(/[\s\S]{1,50000}/gu) ?? []).map(text => ({ blockId: crypto.randomUUID(), kind: "plainText", text })) }], source: { kind: "manual" } };
  let value: Record<string, unknown>;
  try { const parsed = readObject(JSON.parse(text)); value = parsed.document === undefined ? parsed : readObject(parsed.document); }
  catch { throw new Error("剧本 JSON 无法解析，请检查文件格式。"); }
  if (!Array.isArray(value.sections) || !value.sections.length) throw new Error("剧本 JSON 缺少 sections 正文结构。");
  const sections: ScriptSection[] = value.sections.map(item => {
    const section = readObject(item);
    if (!Array.isArray(section.blocks)) throw new Error("剧本 JSON 章节缺少 blocks 段落。");
    return { sectionId: crypto.randomUUID(), heading: readText(section.heading), blocks: section.blocks.map(item => {
      const block = readObject(item);
      if (!["plainText", "sceneHeading", "action", "dialogue", "narration"].includes(String(block.kind))) throw new Error("剧本 JSON 段落类型无效。");
      return { blockId: crypto.randomUUID(), kind: block.kind as ScriptBlock["kind"], text: readText(block.text), ...(block.speakerRef === undefined ? {} : { speakerRef: readText(block.speakerRef) }) };
    }) };
  });
  if (value.outline !== undefined && !Array.isArray(value.outline)) throw new Error("剧本 JSON 提纲格式无效。");
  const outline = (value.outline as unknown[] | undefined)?.map((item, order) => { const entry = readObject(item); return { outlineItemId: crypto.randomUUID(), text: readText(entry.text), heading: readText(entry.heading), order }; });
  // ACT: 导入作为新的私人剧本，重建内部 ID，不带入其他项目的来源权限引用。
  return { title: readText(value.title, title), language: readText(value.language, "zh-CN"), summary: readText(value.summary), outline, sections, source: { kind: "manual" } };
}
async function initialize() {
  loading.value = true;
  loadFailed.value = false;
  message.value = "";
  try {
    if (props.scriptId && props.version) {
      const result = await api<{ script: { document: ScriptDocument; description: string; editable: boolean } }>(`/api/scripts/${props.scriptId}/versions/${props.version}`);
      if (!active) return;
      if (!result.script.editable) throw new Error("该剧本不可编辑。");
      draft.value = result.script.document;
      description.value = result.script.description;
    } else if (props.importFile) {
      const document = await readImport(props.importFile);
      if (!active) return;
      draft.value = document;
    }
    baseline = snapshot();
  } catch (error) {
    if (active) { loadFailed.value = true; message.value = error instanceof Error ? error.message : "剧本读取失败。"; }
  } finally { if (active) loading.value = false; }
}
async function saveScript() {
  if (saving.value || loading.value || loadFailed.value) return;
  message.value = "";
  if (!draft.value.title.trim()) { message.value = "请填写剧本标题。"; return; }
  if (!draft.value.sections.some(section => section.blocks.some(block => block.text.trim()))) { message.value = "请填写剧本正文。"; return; }
  if (props.scriptId && !dirty.value) { emit("close"); return; }
  saving.value = true;
  try {
    const document = JSON.parse(JSON.stringify(draft.value)) as ScriptDocument;
    document.outline?.forEach((item, order) => { item.order = order; });
    document.source = props.scriptId && props.version ? { kind: "rewrite", sourceScriptRef: { scriptId: props.scriptId, version: props.version } } : { kind: "manual" };
    await api(props.scriptId ? `/api/scripts/${props.scriptId}/versions` : "/api/scripts", { method: "POST", body: JSON.stringify({ document, description: description.value.trim(), ...(props.scriptId ? { baseVersion: props.version } : {}) }) });
    baseline = snapshot();
    emit("saved");
  } catch (error) { message.value = error instanceof Error ? error.message : "剧本保存失败，请重试。"; }
  finally { saving.value = false; }
}
function confirmDiscard() { return !saving.value && (!dirty.value || window.confirm("剧本有未保存的修改，确定放弃吗？")); }
defineExpose({ confirmDiscard });
function closeEditor() { if (confirmDiscard()) emit("close"); }
function onBackdrop(event: MouseEvent) { if (event.target === dialog.value) closeEditor(); }
function addBlock(section: ScriptSection) { section.blocks.push({ blockId: crypto.randomUUID(), kind: "plainText", text: "" }); }
function addSection() { draft.value.sections.push({ sectionId: crypto.randomUUID(), heading: "", blocks: [{ blockId: crypto.randomUUID(), kind: "plainText", text: "" }] }); }
function addOutline() { (draft.value.outline ??= []).push({ outlineItemId: crypto.randomUUID(), text: "", order: draft.value.outline?.length ?? 0 }); }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = ""; } }
onMounted(async () => { window.addEventListener("beforeunload", beforeUnload); await nextTick(); dialog.value?.showModal(); await initialize(); });
onBeforeUnmount(() => { active = false; window.removeEventListener("beforeunload", beforeUnload); dialog.value?.close(); });
</script>

<style scoped lang="scss">
.libraryEditor {
  width: min(980px, calc(100vw - 32px)); max-width: none; max-height: 88dvh; padding: 0; border: 1px solid var(--cr-border-subtle); border-radius: 16px; background: var(--cr-surface); color: var(--cr-text-primary); overflow: hidden; &::backdrop { background: rgba(15,23,42,.25); }
  button { cursor: pointer; &:disabled { opacity: .5; cursor: not-allowed; } }
  :is(input, textarea, select, button, summary):focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
  .editorLayout { display: flex; flex-direction: column; max-height: 88dvh;
    .editorHeader { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 22px 28px; border-bottom: 1px solid var(--cr-border-subtle); flex-shrink: 0; .eyebrow { color: var(--cr-text-muted); font-size: 11px; } h2 { margin: 6px 0; font-size: 22px; font-weight: 600; } p { margin: 0; font-size: 12px; color: var(--cr-text-muted); overflow-wrap: anywhere; } .closeButton { font-size: 24px; border: 0; background: transparent; color: var(--cr-text-muted); } }
    .editorBody { overflow: auto; padding: 26px 28px; min-height: 220px; .statusMessage { color: var(--cr-text-muted); font-size: 13px; } .errorMessage { color: var(--cr-danger); font-size: 13px; padding: 12px 0 20px; button { margin-left: 12px; } } fieldset { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 32px; border: 0; margin: 0; padding: 0; min-width: 0;
      .documentDetails { display: grid; gap: 20px; align-content: start; .metadataFields { display: grid; gap: 20px; } .outlineEditor { font-size: 12px; summary { cursor: pointer; color: var(--cr-text-muted); } .outlineRow { display: flex; gap: 8px; align-items: center; margin: 12px 0; button { border: 0; background: transparent; color: var(--cr-text-muted); font-size: 11px; flex-shrink: 0; } } } }
      .documentContent { min-width: 0; .contentHeading { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; h3 { margin: 0; font-size: 16px; font-weight: 550; } span { color: var(--cr-text-muted); font-size: 11px; } } .scriptSection { padding-top: 16px; margin-bottom: 20px; border-top: 1px solid var(--cr-border-subtle); .sectionHeading { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; input { background: transparent; border: 0; padding: 6px 0; font-weight: 550; } button { border: 0; background: transparent; color: var(--cr-text-muted); flex-shrink: 0; font-size: 11px; } } .scriptBlock { display: grid; gap: 8px; margin-bottom: 16px; .blockToolbar { display: flex; justify-content: space-between; align-items: center; select, button { border: 0; background: transparent; color: var(--cr-text-muted); font-size: 11px; padding: 4px 0; } } textarea { min-height: 170px; font-size: 14px; line-height: 1.9; } } } }
    } }
    .editorFooter { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px 28px; border-top: 1px solid var(--cr-border-subtle); flex-shrink: 0; > span { font-size: 11px; color: var(--cr-text-muted); } > div { display: flex; gap: 10px; } }
  }
  .fieldLabel { display: grid; gap: 8px; font-size: 12px; color: var(--cr-text-secondary); }
  input, textarea, select { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 7px; background: var(--cr-surface); color: inherit; font: inherit; font-size: 12px; line-height: 1.7; }
  textarea { resize: vertical; }
  .textButton { padding: 8px 0; border: 0; background: transparent; color: var(--cr-brand-primary); font-size: 12px; }
  .primaryButton, .secondaryButton { border: 1px solid var(--cr-border-subtle); border-radius: 7px; padding: 10px 14px; background: var(--cr-surface); color: var(--cr-text-secondary); font-size: 12px; }
  .primaryButton { border-color: var(--cr-brand-primary); background: var(--cr-brand-primary); color: #fff; }
}
@media (max-width: 700px) { .libraryEditor { .editorLayout { .editorHeader, .editorFooter { padding: 18px; } .editorBody { padding: 20px; fieldset { grid-template-columns: minmax(0, 1fr); gap: 24px; } } .editorFooter > span { display: none; } .editorFooter > div { margin-left: auto; } } } }
</style>
