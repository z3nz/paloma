<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="$emit('close')">
    <div class="bg-bg-primary border border-border rounded-xl shadow-2xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary">
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium text-text-primary">System Prompt</span>
          <span v-if="promptData" class="text-xs text-text-muted">
            {{ promptData.role }} / {{ promptData.pillar }} — {{ formatTokens(promptData.approxTokens) }} tokens
          </span>
        </div>
        <div class="flex items-center gap-2">
          <!-- Role selector -->
          <select
            v-model="selectedRole"
            @change="fetchPrompt"
            class="bg-bg-primary border border-border rounded px-2 py-1 text-xs text-text-primary"
          >
            <option value="paestro">67 Paestro</option>
            <option value="accordion-head">Angel Head</option>
            <option value="accordion-worker">Worker</option>
            <option value="hydra-planner">Hydra Planner</option>
          </select>
          <!-- Copy button -->
          <button @click="copyPrompt" class="px-2 py-1 text-xs bg-bg-tertiary text-text-secondary rounded hover:text-text-primary transition-colors">
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
          <!-- Save to file button -->
          <button @click="saveToFile" class="px-2 py-1 text-xs bg-bg-tertiary text-text-secondary rounded hover:text-text-primary transition-colors">
            Save .md
          </button>
          <!-- Close -->
          <button @click="$emit('close')" class="p-1 text-text-muted hover:text-text-primary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto">
        <div v-if="loading" class="flex items-center justify-center h-full text-text-muted text-sm">
          Loading prompt...
        </div>
        <div v-else-if="error" class="flex items-center justify-center h-full text-error text-sm">
          {{ error }}
        </div>
        <pre v-else class="p-4 text-xs text-text-primary font-mono leading-relaxed whitespace-pre-wrap break-words">{{ promptData?.prompt || 'No prompt loaded' }}</pre>
      </div>

      <!-- Footer -->
      <div v-if="promptData" class="px-4 py-2 border-t border-border bg-bg-secondary text-xs text-text-muted flex items-center justify-between">
        <span>{{ promptData.length?.toLocaleString() }} chars / ~{{ formatTokens(promptData.approxTokens) }} tokens</span>
        <span>Role: {{ promptData.role }} | Pillar: {{ promptData.pillar }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  visible: { type: Boolean, default: false }
})

defineEmits(['close'])

const { getSystemPrompt, callMcpTool } = useMCP()

const selectedRole = ref('paestro')
const promptData = ref(null)
const loading = ref(false)
const error = ref(null)
const copied = ref(false)

async function fetchPrompt() {
  loading.value = true
  error.value = null
  try {
    const result = await getSystemPrompt(selectedRole.value, 'flow')
    promptData.value = result
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function copyPrompt() {
  if (promptData.value?.prompt) {
    navigator.clipboard.writeText(promptData.value.prompt)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}

async function saveToFile() {
  if (!promptData.value?.prompt) return
  try {
    const filename = `.paloma/docs/paestro-system-prompt-${selectedRole.value}.md`
    const content = `# System Prompt — ${selectedRole.value}\n\n> Generated: ${new Date().toISOString()}\n> Length: ${promptData.value.length} chars (~${promptData.value.approxTokens} tokens)\n\n---\n\n${promptData.value.prompt}`
    await callMcpTool('mcp__paloma__filesystem__write_file', { path: filename, content })
  } catch { /* best effort */ }
}

function formatTokens(count) {
  if (!count) return '0'
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k'
  return count.toString()
}

// Fetch on open
watch(() => props.visible, (v) => {
  if (v) fetchPrompt()
})
</script>
