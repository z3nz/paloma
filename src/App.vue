<template>
  <!-- Welcome / Setup -->
  <WelcomeScreen
    v-if="!apiKey || !dirHandle"
    @open-project="handleOpenProject"
  />

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
        v-if="pendingChanges.length > 0"
        :pending-changes="pendingChanges"
        :has-pending-changes="hasPendingChanges"
        :pending-count="pendingCount"
        @apply-change="index => applyChange(index, dirHandle)"
        @apply-all="() => applyAll(dirHandle)"
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
import { useChanges } from './composables/useChanges.js'

const { apiKey, defaultModel } = useSettings()
const { dirHandle, projectName, openProject } = useProject()
const { files, buildIndex } = useFileIndex()
const { sessions, activeSessionId, loadSessions, createSession, updateSession, deleteSession, setActiveSession } = useSessions()
const { loadModels } = useOpenRouter()
const {
  pendingChanges, hasPendingChanges, pendingCount,
  applyChange, applyAll, dismissChange, dismissAll
} = useChanges()

const showSettings = ref(false)
const diffModalChange = ref(null)

const activeSession = computed(() =>
  sessions.value.find(s => s.id === activeSessionId.value) || null
)

// Load models when API key is available
watch(apiKey, (key) => {
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
    await buildIndex(handle)
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

function handleViewDiff(index) {
  const change = pendingChanges.value[index]
  if (change?.newContent !== null) {
    diffModalChange.value = { ...change, _index: index }
  }
}

async function handleDiffModalApply() {
  if (!diffModalChange.value) return
  await applyChange(diffModalChange.value._index, dirHandle.value)
  diffModalChange.value = null
}
</script>
