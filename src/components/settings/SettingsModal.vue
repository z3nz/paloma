<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
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
      <div class="px-6 py-5 space-y-5 overflow-y-auto">
        <!-- Appearance -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">Appearance</label>
          <div class="flex items-center gap-2 p-1 bg-bg-primary border border-border rounded-lg w-fit">
            <button 
              @click="theme = 'dark'"
              class="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all"
              :class="theme === 'dark' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
              Dark
            </button>
            <button 
              @click="theme = 'light'"
              class="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all"
              :class="theme === 'light' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              Light
            </button>
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
          </div>
        </div>

        <!-- MCP Servers & Tool Permissions (unified) -->
        <div v-if="mcpConnected && Object.keys(mcpServerList).length > 0">
          <label class="block text-sm text-text-secondary mb-1.5">Servers & Permissions</label>
          <div class="space-y-1.5">
            <div v-for="(info, name) in mcpServerList" :key="name">
              <!-- Server row -->
              <div
                class="flex items-center justify-between bg-bg-primary border border-border rounded-md px-3 py-2 cursor-pointer select-none"
                :class="expandedServers.has(name) ? 'rounded-b-none border-b-0' : ''"
                @click="toggleExpand(name)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    class="shrink-0 text-text-muted transition-transform duration-150"
                    :class="expandedServers.has(name) ? 'rotate-90' : ''"
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    :class="info.status === 'connected' ? 'bg-success' : 'bg-danger'"
                  />
                  <span class="text-sm text-text-primary truncate">{{ name }}</span>
                  <span class="text-xs text-text-muted shrink-0">{{ info.tools?.length || 0 }}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded-full shrink-0" :class="permBadgeClass(name)">
                    {{ permBadgeLabel(name) }}
                  </span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0 ml-2" @click.stop>
                  <!-- Server-level actions -->
                  <button
                    v-if="getPermTier(name) === 'project'"
                    @click="revokeProjectApproval(name)"
                    class="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                  >Revoke</button>
                  <template v-if="getPermTier(name) === 'session'">
                    <button
                      v-if="hasProject"
                      @click="promoteToProject(name)"
                      class="text-xs px-2 py-1 rounded border border-border text-accent hover:bg-accent/10 transition-colors"
                    >Promote</button>
                    <button
                      @click="clearServerSession(name)"
                      class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
                    >Clear</button>
                  </template>
                  <template v-if="getPermTier(name) === 'none'">
                    <button
                      v-if="hasProject"
                      @click="promoteToProject(name)"
                      class="text-xs px-2 py-1 rounded border border-border text-accent hover:bg-accent/10 transition-colors"
                    >Auto-approve</button>
                    <button
                      @click="approveServerSession(name)"
                      class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
                    >Session</button>
                  </template>
                </div>
              </div>

              <!-- Expanded tool list -->
              <div
                v-if="expandedServers.has(name)"
                class="bg-bg-primary border border-border border-t-0 rounded-b-md px-2 pb-2 pt-1 space-y-0.5"
              >
                <div
                  v-for="tool in info.tools"
                  :key="tool.name"
                  class="flex items-center justify-between rounded px-2 py-1.5 hover:bg-bg-hover/50 transition-colors group"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-xs font-mono text-text-primary truncate">{{ tool.name }}</span>
                    <span
                      class="text-[10px] px-1 py-0.5 rounded-full shrink-0"
                      :class="toolBadgeClass(name, tool.name)"
                    >{{ toolBadgeLabel(name, tool.name) }}</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <!-- Per-tool actions depend on the server's config shape -->
                    <template v-if="toolTier(name, tool.name) === 'project' && !isServerFullyApproved(name)">
                      <button
                        @click="revokeToolFromProject(name, tool.name)"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                      >Revoke</button>
                    </template>
                    <template v-if="toolTier(name, tool.name) === 'project' && isServerFullyApproved(name)">
                      <button
                        @click="excludeToolFromProject(name, tool.name)"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                      >Exclude</button>
                    </template>
                    <template v-if="toolTier(name, tool.name) === 'session'">
                      <button
                        v-if="hasProject"
                        @click="approveToolProject(name, tool.name)"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-border text-accent hover:bg-accent/10 transition-colors"
                      >Promote</button>
                      <button
                        @click="clearToolSession(name, tool.name)"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
                      >Clear</button>
                    </template>
                    <template v-if="toolTier(name, tool.name) === 'none'">
                      <button
                        v-if="hasProject"
                        @click="approveToolProject(name, tool.name)"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-border text-accent hover:bg-accent/10 transition-colors"
                      >Approve</button>
                      <button
                        @click="approveToolSession(name, tool.name)"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
                      >Session</button>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="sessionCount > 0" class="mt-2">
            <button
              @click="clearAllSessions"
              class="text-xs text-text-muted hover:text-danger transition-colors"
            >Clear all session approvals ({{ sessionCount }})</button>
          </div>
        </div>

        <!-- Default Model -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">Default Model</label>
          <select
            v-model="localModel"
            class="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <optgroup label="Paloma (CLI)">
              <option v-for="m in cliModels" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </optgroup>
            <optgroup v-if="apiKey" label="OpenRouter">
              <option v-for="m in popularModels" :key="m" :value="m">
                {{ m.split('/').pop() }}
              </option>
            </optgroup>
          </select>
        </div>

        <!-- Project info -->
        <div v-if="projectName">
          <label class="block text-sm text-text-secondary mb-1.5">Current Project</label>
          <div class="text-sm text-text-primary bg-bg-primary border border-border rounded-md px-3 py-2">
            {{ projectName }}
          </div>
        </div>

        <!-- Optional Integrations -->
        <div>
          <label class="block text-sm text-text-secondary mb-1.5">OpenRouter API Key</label>
          <p class="text-xs text-text-muted mb-2">Optional. Paloma works with CLI models by default. Add an OpenRouter key for additional models.</p>
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
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
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
import { ref, computed } from 'vue'
import { useSettings } from '../../composables/useSettings.js'
import { useTheme } from '../../composables/useTheme.js'
import { useMCP } from '../../composables/useMCP.js'
import { usePermissions } from '../../composables/usePermissions.js'
import { useProject } from '../../composables/useProject.js'
import { CLI_MODELS } from '../../services/claudeStream.js'

const props = defineProps({
  projectName: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const { apiKey, defaultModel } = useSettings()
const { theme } = useTheme()
const { connected: mcpConnected, connectionState: mcpConnectionState, servers: mcpServerList, bridgeUrl, autoConnect: mcpAutoConnect, connect: mcpConnect, disconnect: mcpDisconnect, callMcpTool } = useMCP()
const { sessionApprovals, approveForSession, revokeSession, approveToolForSession, revokeToolSession, clearSession, getToolPermTier } = usePermissions()
const { projectRoot, mcpConfig } = useProject()

const hasProject = computed(() => !!projectRoot.value && !!mcpConfig.value)
const sessionCount = computed(() => sessionApprovals.value.size)
const expandedServers = ref(new Set())

// --- Server-level permission helpers ---

function getPermTier(serverName) {
  // Check if server has ANY project-level entry (string or object)
  const autoExec = mcpConfig.value?.autoExecute
  if (autoExec) {
    for (const entry of autoExec) {
      if (typeof entry === 'string' && entry === serverName) return 'project'
      if (entry?.server === serverName) return 'project'
    }
  }
  if (sessionApprovals.value.has(serverName)) return 'session'
  return 'none'
}

function isServerFullyApproved(serverName) {
  // True only if the server is a plain string in autoExecute (all tools)
  const autoExec = mcpConfig.value?.autoExecute
  if (!autoExec) return false
  return autoExec.some(e => typeof e === 'string' && e === serverName)
}

function permBadgeLabel(serverName) {
  const tier = getPermTier(serverName)
  if (tier === 'project') {
    if (isServerFullyApproved(serverName)) return 'all'
    const entry = mcpConfig.value?.autoExecute?.find(e => e?.server === serverName)
    if (entry?.tools) return `${entry.tools.length} tools`
    if (entry?.except) return `${entry.except.length} excluded`
    return 'project'
  }
  if (tier === 'session') return 'session'
  return 'ask'
}

function permBadgeClass(serverName) {
  const tier = getPermTier(serverName)
  if (tier === 'project') return 'bg-accent/20 text-accent'
  if (tier === 'session') return 'bg-warning/20 text-warning'
  return 'bg-bg-hover text-text-muted'
}

// --- Per-tool permission helpers ---

function toolTier(serverName, toolName) {
  return getToolPermTier(serverName, toolName, mcpConfig.value)
}

function toolBadgeLabel(serverName, toolName) {
  const tier = toolTier(serverName, toolName)
  if (tier === 'project') return isServerFullyApproved(serverName) ? 'inherited' : 'approved'
  if (tier === 'session') return 'session'
  return 'ask'
}

function toolBadgeClass(serverName, toolName) {
  const tier = toolTier(serverName, toolName)
  if (tier === 'project') return isServerFullyApproved(serverName) ? 'bg-accent/10 text-accent/60' : 'bg-accent/20 text-accent'
  if (tier === 'session') return 'bg-warning/20 text-warning'
  return 'bg-bg-hover text-text-muted'
}

// --- Expand/collapse ---

function toggleExpand(serverName) {
  const next = new Set(expandedServers.value)
  if (next.has(serverName)) next.delete(serverName)
  else next.add(serverName)
  expandedServers.value = next
}

// --- Write helper ---

async function writeMcpConfig() {
  if (!projectRoot.value || !mcpConfig.value) return
  try {
    await callMcpTool('mcp__filesystem__write_file', {
      path: `${projectRoot.value}/.paloma/mcp.json`,
      content: JSON.stringify(mcpConfig.value, null, 2) + '\n'
    })
  } catch (err) {
    console.error('[Settings] Failed to write mcp.json:', err)
  }
}

// --- Server-level actions ---

async function promoteToProject(serverName) {
  if (!mcpConfig.value) return
  const autoExec = mcpConfig.value.autoExecute || []
  // Remove any existing object entry for this server, replace with string
  const filtered = autoExec.filter(e =>
    !(typeof e === 'string' && e === serverName) && !(e?.server === serverName)
  )
  filtered.push(serverName)
  mcpConfig.value = { ...mcpConfig.value, autoExecute: filtered }
  await writeMcpConfig()
  approveForSession(serverName)
}

async function revokeProjectApproval(serverName) {
  if (!mcpConfig.value) return
  const autoExec = (mcpConfig.value.autoExecute || []).filter(e =>
    !(typeof e === 'string' && e === serverName) && !(e?.server === serverName)
  )
  mcpConfig.value = { ...mcpConfig.value, autoExecute: autoExec }
  await writeMcpConfig()
  revokeSession(serverName)
}

function approveServerSession(serverName) {
  approveForSession(serverName)
}

function clearServerSession(serverName) {
  revokeSession(serverName)
}

function clearAllSessions() {
  clearSession()
}

// --- Per-tool project actions ---

async function approveToolProject(serverName, toolName) {
  if (!mcpConfig.value) return
  const autoExec = [...(mcpConfig.value.autoExecute || [])]
  const idx = autoExec.findIndex(e =>
    (typeof e === 'string' && e === serverName) || (e?.server === serverName)
  )

  if (idx === -1) {
    // No entry — create allowlist
    autoExec.push({ server: serverName, tools: [toolName] })
  } else if (typeof autoExec[idx] === 'string') {
    // Already fully approved — tool is covered
    return
  } else {
    const entry = { ...autoExec[idx] }
    if (entry.tools) {
      if (!entry.tools.includes(toolName)) {
        entry.tools = [...entry.tools, toolName]
      }
    } else if (entry.except) {
      entry.except = entry.except.filter(t => t !== toolName)
      if (entry.except.length === 0) {
        autoExec[idx] = serverName
        mcpConfig.value = { ...mcpConfig.value, autoExecute: autoExec }
        await writeMcpConfig()
        return
      }
    }
    autoExec[idx] = entry
  }

  mcpConfig.value = { ...mcpConfig.value, autoExecute: autoExec }
  await writeMcpConfig()
}

async function revokeToolFromProject(serverName, toolName) {
  if (!mcpConfig.value) return
  const autoExec = [...(mcpConfig.value.autoExecute || [])]
  const idx = autoExec.findIndex(e =>
    (typeof e === 'string' && e === serverName) || (e?.server === serverName)
  )
  if (idx === -1) return

  if (typeof autoExec[idx] === 'string') {
    // Full server — convert to except list
    autoExec[idx] = { server: serverName, except: [toolName] }
  } else {
    const entry = { ...autoExec[idx] }
    if (entry.tools) {
      entry.tools = entry.tools.filter(t => t !== toolName)
      if (entry.tools.length === 0) {
        autoExec.splice(idx, 1)
      } else {
        autoExec[idx] = entry
      }
    } else if (entry.except) {
      if (!entry.except.includes(toolName)) {
        entry.except = [...entry.except, toolName]
      }
      autoExec[idx] = entry
    }
  }

  mcpConfig.value = { ...mcpConfig.value, autoExecute: autoExec }
  await writeMcpConfig()
}

async function excludeToolFromProject(serverName, toolName) {
  // Same as revokeToolFromProject — converts string to except list
  await revokeToolFromProject(serverName, toolName)
}

// --- Per-tool session actions ---

function approveToolSession(serverName, toolName) {
  approveToolForSession(serverName, toolName)
}

function clearToolSession(serverName, toolName) {
  revokeToolSession(serverName, toolName)
}

// --- General settings ---

const localKey = ref(apiKey.value)
const localModel = ref(defaultModel.value)
const showKey = ref(false)
const localBridgeUrl = ref(bridgeUrl.value)
const localAutoConnect = ref(mcpAutoConnect.value)

const cliModels = CLI_MODELS

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
