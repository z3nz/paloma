<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-lg mx-4 shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 class="text-lg font-semibold text-text-primary">Settings</h2>
        <button
          @click="$emit('close')"
          class="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 py-5 space-y-5">
        <!-- API Key -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">OpenRouter API Key</label>
          <div class="flex gap-2">
            <input
              v-model="localKey"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk-or-..."
              class="flex-1 bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
            />
            <button
              @click="showKey = !showKey"
              class="px-3 py-2 bg-bg-primary border border-border rounded-md text-text-secondary hover:text-text-primary text-sm transition-colors"
            >
              {{ showKey ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>

        <!-- Default Model -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">Default Model</label>
          <select
            v-model="localModel"
            class="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option v-for="m in popularModels" :key="m" :value="m">
              {{ m.split('/').pop() }}
            </option>
          </select>
        </div>

        <!-- Project info -->
        <div v-if="projectName">
          <label class="block text-sm text-text-secondary mb-1.5">Current Project</label>
          <div class="text-sm text-text-primary bg-bg-primary border border-border rounded-md px-3 py-2">
            {{ projectName }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
        <button
          @click="$emit('close')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
        <button
          @click="save"
          class="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSettings } from '../../composables/useSettings.js'

const props = defineProps({
  projectName: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const { apiKey, defaultModel } = useSettings()

const localKey = ref(apiKey.value)
const localModel = ref(defaultModel.value)
const showKey = ref(false)

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

function save() {
  apiKey.value = localKey.value
  defaultModel.value = localModel.value
  emit('close')
}
</script>
