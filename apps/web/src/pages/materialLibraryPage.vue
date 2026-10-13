<template>
  <div class="materialPage">
    <cruioHeader />
    <main class="materialMain">
      <header class="pageHeading"><div><span class="eyebrow">创作资源</span><h1>素材库</h1><p>在项目之间使用剧本，按公共与私有整理。</p></div><div class="pageActions"><input ref="importInput" class="fileInput" type="file" accept=".txt,.md,.json" aria-label="选择剧本文件" @change="importScript" /><button type="button" class="secondaryButton" @click="importInput?.click()">导入剧本</button><button type="button" class="primaryButton" @click="openEditor()">新建剧本</button></div></header>
      <div class="libraryLayout">
        <aside class="libraryNavigation" aria-label="素材类型"><span class="navigationLabel">素材类型</span><router-link to="/materials/scripts"><nodeIcon kind="script" /><span>剧本库</span><span aria-hidden="true">→</span></router-link></aside>
        <section class="libraryContent" aria-labelledby="scriptLibraryHeading">
          <header class="libraryHeading"><div><h2 id="scriptLibraryHeading">剧本库</h2><p>{{ scope === 'public' ? '浏览已发布的公共剧本及版本。' : '查看当前账号的私人剧本及版本。' }}</p></div><label class="searchField"><span class="srOnly">搜索剧本</span><input v-model="query" type="search" placeholder="搜索剧本名称" /></label></header>
          <nav class="scopeNavigation" aria-label="素材可见范围"><router-link :to="{ path: '/materials/scripts', query: { scope: 'private' } }" :class="{ selectedScope: scope === 'private' }" :aria-current="scope === 'private' ? 'page' : undefined">私有<span v-if="!loading && scope === 'private'">{{ scripts.length }}</span></router-link><router-link :to="{ path: '/materials/scripts', query: { scope: 'public' } }" :class="{ selectedScope: scope === 'public' }" :aria-current="scope === 'public' ? 'page' : undefined">公共<span v-if="!loading && scope === 'public'">{{ scripts.length }}</span></router-link></nav>
          <p v-if="actionMessage" class="actionMessage" role="status">{{ actionMessage }}</p>
          <div v-if="loading" class="loadingState" role="status"><nodeIcon kind="script" /><span>正在读取{{ scope === 'public' ? '公共' : '私有' }}剧本…</span></div>
          <div v-else-if="loadError" class="errorState" role="alert"><p>{{ loadError }}</p><button type="button" @click="loadScripts">重新加载</button></div>
          <div v-else-if="filteredScripts.length" class="scriptGrid">
            <article v-for="script in filteredScripts" :key="script.scriptId" class="scriptCard"><button type="button" :aria-label="`查看剧本：${script.title}`" @click="openScript(script)"><div class="cardHeading"><span class="scriptMark"><nodeIcon kind="script" /></span><span class="scopeLabel">{{ script.scope === 'public' ? '公共剧本' : '私有剧本' }}</span></div><h3>{{ script.title }}</h3><p v-if="script.description" class="scriptDescription">{{ script.description }}</p><div class="cardFooter"><span>v{{ script.latestVersion }}<span class="versionCount"> · {{ script.versions?.length ?? 1 }} 个版本</span></span><strong>阅读剧本 <span aria-hidden="true">↗</span></strong></div></button><div v-if="script.scope === 'private'" class="cardActions"><button type="button" :aria-label="`编辑剧本：${script.title}`" @click="openEditor(script)">编辑</button><button type="button" class="deleteButton" :aria-label="`删除剧本：${script.title}`" @click="openRemove(script)">删除</button></div></article>
          </div>
          <div v-else class="emptyState"><nodeIcon kind="script" /><h3>{{ query.trim() ? '没有匹配的剧本' : scope === 'public' ? '暂无公共剧本' : '暂无私有剧本' }}</h3><p>{{ query.trim() ? '试试其他名称。' : scope === 'public' ? '已发布的剧本会显示在这里。' : '新建、导入或在画布中保存的私人剧本会显示在这里。' }}</p></div>
        </section>
      </div>
    </main>
    <scriptLibraryEditor v-if="editorOpen && !creatingScript" ref="libraryEditor" :scriptId="editingScript?.scriptId" :version="editingScript?.latestVersion" :importFile="importFile" @saved="onScriptSaved" @close="closeEditor" />
    <dialog ref="creationDialog" class="creationDialog" aria-labelledby="creationHeading" @cancel.prevent="closeCreation" @click="onCreationBackdrop"><section v-if="editorOpen && creatingScript" class="creationLayout"><header class="creationHeader"><div><span class="eyebrow">私有剧本库</span><h2 id="creationHeading">创作剧本</h2><p>填写创作要求，完成草稿并审阅后保存。</p></div><button type="button" class="closeButton" aria-label="关闭剧本创作" :disabled="creationEditor?.working" @click="closeCreation">×</button></header><div class="creationBody"><scriptNodeEditor ref="creationEditor" nodeId="libraryScript" suggestedTitle="未命名剧本" purpose="library" :writingBrief="creationBrief" :model="creationModel" :models="creationModels" @updateWritingBrief="(_nodeId, brief) => creationBrief = brief" @updateModel="(_nodeId, model) => creationModel = model" @saved="onScriptSaved" @close="closeEditor" /></div></section></dialog>
    <dialog ref="removeDialog" class="removeDialog" aria-labelledby="removeHeading" @cancel.prevent="closeRemove" @click="onRemoveBackdrop"><section v-if="removeTarget"><span class="eyebrow">删除私有剧本</span><h2 id="removeHeading">删除「{{ removeTarget.title }}」？</h2><p>剧本将从素材库移除。历史版本及已有画布的定稿引用会保留。</p><p v-if="removeError" class="removeError" role="alert">{{ removeError }}</p><div><button type="button" class="secondaryButton" :disabled="removing" @click="closeRemove">取消</button><button type="button" class="dangerButton" :disabled="removing" @click="removeScript">{{ removing ? '正在删除…' : '确认删除' }}</button></div></section></dialog>
    <dialog ref="previewDialog" class="scriptPreview" aria-labelledby="previewHeading" @cancel.prevent="closePreview" @click="onBackdrop"><section v-if="selectedScript"><header class="previewHeader"><div><span class="eyebrow">{{ selectedScript.scope === 'public' ? '公共剧本' : '私有剧本' }}</span><h2 id="previewHeading">{{ selectedScript.title }}</h2></div><div class="previewActions"><button v-if="selectedScript.scope === 'private'" type="button" class="textButton" @click="editPreview">编辑最新版本</button><label>版本<select :value="selectedVersion" @change="changeVersion"><option v-for="version in selectedScript.versions ?? [selectedScript.latestVersion]" :key="version" :value="version">v{{ version }}</option></select></label><button type="button" class="closeButton" aria-label="关闭剧本预览" @click="closePreview">×</button></div></header><div class="previewBody"><p v-if="previewLoading" class="previewStatus" role="status">正在读取正文…</p><div v-else-if="previewError" class="errorState" role="alert"><p>{{ previewError }}</p><button type="button" @click="loadVersion">重新加载</button></div><article v-else-if="document" class="scriptDocument"><h3>{{ document.title }}</h3><p v-if="document.summary" class="documentSummary">{{ document.summary }}</p><ol v-if="document.outline?.length"><li v-for="item in document.outline" :key="item.outlineItemId">{{ item.heading ? `${item.heading} · ` : '' }}{{ item.text }}</li></ol><section v-for="section in document.sections" :key="section.sectionId"><h4 v-if="section.heading">{{ section.heading }}</h4><div v-for="block in section.blocks" :key="block.blockId" class="scriptBlock" :class="block.kind"><strong v-if="block.kind === 'dialogue' && block.speakerRef">{{ block.speakerRef }}</strong><p>{{ block.text }}</p></div></section></article></div></section></dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import cruioHeader from "@/components/cruioHeader.vue";
import scriptNodeEditor from "@/components/scriptNodeEditor.vue";
import scriptLibraryEditor from "@/components/scriptLibraryEditor.vue";
import nodeIcon from "@/components/nodeIcon.vue";
import { api } from "@/lib/cruioApi";

type ScriptItem = { scriptId: string; title: string; description: string; scope: "public" | "private"; latestVersion: number; versions: number[] | null };
type ScriptDocument = { title: string; summary?: string; outline?: { outlineItemId: string; heading?: string; text: string }[]; sections: { sectionId: string; heading?: string; blocks: { blockId: string; kind: string; text: string; speakerRef?: string }[] }[] };

const route = useRoute();
const router = useRouter();
const importInput = ref<HTMLInputElement>();
const importFile = ref<File>();
const editingScript = ref<ScriptItem>();
const editorOpen = ref(false);
const creatingScript = ref(false);
const creationDialog = ref<HTMLDialogElement>();
const creationEditor = ref<{ confirmDiscard: () => boolean; working: boolean }>();
const creationBrief = ref<{ idea?: string; purpose?: string; audience?: string; keyPoints?: string; tone?: string; language?: string; constraints?: string; targetLength?: { unit: "words" | "characters" | "minutes"; value: number } }>({});
const creationModel = ref("");
const creationModels = ref<{ value: string; label: string }[]>([]);
const libraryEditor = ref<{ confirmDiscard: () => boolean }>();
const actionMessage = ref("");
const removeDialog = ref<HTMLDialogElement>();
const removeTarget = ref<ScriptItem>();
const removeError = ref("");
const removing = ref(false);
let editorReturnFocus: HTMLElement | null = null;
let removeReturnFocus: HTMLElement | null = null;
const scope = computed(() => route.query.scope === "public" ? "public" : "private");
const scripts = ref<ScriptItem[]>([]);
const query = ref("");
const loading = ref(true);
const loadError = ref("");
const filteredScripts = computed(() => scripts.value.filter(script => script.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const previewDialog = ref<HTMLDialogElement | null>(null);
const selectedScript = ref<ScriptItem | null>(null);
const selectedVersion = ref(1);
const document = ref<ScriptDocument | null>(null);
const previewLoading = ref(false);
const previewError = ref("");
let listRevision = 0;
let previewRevision = 0;
let returnFocus: HTMLElement | null = null;

async function loadScripts() {
  const revision = ++listRevision;
  loading.value = true;
  loadError.value = "";
  scripts.value = [];
  try {
    const result = await api<{ scripts: ScriptItem[] }>(`/api/scripts?scope=${scope.value}`);
    if (revision === listRevision) scripts.value = result.scripts;
  } catch (error) {
    if (revision === listRevision) loadError.value = error instanceof Error ? error.message : "剧本库加载失败。";
  } finally { if (revision === listRevision) loading.value = false; }
}
async function openScript(script: ScriptItem) {
  returnFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
  selectedScript.value = script;
  selectedVersion.value = script.latestVersion;
  void loadVersion();
  await nextTick();
  previewDialog.value?.showModal();
}
async function loadVersion() {
  const script = selectedScript.value;
  if (!script) return;
  const revision = ++previewRevision;
  previewLoading.value = true;
  previewError.value = "";
  document.value = null;
  try {
    const result = await api<{ script: { document: ScriptDocument } }>(`/api/scripts/${script.scriptId}/versions/${selectedVersion.value}`);
    if (revision === previewRevision) document.value = result.script.document;
  } catch (error) {
    if (revision === previewRevision) previewError.value = error instanceof Error ? error.message : "正文加载失败。";
  } finally { if (revision === previewRevision) previewLoading.value = false; }
}
function changeVersion(event: Event) {
  const version = Number((event.target as HTMLSelectElement).value);
  if (!(selectedScript.value?.versions ?? [selectedScript.value?.latestVersion]).includes(version)) return;
  selectedVersion.value = version;
  void loadVersion();
}
function closePreview() {
  previewRevision += 1;
  previewDialog.value?.close();
  selectedScript.value = null;
  returnFocus?.focus();
}
function onBackdrop(event: MouseEvent) { if (event.target === previewDialog.value) closePreview(); }
async function openEditor(script?: ScriptItem, file?: File) {
  editorReturnFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
  editingScript.value = script;
  importFile.value = file;
  creatingScript.value = !script && !file;
  creationBrief.value = {};
  creationModel.value = "";
  creationModels.value = [];
  editorOpen.value = true;
  actionMessage.value = "";
  if (creatingScript.value) {
    await nextTick();
    creationDialog.value?.showModal();
    void loadCreationModels();
  }
}
async function loadCreationModels() {
  try {
    const result = await api<{ models: { operation: string; available: boolean; providerId: string; upstreamModelId: string; providerLabel: string; label?: string }[] }>("/api/generation/models");
    creationModels.value = result.models.filter(model => model.available && model.operation === "text.generate").map(model => ({ value: JSON.stringify([model.providerId, model.upstreamModelId]), label: `${model.providerLabel} · ${model.label || model.upstreamModelId}` }));
  } catch { creationModels.value = []; }
}
function closeCreation() { if (creationEditor.value?.confirmDiscard() ?? true) closeEditor(); }
function onCreationBackdrop(event: MouseEvent) { if (event.target === creationDialog.value) closeCreation(); }
function importScript(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  void openEditor(undefined, file);
  input.value = "";
}
function closeEditor() {
  creationDialog.value?.close();
  editorOpen.value = false;
  creatingScript.value = false;
  editingScript.value = undefined;
  importFile.value = undefined;
  editorReturnFocus?.focus();
}
async function onScriptSaved() {
  closeEditor();
  await nextTick();
  actionMessage.value = "剧本已保存到私有库。";
  query.value = "";
  if (scope.value !== "private") await router.replace({ path: "/materials/scripts", query: { scope: "private" } });
  else await loadScripts();
}
function editPreview() {
  const script = selectedScript.value;
  if (!script || script.scope !== "private") return;
  closePreview();
  openEditor(script);
}
async function openRemove(script: ScriptItem) {
  removeReturnFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
  removeTarget.value = script;
  removeError.value = "";
  await nextTick();
  removeDialog.value?.showModal();
}
function closeRemove() {
  if (removing.value) return;
  removeDialog.value?.close();
  removeTarget.value = undefined;
  removeReturnFocus?.focus();
}
function onRemoveBackdrop(event: MouseEvent) { if (event.target === removeDialog.value) closeRemove(); }
async function removeScript() {
  if (!removeTarget.value || removing.value) return;
  removing.value = true;
  removeError.value = "";
  try {
    await api(`/api/scripts/${removeTarget.value.scriptId}`, { method: "DELETE" });
    removing.value = false;
    closeRemove();
    actionMessage.value = "剧本已从素材库移除。";
    await loadScripts();
  } catch (error) { removeError.value = error instanceof Error ? error.message : "剧本删除失败，请重试。"; }
  finally { removing.value = false; }
}
onBeforeRouteLeave(() => !removing.value && (creationEditor.value?.confirmDiscard() ?? libraryEditor.value?.confirmDiscard() ?? true));
onBeforeRouteUpdate(() => !removing.value && (creationEditor.value?.confirmDiscard() ?? libraryEditor.value?.confirmDiscard() ?? true));
watch(scope, () => { closePreview(); query.value = ""; void loadScripts(); });
onMounted(loadScripts);
onBeforeUnmount(() => { listRevision += 1; previewRevision += 1; });
</script>

<style scoped lang="scss">
.materialPage {
  min-height: 100dvh; background: var(--cr-page-background); color: var(--cr-text-primary);
  .eyebrow { font-size: 11px; color: var(--cr-text-muted); letter-spacing: .05em; }
  .srOnly { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  button { cursor: pointer; transition: background .18s, border-color .18s; }
  :is(button, a, input, select):focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 3px; }
  .materialMain { width: min(1180px, calc(100% - 48px)); margin: 0 auto; padding: 36px 0 56px;
    .pageHeading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 30px; .pageActions { display: flex; gap: 10px; flex-shrink: 0; .fileInput { display: none; } } h1 { margin: 6px 0 8px; font-size: 30px; letter-spacing: -.04em; font-weight: 650; } p { margin: 0; color: var(--cr-text-muted); font-size: 13px; } }
    .libraryLayout { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 36px;
      .libraryNavigation { border-right: 1px solid var(--cr-border-subtle); padding: 8px 20px 0 0; .navigationLabel { display: block; padding: 0 12px 16px; color: var(--cr-text-muted); font-size: 11px; } a { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 8px; background: var(--cr-surface-hover); color: var(--cr-brand-primary); text-decoration: none; font-size: 13px; font-weight: 550; > span:last-child { margin-left: auto; } :deep(.nodeIcon) { width: 18px; height: 18px; } } }
      .libraryContent { min-width: 0;
        .libraryHeading { display: flex; justify-content: space-between; align-items: center; gap: 20px; h2 { margin: 0 0 7px; font-size: 21px; font-weight: 600; } p { margin: 0; color: var(--cr-text-muted); font-size: 12px; } .searchField input { width: 220px; padding: 10px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 7px; background: var(--cr-surface); color: inherit; font-size: 12px; } }
        .scopeNavigation { display: flex; gap: 26px; margin: 24px 0 20px; border-bottom: 1px solid var(--cr-border-subtle); a { display: flex; align-items: center; gap: 8px; padding: 12px 2px; margin-bottom: -1px; border-bottom: 2px solid transparent; color: var(--cr-text-muted); text-decoration: none; font-size: 13px; span { padding: 1px 6px; border-radius: 4px; background: var(--cr-surface-hover); font-size: 10px; font-variant-numeric: tabular-nums; } &.selectedScope { color: var(--cr-text-primary); border-color: var(--cr-brand-primary); font-weight: 600; } } }
        .scriptGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(245px, 1fr)); gap: 18px;
          .scriptCard { min-width: 0; .cardActions { display: flex; justify-content: flex-end; gap: 14px; padding: 10px 4px 0; button { padding: 3px 0; background: transparent; border: 0; color: var(--cr-text-secondary); font-size: 12px; &.deleteButton { color: var(--cr-danger); } } } > button { width: 100%; min-height: 195px; padding: 22px; display: flex; flex-direction: column; text-align: left; border: 1px solid var(--cr-border-subtle); border-radius: 10px; background: var(--cr-surface); color: inherit; &:hover { border-color: var(--cr-border-focus); background: color-mix(in srgb, var(--cr-surface) 96%, var(--cr-brand-primary)); } .cardHeading { display: flex; justify-content: space-between; align-items: center; gap: 12px; .scriptMark { display: grid; place-items: center; width: 36px; height: 40px; border-radius: 5px; background: var(--cr-surface-hover); color: var(--cr-brand-primary); :deep(.nodeIcon) { width: 22px; height: 22px; } } .scopeLabel { font-size: 10px; color: var(--cr-text-muted); } } h3 { margin: 18px 0 8px; font-family: "Songti SC", "Noto Serif SC", serif; font-weight: 600; font-size: 22px; line-height: 1.5; overflow-wrap: anywhere; } .scriptDescription { margin: 0 0 16px; color: var(--cr-text-muted); font-size: 12px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } .cardFooter { margin-top: auto; padding-top: 16px; display: flex; justify-content: space-between; gap: 8px; align-items: center; border-top: 1px solid var(--cr-border-subtle); color: var(--cr-text-muted); font-size: 11px; .versionCount { font-size: 10px; } strong { color: var(--cr-brand-primary); font-size: 11px; font-weight: 550; white-space: nowrap; } } } }
        }
        .emptyState, .loadingState { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; text-align: center; :deep(.nodeIcon) { width: 34px; height: 34px; color: var(--cr-text-muted); margin-bottom: 18px; } h3 { margin: 0 0 8px; font-size: 18px; font-weight: 550; } p, > span { margin: 0; color: var(--cr-text-muted); font-size: 12px; } }
      }
    }
  }
  .primaryButton, .secondaryButton, .dangerButton { padding: 10px 14px; border: 1px solid var(--cr-border-subtle); border-radius: 7px; background: var(--cr-surface); color: var(--cr-text-primary); font-size: 12px; &:disabled { opacity: .5; cursor: not-allowed; } }
  .primaryButton { background: var(--cr-brand-primary); border-color: var(--cr-brand-primary); color: #fff; }
  .dangerButton { background: var(--cr-danger); border-color: var(--cr-danger); color: #fff; }
  .textButton { padding: 5px 0; border: 0; background: transparent; color: var(--cr-brand-primary); font-size: 11px; }
  .actionMessage { font-size: 12px; color: var(--cr-text-secondary); margin: 12px 0 20px; }
  .creationDialog { width: min(1080px, calc(100vw - 32px)); max-width: none; max-height: 85dvh; border: 1px solid var(--cr-border-subtle); border-radius: 20px; padding: 0; overflow: hidden; background: var(--cr-surface); color: var(--cr-text-primary); &::backdrop { background: rgba(15,23,42,.25); } .creationLayout { display: flex; flex-direction: column; max-height: 85dvh; } .creationHeader { padding: 22px 28px; border-bottom: 1px solid var(--cr-border-subtle); display: flex; justify-content: space-between; align-items: center; gap: 16px; h2 { font-size: 21px; margin: 6px 0; font-weight: 600; } p { color: var(--cr-text-muted); font-size: 12px; margin: 0; } .closeButton { border: 0; background: transparent; color: var(--cr-text-secondary); font-size: 24px; } } .creationBody { overflow: auto; padding: 24px; min-height: 0; } }
  .removeDialog { width: min(420px, calc(100vw - 40px)); padding: 26px; border: 1px solid var(--cr-border-subtle); border-radius: 12px; background: var(--cr-surface); color: var(--cr-text-primary); &::backdrop { background: rgba(15,23,42,.25); } h2 { margin: 10px 0 14px; font-size: 21px; line-height: 1.5; overflow-wrap: anywhere; } p { color: var(--cr-text-muted); font-size: 13px; line-height: 1.8; } .removeError { color: var(--cr-danger); } section > div { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; } }
  .errorState { padding: 28px 0; color: var(--cr-danger); font-size: 13px; button { padding: 8px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; background: var(--cr-surface); color: var(--cr-text-primary); } }
  .scriptPreview { width: min(760px, calc(100vw - 32px)); max-width: none; max-height: 85dvh; padding: 0; border: 1px solid var(--cr-border-subtle); border-radius: 16px; background: var(--cr-surface); color: var(--cr-text-primary); overflow: hidden; &::backdrop { background: rgba(15,23,42,.25); } > section { display: flex; flex-direction: column; max-height: 85dvh; }
    .previewHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 28px; border-bottom: 1px solid var(--cr-border-subtle); flex-shrink: 0; h2 { margin: 5px 0 0; font-size: 17px; font-weight: 600; overflow-wrap: anywhere; } .previewActions { display: flex; align-items: center; gap: 20px; flex-shrink: 0; label { display: flex; gap: 8px; align-items: center; color: var(--cr-text-muted); font-size: 11px; } select { border: 1px solid var(--cr-border-subtle); padding: 5px 8px; border-radius: 6px; background: var(--cr-surface); color: inherit; } .closeButton { padding: 4px 8px; border: 0; background: transparent; color: var(--cr-text-secondary); font-size: 24px; } } }
    .previewBody { overflow: auto; padding: 28px 36px 40px; min-height: 200px; .previewStatus { color: var(--cr-text-muted); font-size: 13px; } .scriptDocument { font-size: 14px; line-height: 1.9; overflow-wrap: anywhere; h3 { margin: 0 0 24px; font-family: "Songti SC", serif; font-size: 28px; line-height: 1.5; font-weight: 600; } .documentSummary { color: var(--cr-text-muted); padding-bottom: 22px; border-bottom: 1px solid var(--cr-border-subtle); white-space: pre-wrap; } ol { padding-left: 20px; color: var(--cr-text-secondary); font-size: 13px; } > section { margin-top: 28px; h4 { font-size: 16px; margin: 0 0 16px; } .scriptBlock { margin-bottom: 16px; p { margin: 0; white-space: pre-wrap; } &.sceneHeading { font-weight: 600; } &.dialogue { padding-left: 18px; border-left: 2px solid var(--cr-border-subtle); strong { display: block; color: var(--cr-brand-primary); font-size: 12px; margin-bottom: 4px; } } } } } }
  }
}
@media (max-width: 700px) {
  .materialPage { .materialMain { width: calc(100% - 28px); padding-top: 24px; .pageHeading { margin-bottom: 24px; align-items: flex-start; flex-direction: column; gap: 16px; } .libraryLayout { grid-template-columns: minmax(0, 1fr); gap: 20px; .libraryNavigation { border-right: 0; border-bottom: 1px solid var(--cr-border-subtle); padding: 0 0 16px; .navigationLabel { display: none; } a { width: fit-content; min-width: 150px; } } .libraryContent { .libraryHeading { align-items: stretch; flex-direction: column; gap: 16px; .searchField input { width: 100%; box-sizing: border-box; } } .scriptGrid { grid-template-columns: minmax(0, 1fr); } } } } .creationDialog { .creationHeader { padding: 18px; } .creationBody { padding: 12px; } } .scriptPreview { .previewHeader { padding: 18px; .previewActions { flex-wrap: wrap; justify-content: flex-end; max-width: 150px; gap: 8px; label { gap: 4px; } } } .previewBody { padding: 24px 20px; } } }
}
</style>
