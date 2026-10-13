<template>
  <canvasNodeCard
    nodeType="mediaNode"
    :data="{ label: media.label ?? media.fileName, mediaType: media.mediaType, disabled: media.disabled }"
    :inputConnected="inputConnected"
    :outputConnected="outputConnected"
    :executionStatus="executionStatus"
    :canExecute="canExecute"
    :progress="progress"
    :failure="failure"
    :executionUnavailableReason="executionUnavailableReason"
    @execute="emit('execute')"
    @history="emit('history')"
    @action="emit('action', $event)"
    @preview="(url, type) => emit('preview', url, type)"
    @openDetails="emit('openDetails')"
  >
    <template #content>
      <button v-if="media.mediaStatus === 'active' && media.mediaType.startsWith('image/')" class="mediaPreviewButton nodrag nopan" type="button" aria-label="预览素材" @click.stop="emit('preview', previewUrl, 'image')" @dblclick.stop><img class="mediaPreview" :src="previewUrl" :alt="media.fileName" /></button>
      <p class="mediaSummary">{{ media.mediaType }} · {{ media.mediaStatus ?? "状态未知" }}</p>
    </template>
  </canvasNodeCard>
</template>

<script setup lang="ts">
import canvasNodeCard from "@/components/canvasNodeCard.vue";

const emit = defineEmits<{ openDetails: []; execute: []; history: []; action: [action: string]; preview: [url: string, type: string] }>();

defineProps<{
  media: { label?: string; disabled?: boolean; fileName: string; mediaType: string; mediaStatus?: string };
  previewUrl: string;
  inputConnected?: boolean;
  outputConnected?: boolean;
  executionStatus?: string;
  canExecute?: boolean;
  executionUnavailableReason?: string;
  progress?: number;
  failure?: string;
}>();
</script>

<style scoped lang="scss">
.mediaPreviewButton { width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.mediaPreview { width: 100%; max-height: 112px; margin-top: 8px; object-fit: contain; border-radius: 6px; background: var(--cr-surface-subtle); }
.mediaSummary { margin: 0; color: var(--cr-text-secondary); font-size: 12px; line-height: 1.4; }
</style>
