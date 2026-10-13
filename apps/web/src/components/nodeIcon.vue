<template>
<svg class="nodeIcon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <g v-if="kind === 'script'"><path d="M6 3.75h8l4 4v12.5H6z"/><path d="M14 3.75v4h4M9 12h6M9 15.5h6"/></g>
              <g v-else-if="kind === 'storyboard'"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></g>
              <g v-else-if="kind === 'material'"><path d="M4 7.5h16v12H4zM4 7.5l2-3h12l2 3"/><path d="m7 16 3-3 2.5 2 2-2 2.5 3"/></g>
              <g v-else-if="kind === 'director'"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></g>
              <g v-else-if="kind === 'image'"><rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m5 17 5-5 3 3 2-2 4 4"/></g>
              <g v-else-if="kind === 'video'"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></g>
              <g v-else-if="kind === 'sound'"><path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></g>
              <g v-else-if="kind === 'editing'"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 7.5 12 9M8 16.5l5-4M15 10l5-3"/></g>
              <g v-else-if="kind === 'play'"><path d="m9 5 11 7-11 7z" /></g>
              <g v-else-if="kind === 'history'"><path d="M3 11a9 9 0 1 1 2.6 7M3 5v6h6M12 7v5l3 2" /></g>
              <g v-else-if="kind === 'edit'"><path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4" /></g>
              <g v-else-if="kind === 'more'"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></g>
              <g v-else><rect x="3.5" y="9" width="5" height="5" rx="1"/><rect x="15.5" y="3" width="5" height="5" rx="1"/><rect x="15.5" y="15" width="5" height="5" rx="1"/><path d="M8.5 11.5h3a4 4 0 0 0 4-4M11.5 11.5a4 4 0 0 1 4 4"/></g>
            </svg>
</template>

<script setup lang="ts">
defineProps<{ kind: string }>();
</script>

<style scoped>
.nodeIcon { width: 20px; height: 20px; flex-shrink: 0; }
</style>
