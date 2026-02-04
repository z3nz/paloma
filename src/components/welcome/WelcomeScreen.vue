<template>
  <div class="h-full flex items-center justify-center bg-bg-primary">
    <div class="w-full max-w-md px-8">
      <!-- Logo -->
      <div class="text-center mb-10">
        <h1 class="text-3xl font-bold text-accent mb-2">Paloma</h1>
        <p class="text-text-secondary text-sm">AI-powered development workflows, locally.</p>
      </div>

      <!-- Step 1: API Key -->
      <div v-if="step === 1" class="space-y-4">
        <div>
          <label class="block text-sm text-text-secondary mb-2">OpenRouter API Key</label>
          <input
            v-model="keyInput"
            type="password"
            placeholder="sk-or-..."
            class="w-full bg-bg-secondary border border-border rounded-md px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            @keydown.enter="validateKey"
          />
          <p class="text-xs text-text-muted mt-2">
            Get your key at
            <a href="https://openrouter.ai/keys" target="_blank" class="text-accent hover:text-accent-hover underline">openrouter.ai/keys</a>
          </p>
        </div>

        <p v-if="keyError" class="text-danger text-sm">{{ keyError }}</p>

        <button
          @click="validateKey"
          :disabled="!keyInput || validating"
          class="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors text-sm"
        >
          {{ validating ? 'Validating...' : 'Continue' }}
        </button>
      </div>

      <!-- Step 2: Open Project -->
      <div v-if="step === 2" class="space-y-4 text-center">
        <p class="text-text-secondary text-sm">API key saved. Now open a project directory.</p>
        <button
          @click="pickProject"
          class="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-md transition-colors text-sm"
        >
          Open Project Folder
        </button>
        <p class="text-xs text-text-muted">
          Paloma uses the File System Access API to read files locally. Nothing is uploaded.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useSettings } from '../../composables/useSettings.js'
import { useOpenRouter } from '../../composables/useOpenRouter.js'

const emit = defineEmits(['complete', 'open-project'])

const { apiKey } = useSettings()
const { validateApiKey } = useOpenRouter()

const step = ref(apiKey.value ? 2 : 1)
const keyInput = ref('')
const keyError = ref('')
const validating = ref(false)

async function validateKey() {
  if (!keyInput.value) return
  validating.value = true
  keyError.value = ''

  const valid = await validateApiKey(keyInput.value)
  if (valid) {
    apiKey.value = keyInput.value
    step.value = 2
  } else {
    keyError.value = 'Invalid API key. Please check and try again.'
  }
  validating.value = false
}

function pickProject() {
  emit('open-project')
}
</script>
