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
  { id: 'flow', label: 'Flow', tooltip: 'The Orchestrator — Head Mind' + modelHint('flow'), activeClass: 'bg-blue-500/20 text-blue-400' },
  { id: 'scout', label: 'Scout', tooltip: 'Curious Inquiry Without Assumption' + modelHint('scout'), activeClass: 'bg-cyan-500/20 text-cyan-400' },
  { id: 'chart', label: 'Chart', tooltip: 'Strategic Foresight Through Collaboration' + modelHint('chart'), activeClass: 'bg-yellow-500/20 text-yellow-400' },
  { id: 'forge', label: 'Forge', tooltip: 'Powerful Craftsmanship With Transparency' + modelHint('forge'), activeClass: 'bg-orange-500/20 text-orange-400' },
  { id: 'polish', label: 'Polish', tooltip: 'Rigorous Excellence Without Compromise' + modelHint('polish'), activeClass: 'bg-pink-500/20 text-pink-400' },
  { id: 'ship', label: 'Ship', tooltip: 'Complete Documentation As Legacy' + modelHint('ship'), activeClass: 'bg-green-500/20 text-green-400' }
]
</script>
