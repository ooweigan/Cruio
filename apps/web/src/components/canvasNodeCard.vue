<template>
  <article class="nodeCard" :class="nodeType">
    <handle type="target" :position="Position.Left" />
    <header class="cardHeader">
      <span class="typeMark" aria-hidden="true">{{ typeMark }}</span>
      <span class="typeName">{{ typeName }}</span>
    </header>
    <template v-if="nodeType === 'workflowReference'">
      <strong class="cardTitle">{{ referenceName ?? data.label }}</strong>
      <p class="cardBody">项目引用版本 v{{ referenceVersion ?? "?" }}</p>
      <footer class="cardFooter">源工作流在工作流库中编辑</footer>
    </template>
    <template v-else>
      <strong class="cardTitle">{{ data.label }}</strong>
      <p v-if="nodeType === 'textNode'" class="cardBody">{{ data.content?.trim() || "选中节点后填写文本内容" }}</p>
      <p v-else-if="nodeType === 'promptNode'" class="cardBody promptBody">{{ data.content?.trim() || "选中节点后填写提示词草稿" }}</p>
      <p v-else class="cardBody">基础创作节点</p>
      <footer v-if="nodeType === 'promptNode'" class="cardFooter">草稿内容，不会触发生成</footer>
    </template>
    <handle type="source" :position="Position.Right" />
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";

type NodeType = "basicNode" | "textNode" | "promptNode" | "workflowReference";
type NodeData = { label: string; content?: string };

const props = defineProps<{
  nodeType: NodeType;
  data: NodeData;
  referenceName?: string;
  referenceVersion?: number;
}>();

const typeName = computed(() => ({
  basicNode: "创作节点",
  textNode: "文本",
  promptNode: "提示词草稿",
  workflowReference: "工作流引用",
})[props.nodeType]);
const typeMark = computed(() => ({
  basicNode: "N",
  textNode: "T",
  promptNode: "P",
  workflowReference: "W",
})[props.nodeType]);
</script>

<style scoped lang="scss">
.nodeCard { position: relative; width: 246px; min-height: 126px; padding: 14px 16px 12px; border: 1px solid #cbd1d9; border-radius: 12px; color: #252832; background: #fff; box-shadow: 0 8px 24px rgba(67, 71, 86, .08); }
.nodeCard.textNode { border-top: 3px solid #8c96a6; padding-top: 12px; }
.nodeCard.promptNode { border-top: 3px solid #e6ca7b; padding-top: 12px; background: #fffdf7; }
.nodeCard.workflowReference { border-top: 3px solid #8b83ee; padding-top: 12px; background: #faf9ff; }
.cardHeader { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
.typeMark { width: 21px; height: 21px; display: grid; place-items: center; border-radius: 5px; color: #4d5664; background: #eef1f5; font-size: .65rem; font-weight: 800; }
.promptNode .typeMark { color: #745a20; background: #fff0c8; }
.workflowReference .typeMark { color: #625bc4; background: #eae8ff; }
.typeName { color: #626a77; font-size: .67rem; font-weight: 700; }
.cardTitle { display: block; overflow: hidden; color: #252832; font-size: .88rem; font-weight: 720; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.cardBody { display: -webkit-box; overflow: hidden; min-height: 2.6em; margin: 8px 0 0; color: #626a77; font-size: .72rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.promptBody { color: #665c47; }
.cardFooter { margin-top: 12px; padding-top: 9px; border-top: 1px solid #e8e7ed; color: #6a7180; font-size: .65rem; line-height: 1.3; }
:deep(.vue-flow__handle) { width: 9px; height: 9px; border: 2px solid #fff; background: #777e8f; }
.workflowReference :deep(.vue-flow__handle) { background: #7a73fd; }
</style>
