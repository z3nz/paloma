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

    <!-- Messages (tool messages consumed by their parent assistant get filtered out) -->
    <MessageItem
      v-for="msg in displayMessages"
      :key="msg.id"
      :message="msg"
      :tool-messages="getToolMessagesFor(msg)"
      @apply-code="payload => $emit('apply-code', payload)"
    />

    <!-- Streaming message -->
    <div v-if="streaming" class="px-6 py-4 bg-bg-secondary/50">
      <div class="max-w-3xl mx-auto">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-medium uppercase tracking-wider text-purple-400">Paloma</span>
        </div>
        <div
          class="message-content text-sm text-text-primary"
          :class="{ 'streaming-cursor': !streamingContent }"
          v-html="streamingHtmlThrottled"
        />
      </div>
    </div>

    <!-- Live tool activity (during streaming only — persisted tools render inside MessageItem) -->
    <ToolCallGroup
      v-if="toolActivity.length && streaming"
      :activities="toolActivity"
      :tool-messages="liveToolMessages"
      :live="true"
      class="px-6 py-2"
    />

    <!-- Active pillar animations — shows running/streaming pillars scoped to this chat -->
    <div v-if="activePillars.length > 0" class="px-6 py-4">
      <div class="max-w-3xl mx-auto">
        <div class="text-xs font-medium uppercase tracking-wider text-text-muted mb-3">Active Pillars</div>
        <div class="flex flex-wrap gap-3">
          <div
            v-for="p in activePillars"
            :key="p.pillarId"
            @click="$emit('navigate-to-pillar', p.dbSessionId)"
            class="pillar-activity-card flex flex-col items-center gap-2 py-4 px-5 rounded-lg border cursor-pointer hover:brightness-125 transition"
            :style="{
              borderColor: pillarColors[p.phase] + '40',
              backgroundColor: pillarColors[p.phase] + '10',
              '--pillar-glow': pillarColors[p.phase]
            }"
          >
            <PillarLoader :pillar="p.phase" :size="48" />
            <span
              class="text-xs font-bold uppercase tracking-wider"
              :style="{ color: pillarColors[p.phase] }"
            >{{ p.phase }}</span>
            <span class="text-[10px] text-text-muted">
              {{ p.status === 'streaming' ? 'Streaming...' : 'Running...' }}
            </span>
          </div>
        </div>
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
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { marked } from 'marked'
import MessageItem from './MessageItem.vue'
import ToolCallGroup from './ToolCallGroup.vue'
import PillarLoader from '../ui/PillarLoader.vue'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  streaming: { type: Boolean, default: false },
  streamingContent: { type: String, default: '' },
  toolActivity: { type: Array, default: () => [] },
  error: { type: String, default: null },
  sessionId: { type: Number, default: null }
})

const emit = defineEmits(['apply-code', 'navigate-to-pillar'])

const { pillarStatuses, pillarPhases, pillarParents, pillarDbSessions } = useMCP()

const pillarColors = {
  flow: '#22d3ee',
  scout: '#22d3ee',
  chart: '#facc15',
  forge: '#fb923c',
  polish: '#f472b6',
  ship: '#4ade80'
}

const activePillars = computed(() => {
  const result = []
  for (const [pillarId, status] of pillarStatuses) {
    if (status === 'running' || status === 'streaming') {
      // Only show pillars belonging to the current session
      const parentId = pillarParents.get(pillarId)
      if (parentId !== props.sessionId) continue
      result.push({
        pillarId,
        phase: pillarPhases.get(pillarId) || 'flow',
        status,
        dbSessionId: pillarDbSessions.get(pillarId)
      })
    }
  }
  return result
})

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

/**
 * Build a set of tool message IDs that are "consumed" by an assistant message
 * with toolActivity — these should not render as standalone messages.
 */
const consumedToolIds = computed(() => {
  const consumed = new Set()
  const msgs = visibleMessages.value
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.role === 'assistant' && msg.toolActivity?.length) {
      // Collect tool messages AFTER this assistant message (OpenRouter path)
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].role === 'tool') {
          consumed.add(msgs[j].id)
        } else {
          break
        }
      }
      // Collect tool messages BEFORE this assistant message (CLI path:
      // tool results arrive during stream, assistant message saved at end)
      for (let j = i - 1; j >= 0; j--) {
        if (msgs[j].role === 'tool') {
          consumed.add(msgs[j].id)
        } else {
          break
        }
      }
    }
  }
  return consumed
})

/**
 * Messages to display — filters out tool messages that are consumed by ToolCallGroup.
 */
const displayMessages = computed(() => {
  // Tool messages are never rendered standalone — they're shown inside ToolCallGroup
  return visibleMessages.value.filter(msg => msg.role !== 'tool')
})

/**
 * Tool messages for the live ToolCallGroup (during streaming).
 * These are tool messages pushed to the messages array during the current turn
 * that haven't yet been claimed by a persisted assistant message.
 * They accumulate at the tail of the messages array as tools complete.
 */
const liveToolMessages = computed(() => {
  if (!props.streaming && !props.toolActivity.length) return []
  const msgs = props.messages
  const result = []
  // Walk backward from the end collecting tool messages until we hit a non-tool message
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'tool') {
      result.unshift(msgs[i])
    } else {
      break
    }
  }
  return result
})

/**
 * Get tool messages that belong to a given assistant message.
 */
function getToolMessagesFor(msg) {
  if (msg.role !== 'assistant' || !msg.toolActivity?.length) return []
  const msgs = visibleMessages.value
  const idx = msgs.indexOf(msg)
  if (idx === -1) return []

  const toolMsgs = []
  // Look forward (OpenRouter path: tool messages saved after assistant)
  for (let j = idx + 1; j < msgs.length; j++) {
    if (msgs[j].role === 'tool') {
      toolMsgs.push(msgs[j])
    } else {
      break
    }
  }
  // Look backward (CLI path: tool results saved during stream,
  // assistant message saved at end with later timestamp)
  for (let j = idx - 1; j >= 0; j--) {
    if (msgs[j].role === 'tool') {
      toolMsgs.unshift(msgs[j])  // prepend to maintain chronological order
    } else {
      break
    }
  }
  return toolMsgs
}

function checkScrollPosition() {
  if (!container.value) return
  const { scrollTop, scrollHeight, clientHeight } = container.value
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < 100
}

onMounted(() => {
  container.value?.addEventListener('scroll', checkScrollPosition, { passive: true })
})

onBeforeUnmount(() => {
  container.value?.removeEventListener('scroll', checkScrollPosition)
  if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null }
})

function scrollToBottom(behavior = 'smooth') {
  nextTick(() => {
    anchor.value?.scrollIntoView({ behavior })
  })
}

// --- Streaming markdown safety ---
function closeOpenFences(text) {
  const fencePattern = /^(`{3,})/gm
  let open = false
  let openFence = '```'
  let match
  while ((match = fencePattern.exec(text)) !== null) {
    if (!open) {
      open = true
      openFence = match[1]
    } else {
      open = false
    }
  }
  return open ? text + '\n' + openFence : text
}

// --- Throttled streaming HTML ---
const streamingHtmlThrottled = ref('<span class="streaming-cursor"></span>')
let throttleTimer = null

function renderAndScroll() {
  const safeContent = closeOpenFences(props.streamingContent)
  streamingHtmlThrottled.value = marked.parse(safeContent, { breaks: true }) + '<span class="streaming-cursor"></span>'
  if (isNearBottom.value) {
    scrollToBottom('instant')
  }
}

watch(
  () => props.streamingContent,
  (content) => {
    if (!content) {
      streamingHtmlThrottled.value = '<span class="streaming-cursor"></span>'
      return
    }
    // Render immediately on first chunk, then throttle subsequent updates
    if (!throttleTimer) {
      renderAndScroll()
      throttleTimer = setTimeout(() => { throttleTimer = null }, 80)
    }
  }
)

// Scroll when streaming starts (show blinking cursor immediately),
// and flush on stream end to ensure final content is rendered
watch(
  () => props.streaming,
  (val) => {
    if (val) {
      // Streaming just started — scroll to show the loading indicator
      if (isNearBottom.value) {
        scrollToBottom('instant')
      }
    } else if (props.streamingContent) {
      if (throttleTimer) {
        clearTimeout(throttleTimer)
        throttleTimer = null
      }
      renderAndScroll()
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

// Scroll when tool activity changes (new tools appear below streaming content)
watch(
  () => props.toolActivity.length,
  (newLen, oldLen) => {
    if (newLen > oldLen && isNearBottom.value) {
      scrollToBottom('instant')
    }
  }
)

// Scroll when active pillars appear/change
watch(
  () => activePillars.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen && isNearBottom.value) {
      scrollToBottom('instant')
    }
  }
)
</script>

<style scoped>
.pillar-activity-card {
  animation: pillar-card-glow 2.5s ease-in-out infinite;
  min-width: 100px;
}

@keyframes pillar-card-glow {
  0%, 100% { box-shadow: 0 0 4px 0 var(--pillar-glow, transparent); }
  50% { box-shadow: 0 0 16px 3px var(--pillar-glow, transparent); }
}
</style>
