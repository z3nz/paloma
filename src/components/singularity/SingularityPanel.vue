<template>
  <aside
    v-if="visible"
    class="relative flex h-full shrink-0 overflow-hidden border-l border-border bg-bg-secondary transition-[width] duration-200 ease-out"
    :style="{ width: collapsed ? '48px' : `${panelWidth}px` }"
  >
    <!-- Dragging the left edge resizes the panel without disturbing the chat column. -->
    <div
      v-if="!collapsed"
      class="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-accent/40 active:bg-accent/60"
      @mousedown.prevent="startResize"
    ></div>

    <!-- The collapsed rail keeps the Thinker visible even when the panel is tucked away. -->
    <button
      v-if="collapsed"
      type="button"
      class="flex h-full w-full flex-col items-center gap-3 py-3 text-text-muted transition-colors hover:text-text-primary"
      @click="expandPanel"
    >
      <span class="mt-1 h-2.5 w-2.5 rounded-full" :class="collapsedDotClass"></span>
      <span
        class="text-[10px] font-mono tracking-[0.35em]"
        style="writing-mode: vertical-rl; transform: rotate(180deg);"
      >
        THINKER
      </span>
    </button>

    <!-- The expanded view combines readiness, tools, and the live stream in one place. -->
    <template v-else>
      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-full" :class="voiceDotClass" title="Voice"></span>
                <span class="h-2.5 w-2.5 rounded-full" :class="thinkerDotClass" title="Thinker"></span>
              </div>
              <h2 class="text-sm font-semibold text-text-primary">Dual Mind</h2>
              <span
                v-if="isComplete"
                class="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.25em] text-success"
              >
                Complete
              </span>
            </div>
            <p class="mt-1 text-[11px] uppercase tracking-[0.2em] text-text-muted">{{ statusLabel }}</p>
          </div>

          <button
            type="button"
            class="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            title="Collapse Thinker panel"
            @click="collapsePanel"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </header>

        <!-- Tool calls stay in their own section so the stream remains readable. -->
        <section class="border-b border-border/70">
          <button
            type="button"
            class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bg-hover/60"
            @click="toolSectionOpen = !toolSectionOpen"
          >
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.2em] text-text-primary">Tool Calls</div>
              <p class="mt-1 text-xs text-text-muted">
                {{ normalizedToolCalls.length }}
                {{ normalizedToolCalls.length === 1 ? 'call' : 'calls' }}
                tracked
              </p>
            </div>

            <svg
              class="h-4 w-4 text-text-muted transition-transform"
              :class="{ 'rotate-90': toolSectionOpen }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div v-if="toolSectionOpen" class="max-h-56 overflow-y-auto px-3 pb-3">
            <div v-if="normalizedToolCalls.length" class="space-y-2">
              <article
                v-for="tool in normalizedToolCalls"
                :key="tool.id"
                class="overflow-hidden rounded-lg border border-border bg-bg-primary/70"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-hover/50"
                  @click="toggleToolCard(tool.id)"
                >
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="toolStatusDotClass(tool)"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-mono text-xs text-text-primary">{{ tool.name }}</span>
                    <span class="block text-[11px] text-text-muted">{{ toolStatusLabel(tool) }}</span>
                  </span>
                  <svg
                    class="h-4 w-4 shrink-0 text-text-muted transition-transform"
                    :class="{ 'rotate-90': isToolCardOpen(tool.id) }"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <div v-if="isToolCardOpen(tool.id)" class="space-y-3 border-t border-border/60 px-3 py-3">
                  <div>
                    <div class="mb-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">Input</div>
                    <pre class="overflow-x-auto rounded-md bg-bg-secondary px-3 py-2 text-xs text-text-secondary">{{ formatPayload(tool.input) }}</pre>
                  </div>

                  <div v-if="tool.output">
                    <div class="mb-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">Output</div>
                    <pre class="max-h-40 overflow-auto rounded-md bg-bg-secondary px-3 py-2 text-xs text-text-secondary">{{ tool.output }}</pre>
                  </div>
                </div>
              </article>
            </div>

            <p v-else class="px-1 pb-1 text-sm italic text-text-muted">
              Tool calls will appear here as the Thinker explores.
            </p>
          </div>
        </section>

        <!-- The stream stays monospace and auto-scrolls so the newest reasoning is always visible. -->
        <div class="flex-1 overflow-y-auto px-4 py-4 font-mono text-sm leading-relaxed text-text-secondary">
          <div v-if="thinkerContent" class="whitespace-pre-wrap break-words">{{ thinkerContent }}</div>
          <div v-else class="italic text-text-muted">Waiting for Thinker to begin exploring...</div>
          <div ref="scrollAnchor"></div>
        </div>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({
  thinkerContent: { type: String, default: '' },
  thinkerToolCalls: { type: Array, default: () => [] },
  voiceReady: { type: Boolean, default: false },
  thinkerReady: { type: Boolean, default: false },
  isComplete: { type: Boolean, default: false },
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['collapse', 'expand', 'resize'])

const collapsed = ref(false)
const panelWidth = ref(380)
const toolSectionOpen = ref(true)
const openToolCards = ref({})
const scrollAnchor = ref(null)

function stringifyValue(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeToolCall(toolCall, index) {
  const output = stringifyValue(toolCall.output ?? toolCall.result ?? '')
  const isError = Boolean(toolCall.isError || toolCall.status === 'error')

  return {
    id: toolCall.id || `tool-${index}`,
    name: toolCall.name || 'tool',
    input: toolCall.input ?? toolCall.args ?? {},
    output,
    status: toolCall.status || (isError ? 'error' : output ? 'done' : 'running'),
    isError
  }
}

const normalizedToolCalls = computed(() => props.thinkerToolCalls.map(normalizeToolCall))

const voiceDotClass = computed(() => {
  if (!props.visible) return 'bg-text-muted/50'
  if (props.voiceReady) return 'bg-success shadow-sm'
  return 'bg-accent animate-pulse'
})

const thinkerDotClass = computed(() => {
  if (!props.visible) return 'bg-text-muted/50'
  if (props.thinkerReady) return 'bg-success shadow-sm'
  return 'bg-accent animate-pulse'
})

const collapsedDotClass = computed(() => {
  if (props.isComplete) return 'bg-success shadow-sm'
  if (props.visible) return 'bg-accent animate-pulse'
  return 'bg-text-muted/50'
})

const statusLabel = computed(() => {
  if (props.isComplete) return 'Agreement reached'
  if (props.voiceReady && props.thinkerReady) return 'Agreement reached'
  if (props.thinkerReady) return 'Thinker ready'
  if (props.voiceReady) return 'Voice ready'
  return 'Thinking'
})

watch(
  () => props.visible,
  async (visible, previousVisible) => {
    if (!visible) return

    if (!previousVisible || collapsed.value) {
      collapsed.value = false
      emit('expand')
    }

    await nextTick()
    scrollToBottom()
  },
  { immediate: true }
)

watch(
  () => props.thinkerContent,
  async () => {
    await nextTick()
    scrollToBottom()
  }
)

watch(
  normalizedToolCalls,
  (toolCalls) => {
    for (const toolCall of toolCalls) {
      if (toolCall.status === 'running' && openToolCards.value[toolCall.id] == null) {
        openToolCards.value[toolCall.id] = true
      }
    }
  },
  { immediate: true }
)

function scrollToBottom() {
  scrollAnchor.value?.scrollIntoView({ behavior: 'auto', block: 'end' })
}

function expandPanel() {
  collapsed.value = false
  emit('expand')
  nextTick(() => scrollToBottom())
}

function collapsePanel() {
  collapsed.value = true
  emit('collapse')
}

function isToolCardOpen(toolId) {
  return Boolean(openToolCards.value[toolId])
}

function toggleToolCard(toolId) {
  openToolCards.value[toolId] = !openToolCards.value[toolId]
}

function formatPayload(payload) {
  return stringifyValue(payload || {})
}

function toolStatusLabel(toolCall) {
  if (toolCall.isError) return 'Error'
  if (toolCall.status === 'done') return 'Complete'
  return 'Running'
}

function toolStatusDotClass(toolCall) {
  if (toolCall.isError) return 'bg-danger'
  if (toolCall.status === 'done') return 'bg-success'
  return 'bg-accent animate-pulse'
}

let removeResizeListeners = null

function cleanupResizeListeners() {
  if (!removeResizeListeners) return
  removeResizeListeners()
  removeResizeListeners = null
}

function startResize(event) {
  if (collapsed.value) return

  const startX = event.clientX
  const startWidth = panelWidth.value

  const onMove = (moveEvent) => {
    const nextWidth = Math.max(200, Math.min(600, startWidth + (startX - moveEvent.clientX)))
    if (nextWidth === panelWidth.value) return
    panelWidth.value = nextWidth
    emit('resize', nextWidth)
  }

  const onUp = () => cleanupResizeListeners()

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  removeResizeListeners = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
}

onBeforeUnmount(() => cleanupResizeListeners())
</script>
