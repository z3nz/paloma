<template>
  <div class="relative" ref="wrapper">
    <button
      @click="open = !open"
      class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors"
      :class="currentPhase.activeClass + ' border-current/20'"
    >
      <PillarLoader :pillar="modelValue" :size="12" :active="true" />
      <span>{{ currentPhase.label }}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute bottom-full left-0 mb-1 w-48 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-30"
    >
      <div
        v-for="phase in phases"
        :key="phase.id"
        @click="selectPhase(phase.id)"
        class="px-3 py-2 text-xs cursor-pointer transition-colors flex items-center gap-2"
        :class="phase.id === modelValue ? phase.activeClass + ' font-medium' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'"
      >
        <PillarLoader :pillar="phase.id" :size="14" :active="phase.id === modelValue" />
        <span>{{ phase.label }}</span>
        <span class="text-text-muted ml-auto">{{ phase.shortDesc }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PHASE_MODEL_SUGGESTIONS } from '../../prompts/phases.js'
import PillarLoader from '../ui/PillarLoader.vue'

const props = defineProps({
  modelValue: { type: String, default: 'flow' }
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const wrapper = ref(null)

const phases = [
  { id: 'flow', label: 'Flow', shortDesc: 'Orchestrate', activeClass: 'bg-accent/15 text-accent' },
  { id: 'scout', label: 'Scout', shortDesc: 'Explore', activeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  { id: 'chart', label: 'Chart', shortDesc: 'Design', activeClass: 'bg-warning/15 text-warning' },
  { id: 'forge', label: 'Forge', shortDesc: 'Build', activeClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
  { id: 'polish', label: 'Polish', shortDesc: 'Verify', activeClass: 'bg-pink-500/15 text-pink-600 dark:text-pink-400' },
  { id: 'ship', label: 'Ship', shortDesc: 'Deliver', activeClass: 'bg-success/15 text-success' }
]

const currentPhase = computed(() => phases.find(p => p.id === props.modelValue) || phases[0])

function selectPhase(id) {
  emit('update:modelValue', id)
  open.value = false
}

function handleClickOutside(e) {
  if (wrapper.value && !wrapper.value.contains(e.target)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
</script>
