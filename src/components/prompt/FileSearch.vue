<template>
  <div
    v-if="visible"
    class="absolute bottom-full left-0 right-0 mb-1 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-20"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border text-xs text-text-muted">
      Search files &mdash; <kbd class="bg-bg-tertiary px-1 rounded">↑↓</kbd> navigate, <kbd class="bg-bg-tertiary px-1 rounded">Enter</kbd> select, <kbd class="bg-bg-tertiary px-1 rounded">Esc</kbd> close
    </div>

    <!-- Results -->
    <div class="file-search-dropdown">
      <div v-if="results.length === 0" class="px-3 py-4 text-sm text-text-muted text-center">
        {{ query ? 'No files found' : 'Type to search files...' }}
      </div>
      <div
        v-for="(file, i) in results"
        :key="file.path"
        @click="$emit('select', file)"
        @mouseenter="selectedIndex = i"
        class="px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors"
        :class="i === selectedIndex ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-text-muted">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="text-sm truncate">{{ file.name }}</span>
        <span class="text-xs text-text-muted truncate ml-auto">{{ file.dir }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  results: { type: Array, default: () => [] },
  query: { type: String, default: '' }
})

const emit = defineEmits(['select', 'close'])

const selectedIndex = ref(0)

watch(() => props.results, () => {
  selectedIndex.value = 0
})

function handleKeydown(e) {
  if (!props.visible) return false

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, props.results.length - 1)
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    return true
  }
  if (e.key === 'Enter' && props.results.length > 0) {
    e.preventDefault()
    emit('select', props.results[selectedIndex.value])
    return true
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return true
  }
  return false
}

defineExpose({ handleKeydown })
</script>
