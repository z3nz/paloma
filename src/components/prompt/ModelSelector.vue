<template>
  <div class="relative" ref="wrapper">
    <button
      @click="open = !open"
      class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-bg-primary border border-border rounded-md text-text-secondary hover:text-text-primary hover:border-border transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
      <span class="truncate max-w-[140px]">{{ displayName }}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute bottom-full left-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-30"
    >
      <div class="p-2 border-b border-border">
        <input
          v-model="filter"
          ref="filterInput"
          placeholder="Search models..."
          class="w-full bg-bg-primary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
          @keydown.escape="open = false"
        />
      </div>
      <div class="max-h-64 overflow-y-auto">
        <!-- Local CLI models -->
        <template v-if="filteredCliModels.length">
          <div class="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Local CLI</div>
          <div
            v-for="cliId in filteredCliModels"
            :key="cliId"
            @click="selectModel(cliId)"
            class="px-3 py-2 text-sm cursor-pointer transition-colors"
            :class="cliId === modelValue ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'"
          >
            {{ cliId.split(':').pop() }}
            <span class="text-xs text-text-muted ml-1">CLI</span>
          </div>
        </template>
        <!-- OpenRouter models -->
        <div v-if="filteredModels.length" class="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">OpenRouter</div>
        <div
          v-for="model in filteredModels"
          :key="model"
          @click="selectModel(model)"
          class="px-3 py-2 text-sm cursor-pointer transition-colors"
          :class="model === modelValue ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'"
        >
          {{ model.split('/').pop() }}
          <span class="text-xs text-text-muted ml-1">{{ model.split('/')[0] }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { CLI_MODELS, isCliModel } from '../../services/claudeStream.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  models: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const filter = ref('')
const filterInput = ref(null)
const wrapper = ref(null)

const popularModels = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4',
  'openai/gpt-4o',
  'openai/o1',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-pro-preview',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct'
]

const displayName = computed(() => {
  if (!props.modelValue) return 'Select model'
  if (isCliModel(props.modelValue)) {
    const cli = CLI_MODELS.find(m => m.id === props.modelValue)
    return cli?.name || props.modelValue.split(':').pop() + ' (CLI)'
  }
  return props.modelValue.split('/').pop()
})

const filteredCliModels = computed(() => {
  const ids = CLI_MODELS.map(m => m.id)
  if (!filter.value) return ids
  const q = filter.value.toLowerCase()
  return ids.filter(id => id.toLowerCase().includes(q) || CLI_MODELS.find(m => m.id === id)?.name.toLowerCase().includes(q))
})

const filteredModels = computed(() => {
  const available = props.models.length > 0
    ? props.models.map(m => typeof m === 'string' ? m : m.id)
    : popularModels

  if (!filter.value) return available.slice(0, 20)
  const q = filter.value.toLowerCase()
  return available.filter(m => m.toLowerCase().includes(q)).slice(0, 20)
})

watch(open, (val) => {
  if (val) {
    filter.value = ''
    nextTick(() => filterInput.value?.focus())
  }
})

function selectModel(model) {
  emit('update:modelValue', model)
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
