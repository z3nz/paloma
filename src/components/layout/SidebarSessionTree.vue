<template>
  <div>
    <div v-if="sessionTree.length === 0" class="text-text-muted text-sm text-center py-8 px-4">
      No chats yet. Start a new conversation.
    </div>

    <div v-for="parent in sessionTree" :key="parent.id">
      <!-- Parent row -->
      <div
        @click="$emit('select-session', parent.id)"
        class="group relative px-3 py-2.5 rounded-md cursor-pointer mb-0.5 transition-colors"
        :class="isParentHighlighted(parent)
          ? 'bg-bg-hover text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'"
      >
        <div class="text-sm truncate flex items-center gap-1.5">
          <!-- Chevron for parents with children -->
          <button
            v-if="parent.children.length > 0"
            @click.stop="toggleCollapse(parent.id)"
            class="shrink-0 w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
              class="transition-transform duration-200"
              :class="collapsed.has(parent.id) ? '' : 'rotate-90'"
            >
              <path d="M8 5l10 7-10 7z"/>
            </svg>
          </button>
          <!-- Phase badge for orphaned pillar sessions at top-level -->
          <span v-if="parent.pillarId"
            class="inline-flex items-center px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded"
            :class="pillarBadgeColor(parent.phase)"
          >{{ phaseIcon(parent.phase) }}</span>
          <span class="truncate">{{ parent.title }}</span>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <span v-if="isStreaming(parent.id) && parent.phase === 'flow' && flowProcessingCallback"
            class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0"
            title="Processing callback..."
          />
          <span v-else-if="isStreaming(parent.id)"
            class="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0"
            title="Streaming..."
          />
          <span v-else-if="hasToolActivity(parent.id)"
            class="w-2 h-2 rounded-full bg-purple-400 animate-pulse shrink-0"
            title="Running tools..."
          />
          <span v-else
            class="w-2 h-2 rounded-full shrink-0"
            :class="phaseColor(parent.phase)"
          />
          <span class="text-xs text-text-muted truncate">{{ formatModel(parent.model) }}</span>
          <span v-if="parent.children.length > 0" class="text-[10px] text-text-muted whitespace-nowrap">
            {{ parent.children.length }} pillar{{ parent.children.length !== 1 ? 's' : '' }}
          </span>
          <span class="text-xs text-text-muted ml-auto shrink-0">{{ formatTime(parent.updatedAt) }}</span>
        </div>

        <!-- Delete button -->
        <button
          @click.stop="$emit('delete-session', parent.id)"
          class="absolute top-2 right-2 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity p-1"
          title="Delete chat"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Children (pillar sessions) -->
      <div v-if="parent.children.length > 0 && !collapsed.has(parent.id)" class="pillar-tree-children">
        <div
          v-for="(child, index) in parent.children"
          :key="child.id"
          @click="$emit('select-session', child.id)"
          class="group relative pillar-tree-child cursor-pointer mb-0.5 transition-colors rounded-r-md"
          :class="[
            child.id === activeSessionId
              ? 'bg-bg-hover text-text-primary'
              : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
            index === parent.children.length - 1 ? 'pillar-tree-child--last' : ''
          ]"
          :style="{ '--connector-color': phaseColorValue(child.phase) }"
        >
          <div class="px-3 py-1.5">
            <div class="text-xs truncate flex items-center gap-1.5">
              <span
                class="inline-flex items-center px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded shrink-0"
                :class="pillarBadgeColor(child.phase)"
              >{{ phaseIcon(child.phase) }}</span>
              <span class="truncate">{{ childTitle(child) }}</span>
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <!-- Pillar status indicator -->
              <span v-if="getPillarStatus(child) === 'streaming'"
                class="pillar-status-spinner shrink-0"
                :style="{ borderTopColor: phaseColorValue(child.phase) }"
                title="Streaming..."
              />
              <span v-else-if="getPillarStatus(child) === 'running'"
                class="w-2 h-2 rounded-full animate-pulse shrink-0"
                :style="{ backgroundColor: phaseColorValue(child.phase) }"
                title="Running..."
              />
              <span v-else-if="getPillarStatus(child) === 'error'"
                class="text-danger shrink-0" title="Error"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </span>
              <span v-else-if="getPillarStatus(child) === 'stopped'"
                class="text-text-muted shrink-0" title="Stopped"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>
              </span>
              <span v-else
                class="w-1.5 h-1.5 rounded-full bg-text-muted/50 shrink-0"
                title="Idle"
              />
              <span class="text-[10px] text-text-muted truncate">{{ formatModel(child.model) }}</span>
              <span class="text-[10px] text-text-muted ml-auto shrink-0">{{ formatTime(child.updatedAt) }}</span>
            </div>
          </div>

          <!-- Delete button -->
          <button
            @click.stop="$emit('delete-session', child.id)"
            class="absolute top-1.5 right-1.5 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
            title="Delete chat"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
import { useMCP } from '../../composables/useMCP.js'
import { useSessionState } from '../../composables/useSessionState.js'

const props = defineProps({
  sessionTree: { type: Array, default: () => [] },
  activeSessionId: { type: Number, default: null },
  pillarStatuses: { type: Map, default: () => new Map() }
})

defineEmits(['select-session', 'delete-session'])

const { flowProcessingCallback } = useMCP()
const { isStreaming, hasToolActivity } = useSessionState()

// Collapse state — persisted to localStorage
const COLLAPSED_KEY = 'paloma:sidebarCollapsed'
let _savedCollapsed = []
try { _savedCollapsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]') } catch { /* corrupted */ }
const collapsed = reactive(new Set(_savedCollapsed))

function toggleCollapse(sessionId) {
  if (collapsed.has(sessionId)) {
    collapsed.delete(sessionId)
  } else {
    collapsed.add(sessionId)
  }
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
}

function isParentHighlighted(parent) {
  if (parent.id === props.activeSessionId) return true
  return parent.children.some(c => c.id === props.activeSessionId)
}

function getPillarStatus(child) {
  if (child.pillarId && props.pillarStatuses.has(child.pillarId)) {
    return props.pillarStatuses.get(child.pillarId)
  }
  if (isStreaming(child.id)) return 'streaming'
  if (hasToolActivity(child.id)) return 'running'
  return child.pillarStatus || 'idle'
}

function childTitle(child) {
  return child.title.replace(' (spawned)', '')
}

function phaseColor(phase) {
  const colors = {
    flow: 'bg-blue-400',
    scout: 'bg-cyan-400',
    chart: 'bg-yellow-400',
    forge: 'bg-orange-400',
    polish: 'bg-pink-400',
    ship: 'bg-green-400'
  }
  return colors[phase] || 'bg-text-muted'
}

function phaseColorValue(phase) {
  const colors = {
    scout: '#22d3ee',
    chart: '#facc15',
    forge: '#fb923c',
    polish: '#f472b6',
    ship: '#4ade80',
    flow: '#60a5fa'
  }
  return colors[phase] || '#6e7681'
}

function pillarBadgeColor(phase) {
  const colors = {
    scout: 'bg-cyan-500/20 text-cyan-400',
    chart: 'bg-yellow-500/20 text-yellow-400',
    forge: 'bg-orange-500/20 text-orange-400',
    polish: 'bg-pink-500/20 text-pink-400',
    ship: 'bg-green-500/20 text-green-400'
  }
  return colors[phase] || 'bg-blue-500/20 text-blue-400'
}

function phaseIcon(phase) {
  const icons = {
    scout: 'S',
    chart: 'C',
    forge: 'F',
    polish: 'P',
    ship: '\u2192'
  }
  return icons[phase] || '\u2699'
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
