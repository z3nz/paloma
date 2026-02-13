<template>
  <div
    v-if="visible"
    class="absolute bottom-full left-0 right-0 mb-1 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-20"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border text-xs text-text-muted">
      Commands &mdash; <kbd class="bg-bg-tertiary px-1 rounded">&uarr;&darr;</kbd> navigate, <kbd class="bg-bg-tertiary px-1 rounded">Enter</kbd> select, <kbd class="bg-bg-tertiary px-1 rounded">Esc</kbd> close
    </div>

    <!-- Commands -->
    <div class="max-h-48 overflow-y-auto">
      <div v-if="filtered.length === 0" class="px-3 py-4 text-sm text-text-muted text-center">
        No matching commands
      </div>
      <div
        v-for="(cmd, i) in filtered"
        :key="cmd.name"
        @click="$emit('select', cmd)"
        @mouseenter="selectedIndex = i"
        class="px-3 py-2 cursor-pointer flex items-center gap-3 transition-colors"
        :class="i === selectedIndex ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'"
      >
        <span class="text-accent font-mono text-sm">/{{ cmd.name }}</span>
        <span class="text-xs text-text-muted">{{ cmd.description }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  commands: { type: Array, default: () => [] },
  query: { type: String, default: '' }
})

const emit = defineEmits(['select', 'close'])

const selectedIndex = ref(0)

const filtered = computed(() => {
  if (!props.query) return props.commands
  const q = props.query.toLowerCase()
  return props.commands.filter(c => c.name.toLowerCase().includes(q))
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
  if (e.key === 'Tab' && filtered.value.length > 0) {
    e.preventDefault()
    emit('select', filtered.value[selectedIndex.value])
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
