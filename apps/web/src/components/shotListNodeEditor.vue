<template>
  <section class="shotListEditor" aria-label="镜头清单与编辑器">
    <p v-if="message" class="editorMessage" role="status">{{ message }}</p>
    <div class="editorRow">
      <label class="editorField">镜头清单
        <select class="editorInput" :value="selectedShotListId" :disabled="working" @change="selectShotList">
          <option value="">选择私人镜头清单</option>
          <option v-for="item in shotLists" :key="item.shotListId" :value="item.shotListId">{{ item.title }}</option>
        </select>
      </label>
      <label v-if="selectedShotList" class="editorField">固定版本
        <select class="editorInput" :value="shotListRef?.version ?? 0" :disabled="working" @change="selectVersion">
          <option v-for="version in selectedShotList.versions ?? []" :key="version" :value="version">v{{ version }}</option>
        </select>
      </label>
    </div>
    <p v-if="shotListRef" class="editorHint">当前节点引用 v{{ shotListRef.version }}。编辑后保存会生成新版本。</p>
    <button type="button" :disabled="working" @click="createShotList">新建私人镜头清单</button>
    <div class="editorGroup">
      <strong>节点规划要求</strong>
      <label class="editorField">规划重点<textarea class="editorInput" :value="planningBrief?.emphasis ?? ''" rows="2" @input="setBrief('emphasis', $event)" /></label>
      <label class="editorField">节奏要求<textarea class="editorInput" :value="planningBrief?.pacingNotes ?? ''" rows="2" @input="setBrief('pacingNotes', $event)" /></label>
      <label class="editorField">其他约束<textarea class="editorInput" :value="planningBrief?.constraints ?? ''" rows="2" @input="setBrief('constraints', $event)" /></label>
      <div class="editorRow">
        <label class="editorField">镜头粒度<input class="editorInput" :value="splitSettings?.granularity ?? ''" @input="setSplitText('granularity', $event)" /></label>
        <label class="editorField">目标镜头数<input class="editorInput" type="number" min="1" :value="splitSettings?.targetShotCount ?? ''" @input="setSplitNumber('targetShotCount', $event)" /></label>
        <label class="editorField">目标总时长（毫秒）<input class="editorInput" type="number" min="1" :value="splitSettings?.targetDurationMs ?? ''" @input="setSplitNumber('targetDurationMs', $event)" /></label>
      </div>
      <label class="editorField">视觉展开范围
        <select class="editorInput" :value="splitSettings?.visualExpansionPolicy ?? ''" @change="setExpansionPolicy">
          <option value="">未设置</option><option value="literal">忠于原文</option><option value="nonPlotDetails">补充非剧情细节</option>
        </select>
      </label>
    </div>
    <template v-if="draft">
      <div class="editorGroup">
        <strong>清单内容</strong>
        <label class="editorField">标题<input v-model="draft.title" class="editorInput" maxlength="160" :disabled="working" /></label>
        <div v-if="draft.sourceScope" class="editorGroup">
          <strong>清单来源剧本版本</strong>
          <label class="editorField">剧本
            <select class="editorInput" :value="draft.sourceScope.scriptId" :disabled="working" @change="setScopeScript($event)">
              <option value="">选择剧本</option><option v-for="script in scripts" :key="script.scriptId" :value="script.scriptId">{{ script.title }}</option>
              <option v-if="draft.sourceScope.scriptId && !scripts.some(script => script.scriptId === draft?.sourceScope?.scriptId)" :value="draft.sourceScope.scriptId">原剧本不可用 · {{ draft.sourceScope.scriptId }}</option>
            </select>
          </label>
          <label class="editorField">剧本版本
            <select class="editorInput" v-model.number="draft.sourceScope.version" :disabled="working || !draft.sourceScope.scriptId">
              <option v-for="version in versionsFor(draft.sourceScope.scriptId)" :key="version" :value="version">v{{ version }}</option>
              <option v-if="!versionsFor(draft.sourceScope.scriptId).includes(draft.sourceScope.version)" :value="draft.sourceScope.version">原版本 v{{ draft.sourceScope.version }}（不可用）</option>
            </select>
          </label>
          <button type="button" :disabled="working" @click="delete draft.sourceScope">移除来源剧本</button>
        </div>
        <button v-else type="button" :disabled="working" @click="draft.sourceScope = { scriptId: '', version: 1 }">关联来源剧本版本</button>
      </div>
      <div class="editorGroup">
        <strong>叙事分组</strong>
        <div v-for="group in draft.groups ?? []" :key="group.groupId" class="editorRow">
          <input v-model="group.name" class="editorInput" aria-label="分组名称" maxlength="160" :disabled="working" />
          <button type="button" :disabled="working || draft.shots.some(shot => shot.groupId === group.groupId)" @click="removeGroup(group.groupId)">删除</button>
        </div>
        <button type="button" :disabled="working" @click="addGroup">添加分组</button>
      </div>
      <div class="editorGroup">
        <strong>镜头（按下列顺序叙事）</strong>
        <p class="editorHint">{{ draft.shots.length }} 镜 · {{ plannedDurationLabel }}</p>
        <div v-for="(shot, index) in draft.shots" :key="shot.shotId" class="shotCard">
          <div class="editorRow">
            <strong>第 {{ index + 1 }} 镜</strong>
            <button type="button" :disabled="working || index === 0" @click="moveShot(index, -1)">上移</button>
            <button type="button" :disabled="working || index === draft.shots.length - 1" @click="moveShot(index, 1)">下移</button>
            <button type="button" :disabled="working" @click="copyShot(index)">复制</button>
            <button type="button" :disabled="working" @click="draft.shots.splice(index, 1)">删除</button>
          </div>
          <label class="editorField">显示镜号<input v-model="shot.label" class="editorInput" maxlength="80" :disabled="working" /></label>
          <label v-if="draft.groups?.length" class="editorField">叙事分组
            <select v-model="shot.groupId" class="editorInput" :disabled="working">
              <option :value="undefined">不分组</option>
              <option v-for="group in draft.groups" :key="group.groupId" :value="group.groupId">{{ group.name }}</option>
            </select>
          </label>
          <label class="editorField">画面内容<textarea v-model="shot.content.description" class="editorInput" rows="3" :disabled="working" /></label>
          <label class="editorField">叙事任务<textarea v-model="shot.content.narrativePurpose" class="editorInput" rows="2" :disabled="working" /></label>
          <label class="editorField">计划时长（毫秒）<input :value="shot.plannedDurationMs ?? ''" class="editorInput" type="number" min="1" :disabled="working" @input="setPlannedDuration(shot, $event)" /></label>
          <label class="editorField">连续性备注<textarea v-model="shot.continuityNotes" class="editorInput" rows="2" :disabled="working" /></label>
          <div class="editorGroup">
            <strong>原文位置</strong>
            <div v-for="(span, spanIndex) in shot.sourceSpans ?? []" :key="spanIndex" class="editorGroup">
              <select class="editorInput" :value="span.scriptId" aria-label="原文剧本" :disabled="working" @change="setSpanScript(span, $event)">
                <option value="">选择剧本</option><option v-for="script in scripts" :key="script.scriptId" :value="script.scriptId">{{ script.title }}</option>
                <option v-if="span.scriptId && !scripts.some(script => script.scriptId === span.scriptId)" :value="span.scriptId">原剧本不可用 · {{ span.scriptId }}</option>
              </select>
              <div class="editorRow">
                <select class="editorInput" :value="span.version" aria-label="原文剧本版本" :disabled="working || !span.scriptId" @change="setSpanVersion(span, $event)">
                  <option v-for="version in versionsFor(span.scriptId)" :key="version" :value="version">v{{ version }}</option>
                  <option v-if="!versionsFor(span.scriptId).includes(span.version)" :value="span.version">原版本 v{{ span.version }}（不可用）</option>
                </select>
                <select class="editorInput" v-model="span.blockId" aria-label="原文文本块" :disabled="working || !scriptBlocks[`${span.scriptId}:${span.version}`]">
                  <option value="">选择文本块</option><option v-for="block in scriptBlocks[`${span.scriptId}:${span.version}`] ?? []" :key="block.blockId" :value="block.blockId">{{ block.text.slice(0, 50) || block.blockId }}</option>
                  <option v-if="span.blockId && !scriptBlocks[`${span.scriptId}:${span.version}`]?.some(block => block.blockId === span.blockId)" :value="span.blockId">原文本块不可用 · {{ span.blockId }}</option>
                </select>
              </div>
              <button type="button" :disabled="working" @click="shot.sourceSpans?.splice(spanIndex, 1)">删除原文位置</button>
            </div>
            <button type="button" :disabled="working" @click="addSourceSpan(shot)">添加原文位置</button>
          </div>
          <div class="editorGroup">
            <strong>本镜主体</strong>
            <div v-for="(subject, subjectIndex) in shot.subjects ?? []" :key="subjectIndex" class="editorGroup">
              <div class="editorRow">
                <input v-model="subject.name" class="editorInput" aria-label="主体局部称呼" placeholder="主体称呼" :disabled="working" />
                <select v-model="subject.kind" class="editorInput" aria-label="主体类别" :disabled="working"><option value="character">人物</option><option value="location">地点</option><option value="prop">道具</option><option value="product">产品</option></select>
              </div>
              <div class="editorRow">
                <span v-if="subject.referencePackRef" class="editorHint">已关联参考包 {{ subject.referencePackRef.packId }} v{{ subject.referencePackRef.version }}</span>
                <button type="button" :disabled="working" @click="shot.subjects?.splice(subjectIndex, 1)">删除主体</button>
              </div>
            </div>
            <button type="button" :disabled="working" @click="addSubject(shot)">添加主体</button>
          </div>
        </div>
        <button type="button" :disabled="working" @click="addShot">添加镜头</button>
      </div>
      <button type="button" :disabled="working || !hasUnsavedChanges" @click="saveVersion">保存新版本</button>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "@/lib/cruioApi";

type ShotListRef = { shotListId: string; version: number };
type ScriptSpanRef = { scriptId: string; version: number; blockId: string };
type ShotSubjectUse = { name: string; kind: "character" | "location" | "prop" | "product"; referencePackRef?: { packId: string; version: number } };
type Shot = { shotId: string; label?: string; groupId?: string; content: { description: string; narrativePurpose?: string }; sourceSpans?: ScriptSpanRef[]; subjects?: ShotSubjectUse[]; speechRefs?: ScriptSpanRef[]; plannedDurationMs?: number; continuityNotes?: string; derivedFrom?: { shotListId: string; version: number; shotId: string }[] };
type ShotListDocument = { title: string; sourceScope?: { scriptId: string; version: number }; groups?: { groupId: string; name: string }[]; shots: Shot[]; provenance?: { kind: "manual" } | { kind: "revision"; parent: ShotListRef } };
type ShotListItem = { shotListId: string; title: string; versions: number[] | null };
type ScriptItem = { scriptId: string; title: string; versions: number[] | null };
type ScriptBlock = { blockId: string; text: string };
type PlanningBrief = { emphasis?: string; pacingNotes?: string; constraints?: string };
type SplitSettings = { granularity?: string; targetShotCount?: number; targetDurationMs?: number; visualExpansionPolicy?: "literal" | "nonPlotDetails" };

const props = defineProps<{ nodeId: string; shotListRef?: ShotListRef; suggestedTitle: string; planningBrief?: PlanningBrief; splitSettings?: SplitSettings }>();
const emit = defineEmits<{ setShotListRef: [nodeId: string, value: ShotListRef]; updatePlanningBrief: [nodeId: string, value: PlanningBrief]; updateSplitSettings: [nodeId: string, value: SplitSettings] }>();
const shotLists = ref<ShotListItem[]>([]);
const scripts = ref<ScriptItem[]>([]);
const scriptBlocks = ref<Record<string, ScriptBlock[]>>({});
const draft = ref<ShotListDocument | null>(null);
const savedDocument = ref("");
const working = ref(false);
const message = ref("");
let loadRevision = 0;
let locallySavedRef = "";

const selectedShotListId = computed(() => props.shotListRef?.shotListId ?? "");
const selectedShotList = computed(() => shotLists.value.find(item => item.shotListId === selectedShotListId.value));
const hasUnsavedChanges = computed(() => Boolean(draft.value) && JSON.stringify(draft.value) !== savedDocument.value);
const plannedDurationLabel = computed(() => {
  const shots = draft.value?.shots ?? [];
  const known = shots.filter(shot => shot.plannedDurationMs != null);
  const total = known.reduce((sum, shot) => sum + (shot.plannedDurationMs ?? 0), 0);
  return `${total / 1000} 秒${known.length < shots.length ? `，${shots.length - known.length} 镜未填时长（合计不完整）` : ""}`;
});

function confirmDiscard() {
  if (working.value) { message.value = "请等待镜头清单保存完成。"; return false; }
  return !hasUnsavedChanges.value || window.confirm("镜头清单有未保存的修改。确定放弃吗？");
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value && !working.value) return;
  event.preventDefault();
  event.returnValue = "";
}
async function savePending() {
  if (working.value) return false;
  if (hasUnsavedChanges.value) return saveVersion();
  return true;
}
defineExpose({ confirmDiscard, hasUnsavedChanges, working, savePending });

function setBrief(field: keyof PlanningBrief, event: Event) {
  emit("updatePlanningBrief", props.nodeId, { ...props.planningBrief, [field]: (event.target as HTMLInputElement).value });
}
function setSplitText(field: "granularity", event: Event) {
  emit("updateSplitSettings", props.nodeId, { ...props.splitSettings, [field]: (event.target as HTMLInputElement).value });
}
function setSplitNumber(field: "targetShotCount" | "targetDurationMs", event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const value = Number(raw);
  const settings = { ...props.splitSettings };
  if (raw && Number.isSafeInteger(value) && value > 0) settings[field] = value;
  else delete settings[field];
  emit("updateSplitSettings", props.nodeId, settings);
}
function setExpansionPolicy(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const settings = { ...props.splitSettings };
  if (value === "literal" || value === "nonPlotDetails") settings.visualExpansionPolicy = value;
  else delete settings.visualExpansionPolicy;
  emit("updateSplitSettings", props.nodeId, settings);
}

async function loadLibrary() {
  const result = await api<{ shotLists: ShotListItem[] }>("/api/shotLists");
  shotLists.value = result.shotLists;
}
function versionsFor(scriptId: string) { return scripts.value.find(script => script.scriptId === scriptId)?.versions ?? []; }
async function loadScriptBlocks(scriptId: string, version: number) {
  if (!scriptId || !version) return;
  const key = `${scriptId}:${version}`;
  if (scriptBlocks.value[key]) return;
  const result = await api<{ script: { document: { sections: { blocks: ScriptBlock[] }[] } } }>(`/api/scripts/${scriptId}/versions/${version}`);
  scriptBlocks.value[key] = result.script.document.sections.flatMap(section => section.blocks);
}
function setScopeScript(event: Event) {
  if (!draft.value?.sourceScope) return;
  const scriptId = (event.target as HTMLSelectElement).value;
  draft.value.sourceScope.scriptId = scriptId;
  draft.value.sourceScope.version = versionsFor(scriptId)[0] ?? 1;
}
function setSpanScript(span: ScriptSpanRef, event: Event) {
  span.scriptId = (event.target as HTMLSelectElement).value;
  span.version = versionsFor(span.scriptId)[0] ?? 1;
  span.blockId = "";
  void loadScriptBlocks(span.scriptId, span.version).catch(error => { message.value = error instanceof Error ? error.message : "剧本文本块加载失败。"; });
}
function setSpanVersion(span: ScriptSpanRef, event: Event) {
  span.version = Number((event.target as HTMLSelectElement).value);
  span.blockId = "";
  void loadScriptBlocks(span.scriptId, span.version).catch(error => { message.value = error instanceof Error ? error.message : "剧本文本块加载失败。"; });
}
async function loadVersion(shotListRef?: ShotListRef) {
  const revision = ++loadRevision;
  draft.value = null;
  savedDocument.value = "";
  if (!shotListRef) return;
  try {
    const result = await api<{ shotList: { document: ShotListDocument } }>(`/api/shotLists/${shotListRef.shotListId}/versions/${shotListRef.version}`);
    if (revision !== loadRevision) return;
    draft.value = structuredClone(result.shotList.document);
    savedDocument.value = JSON.stringify(draft.value);
    for (const shot of draft.value.shots) {
      for (const span of shot.sourceSpans ?? []) {
        try { await loadScriptBlocks(span.scriptId, span.version); }
        catch { message.value = "部分原文已不可访问，已保留清单中的固定引用。"; }
      }
    }
  } catch (error) {
    if (revision === loadRevision) message.value = error instanceof Error ? error.message : "镜头清单版本加载失败。";
  }
}
function selectShotList(event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!confirmDiscard()) { target.value = selectedShotListId.value; return; }
  const item = shotLists.value.find(candidate => candidate.shotListId === target.value);
  const version = item?.versions?.[0];
  if (item && version) emit("setShotListRef", props.nodeId, { shotListId: item.shotListId, version });
  else target.value = selectedShotListId.value;
}
function selectVersion(event: Event) {
  const target = event.target as HTMLSelectElement;
  if (!confirmDiscard()) { target.value = String(props.shotListRef?.version ?? 0); return; }
  const version = Number(target.value);
  if (props.shotListRef && selectedShotList.value?.versions?.includes(version)) emit("setShotListRef", props.nodeId, { shotListId: props.shotListRef.shotListId, version });
}
async function createShotList() {
  if (!confirmDiscard()) return;
  working.value = true;
  message.value = "";
  try {
    const document: ShotListDocument = { title: props.suggestedTitle.trim() || "未命名分镜", shots: [], provenance: { kind: "manual" } };
    const result = await api<{ shotListRef: ShotListRef; document: ShotListDocument }>("/api/shotLists", { method: "POST", body: JSON.stringify({ document }) });
    draft.value = result.document;
    savedDocument.value = JSON.stringify(draft.value);
    locallySavedRef = `${result.shotListRef.shotListId}:${result.shotListRef.version}`;
    emit("setShotListRef", props.nodeId, result.shotListRef);
    message.value = "私人镜头清单已创建。";
    try { await loadLibrary(); } catch { message.value = "清单已创建，但列表刷新失败。"; }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建镜头清单失败。";
  } finally { working.value = false; }
}
async function saveVersion() {
  if (!draft.value || !props.shotListRef || !hasUnsavedChanges.value) return;
  working.value = true;
  message.value = "";
  try {
    const document = JSON.parse(JSON.stringify(draft.value)) as ShotListDocument;
    document.provenance = { kind: "revision", parent: props.shotListRef };
    const result = await api<{ shotListRef: ShotListRef; document: ShotListDocument }>(`/api/shotLists/${props.shotListRef.shotListId}/versions`, {
      method: "POST", body: JSON.stringify({ baseVersion: props.shotListRef.version, document }),
    });
    draft.value = result.document;
    savedDocument.value = JSON.stringify(draft.value);
    locallySavedRef = `${result.shotListRef.shotListId}:${result.shotListRef.version}`;
    emit("setShotListRef", props.nodeId, result.shotListRef);
    message.value = `已保存为 v${result.shotListRef.version}。`;
    try { await loadLibrary(); } catch { message.value = `已保存为 v${result.shotListRef.version}，但列表刷新失败。`; }
    return true;
  } catch (error) {
    message.value = error instanceof Error && error.message !== "Failed to fetch" ? error.message : "镜头清单保存失败，请重试。";
    return false;
  } finally { working.value = false; }
}
function addGroup() {
  if (!draft.value) return;
  (draft.value.groups ??= []).push({ groupId: crypto.randomUUID(), name: "新分组" });
}
function removeGroup(groupId: string) { draft.value?.groups?.splice(draft.value.groups.findIndex(group => group.groupId === groupId), 1); }
function addShot() { draft.value?.shots.push({ shotId: crypto.randomUUID(), content: { description: "" } }); }
function setPlannedDuration(shot: Shot, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const value = Number(raw);
  if (raw && Number.isSafeInteger(value) && value > 0) shot.plannedDurationMs = value;
  else delete shot.plannedDurationMs;
}
function moveShot(index: number, distance: number) {
  if (!draft.value) return;
  const [shot] = draft.value.shots.splice(index, 1);
  if (shot) draft.value.shots.splice(index + distance, 0, shot);
}
function copyShot(index: number) {
  if (!draft.value) return;
  const source = draft.value.shots[index];
  const sourceInBase = (JSON.parse(savedDocument.value) as ShotListDocument).shots.some(shot => shot.shotId === source?.shotId);
  if (source) draft.value.shots.splice(index + 1, 0, {
    ...structuredClone(source),
    shotId: crypto.randomUUID(),
    label: source.label ? `${source.label} 副本` : undefined,
    derivedFrom: props.shotListRef && sourceInBase
      ? [{ shotListId: props.shotListRef.shotListId, version: props.shotListRef.version, shotId: source.shotId }]
      : source.derivedFrom,
  });
}
function addSourceSpan(shot: Shot) { (shot.sourceSpans ??= []).push({ scriptId: "", version: 1, blockId: "" }); }
function addSubject(shot: Shot) { (shot.subjects ??= []).push({ name: "", kind: "character" }); }

watch(() => [props.shotListRef?.shotListId, props.shotListRef?.version], () => {
  const refKey = `${props.shotListRef?.shotListId}:${props.shotListRef?.version}`;
  if (refKey === locallySavedRef) { locallySavedRef = ""; return; }
  void loadVersion(props.shotListRef);
});
onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnload);
  try {
    const result = await api<{ scripts: ScriptItem[] }>("/api/scripts");
    scripts.value = result.scripts;
    await loadLibrary();
    await loadVersion(props.shotListRef);
  }
  catch (error) { message.value = error instanceof Error ? error.message : "镜头清单加载失败。"; }
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<style scoped lang="scss">
.shotListEditor {
  display: grid;
  gap: 12px;
  margin-top: 16px;

  .editorGroup, .shotCard { display: grid; gap: 10px; border-top: 1px solid var(--cr-border-subtle); padding-top: 12px; }
  .shotCard { padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; }
  .editorField { display: grid; gap: 6px; min-width: 0; font-size: 12px; }
  .editorInput { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); color: inherit; font: inherit; box-sizing: border-box; }
  .editorRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .editorRow .editorInput, .editorRow .editorField { flex: 1; }
  .editorHint, .editorMessage { margin: 0; font-size: 12px; line-height: 1.5; }
  .editorHint { color: var(--cr-text-muted); }
}
</style>
