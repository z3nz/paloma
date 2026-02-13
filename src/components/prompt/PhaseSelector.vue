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
      <component :is="phase.icon" :size="13" />
      {{ phase.label }}
    </button>
  </div>
</template>

<script setup>
import { Waves, Search, Map, Hammer, Sparkles, Rocket } from 'lucide-vue-next'

defineProps({
  modelValue: { type: String, default: 'flow' }
})
defineEmits(['update:modelValue'])

const phases = [
  { id: 'flow', label: 'Flow', icon: Waves, tooltip: 'Collaborative Discovery Through Trust', activeClass: 'bg-blue-500/20 text-blue-400' },
  { id: 'scout', label: 'Scout', icon: Search, tooltip: 'Curious Inquiry Without Assumption', activeClass: 'bg-cyan-500/20 text-cyan-400' },
  { id: 'chart', label: 'Chart', icon: Map, tooltip: 'Strategic Foresight Through Collaboration', activeClass: 'bg-yellow-500/20 text-yellow-400' },
  { id: 'forge', label: 'Forge', icon: Hammer, tooltip: 'Powerful Craftsmanship With Transparency', activeClass: 'bg-orange-500/20 text-orange-400' },
  { id: 'polish', label: 'Polish', icon: Sparkles, tooltip: 'Rigorous Excellence Without Compromise', activeClass: 'bg-pink-500/20 text-pink-400' },
  { id: 'ship', label: 'Ship', icon: Rocket, tooltip: 'Complete Documentation As Legacy', activeClass: 'bg-green-500/20 text-green-400' }
]
</script>
