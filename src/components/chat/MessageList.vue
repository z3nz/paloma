<template>
  <div ref="container" class="flex-1 overflow-y-auto">
    <!-- Empty state -->
    <div v-if="messages.length === 0 && !streaming" class="h-full flex items-center justify-center">
      <div class="text-center px-8">
        <p class="text-text-muted text-sm">Start a conversation. Attach files with <kbd class="bg-bg-tertiary px-1.5 py-0.5 rounded text-xs">@</kbd></p>
      </div>
    </div>

    <!-- Messages -->
    <MessageItem
      v-for="msg in messages"
      :key="msg.id"
      :message="msg"
    />

    <!-- Streaming message -->
    <div v-if="streaming" class="px-6 py-4 bg-bg-secondary/50">
      <div class="max-w-3xl mx-auto">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-medium uppercase tracking-wider text-success">Assistant</span>
        </div>
        <div
          class="message-content text-sm text-text-primary"
          :class="{ 'streaming-cursor': !streamingContent }"
          v-html="streamingHtml"
        />
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="px-6 py-4">
      <div class="max-w-3xl mx-auto bg-danger/10 border border-danger/30 rounded-md px-4 py-3 text-sm text-danger">
        {{ error }}
      </div>
    </div>

    <div ref="anchor" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { marked } from 'marked'
import MessageItem from './MessageItem.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  streamingContent: { type: String, default: '' },
  error: { type: String, default: null }
})

const container = ref(null)
const anchor = ref(null)

const streamingHtml = computed(() => {
  if (!props.streamingContent) return '<span class="streaming-cursor"></span>'
  return marked.parse(props.streamingContent, { breaks: true }) + '<span class="streaming-cursor"></span>'
})

// Auto-scroll on new messages and streaming updates
watch(
  () => [props.messages.length, props.streamingContent],
  () => {
    nextTick(() => {
      anchor.value?.scrollIntoView({ behavior: 'smooth' })
    })
  }
)
</script>
