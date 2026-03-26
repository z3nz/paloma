<template>
  <aside class="bg-bg-secondary flex flex-col h-full shrink-0" :style="{ width: width + 'px' }" aria-label="Chat sidebar">
    <!-- View Tabs -->
    <div class="flex border-b border-border">
      <button 
        @click="$emit('switch-view', 'chat')"
        class="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-colors"
        :class="activeView === 'chat' ? 'text-accent border-b-2 border-accent bg-bg-primary/30' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        Chats
      </button>
      <button 
        @click="$emit('switch-view', 'inbox')"
        class="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-colors relative"
        :class="activeView === 'inbox' ? 'text-accent border-b-2 border-accent bg-bg-primary/30' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
          <polyline points="22,6 12,13 2,6"></polyline>
        </svg>
        Inbox
        <span v-if="unreadCount > 0" class="absolute top-2 right-4 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] text-white">
          {{ unreadCount }}
        </span>
      </button>
      <button 
        @click="$emit('switch-view', 'files')"
        class="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-colors"
        :class="activeView === 'files' ? 'text-accent border-b-2 border-accent bg-bg-primary/30' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Files
      </button>
    </div>

    <!-- Project indicator + New chat -->
    <div v-if="activeView === 'chat'" class="p-3 space-y-2">
      <div v-if="projectPath && projectPath !== 'paloma'" class="flex items-center gap-2 px-2 py-1.5 bg-bg-primary/50 rounded-md">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent shrink-0">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="text-xs text-text-secondary truncate">{{ projectPath }}</span>
      </div>
      <button
        @click="$emit('new-chat')"
        class="w-full px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2"
        aria-label="Start a new chat"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Chat
      </button>
    </div>

    <!-- Session tree -->
    <div v-if="activeView === 'chat'" class="flex-1 overflow-y-auto px-2">
      <SidebarSessionTree
        :session-tree="sessionTree"
        :active-session-id="activeSessionId"
        :pillar-statuses="pillarStatuses"
        @select-session="id => $emit('select-session', id)"
        @delete-session="id => $emit('delete-session', id)"
      />
    </div>

    <!-- Inbox mini-list placeholder or simple switcher logic -->
    <div v-else-if="activeView === 'inbox'" class="flex-1 flex flex-col items-center justify-center p-6 text-center text-text-muted">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-20">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
        <polyline points="22,6 12,13 2,6"></polyline>
      </svg>
      <p class="text-sm">Switching to Inbox view...</p>
      <button 
        @click="$emit('switch-view', 'chat')"
        class="mt-4 text-xs font-medium text-accent hover:underline"
        aria-label="Back to chat list"
      >
        Back to Chats
      </button>
    </div>

    <!-- Export chats -->
    <div class="p-3 border-t border-border">
      <button
        @click="handleExport"
        :disabled="exporting"
        class="w-full px-3 py-1.5 text-text-muted hover:text-text-primary text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 hover:bg-bg-tertiary disabled:opacity-50"
        aria-label="Export all chats"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        {{ exportLabel }}
      </button>
    </div>
  </aside>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { useMCP } from '../../composables/useMCP.js'
import { useSessions } from '../../composables/useSessions.js'
import { useInbox } from '../../composables/useInbox.js'
import SidebarSessionTree from './SidebarSessionTree.vue'

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: Number, default: null },
  projectPath: { type: String, default: '' },
  width: { type: Number, default: 280 },
  activeView: { type: String, default: 'chat' }
})

defineEmits(['new-chat', 'select-session', 'delete-session', 'switch-view'])

const { exportChats, connected, pillarStatuses } = useMCP()
const { sessionTree } = useSessions()
const { unreadCount } = useInbox()
const exporting = ref(false)
const exportLabel = ref('Export Chats')
let _exportTimer = null
onBeforeUnmount(() => { if (_exportTimer) clearTimeout(_exportTimer) })

async function handleExport() {
  if (!props.projectPath || !connected.value) return
  exporting.value = true
  exportLabel.value = 'Exporting...'
  try {
    const result = await exportChats(props.projectPath)
    exportLabel.value = `Exported ${result.count} chats`
  } catch (e) {
    exportLabel.value = 'Export failed'
    console.error('[Export]', e)
  } finally {
    if (_exportTimer) clearTimeout(_exportTimer)
    _exportTimer = setTimeout(() => {
      exporting.value = false
      exportLabel.value = 'Export Chats'
      _exportTimer = null
    }, 3000)
  }
}
</script>
