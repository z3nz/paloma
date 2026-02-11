<template>
  <div v-if="activities.length" class="px-6 py-2">
    <div class="max-w-3xl mx-auto">
      <!-- Collapsed summary -->
      <button
        @click="expanded = !expanded"
        class="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors w-full text-left"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" class="shrink-0 transition-transform"
          :class="expanded ? 'rotate-90' : ''"
        >
          <polyline points="9 6 15 12 9 18"/>
        </svg>
        <span v-if="runningCount > 0" class="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0"/>
        <span v-else class="w-2 h-2 rounded-full bg-success shrink-0"/>
        <span class="font-mono">
          {{ activities.length }} tool{{ activities.length !== 1 ? 's' : '' }}
          {{ runningCount > 0 ? `(${runningCount} running)` : 'used' }}
        </span>
      </button>

      <!-- Expanded list -->
      <div v-if="expanded" class="mt-1 ml-4 space-y-1">
        <div
          v-for="(activity, i) in activities"
          :key="i"
          class="flex items-center gap-2 text-xs text-text-muted"
        >
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="activity.status === 'running'
              ? 'bg-accent animate-pulse'
              : 'bg-success'"
          />
          <span class="font-mono">{{ formatActivity(activity) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  activities: { type: Array, default: () => [] }
})

const expanded = ref(false)

const runningCount = computed(() =>
  props.activities.filter(a => a.status === 'running').length
)

// Auto-expand when new tools start running, collapse when all done
watch(runningCount, (count, prev) => {
  if (count > 0 && prev === 0) expanded.value = true
})

function formatActivity(activity) {
  const name = activity.name || ''
  const args = activity.args || {}

  // Handle MCP/proxy tool names: "server__tool_name" or "mcp__server__tool"
  if (name.includes('__')) {
    const parts = name.startsWith('mcp__') ? name.split('__').slice(1) : name.split('__')
    const toolName = parts.slice(1).join('__') || parts[0]
    const argSummary = Object.entries(args)
      .filter(([, v]) => typeof v === 'string' && v.length < 80)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
    return argSummary ? `${toolName}(${argSummary})` : toolName
  }

  switch (name) {
    case 'readFile':
      return `Reading ${args.path || 'file'}`
    case 'listDirectory':
      return `Listing ${args.path || 'root directory'}`
    case 'searchFiles':
      return `Searching for "${args.query || ''}"`
    case 'fileExists':
      return `Checking ${args.path || 'file'}`
    case 'createFile':
      return `Creating ${args.path || 'file'}`
    case 'deleteFile':
      return `Deleting ${args.path || 'file'}`
    case 'moveFile':
      return `Moving ${args.fromPath || 'file'} → ${args.toPath || 'destination'}`
    default:
      return `${name}(${JSON.stringify(args)})`
  }
}
</script>
