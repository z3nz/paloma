<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('cancel')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('cancel')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-3xl mx-4 shadow-2xl flex flex-col max-h-[90vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <h2 class="text-sm font-mono text-text-primary truncate">{{ filePath }}</h2>
          <span
            class="text-xs font-medium px-2 py-0.5 rounded shrink-0"
            :class="isNewFile
              ? 'bg-success/20 text-success'
              : 'bg-accent-muted text-accent-hover'"
          >
            {{ isNewFile ? 'New File' : 'Modified' }}
          </span>
          <span class="text-xs text-text-muted shrink-0">
            <span class="text-success">+{{ stats.additions }}</span>
            <span class="mx-1">/</span>
            <span class="text-danger">-{{ stats.removals }}</span>
          </span>
        </div>
        <button
          @click="$emit('cancel')"
          class="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors shrink-0 ml-3"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="overflow-y-auto flex-1 max-h-[80vh]">
        <table class="diff-table">
          <tbody>
            <tr
              v-for="(line, i) in diffLines"
              :key="i"
              :class="{
                'diff-line-add': line.type === 'add',
                'diff-line-remove': line.type === 'remove'
              }"
            >
              <td class="diff-line-number">{{ line.oldNum ?? '' }}</td>
              <td class="diff-line-number">{{ line.newNum ?? '' }}</td>
              <td class="diff-line-marker">{{ line.marker }}</td>
              <td>{{ line.text }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Error banner -->
      <div v-if="error" class="px-6 py-3 border-t border-border shrink-0">
        <div class="bg-danger/10 border border-danger/30 rounded-md px-4 py-2 text-sm text-danger">
          {{ error }}
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
        <button
          @click="$emit('cancel')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
        <button
          @click="$emit('apply')"
          :disabled="!!error"
          class="px-4 py-2 text-sm rounded-md transition-colors"
          :class="error
            ? 'bg-text-muted/20 text-text-muted cursor-not-allowed'
            : 'bg-success/90 hover:bg-success text-white'"
        >
          Apply Changes
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { diffLines as computeDiff } from 'diff'

const props = defineProps({
  filePath: { type: String, required: true },
  originalContent: { type: String, default: null },
  newContent: { type: String, required: true },
  error: { type: String, default: null }
})

const emit = defineEmits(['apply', 'cancel'])

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  } else if (e.key === 'Enter' && !props.error) {
    e.preventDefault()
    emit('apply')
  }
}

onMounted(() => document.addEventListener('keydown', handleKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeyDown))

const isNewFile = computed(() => props.originalContent === null)

const diffLines = computed(() => {
  const original = props.originalContent ?? ''
  let changes
  try {
    changes = computeDiff(original, props.newContent)
  } catch {
    // Diff computation can fail on very large files
    return [{ type: 'context', marker: ' ', oldNum: 1, newNum: 1, text: '(diff too large to display)' }]
  }
  const lines = []
  let oldNum = 1
  let newNum = 1

  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, '').split('\n')
    for (const text of changeLines) {
      if (change.added) {
        lines.push({ type: 'add', marker: '+', oldNum: null, newNum: newNum++, text })
      } else if (change.removed) {
        lines.push({ type: 'remove', marker: '-', oldNum: oldNum++, newNum: null, text })
      } else {
        lines.push({ type: 'context', marker: ' ', oldNum: oldNum++, newNum: newNum++, text })
      }
    }
  }

  return lines
})

const stats = computed(() => {
  let additions = 0
  let removals = 0
  for (const line of diffLines.value) {
    if (line.type === 'add') additions++
    else if (line.type === 'remove') removals++
  }
  return { additions, removals }
})
</script>
