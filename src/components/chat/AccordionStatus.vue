<template>
  <div v-if="activeAccordion" class="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm space-y-2">
    <!-- Header -->
    <div class="flex items-center gap-3 flex-wrap">
      <span class="font-medium text-[var(--color-accent)]">🪗 The Accordion</span>
      <span class="text-[var(--color-text-muted)]">
        {{ phaseLabel }}
      </span>
      <span v-if="activeAccordion.cycleCount > 0" class="text-[var(--color-text-muted)]">
        Cycle {{ activeAccordion.cycleCount }}
      </span>
    </div>

    <!-- Three-tier visualization -->
    <div class="flex items-center gap-1.5 text-xs">
      <!-- Maestro tier -->
      <div class="flex items-center gap-1 px-2 py-1 rounded border"
           :class="maestroClasses">
        <span class="font-mono">30B</span>
        <span>Maestro</span>
        <span :class="maestroDot"></span>
      </div>

      <!-- Arrow -->
      <svg v-if="activeAccordion.currentAngel" width="16" height="12" viewBox="0 0 16 12" class="text-[var(--color-accent)] flex-shrink-0">
        <path d="M0 6h12M10 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span v-else class="w-4"></span>

      <!-- Angel Head tier -->
      <div v-if="activeAccordion.currentAngel" class="flex items-center gap-1 px-2 py-1 rounded border"
           :class="angelClasses">
        <span class="font-mono">8B</span>
        <span>{{ angelLabel }}</span>
        <span :class="angelDot"></span>
      </div>
      <div v-else class="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-40">
        <span class="font-mono">8B</span>
        <span>Angel</span>
      </div>

      <!-- Arrow -->
      <svg v-if="activeAccordion.phase === 'worker-active'" width="16" height="12" viewBox="0 0 16 12" class="text-[var(--color-accent)] flex-shrink-0">
        <path d="M0 6h12M10 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span v-else class="w-4"></span>

      <!-- Worker tier -->
      <div v-if="activeAccordion.phase === 'worker-active'" class="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-success)]/30 bg-[var(--color-success)]/5">
        <span class="font-mono text-[var(--color-text-muted)]">3B</span>
        <span class="text-[var(--color-success)]">Worker</span>
        <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse"></span>
      </div>
      <div v-else class="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-40">
        <span class="font-mono">3B</span>
        <span>Worker</span>
      </div>
    </div>

    <!-- History -->
    <div v-if="activeAccordion.historyCount > 0" class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      <span>History:</span>
      <span>{{ activeAccordion.historyCount }} angel{{ activeAccordion.historyCount === 1 ? '' : 's' }} summoned</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  accordionGroups: { type: Map, default: () => new Map() }
})

const activeAccordion = computed(() => {
  if (props.accordionGroups.size === 0) return null
  let last = null
  for (const [, group] of props.accordionGroups) {
    last = group
  }
  if (!last) return null
  if (last.phase === 'done') return null
  return last
})

const phaseLabel = computed(() => {
  if (!activeAccordion.value) return ''
  switch (activeAccordion.value.phase) {
    case 'thinking': return 'Maestro thinking...'
    case 'angel-active': return `Angel ${activeAccordion.value.currentAngel} active`
    case 'worker-active': return 'Worker executing'
    case 'done': return 'Complete'
    default: return activeAccordion.value.phase
  }
})

const angelLabel = computed(() => {
  if (!activeAccordion.value?.currentAngel) return 'Angel'
  switch (activeAccordion.value.currentAngel) {
    case 111: return '111 Initiator'
    case 222: return '222 Harmonizer'
    case 333: return '333 Expander'
    default: return `${activeAccordion.value.currentAngel}`
  }
})

const maestroClasses = computed(() => {
  if (!activeAccordion.value) return ''
  if (activeAccordion.value.phase === 'thinking') {
    return 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10'
  }
  return 'border-[var(--color-border)] text-[var(--color-text-muted)]'
})

const maestroDot = computed(() => {
  const base = 'inline-block w-2 h-2 rounded-full'
  if (!activeAccordion.value) return `${base} bg-[var(--color-text-muted)]`
  if (activeAccordion.value.phase === 'thinking') {
    return `${base} bg-[var(--color-accent)] animate-pulse`
  }
  return `${base} bg-[var(--color-accent)]`
})

const angelClasses = computed(() => {
  if (!activeAccordion.value?.currentAngel) return ''
  if (activeAccordion.value.phase === 'angel-active') {
    return 'border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10'
  }
  return 'border-[var(--color-border)]'
})

const angelDot = computed(() => {
  const base = 'inline-block w-2 h-2 rounded-full'
  if (activeAccordion.value?.phase === 'angel-active') {
    return `${base} bg-[var(--color-warning)] animate-pulse`
  }
  if (activeAccordion.value?.phase === 'worker-active') {
    return `${base} bg-[var(--color-warning)]`
  }
  return `${base} bg-[var(--color-text-muted)]`
})
</script>
