<template>
  <span class="inline-flex items-center gap-1 bg-accent-muted text-accent border border-accent/30 rounded px-2 py-0.5 text-xs">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <span class="truncate max-w-[200px]" :title="file.path">{{ file.name }}</span>
    <button
      @click="$emit('remove')"
      class="hover:text-danger transition-colors ml-0.5"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </span>
</template>

<script setup>
defineProps({
  file: { type: Object, required: true }
})
defineEmits(['remove'])
</script>
