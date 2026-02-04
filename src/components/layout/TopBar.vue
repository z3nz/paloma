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

      <button
        @click="$emit('open-project')"
        class="text-text-secondary hover:text-text-primary text-sm px-2 py-1 rounded hover:bg-bg-hover transition-colors"
      >
        Open Project
      </button>
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
import { ref, computed } from 'vue'
import UsageModal from './UsageModal.vue'
import { useCostTracking } from '../../composables/useCostTracking.js'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  projectName: { type: String, default: '' },
  activeModel: { type: String, default: '' }
})
defineEmits(['open-settings', 'open-project'])

const { sessionCost, sessionTokens, getContextUsage, formatCost, formatTokens } = useCostTracking()
const { connected: mcpConnected, servers: mcpServers, autoConnect: mcpAutoConnect } = useMCP()

const showUsageModal = ref(false)

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
</script>
