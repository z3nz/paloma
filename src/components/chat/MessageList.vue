<template>
  <div ref="container" class="flex-1 overflow-y-auto">
    <!-- Empty state -->
    <div v-if="messages.length === 0 && !streaming" class="h-full flex items-center justify-center">
      <div class="text-center px-8">
        <p class="text-text-muted text-sm">Start a conversation. Attach files with <kbd class="bg-bg-tertiary px-1.5 py-0.5 rounded text-xs">@</kbd></p>
      </div>
    </div>

    <!-- Load earlier messages button -->
    <div v-if="hasHiddenMessages" class="px-6 py-3 text-center border-b border-border-light">
      <button
        @click="showAll = true"
        class="text-xs text-accent hover:text-accent/80 transition-colors"
      >
        Load {{ messages.length - VISIBLE_LIMIT }} earlier messages
      </button>
    </div>

    <!-- Messages -->
    <MessageItem
      v-for="msg in visibleMessages"
      :key="msg.id"
      :message="msg"
      @apply-code="payload => $emit('apply-code', payload)"
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
          v-html="streamingHtmlThrottled"
        />
      </div>
    </div>

    <!-- Tool activity -->
    <ToolActivity v-if="toolActivity.length" :activities="toolActivity" />

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
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { marked } from 'marked'
import MessageItem from './MessageItem.vue'
import ToolActivity from './ToolActivity.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  streamingContent: { type: String, default: '' },
  toolActivity: { type: Array, default: () => [] },
  error: { type: String, default: null }
})

defineEmits(['apply-code'])

const container = ref(null)
const anchor = ref(null)
const isNearBottom = ref(true)

// --- Lazy message rendering ---
const VISIBLE_LIMIT = 30
const showAll = ref(false)

const hasHiddenMessages = computed(() =>
  !showAll.value && props.messages.length > VISIBLE_LIMIT
)

const visibleMessages = computed(() => {
  if (showAll.value || props.messages.length <= VISIBLE_LIMIT) return props.messages
  return props.messages.slice(-VISIBLE_LIMIT)
})

// --- Scroll position ---
const SCROLL_KEY = 'paloma:scrollTop'

function checkScrollPosition() {
  if (!container.value) return
  const { scrollTop, scrollHeight, clientHeight } = container.value
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < 100
  sessionStorage.setItem(SCROLL_KEY, String(scrollTop))
}

onMounted(() => {
  container.value?.addEventListener('scroll', checkScrollPosition, { passive: true })
  // Restore saved scroll position
  const saved = sessionStorage.getItem(SCROLL_KEY)
  if (saved != null && container.value) {
    nextTick(() => {
      container.value.scrollTop = Number(saved)
    })
  }
})

onBeforeUnmount(() => {
  container.value?.removeEventListener('scroll', checkScrollPosition)
})

function scrollToBottom(behavior = 'smooth') {
  nextTick(() => {
    anchor.value?.scrollIntoView({ behavior })
  })
}

// --- Throttled streaming HTML ---
const streamingHtmlThrottled = ref('<span class="streaming-cursor"></span>')
let throttleTimer = null

watch(
  () => props.streamingContent,
  (content) => {
    if (!content) {
      streamingHtmlThrottled.value = '<span class="streaming-cursor"></span>'
      return
    }
    if (throttleTimer) return
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      streamingHtmlThrottled.value = marked.parse(props.streamingContent, { breaks: true }) + '<span class="streaming-cursor"></span>'
    }, 150)
  }
)

// Flush on stream end to ensure final content is rendered
watch(
  () => props.streaming,
  (val) => {
    if (!val && props.streamingContent) {
      if (throttleTimer) {
        clearTimeout(throttleTimer)
        throttleTimer = null
      }
      streamingHtmlThrottled.value = marked.parse(props.streamingContent, { breaks: true }) + '<span class="streaming-cursor"></span>'
    }
  }
)

// Reset showAll on session switch (bulk load)
watch(
  () => props.messages.length,
  (newLen, oldLen) => {
    if (oldLen === 0 && newLen > 0) {
      showAll.value = false
      scrollToBottom('instant')
      isNearBottom.value = true
      return
    }
    if (newLen > oldLen && isNearBottom.value) {
      scrollToBottom()
    }
  }
)

// Scroll during streaming only if user is near bottom
watch(
  () => props.streamingContent,
  () => {
    if (isNearBottom.value) {
      scrollToBottom()
    }
  }
)
</script>
