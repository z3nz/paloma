<template>
  <div 
    class="bg-[--color-bg-secondary] border border-[--color-border] rounded-xl overflow-hidden shadow-sm transition-all"
    :class="{ 'opacity-70': isCollapsed && !isExpanded }"
  >
    <!-- Message Header -->
    <div 
      class="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[--color-bg-hover]/30"
      @click="toggleExpand"
    >
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 rounded-full bg-[--color-bg-tertiary] flex items-center justify-center text-xs font-bold text-[--color-text-secondary] shrink-0 border border-[--color-border]">
          {{ getInitials(message.from) }}
        </div>
        <div class="min-w-0">
          <div class="text-sm font-semibold text-[--color-text-primary] truncate">
            {{ getSenderName(message.from) }}
            <span class="text-[10px] font-normal text-[--color-text-muted] ml-1 opacity-60">{{ message.from }}</span>
          </div>
          <div v-if="!isExpanded && isCollapsed" class="text-[11px] text-[--color-text-muted] truncate max-w-lg italic">
            {{ message.body?.substring(0, 100) }}...
          </div>
          <div v-else class="text-[10px] text-[--color-text-muted] uppercase tracking-wider font-semibold opacity-80">
            to: {{ message.to }}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[10px] text-[--color-text-muted] whitespace-nowrap uppercase tracking-tighter">
          {{ formatDate(message.timestamp) }}
        </span>
        <svg 
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          class="text-[--color-text-muted] transition-transform duration-200"
          :class="{ 'rotate-180': isExpanded || !isCollapsed }"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>

    <!-- Message Body -->
    <div v-if="isExpanded || !isCollapsed" class="px-4 pb-5 border-t border-[--color-border-light] pt-4">
      <!-- HTML Body (Sandboxed-ish via v-html and CSS) -->
      <div v-if="message.htmlBody" class="email-html-wrapper bg-white rounded-lg p-4 mb-2 overflow-x-auto max-h-[70vh] border border-white/10 shadow-inner">
        <div class="email-html-content" v-html="sanitizedHtml"></div>
      </div>
      
      <!-- Plain Text Body -->
      <div v-else class="whitespace-pre-wrap text-sm leading-relaxed text-[--color-text-primary] font-sans selection:bg-[--color-accent-muted]">
        {{ message.body }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { sanitizeEmailHtml } from '../../utils/sanitize.js'

const props = defineProps({
  message: { type: Object, required: true },
  isLatest: { type: Boolean, default: false },
  isCollapsed: { type: Boolean, default: false }
})

const isExpanded = ref(props.isLatest)

function toggleExpand() {
  if (props.isCollapsed) {
    isExpanded.value = !isExpanded.value
  }
}

const sanitizedHtml = computed(() => {
  if (!props.message.htmlBody) return ''
  return sanitizeEmailHtml(props.message.htmlBody)
})

function getInitials(from) {
  if (!from) return '?'
  const cleanEmail = from.replace(/.*<(.+)>$/, '$1')
  const name = cleanEmail.split('@')[0]
  if (name.includes('.')) {
    const parts = name.split('.')
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

function getSenderName(from) {
  if (!from) return 'Unknown'
  const match = from.match(/^"([^"]+)"/) || from.match(/^([^<]+)/)
  if (match && match[1].trim()) return match[1].trim()
  return from.split('@')[0]
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false
  })
}
</script>

<style scoped>
.email-html-content :deep(*) {
  /* Reset some common styles that might leak from parent */
  color: #000;
  font-family: sans-serif;
  line-height: normal;
}

.email-html-content :deep(a) {
  color: #0047b3;
  text-decoration: underline;
}

.email-html-wrapper {
  color-scheme: light; /* Force light mode inside HTML email container */
}
</style>
