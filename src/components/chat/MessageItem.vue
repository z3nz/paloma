<template>
  <!-- Tool message -->
  <div
    v-if="message.role === 'tool'"
    class="px-6 py-1.5"
  >
    <div class="max-w-3xl mx-auto flex items-start gap-2 text-xs text-text-muted">
      <span class="uppercase tracking-wider text-warning font-medium shrink-0">Tool</span>
      <button
        @click="expanded = !expanded"
        class="font-mono hover:text-text-secondary text-left"
      >
        {{ message.toolName }}({{ formatArgs }}) {{ expanded ? '▾' : '▸' }}
      </button>
    </div>
    <div v-if="expanded" class="max-w-3xl mx-auto mt-1 ml-10">
      <pre class="text-xs text-text-muted font-mono whitespace-pre-wrap bg-bg-primary border border-border rounded-md p-2 max-h-48 overflow-y-auto">{{ truncatedResult }}</pre>
    </div>
  </div>

  <!-- Assistant message with tool calls but no content -->
  <div
    v-else-if="message.role === 'assistant' && message.toolCalls && !message.content"
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
      <!-- Role label -->
      <div class="flex items-center gap-2 mb-2">
        <span
          class="text-xs font-medium uppercase tracking-wider"
          :class="message.role === 'user' ? 'text-success' : 'text-purple-400'"
        >
          {{ message.role === 'user' ? 'You' : 'Paloma' }}
        </span>
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

      <!-- Token/cost annotation for assistant messages -->
      <div v-if="message.role === 'assistant' && message.usage" class="mt-2 text-xs text-text-muted flex items-center gap-3">
        <span>{{ formatTokens(message.usage.totalTokens) }} tokens</span>
        <span>{{ formatCost(messageCost) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { useCostTracking } from '../../composables/useCostTracking.js'

const props = defineProps({
  message: { type: Object, required: true }
})

const emit = defineEmits(['apply-code'])

const htmlCache = new Map()

const expanded = ref(false)

const { formatCost, formatTokens, calculateMessageCost } = useCostTracking()
const messageCost = computed(() => calculateMessageCost(props.message))

// Format tool args for compact display
const formatArgs = computed(() => {
  if (props.message.role !== 'tool') return ''
  const args = props.message.toolArgs
  if (!args) return ''
  const values = Object.values(args)
  if (values.length === 1) return JSON.stringify(values[0])
  return Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
})

// Truncate tool result for display
const truncatedResult = computed(() => {
  if (props.message.role !== 'tool') return ''
  const content = props.message.content || ''
  if (content.length > 2000) {
    return content.slice(0, 2000) + '\n\n[Truncated...]'
  }
  return content
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
