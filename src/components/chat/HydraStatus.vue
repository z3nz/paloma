<template>
  <div v-if="activeHydra" class="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm space-y-1">
    <!-- Header -->
    <div class="flex items-center gap-3 flex-wrap">
      <span class="font-medium text-[var(--color-accent)]">🐉 The Hydra</span>
      <span class="text-[var(--color-text-muted)]">
        {{ phaseLabel }}
        <template v-if="activeHydra.round > 0"> — Round {{ activeHydra.round }}</template>
      </span>
      <span class="text-[var(--color-text-muted)]">
        {{ activeHydra.aliveHeads.length }} alive
        <template v-if="activeHydra.deadHeads.length > 0">
          / {{ activeHydra.deadHeads.length }} dead
        </template>
      </span>
      <span v-if="activeHydra.consensusBy" class="text-[var(--color-success)]">
        Plan by Head {{ activeHydra.consensusBy }}
      </span>
    </div>

    <!-- Planning heads -->
    <div v-if="activeHydra.phase !== 'execution' && activeHydra.phase !== 'done'" class="flex items-center gap-2 flex-wrap">
      <span v-for="head in activeHydra.aliveHeads" :key="head.headNumber" class="flex items-center gap-1">
        <span :class="headDot(head.status)"></span>
        H{{ head.headNumber }}
      </span>
      <span v-for="dead in activeHydra.deadHeads" :key="'d' + dead.headNumber" class="flex items-center gap-1 opacity-50">
        <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-error)]"></span>
        <span class="line-through">H{{ dead.headNumber }}</span>
      </span>
    </div>

    <!-- Workers -->
    <div v-if="activeHydra.workers.length > 0" class="flex items-center gap-2 flex-wrap">
      <span class="text-[var(--color-text-muted)]">Workers:</span>
      <span v-for="w in activeHydra.workers" :key="w.workerNumber" class="flex items-center gap-1">
        <span :class="workerDot(w.status)"></span>
        W{{ w.workerNumber }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  hydraGroups: { type: Map, default: () => new Map() }
})

const activeHydra = computed(() => {
  if (props.hydraGroups.size === 0) return null
  let last = null
  for (const [, group] of props.hydraGroups) {
    last = group
  }
  if (!last) return null
  // Show while any phase is active (not 'done')
  if (last.phase === 'done') return null
  return last
})

const phaseLabel = computed(() => {
  if (!activeHydra.value) return ''
  switch (activeHydra.value.phase) {
    case 'planning': return 'Planning'
    case 'voting': return 'Voting'
    case 'consensus': return 'Consensus!'
    case 'execution': return 'Building'
    case 'error': return 'Error'
    default: return activeHydra.value.phase
  }
})

function headDot(status) {
  const base = 'inline-block w-2 h-2 rounded-full'
  if (status === 'planning') return `${base} bg-[var(--color-success)] animate-pulse`
  if (status === 'plan-complete') return `${base} bg-[var(--color-success)]`
  if (status === 'voting') return `${base} bg-[var(--color-warning)] animate-pulse`
  if (status === 'dead') return `${base} bg-[var(--color-error)]`
  return `${base} bg-[var(--color-text-muted)]`
}

function workerDot(status) {
  const base = 'inline-block w-2 h-2 rounded-full'
  if (status === 'working') return `${base} bg-[var(--color-success)] animate-pulse`
  if (status === 'done') return `${base} bg-[var(--color-success)]`
  return `${base} bg-[var(--color-text-muted)]`
}
</script>
