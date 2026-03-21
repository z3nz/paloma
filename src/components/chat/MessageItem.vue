<template>
  <!-- Tool messages are never rendered standalone — they're shown inside ToolCallGroup -->

  <!-- Assistant message with toolActivity (new rich display) -->
  <div
    v-if="message.role === 'assistant' && hasToolActivity"
    class="px-6"
    :class="message.content ? 'py-4 bg-bg-secondary/50' : 'py-2'"
  >
    <div class="max-w-3xl mx-auto">
      <!-- Callback badge -->
      <CallbackBadge v-if="message.isCallback" :message="message" />

      <!-- Role label (only if there's content) -->
      <div v-if="message.content" class="flex items-center gap-2 mb-2">
        <span class="text-xs font-medium uppercase tracking-wider text-purple-400">Paloma</span>
        <span v-if="shortModelName" class="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">{{ shortModelName }}</span>
      </div>

      <!-- Content (if any) -->
      <div
        v-if="message.content"
        class="message-content text-sm text-text-primary"
        v-html="renderedHtml"
        @click="handleContentClick"
      />

      <!-- Tool call group (below content) -->
      <ToolCallGroup
        :activities="message.toolActivity"
        :tool-messages="toolMessages"
        class="mt-3"
      />

      <!-- Interrupted indicator -->
      <div v-if="message.interrupted" class="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted bg-bg-tertiary rounded opacity-80">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
        <span>Response interrupted</span>
      </div>

      <!-- Token/cost annotation -->
      <div v-if="message.usage" class="mt-2 text-xs text-text-muted flex items-center gap-3">
        <span :title="formatTokenBreakdown(message.usage)">{{ formatTokens(message.usage.totalTokens) }} tokens</span>
        <span>{{ formatCost(messageCost) }}</span>
      </div>
    </div>
  </div>

  <!-- Assistant message with legacy toolCalls but no toolActivity and no content -->
  <div
    v-else-if="message.role === 'assistant' && message.toolCalls && !message.toolActivity && !message.content"
    class="px-6 py-1.5"
  >
    <div class="max-w-3xl mx-auto">
      <span class="text-xs text-text-muted italic">
        Used {{ message.toolCalls.length }} tool{{ message.toolCalls.length === 1 ? '' : 's' }}
      </span>
    </div>
  </div>

  <!-- Normal user/assistant message -->
  <div
    v-else
    class="px-6 py-4"
    :class="message.role === 'user' ? 'bg-bg-primary' : 'bg-bg-secondary/50'"
  >
    <div class="max-w-3xl mx-auto">
      <!-- Callback badge -->
      <CallbackBadge v-if="message.role === 'assistant' && message.isCallback" :message="message" />

      <!-- Role label -->
      <div class="flex items-center gap-2 mb-2">
        <span
          class="text-xs font-medium uppercase tracking-wider"
          :class="message.role === 'user' ? 'text-success' : 'text-purple-400'"
        >
          {{ message.role === 'user' ? 'You' : 'Paloma' }}
        </span>
        <span v-if="message.role === 'assistant' && shortModelName" class="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">{{ shortModelName }}</span>
        <!-- Attached files -->
        <div v-if="message.files?.length" class="flex items-center gap-1 ml-2">
          <span
            v-for="file in message.files"
            :key="file.path"
            class="text-xs bg-bg-tertiary text-text-muted px-2 py-0.5 rounded"
          >
            {{ file.name }}
          </span>
        </div>
      </div>

      <!-- Content -->
      <div
        v-if="message.role === 'user'"
        class="text-sm text-text-primary whitespace-pre-wrap"
      >{{ displayContent }}</div>

      <div
        v-else
        class="message-content text-sm text-text-primary"
        v-html="renderedHtml"
        @click="handleContentClick"
      />

      <!-- Interrupted indicator -->
      <div v-if="message.role === 'assistant' && message.interrupted" class="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted bg-bg-tertiary rounded opacity-80">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
        <span>Response interrupted</span>
      </div>

      <!-- Token/cost annotation for assistant messages -->
      <div v-if="message.role === 'assistant' && message.usage" class="mt-2 text-xs text-text-muted flex items-center gap-3">
        <span :title="formatTokenBreakdown(message.usage)">{{ formatTokens(message.usage.totalTokens) }} tokens</span>
        <span>{{ formatCost(messageCost) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { marked } from 'marked'
import hljs from '../../utils/highlight.js'
import { useCostTracking } from '../../composables/useCostTracking.js'
import ToolCallGroup from './ToolCallGroup.vue'
import CallbackBadge from './CallbackBadge.vue'

const props = defineProps({
  message: { type: Object, required: true },
  toolMessages: { type: Array, default: () => [] }  // role:'tool' messages that belong to this assistant message
})

const emit = defineEmits(['apply-code'])

const HTML_CACHE_MAX = 100
const htmlCache = new Map()

const { formatCost, formatTokens, formatTokenBreakdown, calculateMessageCost } = useCostTracking()
const messageCost = computed(() => calculateMessageCost(props.message))

const hasToolActivity = computed(() =>
  props.message.role === 'assistant' && props.message.toolActivity?.length > 0
)

const shortModelName = computed(() => {
  const m = props.message.model
  if (!m) return null
  if (m.startsWith('ollama:')) return m.replace('ollama:', '').split(':')[0]
  if (m.startsWith('gemini-cli:')) return 'Gemini ' + m.replace('gemini-cli:', '').charAt(0).toUpperCase() + m.replace('gemini-cli:', '').slice(1)
  if (m.startsWith('copilot-cli:')) return m.replace('copilot-cli:', '')
  if (m.startsWith('codex-cli:')) return 'Codex'
  if (m.includes(':')) return m.split(':')[1]
  return m.split('/').pop()
})

// For user messages, strip <file> tags from display
const displayContent = computed(() => {
  if (props.message.role !== 'user') return props.message.content
  return props.message.content.replace(/<file path="[^"]*">[\s\S]*?<\/file>\n*/g, '').trim()
})

// Decode HTML entities to get raw code text
function decodeEntities(html) {
  const el = document.createElement('textarea')
  el.innerHTML = html
  return el.value
}

// Store code block metadata for event delegation
const codeBlocks = ref([])

const renderedHtml = computed(() => {
  if (props.message.role !== 'assistant') return ''
  if (!props.message.content) return ''

  const cached = htmlCache.get(props.message.content)
  if (cached) {
    codeBlocks.value = cached.blocks
    return cached.html
  }

  const blocks = []
  const html = marked.parse(props.message.content, { breaks: true })

  const result = html.replace(
    /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (match, infoString, code) => {
      let lang = infoString || ''
      let filePath = ''

      // Parse info string: "js:src/utils.js" -> lang="js", filePath="src/utils.js"
      if (lang.includes(':')) {
        const colonIdx = lang.indexOf(':')
        filePath = lang.slice(colonIdx + 1)
        lang = lang.slice(0, colonIdx)
      }

      const index = blocks.length
      blocks.push({ path: filePath, code: decodeEntities(code) })

      const highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(decodeEntities(code), { language: lang }).value
        : hljs.highlightAuto(decodeEntities(code)).value

      const headerHtml = filePath
        ? `<div class="code-block-header"><span class="code-block-path">${filePath}</span></div>`
        : ''

      const applyBtnHtml = filePath
        ? `<button class="apply-btn" data-code-index="${index}">Apply</button>`
        : ''

      const copyOnclick = `navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})`

      return `<div class="code-block-wrapper">${headerHtml}<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre><div class="code-block-actions"><button class="copy-btn" onclick="${copyOnclick}">Copy</button>${applyBtnHtml}</div></div>`
    }
  )

  codeBlocks.value = blocks
  // LRU eviction: drop oldest entries when cache exceeds limit
  if (htmlCache.size >= HTML_CACHE_MAX) {
    const firstKey = htmlCache.keys().next().value
    htmlCache.delete(firstKey)
  }
  htmlCache.set(props.message.content, { html: result, blocks })
  return result
})

function handleContentClick(e) {
  const btn = e.target.closest('.apply-btn')
  if (!btn) return
  const index = parseInt(btn.dataset.codeIndex, 10)
  const block = codeBlocks.value[index]
  if (block?.path) {
    emit('apply-code', { path: block.path, code: block.code })
  }
}
</script>
