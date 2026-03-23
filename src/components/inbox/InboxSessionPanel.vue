<template>
  <div 
    class="ml-12 border-l-2 pl-4 py-2 my-2 transition-all"
    :style="{ borderColor: phaseColor }"
  >
    <div 
      class="flex items-center justify-between group"
      :class="{ 'cursor-pointer': session && !loading }"
      @click="session && !loading && (isExpanded = !isExpanded)"
    >
      <div class="flex items-center gap-2">
        <div 
          class="p-1.5 rounded-md"
          :style="{ backgroundColor: phaseColorMuted, color: phaseColor }"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
        </div>
        <div class="flex flex-col">
          <span class="text-[11px] font-bold text-[--color-text-primary] uppercase tracking-wider">Paloma handled this email</span>
          <span v-if="loading" class="text-[10px] text-[--color-text-muted] font-medium animate-pulse">
            Hydrating session from bridge...
          </span>
          <span v-else-if="session" class="text-[10px] text-[--color-text-muted] font-medium">
            {{ session.phase }} phase &bull; {{ messages.length }} messages
          </span>
          <span v-else class="text-[10px] text-[--color-text-muted] font-medium">
            Details unavailable (browser was offline)
          </span>
        </div>
      </div>
      <div v-if="session && !loading" class="flex items-center gap-2 text-[10px] text-[--color-text-muted] group-hover:text-[--color-text-primary] transition-colors pr-2">
        <span>{{ isExpanded ? 'Collapse' : 'Show details' }}</span>
        <svg 
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          class="transition-transform duration-200"
          :class="{ 'rotate-180': isExpanded }"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>

    <div v-if="isExpanded" class="mt-4 space-y-4">
      <!-- Tool Calls Summary -->
      <div v-if="toolCalls.length > 0" class="space-y-2">
        <h4 class="text-[10px] font-bold text-[--color-text-muted] uppercase tracking-widest">Tools Used</h4>
        <div class="flex flex-wrap gap-2">
          <div 
            v-for="(tool, idx) in toolCalls" 
            :key="idx"
            class="px-2 py-1 bg-[--color-bg-tertiary] border border-[--color-border] rounded text-[10px] font-mono text-[--color-text-secondary] flex items-center gap-1.5"
          >
            <div class="w-1.5 h-1.5 rounded-full bg-[--color-success]"></div>
            {{ tool.name || tool.toolName }}
          </div>
        </div>
      </div>

      <!-- Assistant Response -->
      <div v-if="assistantResponse" class="space-y-2 pr-4">
        <h4 class="text-[10px] font-bold text-[--color-text-muted] uppercase tracking-widest">Assistant Response</h4>
        <div class="text-xs leading-relaxed text-[--color-text-secondary] bg-[--color-bg-primary]/50 p-3 rounded-lg border border-[--color-border-light] line-clamp-6">
          {{ assistantResponse }}
        </div>
      </div>

      <!-- Link to full session -->
      <div class="pt-2">
        <button 
          @click="navigateToSession"
          class="text-[10px] font-bold text-[--color-accent] hover:text-[--color-accent-hover] transition-colors flex items-center gap-1.5 uppercase tracking-wider"
        >
          View Full Session History
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import db from '../../services/db.js'
import { useSessions } from '../../composables/useSessions.js'

const props = defineProps({
  sessionId: { type: [Number, String], default: null },
  messageId: { type: String, default: null },
  message: { type: Object, default: null }
})

const isExpanded = ref(false)
const loading = ref(false)
const session = ref(null)
const messages = ref([])

const { hydrateSessionFromBridge } = useSessions()

onMounted(async () => {
  try {
    let dbSession = null

    // Strategy 1: Look up by pillarId "email:{messageId}" (most reliable)
    if (props.messageId) {
      const pillarId = `email:${props.messageId}`
      dbSession = await db.sessions.where('pillarId').equals(pillarId).first()
    }

    // Strategy 2: If sessionId is a valid numeric IDB key, try direct lookup
    if (!dbSession && props.sessionId != null) {
      const numId = Number(props.sessionId)
      if (Number.isFinite(numId) && numId > 0) {
        dbSession = await db.sessions.get(numId)
      }
    }

    // Strategy 3: Hydrate from bridge if session not found locally
    if (!dbSession && props.sessionId && props.messageId) {
      loading.value = true
      const hydratedId = await hydrateSessionFromBridge(props.sessionId, props.messageId, props.message)
      if (hydratedId) {
        dbSession = await db.sessions.get(hydratedId)
      }
      loading.value = false
    }

    if (!dbSession) return

    session.value = dbSession
    messages.value = await db.messages.where('sessionId').equals(dbSession.id).toArray()
  } catch (err) {
    console.warn('[InboxSessionPanel] Failed to load/hydrate session:', err.message)
    loading.value = false
  }
})

const toolCalls = computed(() => {
  // toolActivity = hydrated sessions, tool_calls/toolCalls = live sessions
  return messages.value
    .filter(m => m.role === 'assistant' && (m.toolActivity || m.tool_calls || m.toolCalls))
    .flatMap(m => m.toolActivity || m.tool_calls || m.toolCalls)
})

const assistantResponse = computed(() => {
  const lastAssistant = [...messages.value]
    .reverse()
    .find(m => m.role === 'assistant' && m.content)
  return lastAssistant?.content || ''
})

const phaseColor = computed(() => {
  if (!session.value) return 'var(--color-accent)'
  switch (session.value.phase) {
    case 'flow': return '#22d3ee' // cyan
    case 'scout': return '#a855f7' // purple
    case 'chart': return '#f59e0b' // amber
    case 'forge': return '#10b981' // emerald
    case 'polish': return '#3b82f6' // blue
    case 'ship': return '#ef4444' // red
    default: return 'var(--color-accent)'
  }
})

const phaseColorMuted = computed(() => {
  return phaseColor.value + '22' // 13% opacity
})

function navigateToSession() {
  if (!session.value?.id) return
  window.dispatchEvent(new CustomEvent('paloma:select-session', { detail: session.value.id }))
}
</script>
