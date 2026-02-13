<template>
  <div
    v-if="visible"
    class="absolute bottom-full left-0 right-0 mb-1 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-20"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border text-xs text-text-muted">
      {{ headerText }} &mdash; <kbd class="bg-bg-tertiary px-1 rounded">&uarr;&darr;</kbd> navigate, <kbd class="bg-bg-tertiary px-1 rounded">Enter</kbd> select, <kbd class="bg-bg-tertiary px-1 rounded">Esc</kbd> close
    </div>

    <!-- Results -->
    <div class="max-h-64 overflow-y-auto">
      <div v-if="loading" class="px-3 py-4 text-sm text-text-muted text-center">
        Loading plans...
      </div>
      <div v-else-if="allItems.length === 0" class="px-3 py-4 text-sm text-text-muted text-center">
        No matching plans
      </div>
      <template v-else>
        <!-- Action items (shown in list mode, filtered by query) -->
        <template v-if="actions.length > 0">
          <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted border-b border-border/50">Actions</div>
          <div
            v-for="(action, i) in actions"
            :key="action.id"
            @click="$emit('select', action)"
            @mouseenter="selectedIndex = i"
            class="px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors"
            :class="i === selectedIndex ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'"
          >
            <span class="text-sm shrink-0">{{ action.icon }}</span>
            <span class="text-accent font-mono text-sm">{{ action.label }}</span>
            <span class="text-xs text-text-muted ml-auto">{{ action.description }}</span>
          </div>
          <div v-if="planItems.length > 0" class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted border-t border-border/50">Plans</div>
        </template>

        <!-- Plan items -->
        <div
          v-for="(item, idx) in planItems"
          :key="item.id"
          @click="$emit('select', item)"
          @mouseenter="selectedIndex = actionsOffset + idx"
          class="px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors"
          :class="(actionsOffset + idx) === selectedIndex ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'"
        >
          <span class="text-sm shrink-0">{{ item.icon }}</span>
          <span class="text-sm truncate">{{ item.label }}</span>
          <span class="text-xs text-text-muted ml-auto shrink-0">{{ item.status }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  query: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  mode: { type: String, default: 'list' }
})

const emit = defineEmits(['select', 'close'])

const selectedIndex = ref(0)

const headerText = computed(() => {
  switch (props.mode) {
    case 'activate': return 'Select plan to activate'
    case 'pause': return 'Select plan to pause'
    case 'complete': return 'Select plan to complete'
    case 'archive': return 'Select plan to archive'
    default: return 'Plans'
  }
})

const ALL_ACTIONS = [
  { id: '__activate', type: 'action', action: 'activate', icon: '▶', label: 'activate', description: 'Promote to active (loads into context)' },
  { id: '__pause', type: 'action', action: 'pause', icon: '⏸', label: 'pause', description: 'Pause (in progress, not loaded)' },
  { id: '__complete', type: 'action', action: 'complete', icon: '✅', label: 'complete', description: 'Mark as completed' },
  { id: '__archive', type: 'action', action: 'archive', icon: '📦', label: 'archive', description: 'Archive a plan' },
]

// Action items shown in list mode (filtered by query if typing)
const actions = computed(() => {
  if (props.mode !== 'list') return []
  if (!props.query) return ALL_ACTIONS
  const q = props.query.toLowerCase()
  return ALL_ACTIONS.filter(a => a.label.startsWith(q))
})

const actionsOffset = computed(() => actions.value.length)

// Filter plan items by query
const planItems = computed(() => {
  if (!props.query) return props.items
  const q = props.query.toLowerCase()
  return props.items.filter(item =>
    item.label.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q)
  )
})

// All items combined for index tracking
const allItems = computed(() => [...actions.value, ...planItems.value])

watch(allItems, () => {
  selectedIndex.value = 0
})

function handleKeydown(e) {
  if (!props.visible) return false

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, allItems.value.length - 1)
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    return true
  }
  if (e.key === 'Enter' && allItems.value.length > 0) {
    e.preventDefault()
    emit('select', allItems.value[selectedIndex.value])
    return true
  }
  if (e.key === 'Tab' && allItems.value.length > 0) {
    e.preventDefault()
    emit('select', allItems.value[selectedIndex.value])
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
