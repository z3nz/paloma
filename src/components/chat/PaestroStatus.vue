<template>
  <div v-if="activePaestro" class="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm space-y-2">
    <!-- Header -->
    <div class="flex items-center gap-3 flex-wrap">
      <span class="font-medium text-[var(--color-accent)]">🎼 67 — The Paestro</span>
      <span class="text-[var(--color-text-muted)]">{{ phaseLabel }}</span>
      <span v-if="activePaestro.cycleCount > 0" class="text-[var(--color-text-muted)]">
        Cycle {{ activePaestro.cycleCount }}
      </span>
    </div>

    <!-- Pipeline visualization -->
    <div class="flex items-center gap-1.5 text-xs flex-wrap">
      <!-- Paestro -->
      <div class="flex items-center gap-1 px-2 py-1 rounded border"
           :class="stageClasses('paestro')">
        <span class="font-mono">30B</span>
        <span>Paestro</span>
        <span :class="stageDot('paestro')"></span>
      </div>

      <!-- Arrow to Hydra -->
      <svg v-if="showHydra" width="16" height="12" viewBox="0 0 16 12" class="text-[var(--color-accent)] flex-shrink-0">
        <path d="M0 6h12M10 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span v-else class="w-4"></span>

      <!-- Hydra -->
      <div v-if="showHydra" class="flex items-center gap-1 px-2 py-1 rounded border"
           :class="stageClasses('hydra')">
        <span>Hydra</span>
        <span class="text-[var(--color-text-muted)]">×3</span>
        <span :class="stageDot('hydra')"></span>
      </div>
      <div v-else class="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-40">
        <span>Hydra</span>
      </div>

      <!-- Arrow to Vote -->
      <svg v-if="showVote" width="16" height="12" viewBox="0 0 16 12" class="text-[var(--color-accent)] flex-shrink-0">
        <path d="M0 6h12M10 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span v-else class="w-4"></span>

      <!-- Vote -->
      <div v-if="showVote" class="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10">
        <span class="text-[var(--color-warning)]">Vote</span>
        <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-warning)] animate-pulse"></span>
      </div>

      <!-- Arrow to Accordion -->
      <svg v-if="showAccordion" width="16" height="12" viewBox="0 0 16 12" class="text-[var(--color-accent)] flex-shrink-0">
        <path d="M0 6h12M10 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>

      <!-- Accordion -->
      <div v-if="showAccordion" class="flex items-center gap-1 px-2 py-1 rounded border"
           :class="stageClasses('accordion')">
        <span>Accordion</span>
        <span :class="stageDot('accordion')"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  paestroGroups: { type: Map, default: () => new Map() }
})

const activePaestro = computed(() => {
  if (props.paestroGroups.size === 0) return null
  let last = null
  for (const [, group] of props.paestroGroups) {
    last = group
  }
  if (!last) return null
  if (last.phase === 'done') return null
  return last
})

const phaseLabel = computed(() => {
  if (!activePaestro.value) return ''
  switch (activePaestro.value.phase) {
    case 'crafting': return 'Crafting prompt...'
    case 'hydra-planning': return 'Hydra planning...'
    case 'hydra-voting': return 'Waiting for your vote'
    case 'plan-received': return 'Plan received'
    case 'accordion-active': return 'Accordion executing...'
    case 'assessing': return 'Assessing results...'
    case 'done': return 'Complete'
    default: return activePaestro.value.phase
  }
})

const showHydra = computed(() => {
  const p = activePaestro.value?.phase
  return p === 'hydra-planning' || p === 'hydra-voting' || p === 'plan-received' || p === 'accordion-active' || p === 'assessing'
})

const showVote = computed(() => {
  return activePaestro.value?.phase === 'hydra-voting'
})

const showAccordion = computed(() => {
  return activePaestro.value?.phase === 'accordion-active'
})

function stageClasses(stage) {
  const p = activePaestro.value?.phase
  if (stage === 'paestro') {
    if (p === 'crafting' || p === 'assessing') return 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10'
    return 'border-[var(--color-border)] text-[var(--color-text-muted)]'
  }
  if (stage === 'hydra') {
    if (p === 'hydra-planning') return 'border-[var(--color-success)]/50 bg-[var(--color-success)]/5'
    if (p === 'hydra-voting') return 'border-[var(--color-warning)]/50 bg-[var(--color-warning)]/5'
    return 'border-[var(--color-border)]'
  }
  if (stage === 'accordion') {
    if (p === 'accordion-active') return 'border-[var(--color-success)]/50 bg-[var(--color-success)]/5'
    return 'border-[var(--color-border)]'
  }
  return ''
}

function stageDot(stage) {
  const base = 'inline-block w-2 h-2 rounded-full'
  const p = activePaestro.value?.phase
  if (stage === 'paestro') {
    if (p === 'crafting' || p === 'assessing') return `${base} bg-[var(--color-accent)] animate-pulse`
    return `${base} bg-[var(--color-accent)]`
  }
  if (stage === 'hydra') {
    if (p === 'hydra-planning') return `${base} bg-[var(--color-success)] animate-pulse`
    if (p === 'hydra-voting') return `${base} bg-[var(--color-warning)] animate-pulse`
    return `${base} bg-[var(--color-text-muted)]`
  }
  if (stage === 'accordion') {
    if (p === 'accordion-active') return `${base} bg-[var(--color-success)] animate-pulse`
    return `${base} bg-[var(--color-text-muted)]`
  }
  return `${base} bg-[var(--color-text-muted)]`
}
</script>
