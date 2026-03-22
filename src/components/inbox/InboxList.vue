<template>
  <div class="flex flex-col h-full">
    <!-- Loading State -->
    <div v-if="loading && threads.length === 0" class="p-4 space-y-4">
      <div v-for="i in 10" :key="i" class="animate-pulse flex gap-3">
        <div class="w-10 h-10 bg-[--color-bg-tertiary] rounded-full"></div>
        <div class="flex-1 space-y-2 py-1">
          <div class="h-3 bg-[--color-bg-tertiary] rounded w-3/4"></div>
          <div class="h-2 bg-[--color-bg-tertiary] rounded w-1/2"></div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="threads.length === 0" class="flex-1 flex flex-col items-center justify-center p-8 text-center text-[--color-text-muted]">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-3 opacity-20">
        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
        <path d="M22 6l-10 7L2 6"></path>
      </svg>
      <p class="text-sm">No emails yet.</p>
      <p class="text-xs mt-1 text-[--color-text-muted]/70">Click the sync button to pull from Gmail.</p>
    </div>

    <!-- Thread List -->
    <div v-else class="divide-y divide-[--color-border-light]">
      <div 
        v-for="thread in threads" 
        :key="thread.threadId"
        @click="$emit('select-thread', thread.threadId)"
        class="group p-4 flex gap-3 cursor-pointer transition-colors relative"
        :class="[
          activeThreadId === thread.threadId ? 'bg-[--color-bg-tertiary]' : 'hover:bg-[--color-bg-hover]',
          thread.unread ? 'bg-[--color-bg-primary]/30' : ''
        ]"
      >
        <!-- Unread Indicator -->
        <div v-if="thread.unread" class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[--color-accent] rounded-r-full"></div>

        <!-- Avatar/Initials -->
        <div class="w-10 h-10 rounded-full bg-[--color-bg-tertiary] flex items-center justify-center text-sm font-bold text-[--color-text-secondary] shrink-0 border border-[--color-border]">
          {{ getInitials(thread.participants[0]) }}
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-start gap-2 mb-0.5">
            <span class="text-sm font-semibold truncate" :class="thread.unread ? 'text-[--color-text-primary]' : 'text-[--color-text-secondary]'">
              {{ getSenderName(thread.participants[0]) }}
            </span>
            <span class="text-[10px] text-[--color-text-muted] whitespace-nowrap pt-0.5 uppercase tracking-tighter">
              {{ formatRelativeTime(thread.lastMessageAt) }}
            </span>
          </div>
          <div class="text-xs font-medium truncate mb-0.5" :class="thread.unread ? 'text-[--color-text-primary]' : 'text-[--color-text-secondary]'">
            {{ thread.subject }}
          </div>
          <div class="text-[11px] text-[--color-text-muted] line-clamp-2 leading-snug">
            {{ thread.snippet }}
          </div>
        </div>
      </div>
      
      <!-- Load More Trigger -->
      <div v-if="threads.length > 0" ref="loadMoreTrigger" class="h-10 flex items-center justify-center">
        <div v-if="loading" class="w-4 h-4 border-2 border-[--color-bg-tertiary] border-t-[--color-accent] rounded-full animate-spin"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  threads: { type: Array, required: true },
  activeThreadId: { type: String, default: null },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['select-thread', 'load-more'])

const loadMoreTrigger = ref(null)
let observer = null

function setupObserver() {
  if (observer) observer.disconnect()
  if (!loadMoreTrigger.value) return

  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      emit('load-more')
    }
  }, { threshold: 0.1 })

  observer.observe(loadMoreTrigger.value)
}

onMounted(() => {
  setupObserver()
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
})

// Re-setup observer if threads change
watch(() => props.threads.length, () => {
  setTimeout(setupObserver, 100)
})

function getInitials(email) {
  if (!email) return '?'
  const name = email.split('@')[0]
  if (name.includes('.')) {
    const parts = name.split('.')
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

function getSenderName(email) {
  if (!email) return 'Unknown'
  const name = email.split('@')[0]
  return name.split(/[\._]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 7) {
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } else if (days > 0) {
    return `${days}d`
  } else if (hours > 0) {
    return `${hours}h`
  } else if (minutes > 0) {
    return `${minutes}m`
  } else {
    return 'now'
  }
}
</script>
