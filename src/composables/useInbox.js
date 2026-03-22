import { ref, computed, watch } from 'vue'
import { useMCP } from './useMCP.js'

// --- Singleton state ---
const threads = window.__PALOMA_INBOX__?.threads || ref([])
const activeThread = window.__PALOMA_INBOX__?.activeThread || ref(null)
const loading = window.__PALOMA_INBOX__?.loading || ref(false)
const loadingThread = window.__PALOMA_INBOX__?.loadingThread || ref(false)
const syncing = window.__PALOMA_INBOX__?.syncing || ref(false)
const stats = window.__PALOMA_INBOX__?.stats || ref({ threads: 0, messages: 0, linkedSessions: 0 })
const error = window.__PALOMA_INBOX__?.error || ref(null)
const total = window.__PALOMA_INBOX__?.total || ref(0)

const { emailStoreUpdateTrigger } = useMCP()

// --- Bridge URL ---
const getBridgeUrl = () => {
  const wsUrl = localStorage.getItem('paloma:mcpBridgeUrl') || 'ws://localhost:19191'
  return wsUrl.replace('ws://', 'http://').replace('wss://', 'https://')
}

// --- Actions ---

async function fetchThreads({ limit = 50, offset = 0, search = '' } = {}) {
  loading.value = true
  error.value = null
  try {
    const baseUrl = getBridgeUrl()
    const query = new URLSearchParams({ limit, offset, search }).toString()
    const res = await fetch(`${baseUrl}/api/emails?${query}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    
    const data = await res.json()
    if (offset === 0) {
      threads.value = data.threads
    } else {
      threads.value = [...threads.value, ...data.threads]
    }
    total.value = data.total
  } catch (err) {
    console.error('[useInbox] fetchThreads failed:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function fetchThread(threadId) {
  if (!threadId) return
  loadingThread.value = true
  error.value = null
  try {
    const baseUrl = getBridgeUrl()
    const res = await fetch(`${baseUrl}/api/emails/${threadId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    
    const data = await res.json()
    // Flatten: merge thread metadata with messages array for easy template access
    activeThread.value = { ...data.thread, messages: data.messages }
  } catch (err) {
    console.error('[useInbox] fetchThread failed:', err)
    error.value = err.message
  } finally {
    loadingThread.value = false
  }
}

async function fetchStats() {
  try {
    const baseUrl = getBridgeUrl()
    const res = await fetch(`${baseUrl}/api/emails/stats`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    
    const data = await res.json()
    stats.value = data
  } catch (err) {
    console.warn('[useInbox] fetchStats failed:', err.message)
  }
}

async function syncEmails() {
  syncing.value = true
  error.value = null
  try {
    const baseUrl = getBridgeUrl()
    const res = await fetch(`${baseUrl}/api/emails/sync`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    
    // The bridge broadcasts email_store_updated when sync is done,
    // which triggers our watch() below.
    return await res.json()
  } catch (err) {
    console.error('[useInbox] syncEmails failed:', err)
    error.value = err.message
  } finally {
    syncing.value = false
  }
}

function selectThread(threadId) {
  if (!threadId) {
    activeThread.value = null
    return
  }
  fetchThread(threadId)
}

function clearActiveThread() {
  activeThread.value = null
}

// --- Computed ---

const unreadCount = computed(() => {
  return threads.value.filter(t => t.unread).length
})

const hasMore = computed(() => {
  return threads.value.length < total.value
})

// --- WebSocket Event Integration ---

// Re-fetch threads when the bridge signals an update
watch(emailStoreUpdateTrigger, () => {
  fetchThreads({ limit: 50, offset: 0 })
  fetchStats()
})

// --- Initialization ---

// Initial fetch if we have no threads
if (threads.value.length === 0) {
  fetchThreads()
  fetchStats()
}

// --- Composable ---

export function useInbox() {
  return {
    // State
    threads,
    activeThread,
    loading,
    loadingThread,
    syncing,
    stats,
    error,
    
    // Actions
    fetchThreads,
    fetchThread,
    syncEmails,
    fetchStats,
    selectThread,
    clearActiveThread,
    
    // Computed
    unreadCount,
    hasMore
  }
}

// --- HMR Preservation ---
if (import.meta.hot) {
  window.__PALOMA_INBOX__ = {
    threads,
    activeThread,
    loading,
    loadingThread,
    syncing,
    stats,
    error,
    total
  }
}
