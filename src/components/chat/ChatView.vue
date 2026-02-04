<template>
  <div class="flex flex-col h-full">
    <MessageList
      :messages="messages"
      :streaming="streaming"
      :streaming-content="streamingContent"
      :tool-activity="toolActivity"
      :error="error"
      @apply-code="handleApplyCode"
    />
    <div v-if="contextWarning" class="px-4 py-2 bg-warning/10 border-t border-warning/30 text-sm text-warning text-center">
      {{ contextWarning }}
    </div>
    <PromptBuilder
      :session="session"
      :streaming="streaming"
      @send="handleSend"
      @stop="stopStreaming"
      @update-session="handleUpdateSession"
    />

    <DiffPreview
      v-if="showDiff"
      :file-path="pendingEdit.path"
      :original-content="pendingEdit.originalContent"
      :new-content="pendingEdit.code"
      :error="editError"
      @apply="handleConfirmEdit"
      @cancel="handleCancelEdit"
    />

    <ToolConfirmation
      v-if="pendingToolConfirmation"
      :confirmation="pendingToolConfirmation"
      @allow="handleToolAllow"
      @deny="handleToolDeny"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import MessageList from './MessageList.vue'
import PromptBuilder from '../prompt/PromptBuilder.vue'
import DiffPreview from './DiffPreview.vue'
import ToolConfirmation from './ToolConfirmation.vue'
import { useChat } from '../../composables/useChat.js'
import { useSettings } from '../../composables/useSettings.js'
import { useProject } from '../../composables/useProject.js'
import { useFileIndex } from '../../composables/useFileIndex.js'
import { readFileSafe, requestWritePermission, writeFile } from '../../services/filesystem.js'
import { resolveEdit } from '../../services/editing.js'
import { executeWriteTool } from '../../services/tools.js'

const props = defineProps({
  session: { type: Object, default: null }
})

const emit = defineEmits(['update-session'])

const {
  messages, streaming, streamingContent, toolActivity, error,
  pendingToolConfirmation, contextWarning, loadMessages, sendMessage, stopStreaming,
  resolveToolConfirmation, rejectToolConfirmation
} = useChat()
const { apiKey } = useSettings()
const { dirHandle, projectInstructions } = useProject()
const { search: searchFiles, buildIndex } = useFileIndex()

const showDiff = ref(false)
const pendingEdit = ref({ path: '', code: '', originalContent: null })
const editError = ref(null)

watch(
  () => props.session?.id,
  (id) => { loadMessages(id) },
  { immediate: true }
)

async function handleSend({ content, files }) {
  if (!props.session || !content.trim()) return

  const title = await sendMessage(
    props.session.id,
    content,
    files,
    apiKey.value,
    props.session.model,
    dirHandle.value,
    props.session.phase,
    projectInstructions.value,
    searchFiles
  )

  if (title) {
    emit('update-session', props.session.id, { title })
  }
}

function handleUpdateSession(updates) {
  emit('update-session', props.session.id, updates)
}

async function handleApplyCode({ path, code }) {
  editError.value = null
  const originalContent = dirHandle.value
    ? await readFileSafe(dirHandle.value, path)
    : null
  try {
    const { newContent } = resolveEdit(code, originalContent)
    pendingEdit.value = { path, code: newContent, originalContent }
    showDiff.value = true
  } catch (err) {
    editError.value = err.message
    pendingEdit.value = { path, code: '', originalContent }
    showDiff.value = true
  }
}

async function handleConfirmEdit() {
  if (!dirHandle.value) {
    editError.value = 'No project directory open.'
    return
  }
  try {
    const granted = await requestWritePermission(dirHandle.value)
    if (!granted) {
      editError.value = 'Write permission denied. Please grant access and try again.'
      return
    }
    await writeFile(dirHandle.value, pendingEdit.value.path, pendingEdit.value.code)
    showDiff.value = false
    pendingEdit.value = { path: '', code: '', originalContent: null }
    editError.value = null
  } catch (err) {
    editError.value = `Failed to write file: ${err.message}`
  }
}

function handleCancelEdit() {
  showDiff.value = false
  pendingEdit.value = { path: '', code: '', originalContent: null }
  editError.value = null
}

async function handleToolAllow() {
  if (!pendingToolConfirmation.value || !dirHandle.value) return
  const { toolName, args } = pendingToolConfirmation.value
  try {
    const result = await executeWriteTool(toolName, args, dirHandle.value)
    resolveToolConfirmation(result)
    // Refresh file index after write operations
    await buildIndex(dirHandle.value)
  } catch (err) {
    resolveToolConfirmation(JSON.stringify({ error: err.message }))
  }
}

function handleToolDeny() {
  rejectToolConfirmation('User denied')
}
</script>
