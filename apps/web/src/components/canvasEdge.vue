<template>
  <base-edge :id="id" :path="path[0]" :style="style" :markerEnd="markerEnd" :interactionWidth="24" />
  <edge-label-renderer>
    <div v-if="active" class="edgeControls nodrag nopan" :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px) scale(${1 / zoom})` }" @pointerdown.stop @click.stop>
      <div class="edgeButtons">
        <button class="deleteEdge" type="button" aria-label="删除连线" title="删除连线" @click="emit('remove')">×</button>
        <button type="button" aria-label="在连线中插入节点" title="在连线中插入节点" :aria-expanded="showChoices" @click="showChoices = !showChoices">＋</button>
      </div>
      <div v-if="showChoices" class="edgeChoices" @keydown.esc.stop="showChoices = false">
        <span class="choiceTitle">插入节点</span>
        <button v-for="option in options" :key="option.id" type="button" @click="emit('insert', option.id, { x: path[1], y: path[2] }); showChoices = false"><nodeIcon :kind="option.id" />{{ option.label }}</button>
        <p v-if="!options.length">当前输入类型没有兼容的节点</p>
      </div>
    </div>
  </edge-label-renderer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@vue-flow/core";
import nodeIcon from "@/components/nodeIcon.vue";
const props = defineProps<EdgeProps & { active: boolean; zoom: number; options: { id: string; label: string }[] }>();
const emit = defineEmits<{ remove: []; insert: [type: string, position: { x: number; y: number }] }>();
const path = computed(() => getBezierPath(props));
const showChoices = ref(false);
watch(() => props.active, () => { showChoices.value = false; });
</script>

<style scoped lang="scss">
.edgeControls {
  position: absolute; pointer-events: all; z-index: 6;
  .edgeButtons { display: flex; gap: 16px; button { width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border: 1px solid #dbd4eb; border-radius: 50%; background: #fff; color: #7b60bf; font-size: 22px; cursor: pointer; box-shadow: 0 2px 8px rgba(55,42,89,.08); &:hover { background: #f1ecfa; } &.deleteEdge { color: #a53749; &:hover { background: #fff1f3; } } &:focus-visible { outline: 2px solid #9479d4; outline-offset: 3px; } } }
  .edgeChoices { position: absolute; top: 42px; left: 50%; transform: translateX(-50%); width: 220px; padding: 12px; border: 1px solid #e3dcec; border-radius: 14px; background: #fff; box-shadow: 0 8px 24px rgba(55,42,89,.10); display: grid; grid-template-columns: 1fr 1fr; gap: 4px; .choiceTitle { grid-column: 1 / -1; padding: 2px 6px 8px; font-size: 12px; color: #81778e; } button { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: #51465f; font-size: 13px; cursor: pointer; &:hover, &:focus-visible { background: #f1ecfa; color: #7b60bf; } } p { grid-column: 1 / -1; margin: 0; font-size: 12px; line-height: 1.6; color: #81778e; } }
}
</style>
