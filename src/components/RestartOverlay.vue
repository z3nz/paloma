<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="restartPending"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      >
        <div class="flex flex-col items-center gap-4">
          <!-- Spinner -->
          <div class="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
          <p class="text-2xl font-semibold text-white">Restarting...</p>
          <p class="text-sm text-white/60">Paloma is rebuilding and restarting. This page will reload automatically.</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useMCP } from '../composables/useMCP.js'

const { restartPending } = useMCP()
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
