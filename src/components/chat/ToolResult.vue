<template>
  <div class="tool-result" :class="`tool-result--${resultType}`">
    <!-- Error -->
    <div v-if="resultType === 'error'" class="tool-result__error">
      <pre class="tool-result__pre">{{ content }}</pre>
    </div>

    <!-- Empty -->
    <div v-else-if="resultType === 'empty'" class="tool-result__empty">
      <span class="text-text-muted italic">No output</span>
    </div>

    <!-- Git diff -->
    <div v-else-if="resultType === 'diff'" class="tool-result__diff">
      <div v-for="(line, i) in diffLines" :key="i" class="tool-result__diff-line" :class="diffLineClass(line)">
        <span class="tool-result__diff-marker">{{ diffMarker(line) }}</span>
        <span class="tool-result__diff-text">{{ line }}</span>
      </div>
      <button v-if="isTruncated" class="tool-result__truncated" @click="showFull = true">
        Show {{ totalLines - maxLines }} more lines...
      </button>
    </div>

    <!-- JSON -->
    <div v-else-if="resultType === 'json'" class="tool-result__json">
      <pre class="tool-result__pre"><code v-html="highlightedJson"></code></pre>
      <button v-if="isTruncated" class="tool-result__truncated" @click="showFull = true">
        Show full output...
      </button>
    </div>

    <!-- File content (syntax highlighted) -->
    <div v-else-if="resultType === 'file-content'" class="tool-result__file">
      <pre class="tool-result__pre"><code v-html="highlightedContent"></code></pre>
      <button v-if="isTruncated" class="tool-result__truncated" @click="showFull = true">
        Show {{ totalLines - maxLines }} more lines...
      </button>
    </div>

    <!-- Directory listing -->
    <div v-else-if="resultType === 'directory'" class="tool-result__dir">
      <div v-for="(entry, i) in directoryEntries" :key="i" class="tool-result__dir-entry">
        <span class="tool-result__dir-icon">{{ entry.isDir ? '📁' : '📄' }}</span>
        <span :class="entry.isDir ? 'text-accent' : 'text-text-secondary'">{{ entry.name }}</span>
        <span v-if="entry.size" class="text-text-muted ml-2">{{ entry.size }}</span>
      </div>
      <button v-if="isTruncated" class="tool-result__truncated" @click="showFull = true">
        Show {{ totalLines - maxLines }} more entries...
      </button>
    </div>

    <!-- Plain text fallback -->
    <div v-else class="tool-result__plain">
      <pre class="tool-result__pre">{{ visibleContent }}</pre>
      <button v-if="isTruncated" class="tool-result__truncated" @click="showFull = true">
        Show full output...
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import hljs from 'highlight.js'
import { inferLanguage } from '../../utils/toolClassifier.js'

const props = defineProps({
  content: { type: String, default: '' },
  resultType: { type: String, default: 'plain-text' },
  toolName: { type: String, default: '' },
  toolArgs: { type: Object, default: () => ({}) },
  maxLines: { type: Number, default: 50 }
})

const showFull = ref(false)

const totalLines = computed(() => props.content?.split('\n').length || 0)

const isTruncated = computed(() => {
  if (showFull.value) return false
  return totalLines.value > props.maxLines
})

const visibleContent = computed(() => {
  if (!props.content) return ''
  if (showFull.value || !isTruncated.value) return props.content
  return props.content.split('\n').slice(0, props.maxLines).join('\n')
})

// --- Diff rendering ---
const diffLines = computed(() => {
  const lines = visibleContent.value.split('\n')
  return lines
})

function diffLineClass(line) {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'tool-result__diff-line--add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'tool-result__diff-line--remove'
  if (line.startsWith('@@')) return 'tool-result__diff-line--hunk'
  if (line.startsWith('diff --git')) return 'tool-result__diff-line--header'
  return ''
}

function diffMarker(line) {
  if (line.startsWith('+') && !line.startsWith('+++')) return '+'
  if (line.startsWith('-') && !line.startsWith('---')) return '-'
  return ' '
}

// --- JSON rendering ---
const highlightedJson = computed(() => {
  if (props.resultType !== 'json') return ''
  try {
    const parsed = JSON.parse(visibleContent.value)
    const formatted = JSON.stringify(parsed, null, 2)
    return hljs.highlight(formatted, { language: 'json' }).value
  } catch {
    return escapeHtml(visibleContent.value)
  }
})

// --- File content rendering ---
const highlightedContent = computed(() => {
  if (props.resultType !== 'file-content') return ''
  const text = visibleContent.value
  const path = props.toolArgs?.path || ''
  const lang = inferLanguage(path)

  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(text, { language: lang }).value
    } catch { /* fall through */ }
  }

  // Try auto-detect
  try {
    return hljs.highlightAuto(text).value
  } catch {
    return escapeHtml(text)
  }
})

// --- Directory rendering ---
const directoryEntries = computed(() => {
  if (props.resultType !== 'directory') return []
  const content = visibleContent.value

  // Try JSON format first (from list_directory / directory_tree)
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      return parsed.slice(0, showFull.value ? undefined : props.maxLines).map(entry => {
        if (typeof entry === 'string') {
          return { name: entry, isDir: entry.endsWith('/'), size: null }
        }
        return {
          name: entry.name || entry,
          isDir: entry.type === 'directory' || (entry.name || '').endsWith('/'),
          size: entry.size ? formatSize(entry.size) : null
        }
      })
    }
  } catch { /* not JSON */ }

  // Fall back to line-based parsing
  return content.split('\n')
    .filter(l => l.trim())
    .slice(0, showFull.value ? undefined : props.maxLines)
    .map(line => {
      const isDir = line.includes('[DIR]') || line.endsWith('/')
      const name = line.replace(/^\[DIR\]\s*|\[FILE\]\s*/g, '').trim()
      return { name, isDir, size: null }
    })
})

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
</script>
