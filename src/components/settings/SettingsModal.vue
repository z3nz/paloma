<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-lg mx-4 shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 class="text-lg font-semibold text-text-primary">Settings</h2>
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
        <!-- API Key -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">OpenRouter API Key</label>
          <div class="flex gap-2">
            <input
              v-model="localKey"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk-or-..."
              class="flex-1 bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
            />
            <button
              @click="showKey = !showKey"
              class="px-3 py-2 bg-bg-primary border border-border rounded-md text-text-secondary hover:text-text-primary text-sm transition-colors"
            >
              {{ showKey ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>

        <!-- Default Model -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">Default Model</label>
          <select
            v-model="localModel"
            class="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option v-for="m in popularModels" :key="m" :value="m">
              {{ m.split('/').pop() }}
            </option>
          </select>
        </div>

        <!-- Project info -->
        <div v-if="projectName">
          <label class="block text-sm text-text-secondary mb-1.5">Current Project</label>
          <div class="text-sm text-text-primary bg-bg-primary border border-border rounded-md px-3 py-2">
            {{ projectName }}
          </div>
        </div>

        <!-- MCP Bridge -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">MCP Bridge</label>
          <div class="space-y-2">
            <div class="flex gap-2">
              <input
                v-model="localBridgeUrl"
                placeholder="ws://localhost:19191"
                class="flex-1 bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
              <button
                @click="toggleMcpConnection"
                class="px-3 py-2 border border-border rounded-md text-sm transition-colors"
                :class="mcpConnected ? 'bg-danger/20 text-danger hover:bg-danger/30' : 'bg-bg-primary text-text-secondary hover:text-text-primary'"
              >
                {{ mcpConnected ? 'Disconnect' : 'Connect' }}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="w-2 h-2 rounded-full"
                :class="mcpConnected ? 'bg-success' : mcpConnectionState === 'connecting' ? 'bg-warning' : 'bg-text-muted'"
              />
              <span class="text-xs text-text-muted">{{ mcpConnectionState }}</span>
            </div>
            <label class="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" v-model="localAutoConnect" class="rounded" />
              Auto-connect on startup
            </label>
            <div v-if="mcpConnected && Object.keys(mcpServerList).length > 0" class="mt-2 space-y-1.5">
              <p class="text-xs text-text-muted uppercase tracking-wider">Servers</p>
              <div v-for="(info, name) in mcpServerList" :key="name" class="flex items-center justify-between bg-bg-primary border border-border rounded-md px-3 py-2">
                <div class="flex items-center gap-2">
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :class="info.status === 'connected' ? 'bg-success' : 'bg-danger'"
                  />
                  <span class="text-sm text-text-primary">{{ name }}</span>
                </div>
                <span class="text-xs text-text-muted">{{ info.tools?.length || 0 }} tools</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-6 py-4 border-t border-border">
        <button
          @click="$emit('close')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
        <button
          @click="save"
          class="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSettings } from '../../composables/useSettings.js'
import { useMCP } from '../../composables/useMCP.js'

const props = defineProps({
  projectName: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const { apiKey, defaultModel } = useSettings()
const { connected: mcpConnected, connectionState: mcpConnectionState, servers: mcpServerList, bridgeUrl, autoConnect: mcpAutoConnect, connect: mcpConnect, disconnect: mcpDisconnect } = useMCP()

const localKey = ref(apiKey.value)
const localModel = ref(defaultModel.value)
const showKey = ref(false)
const localBridgeUrl = ref(bridgeUrl.value)
const localAutoConnect = ref(mcpAutoConnect.value)

const popularModels = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4',
  'openai/gpt-4o',
  'openai/o1',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-pro-preview',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct'
]

function toggleMcpConnection() {
  if (mcpConnected.value) {
    mcpDisconnect()
  } else {
    mcpConnect(localBridgeUrl.value)
  }
}

function save() {
  apiKey.value = localKey.value
  defaultModel.value = localModel.value
  bridgeUrl.value = localBridgeUrl.value
  mcpAutoConnect.value = localAutoConnect.value
  emit('close')
}
</script>
