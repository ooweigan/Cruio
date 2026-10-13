<template>
  <article class="nodeCard" :class="[nodeType, { disabledNode: data.disabled, runningNode: executionStatus === 'running', failedNode: executionStatus === 'failed' }]">
    <handle id="in" type="target" :position="Position.Left" :connectable="!data.disabled" :aria-label="`输入：${inputLabel}`" :class="{ connected: inputConnected }" />
    <header class="cardHeader">
      <span class="typeMark" aria-hidden="true"><nodeIcon :kind="iconKind" /></span>
      <span class="typeName">{{ typeName }}</span>
    </header>
    <div class="nodeStatus" :class="{ errorStatus: executionStatus === 'failed' }"><span class="statusDot" aria-hidden="true" />{{ statusLabel }}</div>
    <div class="portSummary">
      <span>输入 · {{ inputLabel }}</span>
      <span>输出 · {{ outputLabel }}</span>
    </div>
    <template v-if="nodeType === 'workflowReference'">
      <strong class="cardTitle">{{ referenceName ?? data.label }}</strong>
      <p class="cardBody">项目引用版本 v{{ referenceVersion ?? "?" }}</p>
      <footer class="cardFooter">源工作流在工作流库中编辑</footer>
    </template>
    <template v-else>
      <strong class="cardTitle">{{ data.label }}</strong>
      <slot v-if="!data.formalOutput" name="content">
        <p v-if="nodeType === 'textNode'" class="cardBody">{{ data.content?.trim() || "双击添加文本内容" }}</p>
        <p v-else-if="nodeType === 'scriptNode'" class="cardBody">{{ contentSummary || data.writingBrief?.idea?.trim() || data.content?.trim() || (data.scriptRef ? `已引用脚本 v${data.scriptRef.version}` : "选择已有剧本，或开始创作") }}</p>
        <p v-else-if="nodeType === 'promptNode'" class="cardBody promptBody">{{ data.content?.trim() || "双击添加提示词草稿" }}</p>
        <p v-else-if="nodeType === 'storyboardNode'" class="cardBody">{{ data.shotListRef ? `${shotCount != null ? `${shotCount} 个镜头 · ` : ''}${contentSummary || `镜头清单 v${data.shotListRef.version}`}` : "关联镜头清单，组织画面与节奏" }}</p>
        <p v-else-if="nodeType === 'materialStationNode'" class="cardBody">选择已有素材后转换为真实素材引用</p>
        <p v-else-if="nodeType === 'workflowNode'" class="cardBody">项目画布可绑定已引入的固定工作流版本</p>
        <p v-else-if="nodeType === 'imageGenerationNode' || nodeType === 'videoGenerationNode'" class="cardBody">{{ data.prompt?.trim() || "尚未填写生成提示词" }}</p>
        <p v-else-if="stationNodeTypes.includes(nodeType)" class="cardBody">该工位仅保存节点定义，执行操作尚未接入</p>
        <p v-else class="cardBody">基础创作节点</p>
      </slot>
      <div v-if="data.formalOutput" class="formalOutput">
        <button v-if="data.formalOutput.mediaType === 'image'" class="previewButton nodrag nopan" type="button" @dblclick.stop aria-label="预览节点正式输出" @click.stop="emit('preview', formalOutputUrl, 'image')"><img :src="formalOutputUrl" alt="节点正式输出" /></button>
        <video v-else class="nodrag nopan" :src="formalOutputUrl" controls @dblclick.stop aria-label="节点正式输出" />
        <span>正式输出 · v{{ data.formalOutput.adoptionVersion }}</span>
      </div>
      <div v-if="confirmationStatus || freshnessStatus" class="cardStates" aria-label="节点状态">
        <span v-if="confirmationStatus">创作确认 · {{ confirmationStatus }}</span>
        <span v-if="freshnessStatus">新鲜度 · {{ freshnessStatus }}</span>
      </div>
      <div v-if="stationNodeTypes.includes(nodeType) && nodeType !== 'materialStationNode' && nodeType !== 'workflowNode'" class="cardStates">状态 · 执行能力尚未接入</div>
      <footer v-if="nodeType === 'textNode'" class="cardFooter">文本草稿，不会触发生成</footer>
      <footer v-else-if="nodeType === 'scriptNode'" class="cardFooter">{{ data.scriptRef ? `定稿输出 · 固定版本 v${data.scriptRef.version}` : "尚未采用定稿" }}</footer>
      <footer v-if="nodeType === 'promptNode'" class="cardFooter">草稿内容，不会触发生成</footer>
      <footer v-else-if="nodeType === 'imageGenerationNode' || nodeType === 'videoGenerationNode'" class="cardFooter">确认后仅运行当前节点</footer>
    </template>
    <p v-if="contentError" class="failureReason">内容摘要加载失败 <button class="nodrag nopan" type="button" @click.stop="loadContentSummary">重试</button></p>
    <div v-if="executionStatus === 'running'" class="executionProgress" role="status"><span>正在生成{{ progress != null ? ` · ${Math.round(progress)}%` : '…' }}</span><progress v-if="progress != null" max="100" :value="progress" /><progress v-else /></div>
    <p v-if="executionStatus === 'failed'" class="failureReason">{{ failure || '生成未完成，请查看历史记录中的失败详情。' }}<button v-if="canExecute" class="nodrag nopan" type="button" @click.stop="emit('execute')">重试</button></p>
    <div class="cardActions nodrag nopan" @dblclick.stop>
      <button class="editAction" type="button" :title="detailLabel" aria-label="编辑节点" @click.stop="emit('openDetails')"><nodeIcon kind="edit" /><span>{{ nodeType === 'workflowReference' || nodeType === 'mediaNode' ? '详情' : '编辑' }}</span></button>
      <span class="actionSpacer" />
      <button class="executeAction" type="button" :disabled="!canExecute || !!data.disabled || ['queued', 'running', 'succeeded'].includes(executionStatus ?? '')" :title="data.disabled ? '节点已禁用' : canExecute ? '执行节点' : executionUnavailableReason || '此节点尚未接入执行能力'" aria-label="执行节点" @click.stop="emit('execute')"><nodeIcon kind="play" /></button>
      <button type="button" title="历史执行结果" aria-label="历史执行结果" @click.stop="emit('history')"><nodeIcon kind="history" /></button>
      <details class="nodeMenu" @click.stop><summary aria-label="更多节点操作" title="更多操作"><nodeIcon kind="more" /></summary><div class="menuItems"><button type="button" @click="menuAction($event, 'rename')">重命名</button><button type="button" @click="menuAction($event, 'duplicate')">复制</button><button type="button" @click="menuAction($event, 'disable')">{{ data.disabled ? '启用' : '禁用' }}</button><button class="deleteAction" type="button" @click="menuAction($event, 'delete')">删除</button></div></details>
    </div>
    <handle id="out" type="source" :position="Position.Right" :connectable="!data.disabled" :aria-label="`输出：${outputLabel}`" :class="{ connected: outputConnected }" />
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "@/lib/cruioApi";
import nodeIcon from "@/components/nodeIcon.vue";
import { Handle, Position } from "@vue-flow/core";

type NodeType = "basicNode" | "textNode" | "scriptNode" | "storyboardNode" | "materialStationNode" | "directorNode" | "soundNode" | "editingNode" | "workflowNode" | "promptNode" | "mediaNode" | "imageGenerationNode" | "videoGenerationNode" | "workflowReference";
type NodeData = {
  label: string;
  disabled?: boolean;
  writingBrief?: { idea?: string };
  shotListRef?: { shotListId: string; version: number };
  content?: string;
  scriptRef?: { scriptId: string; version: number };
  prompt?: string;
  mediaType?: string;
  formalOutput?: { resultId: string; adoptionVersion: number; mediaType: "image" | "video" };
};

const props = defineProps<{
  nodeType: NodeType;
  data: NodeData;
  inputConnected?: boolean;
  outputConnected?: boolean;
  executionStatus?: string;
  confirmationStatus?: string;
  freshnessStatus?: string;
  referenceName?: string;
  referenceVersion?: number;
  canExecute?: boolean;
  executionUnavailableReason?: string;
  progress?: number;
  failure?: string;
}>();
const emit = defineEmits<{ openDetails: []; execute: []; history: []; preview: [url: string, type: string]; action: [action: string] }>();
function menuAction(event: Event, action: string) {
  (event.target as HTMLElement).closest("details")?.removeAttribute("open");
  emit("action", action);
}
const iconKind = computed(() => ({ basicNode: "workflow", workflowNode: "workflow", workflowReference: "workflow", scriptNode: "script", storyboardNode: "storyboard", textNode: "script", promptNode: "script", imageGenerationNode: "image", videoGenerationNode: "video", mediaNode: "material", materialStationNode: "material", directorNode: "director", soundNode: "sound", editingNode: "editing" })[props.nodeType] ?? "workflow");
const statusLabel = computed(() => props.data.disabled ? "已禁用" : executionLabel.value || (props.nodeType === "scriptNode" && props.data.scriptRef ? "已定稿" : props.data.formalOutput ? "已完成" : props.data.scriptRef || props.data.shotListRef || props.data.content?.trim() || props.data.prompt?.trim() || props.data.writingBrief?.idea?.trim() ? "已就绪" : "待配置"));
const contentSummary = ref("");
const shotCount = ref<number | null>(null);
const contentError = ref(false);
let summaryRevision = 0;
async function loadContentSummary() {
  const revision = ++summaryRevision;
  contentSummary.value = ""; shotCount.value = null; contentError.value = false;
  try {
    if (props.nodeType === "scriptNode" && props.data.scriptRef) {
      const reference = props.data.scriptRef;
      const result = await api<{ script: { document: { summary?: string; sections?: { blocks: { text: string }[] }[] } } }>(`/api/scripts/${encodeURIComponent(reference.scriptId)}/versions/${reference.version}`);
      if (revision !== summaryRevision) return;
      const document = result.script.document;
      contentSummary.value = document.summary?.trim() || document.sections?.flatMap(section => section.blocks).map(block => block.text).join(" ").trim() || "";
    }
    if (props.nodeType === "storyboardNode" && props.data.shotListRef) {
      const reference = props.data.shotListRef;
      const result = await api<{ shotList: { document: { shots: { content: { description: string } }[] } } }>(`/api/shotLists/${encodeURIComponent(reference.shotListId)}/versions/${reference.version}`);
      if (revision !== summaryRevision) return;
      shotCount.value = result.shotList.document.shots.length;
      contentSummary.value = result.shotList.document.shots.slice(0, 2).map(shot => shot.content.description).join(" · ");
    }
  } catch { if (revision === summaryRevision) contentError.value = true; }
}
watch(() => [props.data.scriptRef?.scriptId, props.data.scriptRef?.version, props.data.shotListRef?.shotListId, props.data.shotListRef?.version], loadContentSummary, { immediate: true });
const stationNodeTypes: NodeType[] = ["storyboardNode", "materialStationNode", "directorNode", "soundNode", "editingNode", "workflowNode"];
const formalOutputUrl = computed(() => props.data.formalOutput
  ? `/api/generation/results/${encodeURIComponent(props.data.formalOutput.resultId)}/read`
  : "");

const typeName = computed(() => ({
  basicNode: "创作节点",
  textNode: "文本",
  scriptNode: "剧本",
  storyboardNode: "分镜",
  materialStationNode: "素材",
  directorNode: "导演",
  soundNode: "声音",
  editingNode: "剪辑",
  workflowNode: "工作流",
  promptNode: "提示词草稿",
  mediaNode: "素材",
  imageGenerationNode: "图片生成",
  videoGenerationNode: "视频生成",
  workflowReference: "工作流引用",
})[props.nodeType]);
const hasInputPort = computed(() => ["imageGenerationNode", "videoGenerationNode"].includes(props.nodeType));
const inputLabel = computed(() => hasInputPort.value ? "参考图" : "内容");
const outputLabel = computed(() => ({
  basicNode: "内容",
  textNode: "文本",
  scriptNode: "剧本文字",
  storyboardNode: "分镜定义",
  materialStationNode: "素材",
  directorNode: "导演参数",
  soundNode: "声音",
  editingNode: "剪辑工程",
  workflowNode: "工作流定义",
  promptNode: "提示词草稿",
  mediaNode: "图片素材",
  imageGenerationNode: "图片结果",
  videoGenerationNode: "视频结果",
  workflowReference: "工作流引用",
})[props.nodeType]);
const detailLabels: Partial<Record<NodeType, string>> = {
  textNode: "编辑文本",
  scriptNode: "选择与确认定稿",
  promptNode: "编辑草稿",
  mediaNode: "查看素材",
  imageGenerationNode: "配置并报价",
  videoGenerationNode: "配置并报价",
  workflowReference: "查看工作流引用",
};
const detailLabel = computed(() => detailLabels[props.nodeType] ?? "查看详情");
const executionLabel = computed(() => ({
  queued: "排队中",
  running: "生成中",
  succeeded: "正在保存结果",
  delivered: "结果可用",
  failed: "生成失败",
  unknown: "状态待核查",
  cancelled: "已取消",
})[props.executionStatus ?? ""] ?? props.executionStatus);
</script>

<style scoped lang="scss">
.nodeCard {
  position: relative; width: 280px; text-align: left; min-height: 190px; padding: 24px 16px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 0 20px 20px 20px; color: var(--cr-text-primary); background: var(--cr-surface); box-shadow: 0 5px 18px rgba(55, 42, 89, .055); transition: box-shadow .18s, border-color .18s;
  &:hover { box-shadow: 0 8px 22px rgba(55, 42, 89, .09); .editAction { opacity: 1; } }
  &.disabledNode { background: #f1eff5; color: #686176; .cardBody { color: #686176; } }
  &.failedNode { border-color: #e6bdc6; }
  .cardHeader { position: absolute; top: -29px; left: -1px; height: 30px; padding: 5px 14px 4px; display: flex; align-items: center; gap: 7px; border: 1px solid var(--cr-border-subtle); border-bottom: 0; border-radius: 12px 12px 0 0; background: var(--cr-surface); }
  .typeMark { display: flex; color: var(--cr-brand-primary); :deep(.nodeIcon) { width: 16px; height: 16px; } }
  .typeName { color: var(--cr-text-secondary); font-size: 12px; font-weight: 600; }
  .nodeStatus { display: flex; align-items: center; gap: 6px; margin: -8px 0 12px; color: var(--cr-text-muted); font-size: 11px; .statusDot { width: 5px; height: 5px; border-radius: 50%; background: #b3abc8; } &.errorStatus { color: #b1465c; .statusDot { background: #b1465c; } } }
  .cardTitle { display: block; overflow: hidden; color: var(--cr-text-primary); font-size: 18px; font-weight: 650; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
  .cardBody { display: -webkit-box; overflow: hidden; min-height: 48px; margin: 12px 0 0; padding: 12px; border-radius: 10px; background: var(--cr-surface-subtle); color: var(--cr-text-secondary); font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .cardFooter { margin-top: 12px; color: var(--cr-text-muted); font-size: 11px; line-height: 1.5; }
  .formalOutput { margin-top: 12px; display: grid; gap: 8px; color: var(--cr-brand-primary); font-size: 11px; img, video { width: 100%; max-height: 160px; object-fit: contain; border-radius: 10px; background: var(--cr-surface-subtle); } }
  .previewButton { display: block; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
  .cardStates { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; color: var(--cr-text-secondary); font-size: 11px; line-height: 1.5; }
  .portSummary { display: none; }
  &:hover .portSummary { display: flex; position: absolute; top: calc(100% + 6px); left: 0; right: 0; justify-content: space-between; color: var(--cr-text-muted); font-size: 11px; }
  .executionProgress { margin: 12px 0; color: var(--cr-brand-primary); font-size: 12px; progress { display: block; width: 100%; height: 4px; margin-top: 8px; accent-color: var(--cr-brand-primary); } }
  .failureReason { color: #a53749; font-size: 12px; line-height: 1.6; button { margin-left: 8px; border: 0; background: transparent; color: inherit; text-decoration: underline; cursor: pointer; } }
  .cardActions { display: flex; gap: 4px; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--cr-border-subtle); button, summary { width: 30px; height: 30px; padding: 5px; display: grid; place-items: center; border: 0; border-radius: 8px; color: var(--cr-text-secondary); background: transparent; cursor: pointer; &:hover { color: var(--cr-brand-primary); background: var(--cr-surface-hover); } &:disabled { opacity: .4; cursor: not-allowed; } } .executeAction { color: var(--cr-brand-primary); background: var(--cr-surface-hover); } .editAction { width: auto; padding: 5px 8px; display: flex; gap: 5px; color: var(--cr-brand-primary); font-size: 12px; :deep(.nodeIcon) { width: 15px; height: 15px; } } .actionSpacer { flex: 1; } }
  .nodeMenu { position: relative; summary { list-style: none; &::-webkit-details-marker { display: none; } } .menuItems { position: absolute; z-index: 6; right: 0; top: 34px; width: 126px; padding: 6px; border: 1px solid var(--cr-border-subtle); border-radius: 12px; background: var(--cr-surface); box-shadow: 0 8px 24px rgba(55,42,89,.12); button { width: 100%; text-align: left; display: block; padding: 6px 10px; font: inherit; font-size: 12px; } .deleteAction { color: #a53749; } } }
  :deep(.vue-flow__handle) { width: 12px; height: 12px; border: 3px solid var(--cr-surface); background: #c9c2de; box-shadow: 0 0 0 1px #d9d3e8; }
  :deep(.vue-flow__handle.connected) { background: var(--cr-brand-primary); }
  :deep(.vue-flow__handle.connecting), :deep(.vue-flow__handle.valid) { background: var(--cr-brand-primary); box-shadow: 0 0 0 5px #e6e0fa; }
}
@media (prefers-reduced-motion: reduce) { .nodeCard { transition: none; } }
</style>
