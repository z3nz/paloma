<template>
  <div
    v-if="visible"
    class="absolute bottom-full left-0 right-0 mb-1 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-20"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border text-xs text-text-muted">
      Switch project &mdash; <kbd class="bg-bg-tertiary px-1 rounded">&uarr;&darr;</kbd> navigate, <kbd class="bg-bg-tertiary px-1 rounded">Enter</kbd> select, <kbd class="bg-bg-tertiary px-1 rounded">Esc</kbd> close
    </div>

    <!-- Results -->
    <div class="max-h-48 overflow-y-auto">
      <div v-if="loading" class="px-3 py-4 text-sm text-text-muted text-center">
        Loading projects...
      </div>
      <div v-else-if="filtered.length === 0" class="px-3 py-4 text-sm text-text-muted text-center">
        No matching projects
      </div>
      <div
        v-for="(project, i) in filtered"
        :key="project"
        @click="$emit('select', project)"
        @mouseenter="selectedIndex = i"
        class="px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors"
        :class="i === selectedIndex ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-text-muted">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="text-sm">{{ project }}</span>
        <span v-if="project === currentProject" class="text-xs text-accent ml-auto">current</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  projects: { type: Array, default: () => [] },
  query: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  currentProject: { type: String, default: '' }
})

const emit = defineEmits(['select', 'close'])

const selectedIndex = ref(0)

const filtered = computed(() => {
  if (!props.query) return props.projects
  const q = props.query.toLowerCase()
  return props.projects.filter(p => p.toLowerCase().includes(q))
})

watch(filtered, () => {
  selectedIndex.value = 0
})

function handleKeydown(e) {
  if (!props.visible) return false

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    return true
  }
  if (e.key === 'Enter' && filtered.value.length > 0) {
    e.preventDefault()
    emit('select', filtered.value[selectedIndex.value])
    return true
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return true
  }
  if (e.key === 'Tab' && filtered.value.length > 0) {
    e.preventDefault()
    emit('select', filtered.value[selectedIndex.value])
    return true
  }
  return false
}

defineExpose({ handleKeydown })
</script>
