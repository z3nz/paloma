<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="tool-confirm-title">
    <div class="absolute inset-0 bg-black/60"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div class="flex items-center gap-3">
          <span
            class="text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded"
            :class="actionBadgeClass"
          >
            {{ actionLabel }}
          </span>
          <h2 id="tool-confirm-title" class="text-sm font-mono text-text-primary truncate">{{ primaryPath }}</h2>
        </div>
        <button
          @click="$emit('deny')"
          class="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 py-5 overflow-y-auto min-h-0">
        <p class="text-sm text-text-secondary">{{ description }}</p>
        <div
          v-if="confirmation.toolName === 'createFile' && confirmation.args.content"
          class="mt-3 bg-bg-primary border border-border rounded-md p-3 max-h-48 overflow-y-auto"
        >
          <pre class="text-xs text-text-muted font-mono whitespace-pre-wrap">{{ truncatedContent }}</pre>
        </div>
        <div
          v-if="confirmation.toolName === 'moveFile'"
          class="mt-3 text-xs text-text-muted font-mono"
        >
          {{ confirmation.args.fromPath }} → {{ confirmation.args.toPath }}
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
        <button
          @click="$emit('deny')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors flex items-center gap-1.5"
          aria-label="Deny tool execution (N)"
        >
          Deny
          <kbd class="text-[10px] text-text-muted bg-bg-primary border border-border rounded px-1 py-0.5 font-mono">N</kbd>
        </button>
        <div class="flex items-center gap-2">
          <!-- Session/project approve for server-backed tools -->
          <div v-if="serverName" class="relative" ref="menuAnchor">
            <button
              @click="showMenu = !showMenu"
              class="px-3 py-2 text-sm text-text-muted hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors flex items-center gap-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div
              v-if="showMenu"
              class="absolute bottom-full right-0 mb-1 bg-bg-primary border border-border rounded-md shadow-lg py-1 min-w-[260px] z-10"
            >
              <!-- Per-tool options -->
              <button
                v-if="bareTool"
                @click="showMenu = false; $emit('allow-tool-session', { server: serverName, tool: bareTool })"
                class="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                Allow <span class="font-mono text-accent">{{ bareTool }}</span> for session
              </button>
              <button
                v-if="bareTool"
                @click="showMenu = false; $emit('allow-tool-always', { server: serverName, tool: bareTool })"
                class="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                Always allow <span class="font-mono text-accent">{{ bareTool }}</span>
              </button>
              <hr v-if="bareTool" class="border-border my-1" />
              <!-- Server-level options -->
              <button
                @click="showMenu = false; $emit('allow-session', serverName)"
                class="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                Allow all <span class="font-mono text-accent">{{ serverName }}</span> for session
              </button>
              <button
                @click="showMenu = false; $emit('allow-always', serverName)"
                class="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                Always allow all <span class="font-mono text-accent">{{ serverName }}</span>
              </button>
            </div>
          </div>
          <button
            @click="$emit('allow')"
            class="px-4 py-2 text-sm text-white rounded-md transition-colors"
            :class="confirmation.toolName === 'deleteFile'
              ? 'bg-danger/90 hover:bg-danger'
              : isExternalTool ? 'bg-accent/90 hover:bg-accent'
              : 'bg-success/90 hover:bg-success'"
            aria-label="Allow tool execution (Y)"
          >
            Allow
            <kbd class="text-[10px] bg-white/10 border border-white/20 rounded px-1 py-0.5 font-mono">Y</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { extractServerName, extractToolName } from '../../composables/usePermissions.js'

const props = defineProps({
  confirmation: { type: Object, required: true }
})

const emit = defineEmits(['allow', 'deny', 'allow-session', 'allow-always', 'allow-tool-session', 'allow-tool-always'])

const showMenu = ref(false)
const menuAnchor = ref(null)

// Close menu on outside click
function handleClickOutside(e) {
  if (menuAnchor.value && !menuAnchor.value.contains(e.target)) {
    showMenu.value = false
  }
}

// Keyboard shortcuts: Y to allow, N to deny
function handleKeyDown(e) {
  // Don't capture if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    emit('allow')
  } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
    e.preventDefault()
    emit('deny')
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown)
})

const isMcp = computed(() => props.confirmation.toolName.startsWith('mcp__'))
// CLI proxy tools have names like "git__git_status" (server__tool format, no mcp__ prefix)
const isProxyTool = computed(() => !isMcp.value && props.confirmation.toolName.includes('__'))
const isExternalTool = computed(() => isMcp.value || isProxyTool.value)

const serverName = computed(() => extractServerName(props.confirmation.toolName))
const bareTool = computed(() => extractToolName(props.confirmation.toolName))

const toolDisplayName = computed(() => {
  const name = props.confirmation.toolName
  if (isMcp.value) {
    const parts = name.split('__')
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  if (isProxyTool.value) {
    const parts = name.split('__')
    return `${parts[0]} / ${parts.slice(1).join('__')}`
  }
  return name
})

const actionLabel = computed(() => {
  if (isExternalTool.value) return 'MCP'
  switch (props.confirmation.toolName) {
    case 'createFile': return 'Create'
    case 'deleteFile': return 'Delete'
    case 'moveFile': return 'Move'
    default: return 'Write'
  }
})

const actionBadgeClass = computed(() => {
  if (isExternalTool.value) return 'bg-accent-muted text-accent'
  switch (props.confirmation.toolName) {
    case 'createFile': return 'bg-success/20 text-success'
    case 'deleteFile': return 'bg-danger/20 text-danger'
    case 'moveFile': return 'bg-warning/20 text-warning'
    default: return 'bg-accent-muted text-accent-hover'
  }
})

const primaryPath = computed(() => {
  if (isExternalTool.value) return toolDisplayName.value
  const args = props.confirmation.args
  return args.path || args.fromPath || ''
})

const description = computed(() => {
  if (isExternalTool.value) {
    const args = props.confirmation.args
    const argSummary = Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
    return `The assistant wants to call tool "${toolDisplayName.value}" with: ${argSummary || 'no arguments'}`
  }
  const args = props.confirmation.args
  switch (props.confirmation.toolName) {
    case 'createFile':
      return `The assistant wants to create a new file at "${args.path}".`
    case 'deleteFile':
      return `The assistant wants to delete the file at "${args.path}". This cannot be undone.`
    case 'moveFile':
      return `The assistant wants to move "${args.fromPath}" to "${args.toPath}".`
    default:
      return `The assistant wants to perform a write operation.`
  }
})

const truncatedContent = computed(() => {
  const content = props.confirmation.args.content || ''
  if (content.length > 500) {
    return content.slice(0, 500) + '\n\n[Truncated...]'
  }
  return content
})
</script>
