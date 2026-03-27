<template>
  <div v-if="activeTrinity" class="flex items-center gap-3 px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm">
    <span class="font-medium text-[var(--color-accent)]">⚡ Holy Trinity</span>
    <span class="flex items-center gap-1">
      <span :class="statusDot(arm1Status)"></span>
      Arm 1 {{ statusLabel(arm1Status) }}
    </span>
    <span class="flex items-center gap-1">
      <span :class="statusDot(arm2Status)"></span>
      Arm 2 {{ statusLabel(arm2Status) }}
    </span>
    <span class="flex items-center gap-1">
      <span :class="statusDot(mindStatus)"></span>
      Mind {{ statusLabel(mindStatus) }}
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  trinityGroups: { type: Map, default: () => new Map() }
})

const { pillarStatuses } = useMCP()

const activeTrinity = computed(() => {
  if (props.trinityGroups.size === 0) return null
  let last = null
  for (const [, group] of props.trinityGroups) {
    last = group
  }
  // Only show if at least one member is still running/streaming
  if (!last) return null
  const statuses = [
    pillarStatuses.get(last.mindPillarId),
    pillarStatuses.get(last.arm1PillarId),
    pillarStatuses.get(last.arm2PillarId)
  ]
  const anyActive = statuses.some(s => s === 'running' || s === 'streaming')
  return anyActive ? last : null
})

const arm1Status = computed(() =>
  activeTrinity.value?.arm1PillarId
    ? (pillarStatuses.get(activeTrinity.value.arm1PillarId) || 'waiting')
    : 'failed'
)

const arm2Status = computed(() =>
  activeTrinity.value?.arm2PillarId
    ? (pillarStatuses.get(activeTrinity.value.arm2PillarId) || 'waiting')
    : 'failed'
)

const mindStatus = computed(() =>
  activeTrinity.value?.mindPillarId
    ? (pillarStatuses.get(activeTrinity.value.mindPillarId) || 'waiting')
    : 'failed'
)

function statusDot(status) {
  const base = 'inline-block w-2 h-2 rounded-full'
  if (status === 'running' || status === 'streaming') return `${base} bg-[var(--color-success)] animate-pulse`
  if (status === 'completed' || status === 'idle') return `${base} bg-[var(--color-success)]`
  if (status === 'failed' || status === 'error') return `${base} bg-[var(--color-error)]`
  return `${base} bg-[var(--color-text-muted)]`
}

function statusLabel(status) {
  if (status === 'running' || status === 'streaming') return '🔄'
  if (status === 'completed' || status === 'idle') return '✓'
  if (status === 'failed' || status === 'error') return '✗'
  return '⏳'
}
</script>
