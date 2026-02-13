<template>
  <!-- Bridge not connected — show welcome/setup -->
  <WelcomeScreen v-if="!bridgeConnected" />

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
        <h2 class="text-xl font-semibold text-text-secondary mb-2">
          {{ projectName || 'Paloma' }}
        </h2>
        <p v-if="projectName" class="text-text-muted text-sm mb-6">{{ files.length }} files indexed</p>
        <p v-else class="text-text-muted text-sm mb-6">Type /project in the prompt to switch projects.</p>
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
import { ref, computed, watch } from 'vue'
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
import { useMCP } from './composables/useMCP.js'
import { useChanges } from './composables/useChanges.js'
import { useSessionState } from './composables/useSessionState.js'

const { apiKey, defaultModel } = useSettings()
const { dirHandle, projectName, projectRoot, openProject, switchProject, resolveRoot, getHashSessionId, syncHash } = useProject()
const { files, buildIndex, updatePaths } = useFileIndex()
const { sessions, activeSessionId, loadSessions, createSession, updateSession, deleteSession, setActiveSession } = useSessions()
const { models, loadModels } = useOpenRouter()
const { connected: bridgeConnected, callMcpTool, resolveProjectPath } = useMCP()
const { activate: activateSession, removeState: removeSessionState } = useSessionState()
const {
  pendingChanges, hasPendingChanges, pendingCount,
  applyChange, applyAll, dismissChange, dismissAll
} = useChanges()

const showSettings = ref(false)
const diffModalChange = ref(null)

const activeSession = computed(() =>
  sessions.value.find(s => s.id === activeSessionId.value) || null
)

// When bridge connects, load sessions and recover project context
watch(bridgeConnected, async (isConnected) => {
  if (isConnected) {
    // If we had a project name from a previous session, recover via MCP
    if (projectName.value) {
      try {
        await switchProject(projectName.value, callMcpTool, resolveProjectPath)
        await loadSessions(projectName.value)
        const hashSessionId = getHashSessionId()
        if (hashSessionId && sessions.value.some(s => s.id === hashSessionId)) {
          setActiveSession(hashSessionId)
          activateSession(hashSessionId)
        }
      } catch (e) {
        console.warn('[Recovery] Project recovery failed, loading default sessions:', e)
        await loadSessions('paloma')
      }
    } else {
      await loadSessions('paloma')
    }
  }
})

// --- URL hash sync ---
watch([projectName, activeSessionId], ([name, sid]) => {
  if (name) {
    syncHash(sid)
  }
})

// Load OpenRouter models when API key is available (optional enhancement)
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
    buildIndex(handle)
    resolveRoot()
    await loadSessions(handle.name)
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Failed to open project:', e)
    }
  }
}

async function handleNewChat() {
  const projectPath = projectName.value || 'paloma'
  const newId = await createSession(projectPath, defaultModel.value)
  if (newId) activateSession(newId)
}

async function handleSelectSession(id) {
  setActiveSession(id)
  activateSession(id)
}

async function handleDeleteSession(id) {
  removeSessionState(id)
  await deleteSession(id)
}

async function handleUpdateSession(id, updates) {
  // Handle project switch from PromptBuilder autocomplete
  if (updates.projectSwitch) {
    const name = updates.projectSwitch
    await loadSessions(name)
    return
  }
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
