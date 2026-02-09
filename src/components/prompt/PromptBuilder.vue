<template>
  <div class="border-t border-border bg-bg-secondary px-4 py-3 relative">
    <!-- File search dropdown -->
    <FileSearch
      ref="fileSearchRef"
      :visible="showFileSearch"
      :results="fileSearchResults"
      :query="fileSearchQuery"
      @select="onFileSelect"
      @close="closeFileSearch"
    />

    <!-- Attached files -->
    <div v-if="attachedFiles.length > 0" class="flex flex-wrap gap-1.5 mb-2">
      <FileChip
        v-for="(file, i) in attachedFiles"
        :key="file.path"
        :file="file"
        @remove="attachedFiles.splice(i, 1)"
      />
    </div>

    <!-- Textarea -->
    <div class="relative">
      <textarea
        ref="textareaRef"
        v-model="input"
        @input="onInput"
        @keydown="onKeydown"
        placeholder="Message Paloma... (@ to attach files, Ctrl+Enter to send)"
        class="prompt-textarea w-full bg-bg-primary border border-border rounded-lg px-4 py-3 pr-12 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
        rows="1"
      />
      <!-- Send / Stop button -->
      <button
        v-if="streaming"
        @click="$emit('stop')"
        class="absolute right-3 bottom-3 p-1.5 bg-danger/20 text-danger rounded-md hover:bg-danger/30 transition-colors"
        title="Stop"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="1"/>
        </svg>
      </button>
      <button
        v-else
        @click="send"
        :disabled="!canSend"
        class="absolute right-3 bottom-3 p-1.5 rounded-md transition-colors"
        :class="canSend
          ? 'bg-accent text-white hover:bg-accent-hover'
          : 'bg-bg-tertiary text-text-muted cursor-not-allowed'"
        title="Send (Ctrl+Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

    <!-- Controls row -->
    <div class="flex items-center justify-between mt-2">
      <div class="flex items-center gap-3">
        <ModelSelector
          :model-value="currentModel"
          :models="models"
          @update:model-value="onModelChange"
        />
        <PhaseSelector
          :model-value="currentPhase"
          @update:model-value="onPhaseChange"
        />
      </div>
      <div class="text-xs text-text-muted">
        <span v-if="modelsError" class="text-warning" title="Using cached/fallback model list">Models: offline</span>
        <span v-else-if="indexing">Indexing files...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import FileSearch from './FileSearch.vue'
import FileChip from './FileChip.vue'
import ModelSelector from './ModelSelector.vue'
import PhaseSelector from './PhaseSelector.vue'
import { useFileIndex } from '../../composables/useFileIndex.js'
import { useOpenRouter } from '../../composables/useOpenRouter.js'
import db from '../../services/db.js'

const props = defineProps({
  session: { type: Object, default: null },
  streaming: { type: Boolean, default: false }
})

const emit = defineEmits(['send', 'stop', 'update-session'])

const { search, indexing } = useFileIndex()
const { models, modelsError } = useOpenRouter()

const input = ref('')
const attachedFiles = ref([])
const textareaRef = ref(null)
const fileSearchRef = ref(null)

const showFileSearch = ref(false)
const fileSearchQuery = ref('')
const fileSearchResults = ref([])

// Track @ position for replacement
let atStartIndex = -1

const currentModel = computed(() => props.session?.model || '')
const currentPhase = computed(() => props.session?.phase || 'research')
const canSend = computed(() => input.value.trim().length > 0 && !props.streaming)

// --- Draft persistence ---
let saveTimeout = null
let suppressSave = false

async function saveDraftNow(sessionId) {
  if (!sessionId) return
  try {
    const existing = await db.drafts.get(sessionId)
    await db.drafts.put({
      sessionId,
      ...existing,
      content: input.value,
      files: attachedFiles.value.map(f => ({ path: f.path, name: f.name })),
      updatedAt: Date.now()
    })
  } catch {
    // Best-effort persistence — UI continues working without storage
  }
}

function scheduleDraftSave() {
  if (suppressSave) return
  clearTimeout(saveTimeout)
  const sessionId = props.session?.id
  if (!sessionId) return
  saveTimeout = setTimeout(() => saveDraftNow(sessionId), 500)
}

watch([input, attachedFiles], scheduleDraftSave, { deep: true })

// Load draft on session switch, save outgoing draft first
watch(
  () => props.session?.id,
  async (sessionId, oldSessionId) => {
    // Save draft for outgoing session
    if (oldSessionId) {
      clearTimeout(saveTimeout)
      await saveDraftNow(oldSessionId)
    }

    // Load draft for incoming session
    suppressSave = true
    if (!sessionId) {
      input.value = ''
      attachedFiles.value = []
    } else {
      const draft = await db.drafts.get(sessionId)
      input.value = draft?.content || ''
      attachedFiles.value = draft?.files || []
    }
    await nextTick()
    suppressSave = false
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearTimeout(saveTimeout)
  // Flush on unmount
  const sessionId = props.session?.id
  if (sessionId) saveDraftNow(sessionId)
})

// Auto-grow textarea
watch(input, () => {
  nextTick(() => {
    const el = textareaRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 192) + 'px'
    }
  })
})

function onInput() {
  const el = textareaRef.value
  if (!el) return

  const cursorPos = el.selectionStart
  const textBeforeCursor = input.value.slice(0, cursorPos)

  // Check for @ trigger
  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/)
  if (atMatch) {
    atStartIndex = cursorPos - atMatch[0].length
    fileSearchQuery.value = atMatch[1]
    fileSearchResults.value = search(atMatch[1])
    showFileSearch.value = true
  } else {
    showFileSearch.value = false
    fileSearchQuery.value = ''
    atStartIndex = -1
  }
}

function onKeydown(e) {
  // Let file search handle keys first
  if (showFileSearch.value && fileSearchRef.value?.handleKeydown(e)) {
    return
  }

  // Ctrl+Enter to send
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    send()
  }
}

function onFileSelect(file) {
  // Avoid duplicates
  if (!attachedFiles.value.find(f => f.path === file.path)) {
    attachedFiles.value.push({ path: file.path, name: file.name })
  }

  // Remove @query from input
  if (atStartIndex >= 0) {
    const cursorPos = textareaRef.value?.selectionStart || input.value.length
    input.value = input.value.slice(0, atStartIndex) + input.value.slice(cursorPos)
  }

  closeFileSearch()
  textareaRef.value?.focus()
}

function closeFileSearch() {
  showFileSearch.value = false
  fileSearchQuery.value = ''
  fileSearchResults.value = []
  atStartIndex = -1
}

function send() {
  if (!canSend.value) return

  emit('send', {
    content: input.value.trim(),
    files: [...attachedFiles.value]
  })

  input.value = ''
  attachedFiles.value = []

  // Clear draft immediately (no debounce)
  clearTimeout(saveTimeout)
  const sessionId = props.session?.id
  if (sessionId) saveDraftNow(sessionId)

  nextTick(() => {
    const el = textareaRef.value
    if (el) {
      el.style.height = 'auto'
      el.focus()
    }
  })
}

function onModelChange(model) {
  emit('update-session', { model })
}

function onPhaseChange(phase) {
  emit('update-session', { phase })
}
</script>
