<template>
  <div class="w-[280px] bg-bg-secondary border-r border-border flex flex-col h-full">
    <!-- New chat button -->
    <div class="p-3">
      <button
        @click="$emit('new-chat')"
        class="w-full px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Chat
      </button>
    </div>

    <!-- Session list -->
    <div class="flex-1 overflow-y-auto px-2">
      <div v-if="sessions.length === 0" class="text-text-muted text-sm text-center py-8 px-4">
        No chats yet. Start a new conversation.
      </div>

      <div
        v-for="session in sessions"
        :key="session.id"
        @click="$emit('select-session', session.id)"
        @contextmenu.prevent="showContextMenu($event, session.id)"
        class="group relative px-3 py-2.5 rounded-md cursor-pointer mb-0.5 transition-colors"
        :class="session.id === activeSessionId
          ? 'bg-bg-hover text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'"
      >
        <div class="text-sm truncate">{{ session.title }}</div>
        <div class="flex items-center gap-2 mt-1">
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="phaseColor(session.phase)"
          />
          <span class="text-xs text-text-muted truncate">{{ formatModel(session.model) }}</span>
          <span class="text-xs text-text-muted ml-auto shrink-0">{{ formatTime(session.updatedAt) }}</span>
        </div>

        <!-- Delete button -->
        <button
          @click.stop="$emit('delete-session', session.id)"
          class="absolute top-2 right-2 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity p-1"
          title="Delete chat"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Export chats -->
    <div class="p-3 border-t border-border">
      <button
        @click="handleExport"
        :disabled="exporting"
        class="w-full px-3 py-1.5 text-text-muted hover:text-text-primary text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 hover:bg-bg-tertiary disabled:opacity-50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        {{ exportLabel }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: Number, default: null },
  projectPath: { type: String, default: '' }
})

defineEmits(['new-chat', 'select-session', 'delete-session'])

const { exportChats, connected } = useMCP()
const exporting = ref(false)
const exportLabel = ref('Export Chats')

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
    setTimeout(() => {
      exporting.value = false
      exportLabel.value = 'Export Chats'
    }, 3000)
  }
}

function phaseColor(phase) {
  const colors = {
    research: 'bg-blue-400',
    plan: 'bg-yellow-400',
    implement: 'bg-green-400',
    review: 'bg-orange-400',
    commit: 'bg-purple-400'
  }
  return colors[phase] || 'bg-text-muted'
}

function formatModel(model) {
  if (!model) return ''
  if (model.startsWith('claude-cli:')) {
    return model.split(':').pop() + ' (CLI)'
  }
  return model.split('/').pop()
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>
