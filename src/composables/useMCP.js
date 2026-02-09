import { ref, computed, watch } from 'vue'
import { createMcpBridge } from '../services/mcpBridge.js'

const _saved = import.meta.hot ? window.__PALOMA_MCP__ : undefined

const connected = ref(_saved?.connected ?? false)
const connectionState = ref(_saved?.connectionState ?? 'disconnected') // 'disconnected' | 'connecting' | 'connected'
const servers = ref(_saved?.servers ?? {})
const bridgeUrl = ref(_saved?.bridgeUrl ?? (localStorage.getItem('paloma:mcpBridgeUrl') || 'ws://localhost:19191'))
const autoConnect = ref(_saved?.autoConnect ?? (localStorage.getItem('paloma:mcpAutoConnect') === 'true'))

let bridge = _saved?.bridge ?? null

watch(bridgeUrl, (val) => localStorage.setItem('paloma:mcpBridgeUrl', val))
watch(autoConnect, (val) => localStorage.setItem('paloma:mcpAutoConnect', String(val)))

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_MCP__ = {
      connected: connected.value,
      connectionState: connectionState.value,
      servers: servers.value,
      bridgeUrl: bridgeUrl.value,
      autoConnect: autoConnect.value,
      bridge
    }
  }
  save()
  watch([connected, connectionState, servers, bridgeUrl, autoConnect], save, { flush: 'sync' })
  import.meta.hot.accept()
}

// Flatten all server tools into OpenRouter format
const mcpTools = computed(() => {
  const tools = []
  for (const [serverName, serverInfo] of Object.entries(servers.value)) {
    if (serverInfo.status !== 'connected') continue
    for (const tool of serverInfo.tools) {
      tools.push({
        type: 'function',
        function: {
          name: `mcp__${serverName}__${tool.name}`,
          description: tool.description || '',
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
      })
    }
  }
  return tools
})

function getEnabledTools(mcpConfig) {
  if (!mcpConfig?.enabled?.length) return []
  const enabledSet = new Set(mcpConfig.enabled)
  return mcpTools.value.filter(t => {
    const serverName = t.function.name.split('__')[1]
    return enabledSet.has(serverName)
  })
}

function getAutoExecuteServers(mcpConfig) {
  return new Set(mcpConfig?.autoExecute || [])
}

export function useMCP() {
  function connect(url) {
    if (url) bridgeUrl.value = url

    if (!bridge) {
      bridge = createMcpBridge()
    }

    bridge.connect(bridgeUrl.value, {
      onStateChange(state) {
        connectionState.value = state
        connected.value = state === 'connected'
      },
      onToolsUpdate(serverData) {
        servers.value = serverData
      }
    })
  }

  function disconnect() {
    if (bridge) {
      bridge.disconnect()
      connected.value = false
      connectionState.value = 'disconnected'
    }
  }

  function refreshTools() {
    if (bridge && connected.value) {
      bridge.discover()
    }
  }

  async function callMcpTool(namespacedName, args) {
    if (!bridge || !connected.value) {
      return JSON.stringify({ error: 'MCP bridge not connected' })
    }
    const { server, tool } = parseMcpToolName(namespacedName)
    try {
      const result = await bridge.callTool(server, tool, args)
      if (result.isError) {
        return JSON.stringify({ error: result.content })
      }
      return result.content
    } catch (e) {
      return JSON.stringify({ error: e.message })
    }
  }

  // Auto-connect on first use if configured
  if (autoConnect.value && !connected.value && connectionState.value === 'disconnected') {
    connect()
  }

  function sendClaudeChat(options, callbacks) {
    if (!bridge || !connected.value) throw new Error('Bridge not connected')
    return bridge.sendClaudeChat(options, callbacks)
  }

  function stopClaudeChat(requestId) {
    if (bridge) bridge.stopClaudeChat(requestId)
  }

  return {
    connected,
    connectionState,
    servers,
    mcpTools,
    bridgeUrl,
    autoConnect,
    connect,
    disconnect,
    refreshTools,
    callMcpTool,
    sendClaudeChat,
    stopClaudeChat,
    getEnabledTools,
    getAutoExecuteServers
  }
}

export function isMcpTool(name) {
  return name.startsWith('mcp__')
}

export function parseMcpToolName(name) {
  const parts = name.split('__')
  return { server: parts[1], tool: parts.slice(2).join('__') }
}
