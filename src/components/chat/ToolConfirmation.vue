<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('deny')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('deny')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-lg mx-4 shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <div class="flex items-center gap-3">
          <span
            class="text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded"
            :class="actionBadgeClass"
          >
            {{ actionLabel }}
          </span>
          <h2 class="text-sm font-mono text-text-primary truncate">{{ primaryPath }}</h2>
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
      <div class="px-6 py-5">
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
      <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
        <button
          @click="$emit('deny')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
        >
          Deny
        </button>
        <button
          @click="$emit('allow')"
          class="px-4 py-2 text-sm text-white rounded-md transition-colors"
          :class="confirmation.toolName === 'deleteFile'
            ? 'bg-danger/90 hover:bg-danger'
            : 'bg-success/90 hover:bg-success'"
        >
          Allow
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  confirmation: { type: Object, required: true }
})

defineEmits(['allow', 'deny'])

const actionLabel = computed(() => {
  switch (props.confirmation.toolName) {
    case 'createFile': return 'Create'
    case 'deleteFile': return 'Delete'
    case 'moveFile': return 'Move'
    default: return 'Write'
  }
})

const actionBadgeClass = computed(() => {
  switch (props.confirmation.toolName) {
    case 'createFile': return 'bg-success/20 text-success'
    case 'deleteFile': return 'bg-danger/20 text-danger'
    case 'moveFile': return 'bg-warning/20 text-warning'
    default: return 'bg-accent-muted text-accent-hover'
  }
})

const primaryPath = computed(() => {
  const args = props.confirmation.args
  return args.path || args.fromPath || ''
})

const description = computed(() => {
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
