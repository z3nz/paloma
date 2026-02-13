<template>
  <div class="h-12 bg-bg-secondary border-b border-border flex items-center justify-between px-4">
    <div class="flex items-center gap-2">
      <span class="text-accent font-semibold text-sm tracking-wide">PALOMA</span>
      <span v-if="projectName" class="text-text-muted text-sm">/</span>
      <span v-if="projectName" class="text-text-secondary text-sm">{{ projectName }}</span>
    </div>

    <!-- Center: cost & token display -->
    <button
      v-if="hasUsageData"
      @click="showUsageModal = true"
      class="flex items-center gap-3 text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-bg-hover transition-colors"
    >
      <span>{{ formatCost(sessionCost) }}</span>
      <span class="text-text-muted">|</span>
      <span :class="contextWarningClass">{{ formatTokens(sessionTokens.total) }}<template v-if="contextUsage"> / {{ formatTokens(contextUsage.limit) }}</template></span>
      <div v-if="contextUsage" class="w-16 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all" :class="contextBarClass" :style="{ width: Math.min(contextUsage.percentage, 100) + '%' }" />
      </div>
    </button>

    <div class="flex items-center gap-2">
      <!-- Hog Wild toggle -->
      <button
        @click="toggleHogWild"
        class="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors font-medium"
        :class="hogWild
          ? 'bg-warning/20 text-warning hover:bg-warning/30'
          : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'"
        :title="hogWild ? 'Hog Wild: ALL tools auto-approved. Click to disable.' : 'Enable Hog Wild mode (auto-approve all tools)'"
      >
        <span v-if="hogWild">HOG WILD</span>
        <span v-else>Hog Wild</span>
      </button>

      <!-- MCP indicator -->
      <div
        v-if="mcpVisible"
        class="flex items-center gap-1.5 text-xs px-2 py-1 rounded"
        :class="mcpConnected ? 'text-text-secondary' : 'text-text-muted'"
        :title="mcpTooltip"
      >
        <span
          class="w-2 h-2 rounded-full"
          :class="mcpConnected ? 'bg-success' : 'bg-text-muted'"
        />
        <span>MCP</span>
        <span v-if="mcpConnected && mcpServerCount > 0" class="text-text-muted">({{ mcpServerCount }})</span>
      </div>

      <!-- Project switcher -->
      <div class="relative" ref="projectDropdownRef">
        <button
          @click="toggleProjectDropdown"
          class="flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm px-2 py-1 rounded hover:bg-bg-hover transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          {{ currentProjectName || 'No Project' }}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <!-- Dropdown -->
        <div
          v-if="showProjectDropdown"
          class="absolute right-0 top-full mt-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden z-30"
        >
          <div v-if="loadingProjects" class="px-3 py-2 text-xs text-text-muted">Loading projects...</div>
          <template v-else>
            <div
              v-for="name in availableProjects"
              :key="name"
              @click="handleSwitchProject(name)"
              class="px-3 py-2 text-sm cursor-pointer transition-colors"
              :class="name === currentProjectName
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'"
            >
              {{ name }}
            </div>
            <div v-if="availableProjects.length === 0" class="px-3 py-2 text-xs text-text-muted">
              No projects in projects/ directory
            </div>
          </template>
          <div class="border-t border-border">
            <button
              @click="handleOpenProject"
              class="w-full px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary text-left transition-colors"
            >
              Open from filesystem...
            </button>
            <button
              v-if="currentProjectName"
              @click="handleDetachProject"
              class="w-full px-3 py-2 text-sm text-text-muted hover:bg-bg-hover hover:text-danger text-left transition-colors"
            >
              Detach project
            </button>
          </div>
        </div>
      </div>

      <button
        @click="$emit('open-settings')"
        class="text-text-secondary hover:text-text-primary p-1.5 rounded hover:bg-bg-hover transition-colors"
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      </button>
    </div>
  </div>

  <UsageModal
    v-if="showUsageModal"
    :active-model="activeModel"
    :project-path="projectName"
    @close="showUsageModal = false"
  />
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import UsageModal from './UsageModal.vue'
import { useCostTracking } from '../../composables/useCostTracking.js'
import { useMCP } from '../../composables/useMCP.js'
import { useProject } from '../../composables/useProject.js'
import { usePermissions } from '../../composables/usePermissions.js'

const props = defineProps({
  projectName: { type: String, default: '' },
  activeModel: { type: String, default: '' }
})
const { sessionCost, sessionTokens, getContextUsage, formatCost, formatTokens } = useCostTracking()
const { connected: mcpConnected, servers: mcpServers, autoConnect: mcpAutoConnect, callMcpTool, resolveProjectPath } = useMCP()
const { projectName: currentProjectName, projectRoot, switchProject, listProjects, detachProject } = useProject()
const { hogWild, toggleHogWild } = usePermissions()

const showUsageModal = ref(false)
const showProjectDropdown = ref(false)
const availableProjects = ref([])
const loadingProjects = ref(false)
const projectDropdownRef = ref(null)

const mcpVisible = computed(() => mcpAutoConnect.value || mcpConnected.value)

const mcpServerCount = computed(() => {
  return Object.values(mcpServers.value).filter(s => s.status === 'connected').length
})

const mcpTooltip = computed(() => {
  if (!mcpConnected.value) return 'MCP Bridge: disconnected'
  const names = Object.entries(mcpServers.value)
    .filter(([, s]) => s.status === 'connected')
    .map(([name]) => name)
  return `MCP Bridge: connected\nServers: ${names.join(', ') || 'none'}`
})

const hasUsageData = computed(() => sessionTokens.value.total > 0)
const contextUsage = computed(() => props.activeModel ? getContextUsage(props.activeModel) : null)

const contextWarningClass = computed(() => {
  if (!contextUsage.value) return ''
  if (contextUsage.value.percentage >= 90) return 'text-error font-medium'
  if (contextUsage.value.percentage >= 80) return 'text-warning font-medium'
  return ''
})

const contextBarClass = computed(() => {
  if (!contextUsage.value) return 'bg-accent'
  if (contextUsage.value.percentage >= 90) return 'bg-error'
  if (contextUsage.value.percentage >= 80) return 'bg-warning'
  return 'bg-accent'
})

async function toggleProjectDropdown() {
  showProjectDropdown.value = !showProjectDropdown.value
  if (showProjectDropdown.value && mcpConnected.value) {
    loadingProjects.value = true
    try {
      const root = projectRoot.value
        ? projectRoot.value.replace(/\/projects\/[^/]+$/, '')
        : '/home/adam/paloma'
      availableProjects.value = await listProjects(callMcpTool, root)
    } catch (e) {
      console.warn('[TopBar] Failed to list projects:', e)
      availableProjects.value = []
    } finally {
      loadingProjects.value = false
    }
  }
}

async function handleSwitchProject(name) {
  showProjectDropdown.value = false
  try {
    await switchProject(name, callMcpTool, resolveProjectPath)
  } catch (e) {
    console.error('[TopBar] Failed to switch project:', e)
  }
}

const emit = defineEmits(['open-settings', 'open-project'])

function handleOpenProject() {
  showProjectDropdown.value = false
  emit('open-project')
}

function handleDetachProject() {
  showProjectDropdown.value = false
  detachProject()
}

function handleClickOutside(e) {
  if (projectDropdownRef.value && !projectDropdownRef.value.contains(e.target)) {
    showProjectDropdown.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
</script>
