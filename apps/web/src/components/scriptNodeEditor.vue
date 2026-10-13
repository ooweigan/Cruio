<template>
  <section class="scriptEditor" aria-label="剧本选择与定稿">
    <div v-if="message" class="editorNotice" :class="{ errorNotice: hasError }" :role="hasError ? 'alert' : 'status'">{{ message }}</div>
    <div class="scriptWorkspace">
      <aside class="scriptSidebar">
        <template v-if="view === 'library'">
          <header class="sidebarHeading"><span class="eyebrow">内容来源</span><h3>剧本库</h3><p>选择一个版本，阅读后采用。</p></header>
          <label class="searchField"><span class="srOnly">搜索剧本</span><input v-model="search" type="search" placeholder="搜索剧本名称" /></label>
          <div v-if="libraryLoading" class="libraryLoading" role="status">正在读取剧本库…</div>
          <div v-else-if="libraryError" class="libraryError" role="alert"><p>{{ libraryError }}</p><button type="button" @click="loadLibrary">重新加载</button></div>
          <div v-else class="scriptList" aria-label="可选剧本">
            <button v-for="item in filteredScripts" :key="item.scriptId" type="button" class="scriptItem" :class="{ selectedScript: candidateRef?.scriptId === item.scriptId }" :aria-pressed="candidateRef?.scriptId === item.scriptId" :disabled="busy" @click="selectScript(item)">
              <nodeIcon kind="script" /><span><strong>{{ item.title }}</strong><small>{{ item.editable ? '私人剧本' : '公共剧本' }} · v{{ item.latestVersion }}</small></span><span v-if="item.scriptId === scriptRef?.scriptId" class="adoptedMark">已采用</span>
            </button>
            <p v-if="!filteredScripts.length" class="listHint">{{ search ? '没有匹配的剧本' : '还没有可采用的剧本' }}</p>
          </div>
          <div class="createEntry"><p>没有合适的剧本？</p><button type="button" :disabled="busy" @click="startCreation"><nodeIcon kind="edit" />创作剧本<span aria-hidden="true">↗</span></button></div>
        </template>
        <template v-else>
          <button type="button" class="backButton" :disabled="busy" @click="returnToLibrary">{{ libraryMode ? '← 返回素材库' : '← 返回剧本库' }}</button>
          <header class="sidebarHeading"><span class="eyebrow">{{ creationMode === 'rewrite' ? '基于已有剧本' : '从创意开始' }}</span><h3>{{ creationMode === 'rewrite' ? '二次创作' : '创作剧本' }}</h3><p>{{ creationMode === 'rewrite' ? '写清修改方向，保留原稿版本。' : '明确创作要求，再完成剧本草稿。' }}</p></header>
          <div v-if="sourceRef" class="sourceReference"><nodeIcon kind="script" /><span><strong>{{ sourceTitle }}</strong><small>来源版本 v{{ sourceRef.version }}</small></span></div>
          <fieldset class="briefFields" :disabled="busy">
            <div class="modelField"><label class="scriptField">创作模型 · LLM<select class="scriptInput" :value="model ?? ''" :disabled="!models?.length" @change="setModel"><option value="">{{ models?.length ? '选择语言模型' : '尚未配置语言模型' }}</option><option v-if="model && !models?.some(item => item.value === model)" :value="model" disabled>原模型当前不可用</option><option v-for="item in models" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><p>模型调用将在配置后接入，目前可手动编辑草稿。</p><button class="generateButton" type="button" disabled title="实际 LLM 调用尚未接入"><nodeIcon kind="play" />{{ creationMode === 'rewrite' ? '生成改写草稿' : '生成剧本草稿' }}</button></div>
            <label class="scriptField">{{ creationMode === 'rewrite' ? '修改要求' : '创意' }}<textarea class="scriptInput" :value="writingBrief?.idea ?? ''" rows="4" :placeholder="creationMode === 'rewrite' ? '希望调整哪些情节、人物或表达？' : '描述你想讲述的故事'" @input="setBrief('idea', $event)" /></label>
            <label v-if="creationMode === 'rewrite'" class="scriptField">必须保留<textarea class="scriptInput" :value="writingBrief?.constraints ?? ''" rows="2" placeholder="不可改变的情节、人物或对白" @input="setBrief('constraints', $event)" /></label>
            <div class="briefPair"><label class="scriptField">语气风格<input class="scriptInput" :value="writingBrief?.tone ?? ''" @input="setBrief('tone', $event)" /></label><label class="scriptField">语言<input class="scriptInput" :value="writingBrief?.language ?? ''" @input="setBrief('language', $event)" /></label></div>
            <details class="moreRequirements"><summary>更多创作要求</summary><label class="scriptField">创作用途<input class="scriptInput" :value="writingBrief?.purpose ?? ''" @input="setBrief('purpose', $event)" /></label><label class="scriptField">目标受众<input class="scriptInput" :value="writingBrief?.audience ?? ''" @input="setBrief('audience', $event)" /></label><label class="scriptField">关键要点<textarea class="scriptInput" :value="writingBrief?.keyPoints ?? ''" rows="3" @input="setBrief('keyPoints', $event)" /></label><label v-if="creationMode === 'create'" class="scriptField">写作约束<textarea class="scriptInput" :value="writingBrief?.constraints ?? ''" rows="2" @input="setBrief('constraints', $event)" /></label><div class="briefPair"><label class="scriptField">目标长度<input v-model="targetValue" class="scriptInput" type="number" min="1" step="1" :aria-invalid="!!lengthError" @input="setTargetLength" /></label><label class="scriptField">单位<select v-model="targetUnit" class="scriptInput" @change="setTargetLength"><option value="words">词</option><option value="characters">字</option><option value="minutes">分钟</option></select></label></div><p v-if="lengthError" class="fieldError" role="alert">{{ lengthError }}</p></details>
          </fieldset>
        </template>
      </aside>
      <main class="scriptReading">
        <div v-if="versionLoading" class="readingState" role="status"><nodeIcon kind="script" /><h3>正在打开剧本</h3><p>读取所选版本的完整正文</p></div>
        <div v-else-if="versionError" class="readingState" role="alert"><nodeIcon kind="script" /><h3>暂时无法打开剧本</h3><p>{{ versionError }}</p><button type="button" @click="loadVersion(candidateRef)">重新加载</button></div>
        <template v-else-if="draft">
          <header class="readingHeader"><div><span class="documentState" :class="{ adoptedState: isAdopted }">{{ view === 'library' ? isAdopted ? '当前定稿' : '待采用' : view === 'review' ? '草稿审阅' : '编辑草稿' }}</span><span class="documentMeta">{{ characterCount }} 字<span v-if="candidateRef && view === 'library'"> · v{{ candidateRef.version }}</span></span></div><label v-if="view === 'library' && selectedScript?.versions?.length" class="versionPicker"><span>版本</span><select :value="candidateRef?.version" :disabled="busy" @change="selectVersion"><option v-for="version in selectedScript.versions" :key="version" :value="version">v{{ version }}</option></select></label><button v-if="view === 'review'" type="button" class="textButton" :disabled="busy" @click="view = 'write'">继续编辑</button></header>
          <article v-if="view !== 'write'" class="scriptDocument">
            <h2>{{ draft.title }}</h2><p v-if="draft.summary" class="documentSummary">{{ draft.summary }}</p>
            <ol v-if="draft.outline?.length" class="documentOutline"><li v-for="item in draft.outline" :key="item.outlineItemId">{{ item.heading ? `${item.heading} · ` : '' }}{{ item.text }}</li></ol>
            <section v-for="section in draft.sections" :key="section.sectionId" class="documentSection"><h3 v-if="section.heading">{{ section.heading }}</h3><div v-for="block in section.blocks" :key="block.blockId" class="documentBlock" :class="block.kind"><strong v-if="block.kind === 'dialogue' && block.speakerRef">{{ block.speakerRef }}</strong><p>{{ block.text }}</p></div></section>
            <p v-if="!hasContent" class="listHint">这个版本还没有正文，暂不能采用为定稿。</p>
          </article>
          <div v-else class="draftEditor">
            <label class="scriptField">剧本标题<input v-model="draft.title" class="draftTitle" maxlength="160" :disabled="busy" /></label>
            <label class="scriptField">梗概<textarea v-model="draft.summary" class="scriptInput" rows="2" :disabled="busy" /></label>
            <details class="outlineEditor"><summary>提纲与语言</summary><label class="scriptField">语言<input v-model="draft.language" class="scriptInput" maxlength="35" :disabled="busy" /></label><div v-for="(item, index) in draft.outline" :key="item.outlineItemId" class="outlineRow"><input v-model="item.text" class="scriptInput" :aria-label="`提纲 ${index + 1}`" :disabled="busy" /><button type="button" :disabled="busy" @click="draft.outline?.splice(index, 1)">删除</button></div><button type="button" class="textButton" :disabled="busy" @click="addOutline">添加提纲</button></details>
            <section v-for="(section, sectionIndex) in draft.sections" :key="section.sectionId" class="draftSection"><div class="sectionHeading"><input v-model="section.heading" class="sectionTitle" :aria-label="`章节 ${sectionIndex + 1} 标题`" placeholder="章节标题" maxlength="300" :disabled="busy" /><button v-if="draft.sections.length > 1" type="button" class="textButton" :disabled="busy" @click="draft.sections.splice(sectionIndex, 1)">删除章节</button></div><div v-for="(block, blockIndex) in section.blocks" :key="block.blockId" class="draftBlock"><div class="blockToolbar"><select v-model="block.kind" :aria-label="`章节 ${sectionIndex + 1} 段落 ${blockIndex + 1} 类型`" :disabled="busy"><option value="plainText">正文</option><option value="sceneHeading">场景标题</option><option value="action">动作</option><option value="dialogue">台词</option><option value="narration">旁白</option></select><button type="button" :disabled="busy" @click="section.blocks.splice(blockIndex, 1)">删除段落</button></div><input v-if="block.kind === 'dialogue'" v-model="block.speakerRef" class="scriptInput" placeholder="说话角色" :aria-label="`段落 ${blockIndex + 1} 说话角色`" maxlength="200" :disabled="busy" /><textarea v-model="block.text" class="scriptInput blockText" :aria-label="`章节 ${sectionIndex + 1} 段落 ${blockIndex + 1} 正文`" rows="6" maxlength="100000" :disabled="busy" /></div><button type="button" class="textButton" :disabled="busy" @click="addBlock(section)">＋ 添加段落</button></section><button type="button" class="textButton" :disabled="busy" @click="addSection">＋ 添加章节</button>
          </div>
          <footer class="readingFooter"><p>{{ libraryMode ? '审阅后保存到私有库，画布中可再选择采用。' : view === 'library' ? '采用固定版本，后续更新不会自动替换。' : '草稿经你确认后，才成为节点的定稿输出。' }}</p><div><button v-if="view === 'library'" type="button" class="secondaryAction" :disabled="busy || !hasContent" @click="startRewrite">二次创作</button><button v-if="view === 'write'" type="button" class="primaryAction" :disabled="busy || !hasContent" @click="reviewDraft">审阅草稿 <span aria-hidden="true">→</span></button><button v-else type="button" class="primaryAction" :disabled="busy || !hasContent" @click="adoptScript">{{ busy ? '正在保存…' : libraryMode ? '保存到私有库' : isAdopted && view === 'library' ? '确认定稿' : '采用为定稿' }} <span aria-hidden="true">✓</span></button></div></footer>
        </template>
        <div v-else class="readingState"><nodeIcon kind="script" /><span class="eyebrow">剧本是制作的起点</span><h3>先找到要讲的故事</h3><p>从左侧选择已有剧本，阅读完整正文。<br />没有合适的内容，也可以开始创作。</p><button type="button" class="secondaryAction" :disabled="busy" @click="startCreation">创作剧本 <span aria-hidden="true">↗</span></button></div>
      </main>
    </div>
    <div v-if="scriptRef" class="outputStrip"><nodeIcon kind="script" /><span>节点定稿输出</span><strong>固定版本 v{{ scriptRef.version }}</strong><small>浏览和编辑草稿不会替换当前定稿</small></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "@/lib/cruioApi";
import nodeIcon from "@/components/nodeIcon.vue";

type ScriptRef = { scriptId: string; version: number };
type ScriptBlock = { blockId: string; kind: "plainText" | "sceneHeading" | "action" | "dialogue" | "narration"; text: string; speakerRef?: string };
type ScriptSection = { sectionId: string; heading?: string; blocks: ScriptBlock[] };
type ScriptDocument = { title: string; language?: string; summary?: string; outline?: { outlineItemId: string; text: string; order: number; heading?: string }[]; sections: ScriptSection[]; source: { kind: "manual" } | { kind: "rewrite"; sourceScriptRef: ScriptRef } };
type ScriptItem = { scriptId: string; title: string; latestVersion: number; editable: boolean; versions: number[] | null };
type WritingBrief = { idea?: string; purpose?: string; audience?: string; keyPoints?: string; tone?: string; language?: string; constraints?: string; targetLength?: { unit: "words" | "characters" | "minutes"; value: number } };
type LanguageModel = { value: string; label: string };

const props = defineProps<{ nodeId: string; scriptRef?: ScriptRef; legacyContent?: string; suggestedTitle: string; writingBrief?: WritingBrief; model?: string; models?: LanguageModel[]; saving?: boolean; purpose?: "canvas" | "library" }>();
const emit = defineEmits<{ setScriptRef: [nodeId: string, value: ScriptRef]; updateWritingBrief: [nodeId: string, value: WritingBrief]; updateModel: [nodeId: string, value: string]; adopt: []; saved: []; close: [] }>();
const libraryMode = computed(() => props.purpose === "library");
const initialBrief = JSON.stringify(props.writingBrief ?? {});
const initialModel = props.model ?? "";
const scripts = ref<ScriptItem[]>([]);
const search = ref("");
const candidateRef = ref<ScriptRef | undefined>(props.scriptRef ? { ...props.scriptRef } : undefined);
const draft = ref<ScriptDocument | null>(null);
const view = ref<"library" | "write" | "review">("library");
const creationMode = ref<"create" | "rewrite">("create");
const sourceRef = ref<ScriptRef>();
const sourceTitle = ref("");
const savedDocument = ref("");
const working = ref(false);
const busy = computed(() => working.value || props.saving);
const message = ref("");
const hasError = ref(false);
const libraryLoading = ref(false);
const libraryError = ref("");
const versionLoading = ref(false);
const versionError = ref("");
const targetValue = ref(String(props.writingBrief?.targetLength?.value ?? ""));
const targetUnit = ref<"words" | "characters" | "minutes">(props.writingBrief?.targetLength?.unit ?? "words");
const lengthError = computed(() => targetValue.value && (!Number.isSafeInteger(Number(targetValue.value)) || Number(targetValue.value) <= 0) ? "目标长度须为大于 0 的整数。" : "");
let loadRevision = 0;

const filteredScripts = computed(() => scripts.value.filter(item => item.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const selectedScript = computed(() => scripts.value.find(item => item.scriptId === candidateRef.value?.scriptId));
const hasContent = computed(() => Boolean(draft.value?.sections.some(section => section.blocks.some(block => block.text.trim()))));
const characterCount = computed(() => draft.value?.sections.reduce((total, section) => total + section.blocks.reduce((count, block) => count + Array.from(block.text.replace(/\s/g, "")).length, 0), 0) ?? 0);
const isAdopted = computed(() => view.value === "library" && candidateRef.value?.scriptId === props.scriptRef?.scriptId && candidateRef.value?.version === props.scriptRef?.version);
const hasUnsavedChanges = computed(() => view.value !== "library" && (JSON.stringify(draft.value) !== savedDocument.value || !!lengthError.value || JSON.stringify(props.writingBrief ?? {}) !== initialBrief || (props.model ?? "") !== initialModel));

function confirmDiscard() {
  if (busy.value) return false;
  return !hasUnsavedChanges.value || window.confirm("草稿有未保存的修改，确定放弃吗？");
}
function validate() {
  message.value = "";
  if (!draft.value?.title.trim()) message.value = "请填写剧本标题。";
  else if (!hasContent.value) message.value = "剧本正文为空，暂不能采用为定稿。";
  else if (view.value !== "library" && lengthError.value) message.value = lengthError.value;
  hasError.value = Boolean(message.value);
  return !hasError.value;
}
async function savePending() { return !working.value; }
defineExpose({ confirmDiscard, hasUnsavedChanges, working, validate, savePending });

function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value && !working.value) return;
  event.preventDefault();
  event.returnValue = "";
}
function setBrief(field: "idea" | "purpose" | "audience" | "keyPoints" | "tone" | "language" | "constraints", event: Event) {
  emit("updateWritingBrief", props.nodeId, { ...props.writingBrief, [field]: (event.target as HTMLInputElement).value });
}
function setModel(event: Event) { emit("updateModel", props.nodeId, (event.target as HTMLSelectElement).value); }
function setTargetLength() {
  const brief = { ...props.writingBrief };
  const value = Number(targetValue.value);
  if (!lengthError.value && value > 0) brief.targetLength = { unit: targetUnit.value, value };
  else delete brief.targetLength;
  emit("updateWritingBrief", props.nodeId, brief);
}
async function loadLibrary() {
  libraryLoading.value = true;
  libraryError.value = "";
  try { scripts.value = (await api<{ scripts: ScriptItem[] }>("/api/scripts")).scripts; }
  catch (error) { libraryError.value = error instanceof Error ? error.message : "剧本库加载失败。"; }
  finally { libraryLoading.value = false; }
}
async function loadVersion(reference?: ScriptRef) {
  const revision = ++loadRevision;
  versionError.value = "";
  draft.value = null;
  savedDocument.value = "";
  versionLoading.value = Boolean(reference);
  if (!reference) return;
  try {
    const result = await api<{ script: { document: ScriptDocument } }>(`/api/scripts/${reference.scriptId}/versions/${reference.version}`);
    if (revision !== loadRevision) return;
    draft.value = structuredClone(result.script.document);
    savedDocument.value = JSON.stringify(draft.value);
  } catch (error) {
    if (revision === loadRevision) versionError.value = error instanceof Error ? error.message : "剧本版本加载失败。";
  } finally { if (revision === loadRevision) versionLoading.value = false; }
}
function selectScript(item: ScriptItem) {
  if (!confirmDiscard()) return;
  candidateRef.value = { scriptId: item.scriptId, version: item.versions?.[0] ?? item.latestVersion };
  message.value = "";
  void loadVersion(candidateRef.value);
}
function selectVersion(event: Event) {
  if (!candidateRef.value) return;
  const version = Number((event.target as HTMLSelectElement).value);
  if (!selectedScript.value?.versions?.includes(version)) return;
  candidateRef.value = { ...candidateRef.value, version };
  void loadVersion(candidateRef.value);
}
function startCreation() {
  if (!confirmDiscard()) return;
  loadRevision += 1;
  versionLoading.value = false;
  versionError.value = "";
  sourceRef.value = undefined;
  sourceTitle.value = "";
  candidateRef.value = undefined;
  creationMode.value = "create";
  emit("updateWritingBrief", props.nodeId, {});
  targetValue.value = "";
  targetUnit.value = "words";
  draft.value = { title: props.suggestedTitle.trim() || "未命名剧本", language: "zh-CN", summary: "", outline: [], sections: [{ sectionId: crypto.randomUUID(), heading: "", blocks: [{ blockId: crypto.randomUUID(), kind: "plainText", text: props.legacyContent ?? "" }] }], source: { kind: "manual" } };
  savedDocument.value = JSON.stringify(draft.value);
  view.value = "write";
  message.value = "";
}
function startRewrite() {
  if (!candidateRef.value || !draft.value || !hasContent.value || busy.value) return;
  sourceRef.value = { ...candidateRef.value };
  sourceTitle.value = draft.value.title;
  draft.value = JSON.parse(JSON.stringify(draft.value)) as ScriptDocument;
  draft.value.source = { kind: "rewrite", sourceScriptRef: { ...candidateRef.value } };
  // ACT: 改写另存为私人剧本，公共稿和来源版本都保留；以后可增加同剧本版本分支。
  draft.value.sections.forEach(section => { section.sectionId = crypto.randomUUID(); section.blocks.forEach(block => { block.blockId = crypto.randomUUID(); }); });
  draft.value.outline?.forEach(item => { item.outlineItemId = crypto.randomUUID(); });
  candidateRef.value = undefined;
  creationMode.value = "rewrite";
  emit("updateWritingBrief", props.nodeId, { ...props.writingBrief, idea: "", constraints: "" });
  savedDocument.value = JSON.stringify(draft.value);
  view.value = "write";
  message.value = "";
}
function returnToLibrary() {
  if (!confirmDiscard()) return;
  if (libraryMode.value) { emit("close"); return; }
  view.value = "library";
  sourceRef.value = undefined;
  candidateRef.value = props.scriptRef ? { ...props.scriptRef } : undefined;
  message.value = "";
  void loadVersion(candidateRef.value);
}
function reviewDraft() { if (validate()) view.value = "review"; }
async function adoptScript() {
  if (busy.value || versionLoading.value || versionError.value || !validate()) return;
  working.value = true;
  try {
    if (view.value !== "library") {
      if (!candidateRef.value || JSON.stringify(draft.value) !== savedDocument.value) {
        const document = JSON.parse(JSON.stringify(draft.value)) as ScriptDocument;
        document.outline?.forEach((item, index) => { item.order = index; });
        const result = await api<{ scriptRef: ScriptRef; document: ScriptDocument }>("/api/scripts", { method: "POST", body: JSON.stringify({ document }) });
        candidateRef.value = result.scriptRef;
        draft.value = result.document;
        savedDocument.value = JSON.stringify(draft.value);
        if (!libraryMode.value) void loadLibrary();
      }
    } else {
      // 采用前重新核实版本权限，避免采用已撤回的公共稿。
      await api(`/api/scripts/${candidateRef.value!.scriptId}/versions/${candidateRef.value!.version}`);
    }
    if (libraryMode.value) { emit("saved"); return; }
    emit("setScriptRef", props.nodeId, { ...candidateRef.value! });
    view.value = "library";
    message.value = "定稿已选定，正在保存节点。";
    hasError.value = false;
    working.value = false;
    emit("adopt");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "定稿保存失败，请重试。";
    hasError.value = true;
  } finally { working.value = false; }
}
function addOutline() {
  if (draft.value) (draft.value.outline ??= []).push({ outlineItemId: crypto.randomUUID(), text: "", order: draft.value.outline.length });
}
function addBlock(section: ScriptSection) { section.blocks.push({ blockId: crypto.randomUUID(), kind: "plainText", text: "" }); }
function addSection() { draft.value?.sections.push({ sectionId: crypto.randomUUID(), heading: "", blocks: [{ blockId: crypto.randomUUID(), kind: "plainText", text: "" }] }); }
watch(() => [props.scriptRef?.scriptId, props.scriptRef?.version], () => {
  if (view.value !== "library") return;
  candidateRef.value = props.scriptRef ? { ...props.scriptRef } : undefined;
  void loadVersion(candidateRef.value);
});
onMounted(() => {
  window.addEventListener("beforeunload", beforeUnload);
  if (libraryMode.value) startCreation();
  else { void loadLibrary(); void loadVersion(candidateRef.value); }
});
onBeforeUnmount(() => { loadRevision += 1; window.removeEventListener("beforeunload", beforeUnload); });
</script>

<style scoped lang="scss">
.scriptEditor {
  color: var(--cr-text-primary);
  .srOnly { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  button, input, textarea, select { font: inherit; }
  button { cursor: pointer; transition: background .18s, color .18s, transform .18s; &:active:not(:disabled) { transform: translateY(1px); } &:disabled { cursor: not-allowed; opacity: .5; } }
  :is(button, input, textarea, select, summary):focus-visible { outline: 2px solid var(--cr-brand-primary); outline-offset: 3px; }
  .eyebrow { font-size: 11px; color: var(--cr-text-muted); letter-spacing: .06em; }
  .editorNotice { margin: 0 0 16px; padding: 12px 16px; border-radius: 8px; background: var(--cr-surface-subtle); font-size: 13px; line-height: 1.6; &.errorNotice { color: #a53749; background: #fcf1f2; } }
  .scriptWorkspace { display: grid; grid-template-columns: minmax(230px, .8fr) minmax(0, 1.65fr); min-height: 470px; border: 1px solid var(--cr-border-subtle); border-radius: 16px; overflow: hidden;
    .scriptSidebar { min-width: 0; padding: 24px 20px; background: var(--cr-surface-subtle); display: flex; flex-direction: column; gap: 20px;
      .sidebarHeading { h3 { margin: 8px 0; font-size: 23px; font-weight: 600; letter-spacing: -.04em; } p { margin: 0; color: var(--cr-text-muted); font-size: 12px; line-height: 1.7; } }
      .searchField input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); color: inherit; font-size: 12px; }
      .scriptList { display: grid; align-content: start; gap: 6px; max-height: 320px; overflow: auto; margin: 0 -8px;
        .scriptItem { display: flex; align-items: start; gap: 10px; width: 100%; padding: 14px 10px; text-align: left; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--cr-text-secondary); :deep(.nodeIcon) { flex-shrink: 0; margin-top: 2px; width: 18px; height: 18px; } > span:first-of-type { min-width: 0; flex: 1; } strong { display: block; font-size: 13px; font-weight: 550; line-height: 1.5; overflow-wrap: anywhere; } small { display: block; margin-top: 6px; color: var(--cr-text-muted); font-size: 10px; } &:hover { background: var(--cr-surface-hover); } &.selectedScript { background: var(--cr-surface); color: var(--cr-brand-primary); border-color: var(--cr-border-subtle); box-shadow: 0 3px 12px rgba(55,42,89,.04); } .adoptedMark { flex-shrink: 0; color: var(--cr-text-muted); font-size: 10px; padding-top: 3px; } }
      }
      .createEntry { margin-top: auto; padding-top: 20px; border-top: 1px solid var(--cr-border-subtle); p { margin: 0 0 12px; font-size: 12px; color: var(--cr-text-muted); } button { display: flex; align-items: center; gap: 9px; width: 100%; border: 1px solid var(--cr-border-subtle); border-radius: 9px; padding: 12px; background: var(--cr-surface); color: var(--cr-text-primary); font-size: 13px; > span { margin-left: auto; } &:hover { color: var(--cr-brand-primary); background: var(--cr-surface-hover); } } }
      .backButton { align-self: start; padding: 0; border: 0; background: transparent; color: var(--cr-text-secondary); font-size: 12px; &:hover { color: var(--cr-brand-primary); } }
      .sourceReference { display: flex; gap: 10px; align-items: center; padding: 12px; background: var(--cr-surface); border-radius: 8px; font-size: 12px; strong { font-weight: 500; overflow-wrap: anywhere; } small { display: block; margin-top: 5px; color: var(--cr-text-muted); font-size: 10px; } }
      .briefFields { border: 0; padding: 0; margin: 0; display: grid; gap: 18px; min-width: 0; .briefPair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .moreRequirements { font-size: 12px; summary { cursor: pointer; color: var(--cr-text-secondary); } > label, > div { margin-top: 16px; } } .modelField { border-bottom: 1px solid var(--cr-border-subtle); padding-bottom: 20px; p { font-size: 11px; line-height: 1.7; color: var(--cr-text-muted); margin: 8px 0 14px; } .generateButton { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 11px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; color: var(--cr-text-secondary); background: var(--cr-surface); font-size: 12px; } } }
    }
    .scriptReading { min-width: 0; display: flex; flex-direction: column; background: var(--cr-surface);
      .readingHeader { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 20px 28px; border-bottom: 1px solid var(--cr-border-subtle); > div { display: flex; align-items: center; gap: 12px; } .documentState { padding: 4px 7px; border-radius: 4px; background: var(--cr-surface-subtle); color: var(--cr-text-secondary); font-size: 10px; &.adoptedState { color: var(--cr-brand-primary); background: var(--cr-surface-hover); } } .documentMeta { color: var(--cr-text-muted); font-size: 10px; font-variant-numeric: tabular-nums; } .versionPicker { display: flex; gap: 7px; align-items: center; font-size: 11px; color: var(--cr-text-muted); select { border: 1px solid var(--cr-border-subtle); border-radius: 6px; padding: 5px 7px; color: var(--cr-text-secondary); background: var(--cr-surface); } } }
      .scriptDocument { flex: 1; padding: 32px 36px 44px; font-size: 14px; line-height: 1.95; overflow-wrap: anywhere; h2 { margin: 0 0 24px; font-family: "Songti SC", "Noto Serif SC", serif; font-size: 28px; line-height: 1.45; font-weight: 600; letter-spacing: .02em; } .documentSummary { padding-bottom: 22px; margin-bottom: 28px; border-bottom: 1px solid var(--cr-border-subtle); color: var(--cr-text-muted); font-size: 13px; white-space: pre-wrap; } .documentOutline { padding-left: 20px; color: var(--cr-text-secondary); font-size: 13px; margin-bottom: 28px; } .documentSection { margin-top: 26px; h3 { margin: 0 0 14px; font-size: 16px; font-weight: 600; } .documentBlock { margin: 0 0 16px; p { margin: 0; white-space: pre-wrap; } &.sceneHeading { font-weight: 600; } &.dialogue { padding-left: 20px; border-left: 2px solid var(--cr-border-subtle); strong { display: block; font-size: 12px; color: var(--cr-brand-primary); margin-bottom: 4px; } } &.narration { color: var(--cr-text-secondary); } } } }
      .draftEditor { flex: 1; padding: 24px 28px 36px; display: grid; gap: 22px; .draftTitle { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--cr-border-subtle); padding: 10px 0; background: transparent; color: inherit; font-size: 24px; font-family: "Songti SC", serif; } .outlineEditor { summary { font-size: 12px; color: var(--cr-text-muted); cursor: pointer; } > label, > div { margin-top: 14px; } .outlineRow { display: flex; align-items: center; gap: 8px; button { border: 0; background: transparent; font-size: 11px; color: var(--cr-text-muted); flex-shrink: 0; } } } .draftSection { padding-top: 16px; border-top: 1px solid var(--cr-border-subtle); .sectionHeading { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; .sectionTitle { min-width: 0; flex: 1; background: transparent; border: 0; color: inherit; font-weight: 550; font-size: 14px; padding: 5px 0; } } .draftBlock { margin-bottom: 14px; display: grid; gap: 8px; .blockToolbar { display: flex; justify-content: space-between; select, button { border: 0; background: transparent; color: var(--cr-text-muted); font-size: 11px; padding: 4px 0; } } .blockText { min-height: 140px; line-height: 1.9; } } } }
      .readingFooter { margin-top: auto; padding: 18px 28px; border-top: 1px solid var(--cr-border-subtle); display: flex; flex-direction: column; gap: 12px; p { margin: 0; color: var(--cr-text-muted); font-size: 11px; line-height: 1.7; } > div { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; } }
      .readingState { min-height: 430px; padding: 30px; box-sizing: border-box; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; > :deep(.nodeIcon) { width: 40px; height: 40px; color: var(--cr-brand-primary); margin-bottom: 24px; } .eyebrow { margin-bottom: 12px; } h3 { margin: 0 0 14px; font-family: "Songti SC", serif; font-size: 26px; font-weight: 550; } p { margin: 0 0 26px; color: var(--cr-text-muted); font-size: 13px; line-height: 1.9; } }
    }
  }
  .scriptField { min-width: 0; display: grid; gap: 8px; font-size: 11px; color: var(--cr-text-secondary); }
  .scriptInput { box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--cr-border-subtle); border-radius: 7px; background: var(--cr-surface); color: var(--cr-text-primary); padding: 10px; font-size: 12px; line-height: 1.7; }
  textarea { resize: vertical; }
  .fieldError, .libraryError { color: #a53749; font-size: 12px; line-height: 1.7; }
  .listHint, .libraryLoading { font-size: 12px; color: var(--cr-text-muted); line-height: 1.8; padding: 12px; }
  .primaryAction, .secondaryAction { display: inline-flex; justify-content: center; align-items: center; gap: 16px; padding: 11px 16px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); color: var(--cr-text-secondary); font-size: 12px; &:hover { background: var(--cr-surface-hover); } }
  .primaryAction { color: #fff; background: var(--cr-brand-primary); border-color: var(--cr-brand-primary); &:hover { background: var(--cr-brand-primary); filter: brightness(.95); } }
  .textButton { padding: 6px 0; border: 0; background: transparent; font-size: 12px; color: var(--cr-brand-primary); }
  .outputStrip { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 16px 4px 0; color: var(--cr-text-muted); font-size: 11px; :deep(.nodeIcon) { width: 15px; height: 15px; } strong { color: var(--cr-text-secondary); font-weight: 500; } small { margin-left: auto; font-size: 10px; } }
}
@media (max-width: 700px) {
  .scriptEditor { .scriptWorkspace { grid-template-columns: minmax(0, 1fr); .scriptSidebar { padding: 20px; .scriptList { max-height: 180px; } } .scriptReading { .readingHeader, .readingFooter { padding: 16px 20px; } .scriptDocument { padding: 26px 22px; } .draftEditor { padding: 20px; } .readingState { min-height: 310px; padding: 24px 18px; h3 { font-size: 23px; } } } } .outputStrip small { margin-left: 0; width: 100%; } }
}
</style>
