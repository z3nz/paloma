<template>
  <!-- Singularity Thinker panel — sits to the right of the main chat area -->
  <aside
    v-if="visible"
    class="flex flex-col h-full overflow-hidden shrink-0 relative border-l"
    style="border-color: var(--color-border); background: var(--color-bg-secondary);"
    :style="{ width: collapsed ? '48px' : panelWidth + 'px' }"
  >
    <!-- Resize handle — left edge drag to resize (only when expanded) -->
    <div
      v-if="!collapsed"
      class="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 transition-colors"
      style="hover:background: var(--color-accent);"
      @mousedown="startResize"
    ></div>

    <!-- ── Collapsed bar ─────────────────────────────────────────────────── -->
    <div
      v-if="collapsed"
      class="flex flex-col items-center py-3 gap-2 cursor-pointer h-full select-none"
      @click="collapsed = false"
      title="Expand Thinker panel"
    >
      <!-- Agreement status dots (vertical stack) -->
      <div class="flex flex-col gap-1.5 items-center">
        <div
          class="w-2.5 h-2.5 rounded-full transition-all"
          :class="voiceDotClass"
          title="Voice"
        ></div>
        <div
          class="w-2.5 h-2.5 rounded-full transition-all"
          :class="thinkerDotClass"
          title="Thinker"
        ></div>
      </div>
      <!-- Vertical "THINKER" label -->
      <span
        class="text-[10px] font-mono tracking-widest"
        style="color: var(--color-text-muted); writing-mode: vertical-rl; transform: rotate(180deg);"
      >
        THINKER
      </span>
    </div>

    <!-- ── Expanded panel ────────────────────────────────────────────────── -->
    <template v-else>
      <!-- Header -->
      <div
        class="flex items-center justify-between px-4 py-3 shrink-0 border-b"
        style="border-color: var(--color-border);"
      >
        <div class="flex items-center gap-2">
          <!-- Agreement dots: Voice (left) + Thinker (right) -->
          <div class="flex items-center gap-1.5" title="Voice / Thinker agreement status">
            <div class="w-2 h-2 rounded-full transition-all" :class="voiceDotClass" title="Voice"></div>
            <div class="w-2 h-2 rounded-full transition-all" :class="thinkerDotClass" title="Thinker"></div>
          </div>
          <h2 class="text-sm font-semibold" style="color: var(--color-text-primary);">Thinker</h2>
          <!-- Agreement badge — shown when both are ready -->
          <span
            v-if="isComplete"
            class="text-xs font-mono px-1.5 py-0.5 rounded"
            style="color: var(--color-success); background: color-mix(in srgb, var(--color-success) 15%, transparent);"
          >
            AGREED
          </span>
        </div>
        <button
          @click="collapsed = true"
          class="p-1 rounded transition-colors"
          style="color: var(--color-text-muted);"
          title="Collapse"
        >
          <!-- Chevron right (collapse) -->
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <!-- Tool calls section -->
      <div
        v-if="thinkerToolCalls.length > 0"
        class="shrink-0 border-b"
        style="border-color: var(--color-border); max-height: 240px; overflow-y: auto;"
      >
        <div class="px-3 py-2">
          <!-- Section header with collapse toggle -->
          <button
            class="flex items-center gap-1.5 w-full text-left"
            @click="toolsExpanded = !toolsExpanded"
          >
            <svg
              class="w-3 h-3 transition-transform shrink-0"
              :class="{ 'rotate-90': toolsExpanded }"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style="color: var(--color-text-muted);"
            >
              <polyline points="9 6 15 12 9 18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="text-xs font-mono" style="color: var(--color-text-muted);">
              TOOLS ({{ thinkerToolCalls.length }})
            </span>
          </button>

          <!-- Individual tool call cards -->
          <div v-if="toolsExpanded" class="mt-2 flex flex-col gap-1">
            <div
              v-for="call in thinkerToolCalls"
              :key="call.id"
              class="rounded text-xs overflow-hidden"
              style="background: var(--color-bg-tertiary, var(--color-bg-primary)); border: 1px solid var(--color-border);"
            >
              <!-- Card header row -->
              <button
                class="flex items-center gap-2 w-full px-2 py-1.5 text-left"
                @click="toggleToolCall(call.id)"
              >
                <!-- Status icon -->
                <span class="shrink-0">
                  <svg v-if="call.status === 'running'" class="w-3 h-3 animate-spin" style="color: var(--color-accent);" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="12"/>
                  </svg>
                  <svg v-else class="w-3 h-3" style="color: var(--color-success);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
                <!-- Tool name (short, strip server prefix) -->
                <span class="font-mono truncate" style="color: var(--color-text-primary);">
                  {{ shortToolName(call.name) }}
                </span>
                <!-- Input preview -->
                <span class="truncate opacity-60 flex-1" style="color: var(--color-text-secondary);">
                  {{ inputPreview(call.input) }}
                </span>
                <!-- Expand chevron -->
                <svg
                  v-if="call.result"
                  class="w-3 h-3 shrink-0 transition-transform"
                  :class="{ 'rotate-90': expandedToolCalls.has(call.id) }"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  style="color: var(--color-text-muted);"
                >
                  <polyline points="9 6 15 12 9 18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <!-- Expanded result -->
              <div
                v-if="expandedToolCalls.has(call.id) && call.result"
                class="px-2 pb-2 border-t"
                style="border-color: var(--color-border);"
              >
                <pre class="text-xs overflow-x-auto whitespace-pre-wrap break-words mt-1.5 leading-relaxed" style="color: var(--color-text-secondary);">{{ truncateResult(call.result) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Stream content — auto-scrolling monospace area -->
      <div
        ref="contentEl"
        class="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
        style="color: var(--color-text-secondary);"
      >
        <div v-if="thinkerContent" class="whitespace-pre-wrap break-words">{{ thinkerContent }}</div>
        <div
          v-else
          class="italic text-sm"
          style="color: var(--color-text-muted);"
        >
          Waiting for Thinker to begin exploring...
        </div>
        <!-- Auto-scroll anchor -->
        <div ref="scrollAnchor"></div>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { ref, computed, watch, nextTick, reactive } from 'vue'

// ── Props ───────────────────────────────────────────────────────────────────

const props = defineProps({
  /** Accumulated thinker stream text */
  thinkerContent: { type: String, default: '' },
  /** Array of thinker tool calls: { id, name, input, status, result } */
  thinkerToolCalls: { type: Array, default: () => [] },
  /** True when the Voice session has emitted <ready/> */
  voiceReady: { type: Boolean, default: false },
  /** True when the Thinker session has emitted <ready/> */
  thinkerReady: { type: Boolean, default: false },
  /** True when both Voice and Thinker are ready */
  isComplete: { type: Boolean, default: false },
  /** Whether to render the panel at all */
  visible: { type: Boolean, default: false }
})

// ── Emits ───────────────────────────────────────────────────────────────────

const emit = defineEmits(['collapse', 'expand', 'resize'])

// ── Local state ─────────────────────────────────────────────────────────────

const collapsed = ref(false)
const panelWidth = ref(380)            // Default 380px, resizable 200–600px
const contentEl = ref(null)
const scrollAnchor = ref(null)
const toolsExpanded = ref(true)        // Tool calls section expanded by default
const expandedToolCalls = reactive(new Set()) // IDs of expanded tool call cards

// ── Computed agreement dot classes ──────────────────────────────────────────

const voiceDotClass = computed(() => {
  if (props.voiceReady) return 'bg-green-500 shadow-sm'
  if (props.visible) return 'bg-blue-400 animate-pulse'
  return 'bg-gray-500'
})

const thinkerDotClass = computed(() => {
  if (props.thinkerReady) return 'bg-green-500 shadow-sm'
  if (props.visible) return 'bg-blue-400 animate-pulse'
  return 'bg-gray-500'
})

// ── Auto-scroll on new content ───────────────────────────────────────────────

watch(() => props.thinkerContent, async () => {
  await nextTick()
  scrollAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
})

// ── Collapse / expand with emits ─────────────────────────────────────────────

watch(collapsed, (val) => {
  if (val) emit('collapse')
  else emit('expand')
})

// ── Tool call helpers ────────────────────────────────────────────────────────

function toggleToolCall(id) {
  if (expandedToolCalls.has(id)) {
    expandedToolCalls.delete(id)
  } else {
    expandedToolCalls.add(id)
  }
}

/** Strip MCP server prefix (e.g. "mcp__paloma__filesystem__read_text_file" → "read_text_file") */
function shortToolName(name) {
  if (!name) return 'unknown'
  const parts = name.split('__')
  return parts[parts.length - 1] || name
}

/** Generate a concise preview of tool input */
function inputPreview(input) {
  if (!input || typeof input !== 'object') return ''
  const firstVal = Object.values(input)[0]
  if (typeof firstVal === 'string') {
    return firstVal.length > 40 ? firstVal.slice(0, 40) + '…' : firstVal
  }
  return JSON.stringify(input).slice(0, 40)
}

/** Truncate long tool results for display */
function truncateResult(result) {
  if (!result) return ''
  const max = 500
  if (result.length <= max) return result
  return result.slice(0, max) + '\n… [truncated]'
}

// ── Resize logic ─────────────────────────────────────────────────────────────

let resizing = false

function startResize(e) {
  resizing = true
  const startX = e.clientX
  const startWidth = panelWidth.value

  function onMove(e) {
    if (!resizing) return
    // Dragging left increases width (panel is on the right)
    const delta = startX - e.clientX
    const newWidth = Math.max(200, Math.min(600, startWidth + delta))
    panelWidth.value = newWidth
    emit('resize', newWidth)
  }

  function onUp() {
    resizing = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>
