<template>
  <slot v-if="!error" />
  <div v-else class="h-full flex items-center justify-center" role="alert">
    <div class="text-center p-8 max-w-lg">
      <div class="mb-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto text-danger/70">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p class="text-lg text-text-secondary mb-2">Something went wrong</p>
      <p class="text-sm text-text-muted mb-4">{{ errorMessage }}</p>

      <!-- Collapsible stack trace -->
      <details v-if="errorStack" class="mb-6 text-left">
        <summary class="text-xs text-text-muted cursor-pointer hover:text-text-secondary transition-colors">
          Show error details
        </summary>
        <pre class="mt-2 p-3 bg-bg-tertiary rounded-md text-xs text-text-muted overflow-auto max-h-48 whitespace-pre-wrap break-words">{{ errorStack }}</pre>
      </details>

      <div class="flex items-center justify-center gap-3">
        <button
          @click="retry"
          class="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          Try Again
        </button>
        <button
          @click="reload"
          class="px-4 py-2 bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary text-sm font-medium rounded-md transition-colors"
        >
          Reload Page
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onErrorCaptured } from 'vue'

const error = ref(null)
const errorInfo = ref(null)

const errorMessage = computed(() => {
  if (!error.value) return ''
  return error.value.message || 'An unexpected error occurred in the application.'
})

const errorStack = computed(() => {
  if (!error.value) return ''
  const parts = []
  if (error.value.stack) parts.push(error.value.stack)
  if (errorInfo.value) parts.push(`Component info: ${errorInfo.value}`)
  return parts.join('\n\n')
})

onErrorCaptured((err, instance, info) => {
  console.error('[ErrorBoundary] Caught error:', err, '\nComponent:', instance, '\nInfo:', info)
  error.value = err
  errorInfo.value = info
  return false // prevent further propagation
})

function retry() {
  error.value = null
  errorInfo.value = null
}

function reload() {
  window.location.reload()
}
</script>
