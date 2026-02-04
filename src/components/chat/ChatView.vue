<template>
  <div class="flex flex-col h-full">
    <MessageList
      :messages="messages"
      :streaming="streaming"
      :streaming-content="streamingContent"
      :error="error"
    />
    <PromptBuilder
      :session="session"
      :streaming="streaming"
      @send="handleSend"
      @stop="stopStreaming"
      @update-session="handleUpdateSession"
    />
  </div>
</template>

<script setup>
import { watch } from 'vue'
import MessageList from './MessageList.vue'
import PromptBuilder from '../prompt/PromptBuilder.vue'
import { useChat } from '../../composables/useChat.js'
import { useSettings } from '../../composables/useSettings.js'
import { useProject } from '../../composables/useProject.js'

const props = defineProps({
  session: { type: Object, default: null }
})

const emit = defineEmits(['update-session'])

const { messages, streaming, streamingContent, error, loadMessages, sendMessage, stopStreaming } = useChat()
const { apiKey } = useSettings()
const { dirHandle } = useProject()

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
    props.session.phase
  )

  if (title) {
    emit('update-session', props.session.id, { title })
  }
}

function handleUpdateSession(updates) {
  emit('update-session', props.session.id, updates)
}
</script>
