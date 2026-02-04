<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-md mx-4 shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 class="text-lg font-semibold text-text-primary">Usage Summary</h2>
        <button
          @click="$emit('close')"
          class="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 py-5 space-y-5">
        <!-- Session cost -->
        <div class="text-center">
          <div class="text-3xl font-bold text-text-primary">{{ formatCost(sessionCost) }}</div>
          <div class="text-sm text-text-muted mt-1">Session Cost</div>
        </div>

        <!-- Token breakdown -->
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-bg-primary border border-border rounded-md p-3 text-center">
            <div class="text-sm font-semibold text-text-primary">{{ formatTokens(sessionTokens.prompt) }}</div>
            <div class="text-xs text-text-muted mt-0.5">Prompt</div>
          </div>
          <div class="bg-bg-primary border border-border rounded-md p-3 text-center">
            <div class="text-sm font-semibold text-text-primary">{{ formatTokens(sessionTokens.completion) }}</div>
            <div class="text-xs text-text-muted mt-0.5">Completion</div>
          </div>
          <div class="bg-bg-primary border border-border rounded-md p-3 text-center">
            <div class="text-sm font-semibold text-text-primary">{{ formatTokens(sessionTokens.total) }}</div>
            <div class="text-xs text-text-muted mt-0.5">Total</div>
          </div>
        </div>

        <!-- Context usage bar -->
        <div v-if="contextUsage">
          <div class="flex items-center justify-between text-sm mb-2">
            <span class="text-text-secondary">Context Usage</span>
            <span :class="contextUsage.percentage >= 80 ? 'text-warning' : 'text-text-muted'">
              {{ Math.round(contextUsage.percentage) }}%
            </span>
          </div>
          <div class="w-full h-2.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all"
              :class="contextUsage.percentage >= 90 ? 'bg-error' : contextUsage.percentage >= 80 ? 'bg-warning' : 'bg-accent'"
              :style="{ width: Math.min(contextUsage.percentage, 100) + '%' }"
            />
          </div>
          <div class="flex justify-between text-xs text-text-muted mt-1">
            <span>{{ formatTokens(contextUsage.used) }} used</span>
            <span>{{ formatTokens(contextUsage.limit) }} limit</span>
          </div>
        </div>

        <!-- Warning banner -->
        <div v-if="contextUsage && contextUsage.percentage >= 80" class="bg-warning/10 border border-warning/30 rounded-md px-4 py-3 text-sm text-warning">
          Context is {{ Math.round(contextUsage.percentage) }}% full. Consider starting a new session to avoid hitting limits.
        </div>

        <!-- Project total -->
        <div v-if="projectCost !== null" class="border-t border-border pt-4">
          <div class="flex items-center justify-between">
            <span class="text-sm text-text-secondary">Project Total</span>
            <span class="text-sm font-semibold text-text-primary">{{ formatCost(projectCost) }}</span>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end px-6 py-4 border-t border-border">
        <button
          @click="$emit('close')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useCostTracking } from '../../composables/useCostTracking.js'

const props = defineProps({
  activeModel: { type: String, default: '' },
  projectPath: { type: String, default: '' }
})

defineEmits(['close'])

const { sessionCost, sessionTokens, getContextUsage, getProjectCost, formatCost, formatTokens } = useCostTracking()

const contextUsage = ref(null)
const projectCost = ref(null)

onMounted(async () => {
  if (props.activeModel) {
    contextUsage.value = getContextUsage(props.activeModel)
  }
  if (props.projectPath) {
    projectCost.value = await getProjectCost(props.projectPath)
  }
})
</script>
