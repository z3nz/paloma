<template>
  <div class="flex flex-col h-full">
    <MessageList
      :messages="messages"
      :streaming="streaming"
      :streaming-content="streamingContent"
      :error="error"
      @apply-code="handleApplyCode"
    />
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
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import MessageList from './MessageList.vue'
import PromptBuilder from '../prompt/PromptBuilder.vue'
import DiffPreview from './DiffPreview.vue'
import { useChat } from '../../composables/useChat.js'
import { useSettings } from '../../composables/useSettings.js'
import { useProject } from '../../composables/useProject.js'
import { readFileSafe, requestWritePermission, writeFile } from '../../services/filesystem.js'

const props = defineProps({
  session: { type: Object, default: null }
})

const emit = defineEmits(['update-session'])

const { messages, streaming, streamingContent, error, loadMessages, sendMessage, stopStreaming } = useChat()
const { apiKey } = useSettings()
const { dirHandle, projectInstructions } = useProject()

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
    projectInstructions.value
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
  pendingEdit.value = { path, code, originalContent }
  showDiff.value = true
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
</script>
