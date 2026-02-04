<template>
  <aside
    class="bg-bg-secondary border-l border-border flex flex-col h-full overflow-hidden shrink-0 relative"
    :style="{ width: panelWidth + 'px' }"
  >
    <!-- Resize handle -->
    <div
      class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 z-10 transition-colors"
      @mousedown="startResize"
    ></div>

    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <h2 class="text-sm font-semibold text-text-primary">
        Changes ({{ pendingChanges.length }} {{ pendingChanges.length === 1 ? 'file' : 'files' }})
      </h2>
      <button
        @click="$emit('dismiss-all')"
        class="text-xs text-text-muted hover:text-text-primary transition-colors"
      >
        Dismiss All
      </button>
    </div>

    <!-- File list -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-for="(change, index) in pendingChanges"
        :key="change.path"
        class="border-b border-border-light"
      >
        <!-- File header row -->
        <button
          class="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-bg-hover/50 transition-colors"
          @click="toggleExpand(index)"
        >
          <!-- Status dot -->
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="{
              'bg-accent': change.status === 'pending',
              'bg-success': change.status === 'applied',
              'bg-danger': change.status === 'error'
            }"
          ></span>

          <!-- File name -->
          <span class="text-sm text-text-primary truncate flex-1 font-mono">
            {{ fileName(change.path) }}
          </span>

          <!-- Status or stats -->
          <span v-if="change.status === 'applied'" class="text-xs text-success shrink-0">Applied</span>
          <span v-else-if="change.status === 'error'" class="text-xs text-danger shrink-0">Error</span>
          <span v-else class="text-xs text-text-muted shrink-0">
            <span class="text-success">+{{ getStats(change).additions }}</span>
            <span class="mx-0.5">/</span>
            <span class="text-danger">-{{ getStats(change).removals }}</span>
          </span>

          <!-- Chevron -->
          <svg
            class="w-3.5 h-3.5 text-text-muted shrink-0 transition-transform"
            :class="{ 'rotate-90': expanded.has(index) }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <!-- Expanded content -->
        <div v-if="expanded.has(index)" class="px-4 pb-3">
          <!-- Full path -->
          <p class="text-xs text-text-muted font-mono mb-2">{{ change.path }}</p>

          <!-- Error message -->
          <div v-if="change.error" class="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-xs text-danger mb-2">
            {{ change.error }}
          </div>

          <!-- Diff table -->
          <div v-if="change.newContent !== null" class="overflow-x-auto rounded border border-border max-h-64 overflow-y-auto mb-2">
            <table class="diff-table">
              <tbody>
                <tr
                  v-for="(line, i) in getDiffLines(change)"
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

          <!-- Per-file actions -->
          <div class="flex justify-end gap-2">
            <!-- View full diff button (always available if there's content) -->
            <button
              v-if="change.newContent !== null"
              @click="$emit('view-diff', index)"
              class="px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary rounded hover:bg-bg-hover transition-colors"
              title="Open full diff in modal"
            >
              <svg class="w-3.5 h-3.5 inline -mt-0.5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
              </svg>
              Full Diff
            </button>
            <template v-if="change.status === 'pending'">
              <button
                @click="$emit('dismiss-change', index)"
                class="px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary rounded hover:bg-bg-hover transition-colors"
              >
                Dismiss
              </button>
              <button
                @click="$emit('apply-change', index)"
                class="px-2.5 py-1 text-xs rounded bg-success/90 hover:bg-success text-white transition-colors"
              >
                Apply
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div v-if="hasPendingChanges" class="px-4 py-3 border-t border-border shrink-0">
      <button
        @click="$emit('apply-all')"
        class="w-full px-3 py-2 text-sm rounded-md bg-success/90 hover:bg-success text-white transition-colors"
      >
        Apply All ({{ pendingCount }})
      </button>
    </div>
  </aside>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { diffLines as computeDiff } from 'diff'

defineProps({
  pendingChanges: { type: Array, required: true },
  hasPendingChanges: { type: Boolean, required: true },
  pendingCount: { type: Number, required: true }
})

defineEmits(['apply-change', 'apply-all', 'dismiss-change', 'dismiss-all', 'view-diff'])

const expanded = ref(new Set([0]))
const panelWidth = ref(320)
const MIN_WIDTH = 240
const MAX_WIDTH = 800

let resizing = false

function startResize(e) {
  e.preventDefault()
  resizing = true
  const startX = e.clientX
  const startWidth = panelWidth.value

  function onMouseMove(e) {
    if (!resizing) return
    // Dragging left increases width, dragging right decreases
    const delta = startX - e.clientX
    panelWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
  }

  function onMouseUp() {
    resizing = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

onBeforeUnmount(() => {
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

function toggleExpand(index) {
  const next = new Set(expanded.value)
  if (next.has(index)) {
    next.delete(index)
  } else {
    next.add(index)
  }
  expanded.value = next
}

function fileName(path) {
  return path.split('/').pop()
}

function getDiffLines(change) {
  const original = change.originalContent ?? ''
  const updated = change.newContent ?? ''
  const changes = computeDiff(original, updated)
  const lines = []
  let oldNum = 1
  let newNum = 1

  for (const c of changes) {
    const cLines = c.value.replace(/\n$/, '').split('\n')
    for (const text of cLines) {
      if (c.added) {
        lines.push({ type: 'add', marker: '+', oldNum: null, newNum: newNum++, text })
      } else if (c.removed) {
        lines.push({ type: 'remove', marker: '-', oldNum: oldNum++, newNum: null, text })
      } else {
        lines.push({ type: 'context', marker: ' ', oldNum: oldNum++, newNum: newNum++, text })
      }
    }
  }

  return lines
}

function getStats(change) {
  if (change.newContent === null) return { additions: 0, removals: 0 }
  const lines = getDiffLines(change)
  let additions = 0
  let removals = 0
  for (const line of lines) {
    if (line.type === 'add') additions++
    else if (line.type === 'remove') removals++
  }
  return { additions, removals }
}
</script>
