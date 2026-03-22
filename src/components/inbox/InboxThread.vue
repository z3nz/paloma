<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Thread Header -->
    <div class="px-6 py-4 border-b border-[--color-border] bg-[--color-bg-secondary]/50 flex items-center justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-[--color-text-primary] truncate mb-1">{{ thread.subject }}</h1>
        <div class="flex items-center gap-4 text-[11px] text-[--color-text-muted] font-medium uppercase tracking-wider">
          <span class="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-[--color-text-muted]">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            {{ thread.participants?.length || 0 }} participants
          </span>
          <span class="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-[--color-text-muted]">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            {{ thread.messageCount || 0 }} messages
          </span>
        </div>
      </div>
    </div>

    <!-- Messages List -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-[--color-bg-primary]">
      <div v-if="loading" class="flex items-center justify-center h-32">
        <div class="w-8 h-8 border-2 border-[--color-bg-tertiary] border-t-[--color-accent] rounded-full animate-spin"></div>
      </div>
      <template v-else>
        <div v-for="(message, index) in sortedMessages" :key="message.messageId" class="flex flex-col gap-4">
          <InboxMessage 
            :message="message" 
            :is-latest="index === sortedMessages.length - 1"
            :is-collapsed="index < sortedMessages.length - 1 && index !== 0 && index !== sortedMessages.length - 1"
          />
          
          <!-- Linked Session -->
          <InboxSessionPanel v-if="message.sessionId" :session-id="message.sessionId" :message-id="message.messageId" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import InboxMessage from './InboxMessage.vue'
import InboxSessionPanel from './InboxSessionPanel.vue'

const props = defineProps({
  thread: { type: Object, required: true },
  loading: { type: Boolean, default: false }
})

const sortedMessages = computed(() => {
  if (!props.thread.messages) return []
  return [...props.thread.messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
})
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-bg-tertiary);
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--color-bg-hover);
}
</style>
