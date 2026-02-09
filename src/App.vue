<template>
  <!-- Auto-recovering (brief flash while checking IndexedDB for stored handle) -->
  <div
    v-if="recovering"
    class="h-screen flex items-center justify-center bg-bg-primary"
  >
    <p class="text-text-muted text-sm animate-pulse">Restoring session...</p>
  </div>

  <!-- Welcome / Setup (only if no API key OR no dirHandle and no need to reconnect) -->
  <WelcomeScreen
    v-else-if="!apiKey || (!dirHandle && !needsReconnect)"
    @open-project="handleOpenProject"
  />

  <!-- Reconnect prompt (full reload recovery — only shown if auto-recover failed) -->
  <div
    v-else-if="needsReconnect"
    class="h-screen flex items-center justify-center bg-bg-primary"
  >
    <div class="text-center">
      <h2 class="text-xl font-semibold text-text-primary mb-2">Reconnect to {{ projectName }}</h2>
      <p class="text-text-muted text-sm mb-4">Page was reloaded. Click to reconnect.</p>
      <button
        @click="handleOpenProject"
        class="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
      >
        Reconnect
      </button>
    </div>
  </div>

  <!-- Main App -->
  <AppLayout
    v-else
    :project-name="projectName"
    :sessions="sessions"
    :active-session-id="activeSessionId"
    :active-model="activeSession?.model || ''"
    @open-settings="showSettings = true"
    @open-project="handleOpenProject"
    @new-chat="handleNewChat"
    @select-session="handleSelectSession"
    @delete-session="handleDeleteSession"
  >
    <ChatView
      v-if="activeSession"
      :session="activeSession"
      @update-session="handleUpdateSession"
    />
    <div v-else class="h-full flex items-center justify-center">
      <div class="text-center">
        <h2 class="text-xl font-semibold text-text-secondary mb-2">{{ projectName }}</h2>
        <p class="text-text-muted text-sm mb-6">{{ files.length }} files indexed</p>
        <button
          @click="handleNewChat"
          class="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          Start New Chat
        </button>
      </div>
    </div>

    <template #right-sidebar>
      <ChangesPanel
        v-if="hasPendingChanges || pendingChanges.some(c => c.status === 'error')"
        :pending-changes="pendingChanges"
        :has-pending-changes="hasPendingChanges"
        :pending-count="pendingCount"
        @apply-change="handleApplyChange"
        @apply-all="handleApplyAll"
        @dismiss-change="dismissChange"
        @dismiss-all="dismissAll"
        @view-diff="handleViewDiff"
      />
    </template>
  </AppLayout>

  <!-- Settings modal -->
  <SettingsModal
    v-if="showSettings"
    :project-name="projectName"
    @close="showSettings = false"
  />

  <!-- Full diff modal from Changes Panel -->
  <DiffPreview
    v-if="diffModalChange"
    :file-path="diffModalChange.path"
    :original-content="diffModalChange.originalContent"
    :new-content="diffModalChange.newContent"
    @apply="handleDiffModalApply"
    @cancel="diffModalChange = null"
  />
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import WelcomeScreen from './components/welcome/WelcomeScreen.vue'
import AppLayout from './components/layout/AppLayout.vue'
import ChatView from './components/chat/ChatView.vue'
import SettingsModal from './components/settings/SettingsModal.vue'
import ChangesPanel from './components/chat/ChangesPanel.vue'
import DiffPreview from './components/chat/DiffPreview.vue'
import { useSettings } from './composables/useSettings.js'
import { useProject } from './composables/useProject.js'
import { useFileIndex } from './composables/useFileIndex.js'
import { useSessions } from './composables/useSessions.js'
import { useOpenRouter } from './composables/useOpenRouter.js'
import { useChanges } from './composables/useChanges.js'

const { apiKey, defaultModel } = useSettings()
const { dirHandle, projectName, needsReconnect, openProject, tryAutoRecover, resolveRoot, getHashSessionId, syncHash } = useProject()
const { files, buildIndex, updatePaths } = useFileIndex()
const { sessions, activeSessionId, loadSessions, createSession, updateSession, deleteSession, setActiveSession } = useSessions()
const { models, loadModels } = useOpenRouter()
const {
  pendingChanges, hasPendingChanges, pendingCount,
  applyChange, applyAll, dismissChange, dismissAll
} = useChanges()

const showSettings = ref(false)
const diffModalChange = ref(null)
const recovering = ref(false)

const activeSession = computed(() =>
  sessions.value.find(s => s.id === activeSessionId.value) || null
)

// --- Auto-recovery on mount ---
onMounted(async () => {
  if (needsReconnect.value && apiKey.value) {
    recovering.value = true
    try {
      const handle = await tryAutoRecover()
      if (handle) {
        buildIndex(handle)
        await loadSessions(handle.name)
        // Resolve filesystem path for CLI cwd (non-blocking)
        resolveRoot()
        // Restore session from URL hash if available
        const hashSessionId = getHashSessionId()
        if (hashSessionId && sessions.value.some(s => s.id === hashSessionId)) {
          setActiveSession(hashSessionId)
        }
      }
    } catch (e) {
      console.warn('[Recovery] Auto-recover failed:', e)
    } finally {
      recovering.value = false
    }
  }
})

// --- URL hash sync ---
// Keep hash in sync whenever project or active session changes
watch([projectName, activeSessionId], ([name, sid]) => {
  if (name && dirHandle.value) {
    syncHash(sid)
  }
})

// Load models when API key is available
watch(apiKey, (key) => {
  if (import.meta.hot && models.value.length > 0) {
    console.log('[HMR] App.vue — skipping redundant loadModels')
    return
  }
  if (key) loadModels(key)
}, { immediate: true })

// Load sessions when project changes
watch(projectName, async (name) => {
  if (name) {
    await loadSessions(name)
  }
})

async function handleOpenProject() {
  try {
    const handle = await openProject()
    // File indexing runs in background — don't block chat loading
    buildIndex(handle)
    // Resolve filesystem path for CLI cwd (non-blocking)
    resolveRoot()
    await loadSessions(handle.name)
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Failed to open project:', e)
    }
  }
}

async function handleNewChat() {
  if (!projectName.value) return
  await createSession(projectName.value, defaultModel.value)
}

async function handleSelectSession(id) {
  setActiveSession(id)
}

async function handleDeleteSession(id) {
  await deleteSession(id)
}

async function handleUpdateSession(id, updates) {
  await updateSession(id, updates)
}

async function handleApplyChange(index) {
  const change = pendingChanges.value[index]
  const path = change?.path
  await applyChange(index, dirHandle.value)
  if (path && dirHandle.value) {
    await updatePaths(dirHandle.value, [{ action: 'update', path }])
  }
}

async function handleApplyAll() {
  const pathUpdates = pendingChanges.value
    .filter(c => c.status === 'pending' && c.path)
    .map(c => ({ action: 'update', path: c.path }))
  await applyAll(dirHandle.value)
  if (pathUpdates.length > 0 && dirHandle.value) {
    await updatePaths(dirHandle.value, pathUpdates)
  }
}

function handleViewDiff(index) {
  const change = pendingChanges.value[index]
  if (change?.newContent !== null) {
    diffModalChange.value = { ...change, _index: index }
  }
}

async function handleDiffModalApply() {
  if (!diffModalChange.value) return
  await handleApplyChange(diffModalChange.value._index)
  diffModalChange.value = null
}
</script>
