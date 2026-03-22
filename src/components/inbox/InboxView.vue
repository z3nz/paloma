<template>
  <div class="flex h-full bg-[--color-bg-primary] text-[--color-text-primary] overflow-hidden">
    <!-- Left Sidebar: Email List -->
    <div class="w-[350px] flex-shrink-0 border-r border-[--color-border] flex flex-col bg-[--color-bg-secondary]">
      <!-- Header -->
      <div class="h-14 px-4 flex items-center justify-between border-b border-[--color-border]">
        <h1 class="text-lg font-semibold flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[--color-accent]">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
          </svg>
          Inbox
          <span v-if="unreadCount > 0" class="ml-1 px-1.5 py-0.5 text-[10px] bg-[--color-accent] text-white rounded-full leading-none">
            {{ unreadCount }}
          </span>
        </h1>
        <div class="flex items-center gap-2">
          <!-- Theme Toggle -->
          <button 
            @click="toggleTheme" 
            class="p-2 hover:bg-[--color-bg-hover] rounded-md transition-colors text-[--color-text-secondary] hover:text-[--color-text-primary]"
            :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <!-- Sun icon (shown in dark mode — click to go light) -->
            <svg v-if="theme === 'dark'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <!-- Moon icon (shown in light mode — click to go dark) -->
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>
          <button 
            @click="syncEmails" 
            class="p-2 hover:bg-[--color-bg-hover] rounded-md transition-colors text-[--color-text-secondary] hover:text-[--color-text-primary] disabled:opacity-50"
            :disabled="syncing"
            title="Sync with Gmail"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'animate-spin': syncing }">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- List -->
      <div class="flex-1 overflow-y-auto custom-scrollbar">
        <InboxList 
          :threads="threads" 
          :active-thread-id="activeThread?.threadId" 
          :loading="loading"
          @select-thread="selectThread"
          @load-more="handleLoadMore"
        />
      </div>

      <!-- Stats Footer -->
      <div class="p-3 border-t border-[--color-border] text-[10px] text-[--color-text-muted] flex justify-between bg-[--color-bg-primary]/30 uppercase tracking-wider font-semibold">
        <span>{{ stats.threads }} threads</span>
        <span>{{ stats.linkedSessions }} sessions linked</span>
      </div>
    </div>

    <!-- Right Pane: Thread Detail -->
    <div class="flex-1 flex flex-col min-w-0 bg-[--color-bg-primary] relative">
      <template v-if="activeThread">
        <InboxThread 
          :thread="activeThread" 
          :loading="loadingThread"
        />
      </template>
      <div v-else class="flex-1 flex flex-col items-center justify-center text-[--color-text-muted] p-8 text-center">
        <div class="w-16 h-16 bg-[--color-bg-secondary] border border-[--color-border] rounded-full flex items-center justify-center mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
        </div>
        <h2 class="text-xl font-medium text-[--color-text-secondary] mb-2">Select an email to read</h2>
        <p class="max-w-xs text-sm">All your Paloma-to-Paloma, trusted sender, and incoming emails are visible here with full transparency.</p>
      </div>

      <!-- Error Overlay -->
      <div v-if="error" class="absolute bottom-4 right-4 max-w-sm p-3 rounded-lg text-sm flex items-start gap-3 shadow-lg z-50 border bg-[--color-danger]/10 border-[--color-danger]/30 text-[--color-danger]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 shrink-0">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div>
          <p class="font-bold">Error</p>
          <p>{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import InboxList from './InboxList.vue'
import InboxThread from './InboxThread.vue'
import { useInbox } from '../../composables/useInbox.js'
import { useTheme } from '../../composables/useTheme.js'

const {
  threads,
  activeThread,
  loading,
  loadingThread,
  syncing,
  stats,
  error,
  fetchThreads,
  syncEmails,
  fetchStats,
  selectThread,
  unreadCount,
  hasMore
} = useInbox()

const { theme, toggleTheme } = useTheme()

onMounted(() => {
  fetchThreads({ limit: 50 })
  fetchStats()
})

function handleLoadMore() {
  if (hasMore.value && !loading.value) {
    fetchThreads({ limit: 50, offset: threads.value.length })
  }
}
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-bg-tertiary);
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--color-bg-hover);
}
</style>
