<template>
  <div v-if="activeArk" class="flex items-center gap-3 px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm">
    <span class="font-medium text-[var(--color-accent)]">🚢 The Ark</span>
    <span class="flex items-center gap-1">
      <span :class="statusDot(head1Status)"></span>
      Head 1 {{ statusLabel(head1Status) }}
    </span>
    <span class="flex items-center gap-1">
      <span :class="statusDot(head2Status)"></span>
      Head 2 {{ statusLabel(head2Status) }}
    </span>
    <span class="flex items-center gap-1">
      <span :class="statusDot(head3Status)"></span>
      Head 3 {{ statusLabel(head3Status) }}
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  arkGroups: { type: Map, default: () => new Map() }
})

const { pillarStatuses } = useMCP()

const activeArk = computed(() => {
  if (props.arkGroups.size === 0) return null
  let last = null
  for (const [, group] of props.arkGroups) {
    last = group
  }
  if (!last) return null
  const statuses = [
    pillarStatuses.get(last.head1PillarId),
    pillarStatuses.get(last.head2PillarId),
    pillarStatuses.get(last.head3PillarId)
  ]
  const anyActive = statuses.some(s => s === 'running' || s === 'streaming')
  return anyActive ? last : null
})

const head1Status = computed(() =>
  activeArk.value?.head1PillarId
    ? (pillarStatuses.get(activeArk.value.head1PillarId) || 'waiting')
    : 'failed'
)

const head2Status = computed(() =>
  activeArk.value?.head2PillarId
    ? (pillarStatuses.get(activeArk.value.head2PillarId) || 'waiting')
    : 'failed'
)

const head3Status = computed(() =>
  activeArk.value?.head3PillarId
    ? (pillarStatuses.get(activeArk.value.head3PillarId) || 'waiting')
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
