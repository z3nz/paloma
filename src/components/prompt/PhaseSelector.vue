<template>
  <div class="flex items-center gap-1">
    <button
      v-for="phase in phases"
      :key="phase.id"
      @click="$emit('update:modelValue', phase.id)"
      class="phase-pill px-2.5 py-1 rounded text-xs font-medium transition-all"
      :class="modelValue === phase.id
        ? `${phase.activeClass} ring-1 ring-current/30`
        : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'"
    >
      {{ phase.label }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  modelValue: { type: String, default: 'research' }
})
defineEmits(['update:modelValue'])

const phases = [
  { id: 'research', label: 'Research', activeClass: 'bg-blue-500/20 text-blue-400' },
  { id: 'plan', label: 'Plan', activeClass: 'bg-yellow-500/20 text-yellow-400' },
  { id: 'implement', label: 'Implement', activeClass: 'bg-green-500/20 text-green-400' },
  { id: 'review', label: 'Review', activeClass: 'bg-orange-500/20 text-orange-400' },
  { id: 'commit', label: 'Commit', activeClass: 'bg-purple-500/20 text-purple-400' }
]
</script>
