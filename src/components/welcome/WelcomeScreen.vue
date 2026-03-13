<template>
  <div class="h-full flex items-center justify-center bg-bg-primary">
    <div class="w-full max-w-md px-8">
      <!-- Logo -->
      <div class="text-center mb-10">
        <h1 class="brand-wordmark text-3xl text-text-primary mb-2">P A L O M A</h1>
        <p class="text-text-secondary text-sm">AI-powered development workflows, locally.</p>
      </div>

      <!-- Connecting state -->
      <div v-if="connectionState === 'connecting'" class="text-center space-y-4">
        <div class="flex items-center justify-center gap-2 text-text-secondary">
          <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span class="text-sm">Connecting to bridge...</span>
        </div>
      </div>

      <!-- Not connected — setup help -->
      <div v-else-if="!connected" class="space-y-4">
        <div class="bg-bg-secondary border border-border rounded-lg p-4 space-y-3">
          <p class="text-sm text-text-secondary">
            Paloma needs the bridge server to run. Start it with:
          </p>
          <div class="bg-bg-primary border border-border rounded-md px-3 py-2 font-mono text-sm text-text-primary select-all">
            node bridge/index.js
          </div>
          <p class="text-xs text-text-muted">
            The bridge connects Paloma to Claude CLI and MCP tools.
          </p>
        </div>

        <div class="flex gap-2">
          <input
            v-model="localBridgeUrl"
            placeholder="ws://localhost:19191"
            class="flex-1 bg-bg-secondary border border-border rounded-md px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            @keydown.enter="handleConnect"
          />
          <button
            @click="handleConnect"
            class="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-md transition-colors text-sm whitespace-nowrap"
          >
            Connect
          </button>
        </div>

        <p v-if="connectionError" class="text-danger text-sm">{{ connectionError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useMCP } from '../../composables/useMCP.js'

const { connected, connectionState, bridgeUrl, connect } = useMCP()

const localBridgeUrl = ref(bridgeUrl.value)
const connectionError = ref('')

// Watch for failed connections
watch(connectionState, (state, oldState) => {
  if (oldState === 'connecting' && state === 'disconnected') {
    connectionError.value = 'Could not connect. Is the bridge running?'
  }
  if (state === 'connected') {
    connectionError.value = ''
  }
})

function handleConnect() {
  connectionError.value = ''
  bridgeUrl.value = localBridgeUrl.value
  connect(localBridgeUrl.value)
}
</script>
