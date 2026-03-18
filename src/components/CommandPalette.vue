<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div ref="paletteRef" class="relative w-full max-w-lg bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden">
      <!-- Search input -->
      <div class="flex items-center border-b border-border px-4 py-3">
        <svg class="w-4 h-4 text-text-muted mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Search sessions, actions..."
          class="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder-text-muted"
          @keydown="handleKeydown"
        />
        <kbd class="ml-2 text-[10px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded border border-border">esc</kbd>
      </div>

      <!-- Results -->
      <div class="max-h-72 overflow-y-auto py-1">
        <!-- Actions section -->
        <template v-if="filteredActions.length > 0">
          <div class="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Actions</div>
          <button
            v-for="(action, i) in filteredActions"
            :key="'action-' + i"
            :class="[
              'w-full flex items-center px-4 py-2 text-sm text-left transition-colors',
              selectedIndex === i ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-primary'
            ]"
            @click="executeAction(action)"
            @mouseenter="selectedIndex = i"
          >
            <span class="w-5 h-5 mr-3 flex items-center justify-center text-xs">{{ action.icon }}</span>
            <span>{{ action.label }}</span>
            <kbd v-if="action.shortcut" class="ml-auto text-[10px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded border border-border">{{ action.shortcut }}</kbd>
          </button>
        </template>

        <!-- Sessions section -->
        <template v-if="filteredSessions.length > 0">
          <div class="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Sessions</div>
          <button
            v-for="(session, i) in filteredSessions"
            :key="'session-' + session.id"
            :class="[
              'w-full flex items-center px-4 py-2 text-sm text-left transition-colors',
              selectedIndex === (filteredActions.length + i) ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-primary'
            ]"
            @click="selectSession(session)"
            @mouseenter="selectedIndex = filteredActions.length + i"
          >
            <span :class="['w-5 h-5 mr-3 flex items-center justify-center text-xs rounded', phaseColor(session.phase)]">
              {{ phaseIcon(session.phase) }}
            </span>
            <span class="truncate flex-1">{{ session.title || 'Untitled' }}</span>
            <span class="ml-2 text-[10px] text-text-muted shrink-0">{{ timeAgo(session.updatedAt || session.createdAt) }}</span>
          </button>
        </template>

        <!-- Empty state -->
        <div v-if="filteredActions.length === 0 && filteredSessions.length === 0" class="px-4 py-8 text-center text-text-muted text-sm">
          No results for "{{ query }}"
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useSessions } from '../composables/useSessions.js'

const emit = defineEmits(['close', 'select-session', 'new-chat', 'open-settings'])

const inputRef = ref(null)
const paletteRef = ref(null)
const query = ref('')
const selectedIndex = ref(0)

const { sessions } = useSessions()

// Actions
const actions = [
  { label: 'New Chat', icon: '+', shortcut: 'Ctrl+N', action: 'new-chat' },
  { label: 'Settings', icon: '\u2699', action: 'settings' }
]

const filteredActions = computed(() => {
  if (!query.value) return actions
  const q = query.value.toLowerCase()
  return actions.filter(a => a.label.toLowerCase().includes(q))
})

const filteredSessions = computed(() => {
  const sorted = [...sessions.value].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  if (!query.value) return sorted.slice(0, 15)
  const q = query.value.toLowerCase()
  return sorted.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.phase || '').toLowerCase().includes(q)
  ).slice(0, 15)
})

const totalItems = computed(() => filteredActions.value.length + filteredSessions.value.length)

// Reset selection when query changes
watch(query, () => { selectedIndex.value = 0 })

function handleKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % totalItems.value
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + totalItems.value) % totalItems.value
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const idx = selectedIndex.value
    if (idx < filteredActions.value.length) {
      executeAction(filteredActions.value[idx])
    } else {
      const sessionIdx = idx - filteredActions.value.length
      if (filteredSessions.value[sessionIdx]) {
        selectSession(filteredSessions.value[sessionIdx])
      }
    }
  }
}

function executeAction(action) {
  emit(action.action)
  emit('close')
}

function selectSession(session) {
  emit('select-session', session.id)
  emit('close')
}

function phaseIcon(phase) {
  const icons = { flow: '\u25CE', scout: '\u25C8', chart: '\u25A3', forge: '\u2726', polish: '\u25C7', ship: '\u2690' }
  return icons[phase] || '\u25CB'
}

function phaseColor(phase) {
  const colors = {
    flow: 'text-blue-400', scout: 'text-green-400', chart: 'text-yellow-400',
    forge: 'text-orange-400', polish: 'text-purple-400', ship: 'text-cyan-400'
  }
  return colors[phase] || 'text-text-muted'
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})
</script>
