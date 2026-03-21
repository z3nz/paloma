<template>
  <div v-if="activities.length" class="tool-call-group">
    <!-- Header / collapsed summary -->
    <button
      class="tool-call-group__header"
      @click="expanded = !expanded; userToggled = true"
    >
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"
        class="tool-call-group__chevron"
        :class="{ 'tool-call-group__chevron--open': expanded }"
      >
        <polyline points="9 6 15 12 9 18"/>
      </svg>

      <!-- Status dot + icon -->
      <span class="flex items-center gap-1">
        <span
          class="tool-call-group__dot"
          :class="runningCount > 0 ? 'tool-call-group__dot--running' : errorCount > 0 ? 'tool-call-group__dot--error' : 'tool-call-group__dot--done'"
        />
        <span v-if="runningCount > 0" class="text-[10px] text-accent" aria-label="Running">...</span>
        <span v-else-if="errorCount > 0" class="text-[10px] text-error" aria-label="Error">×</span>
        <span v-else class="text-[10px] text-success" aria-label="Done">✓</span>
      </span>

      <!-- Summary text -->
      <span class="tool-call-group__summary">
        <span class="tool-call-group__count">{{ activities.length }}</span>
        tool{{ activities.length !== 1 ? 's' : '' }}
        <template v-if="runningCount > 0">
          <span class="tool-call-group__running-badge">{{ runningCount }} running</span>
        </template>
        <template v-else>
          <span class="tool-call-group__total-time" v-if="totalDuration">in {{ formatDuration(totalDuration) }}</span>
        </template>
      </span>

      <!-- Server breakdown pills -->
      <span class="tool-call-group__servers">
        <span
          v-for="server in serverBreakdown"
          :key="server.name"
          class="tool-call-group__server-pill"
          :style="{ background: server.color.bg, color: server.color.text, borderColor: server.color.border }"
        >
          {{ server.name }} {{ server.count > 1 ? `×${server.count}` : '' }}
        </span>
      </span>
    </button>

    <!-- Expanded tool list -->
    <div v-if="expanded" class="tool-call-group__items">
      <ToolCallItem
        v-for="activity in activities"
        :key="activity.id"
        :activity="activity"
        :tool-message="getToolMessage(activity)"
        :live="live"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import ToolCallItem from './ToolCallItem.vue'
import { parseToolName, getServerColor, formatDuration } from '../../utils/toolClassifier.js'

const props = defineProps({
  activities: { type: Array, default: () => [] },
  toolMessages: { type: Array, default: () => [] },  // role:'tool' messages for this group
  live: { type: Boolean, default: false }             // true during streaming
})

const expanded = ref(false)
const userToggled = ref(false)  // Track if user manually toggled — respect their choice

// When not live (persisted message), all tools are definitionally complete —
// the message wouldn't exist if the turn was still in progress.
// This also handles legacy data where status was frozen as 'running'.
const runningCount = computed(() => {
  if (!props.live) return 0
  return props.activities.filter(a => a.status === 'running').length
})

const errorCount = computed(() => {
  return props.activities.filter(a => a.status === 'error').length
})

const totalDuration = computed(() => {
  const durations = props.activities.map(a => a.duration || 0)
  const total = durations.reduce((sum, d) => sum + d, 0)
  return total > 0 ? total : null
})

// Auto-expand when tools start running (live mode) — but only if user hasn't manually toggled
watch(runningCount, (count, prev) => {
  if (props.live && count > 0 && prev === 0 && !userToggled.value) expanded.value = true
})

// Server breakdown for the summary pills
const serverBreakdown = computed(() => {
  const counts = new Map()
  for (const a of props.activities) {
    const { server } = parseToolName(a.name)
    const name = server || 'built-in'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({
    name,
    count,
    color: getServerColor(name)
  }))
})

/**
 * Match a tool activity to its corresponding tool message.
 * Strategy: match by tool call ID if available, otherwise by position order.
 */
function getToolMessage(activity) {
  // Direct ID match — activityId stored on tool message matches activity.id
  const byActivityId = props.toolMessages.find(m => m.activityId === activity.id)
  if (byActivityId) return byActivityId

  // Legacy: toolCallId may equal activity.id (CLI path)
  const byCallId = props.toolMessages.find(m => m.toolCallId === activity.id)
  if (byCallId) return byCallId

  // Fallback: match by tool name + position
  const actIdx = props.activities.indexOf(activity)
  const sameName = props.toolMessages.filter(m => m.toolName === activity.name)
  if (sameName.length === 1) return sameName[0]

  // Last resort: positional match
  return props.toolMessages[actIdx] || null
}


</script>
