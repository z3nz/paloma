<template>
  <slot v-if="!error" />
  <div v-else class="h-full flex items-center justify-center">
    <div class="text-center p-8">
      <p class="text-lg text-text-secondary mb-2">Something went wrong</p>
      <p class="text-sm text-text-muted mb-6">An unexpected error occurred in the application.</p>
      <button
        @click="reload"
        class="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
      >
        Reload
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'

const error = ref(null)

onErrorCaptured((err, instance, info) => {
  console.error('[ErrorBoundary] Caught error:', err, '\nComponent:', instance, '\nInfo:', info)
  error.value = err
  return false // prevent further propagation
})

function reload() {
  window.location.reload()
}
</script>
