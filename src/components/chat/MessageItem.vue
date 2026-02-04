<template>
  <div
    class="px-6 py-4"
    :class="message.role === 'user' ? 'bg-bg-primary' : 'bg-bg-secondary/50'"
  >
    <div class="max-w-3xl mx-auto">
      <!-- Role label -->
      <div class="flex items-center gap-2 mb-2">
        <span
          class="text-xs font-medium uppercase tracking-wider"
          :class="message.role === 'user' ? 'text-accent' : 'text-success'"
        >
          {{ message.role === 'user' ? 'You' : 'Assistant' }}
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
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, nextTick } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'

const props = defineProps({
  message: { type: Object, required: true }
})

// For user messages, strip <file> tags from display
const displayContent = computed(() => {
  if (props.message.role !== 'user') return props.message.content
  return props.message.content.replace(/<file path="[^"]*">[\s\S]*?<\/file>\n*/g, '').trim()
})

const renderedHtml = computed(() => {
  if (props.message.role !== 'assistant') return ''

  const html = marked.parse(props.message.content, { breaks: true })

  // Wrap code blocks for copy button
  return html.replace(
    /<pre><code(?: class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (match, lang, code) => {
      const highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value
      return `<div class="code-block-wrapper"><pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre><button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button></div>`
    }
  )
})
</script>
