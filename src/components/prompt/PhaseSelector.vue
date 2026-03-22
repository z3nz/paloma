<template>
  <div class="flex items-center gap-1">
    <button
      v-for="phase in phases"
      :key="phase.id"
      @click="$emit('update:modelValue', phase.id)"
      class="phase-pill px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5"
      :class="modelValue === phase.id
        ? `${phase.activeClass} ring-1 ring-current/30`
        : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'"
      :title="phase.tooltip"
    >
      <PillarLoader :pillar="phase.id" :size="14" :active="modelValue === phase.id" />
      {{ phase.label }}
    </button>
  </div>
</template>

<script setup>
import { PHASE_MODEL_SUGGESTIONS } from '../../prompts/phases.js'
import PillarLoader from '../ui/PillarLoader.vue'

defineProps({
  modelValue: { type: String, default: 'flow' }
})
defineEmits(['update:modelValue'])

function modelHint(phaseId) {
  const model = PHASE_MODEL_SUGGESTIONS[phaseId]
  if (!model) return ''
  const name = model.replace('claude-cli:', '').charAt(0).toUpperCase() + model.replace('claude-cli:', '').slice(1)
  return ` (${name})`
}

const phases = [
  { id: 'flow', label: 'Flow', tooltip: 'The Orchestrator — Head Mind' + modelHint('flow'), activeClass: 'bg-accent/15 text-accent' },
  { id: 'scout', label: 'Scout', tooltip: 'Curious Inquiry Without Assumption' + modelHint('scout'), activeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  { id: 'chart', label: 'Chart', tooltip: 'Strategic Foresight Through Collaboration' + modelHint('chart'), activeClass: 'bg-warning/15 text-warning' },
  { id: 'forge', label: 'Forge', tooltip: 'Powerful Craftsmanship With Transparency' + modelHint('forge'), activeClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
  { id: 'polish', label: 'Polish', tooltip: 'Rigorous Excellence Without Compromise' + modelHint('polish'), activeClass: 'bg-pink-500/15 text-pink-600 dark:text-pink-400' },
  { id: 'ship', label: 'Ship', tooltip: 'Complete Documentation As Legacy' + modelHint('ship'), activeClass: 'bg-success/15 text-success' }
]
</script>
