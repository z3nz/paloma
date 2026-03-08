import { ref, reactive, computed, watch } from 'vue'
import { createMcpBridge } from '../services/mcpBridge.js'
import { useSessions } from './useSessions.js'
import { useSessionState } from './useSessionState.js'
import { useProject } from './useProject.js'
import db from '../services/db.js'

// Map pillarId → dbSessionId for routing stream events
const pillarSessionMap = new Map()
// Track the registered Flow session's dbSessionId for callback routing
let registeredFlowDbSessionId = null
// Track pending notification metadata between start and done events
let pendingNotificationMeta = null

// Reactive: whether Flow is currently processing a callback notification
const flowProcessingCallback = ref(false)

// pillarId → 'running' | 'streaming' | 'idle' | 'error' | 'stopped'
const pillarStatuses = reactive(new Map())

const _saved = import.meta.hot ? window.__PALOMA_MCP__ : undefined

const connected = ref(_saved?.connected ?? false)
const connectionState = ref(_saved?.connectionState ?? 'disconnected') // 'disconnected' | 'connecting' | 'connected'
const servers = ref(_saved?.servers ?? {})
const bridgeUrl = ref(_saved?.bridgeUrl ?? (localStorage.getItem('paloma:mcpBridgeUrl') || 'ws://localhost:19191'))
const autoConnect = ref(_saved?.autoConnect ?? (localStorage.getItem('paloma:mcpAutoConnect') !== 'false'))

const pendingAskUser = ref(_saved?.pendingAskUser ?? null)
const pendingCliToolConfirmation = ref(_saved?.pendingCliToolConfirmation ?? null)
const cliToolConfirmationQueue = _saved?.cliToolConfirmationQueue ?? []

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
      pendingAskUser: pendingAskUser.value,
      pendingCliToolConfirmation: pendingCliToolConfirmation.value,
      cliToolConfirmationQueue,
      bridge
    }
  }
  save()
  watch([connected, connectionState, servers, bridgeUrl, autoConnect, pendingAskUser, pendingCliToolConfirmation], save, { flush: 'sync' })
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
      },
      onCliToolActivity(toolName, args, status) {
        // CLI tool activity is surfaced via useToolExecution in useCliChat
      },
      onCliToolConfirmation(id, toolName, args) {
        if (pendingCliToolConfirmation.value) {
          // Queue concurrent confirmations instead of overwriting
          cliToolConfirmationQueue.push({ id, toolName, args })
        } else {
          pendingCliToolConfirmation.value = { id, toolName, args }
        }
      },
      onAskUser(id, question, options) {
        pendingAskUser.value = { id, question, options }
      },
      onSetTitle(title) {
        const { activeSessionId, updateSession } = useSessions()
        if (activeSessionId.value && title) {
          updateSession(activeSessionId.value, { title })
        }
      },
      async onPillarSessionCreated(msg) {
        // Create a real session in IndexedDB for the pillar
        const { createPillarSession } = useSessions()
        const { projectName } = useProject()
        const projectPath = projectName.value || 'paloma'
        const dbSessionId = await createPillarSession(
          projectPath,
          msg.model,
          msg.pillar,
          msg.pillarId,
          registeredFlowDbSessionId,
          msg.prompt
        )
        // Map pillarId to dbSessionId for stream routing
        pillarSessionMap.set(msg.pillarId, dbSessionId)
        // Tell the bridge about the dbSessionId
        if (bridge) {
          bridge.sendPillarDbSessionId(msg.pillarId, dbSessionId)
        }
        pillarStatuses.set(msg.pillarId, 'running')
      },
      onPillarStream(pillarId, event) {
        const dbSessionId = pillarSessionMap.get(pillarId)
        if (!dbSessionId) return
        const { getState } = useSessionState()
        const state = getState(dbSessionId)
        state.streaming.value = true
        pillarStatuses.set(pillarId, 'streaming')

        // Accumulate text content from stream events
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              state.streamingContent.value += block.text
            }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            state.streamingContent.value += event.delta.text
          }
        }
      },
      async onPillarMessageSaved(msg) {
        const dbSessionId = pillarSessionMap.get(msg.pillarId)
        if (!dbSessionId) return
        const { getState } = useSessionState()
        const state = getState(dbSessionId)

        // Persist the message to IndexedDB
        const dbMsg = {
          sessionId: dbSessionId,
          role: msg.role,
          content: msg.content || '',
          files: [],
          timestamp: Date.now()
        }
        const msgId = await db.messages.add(dbMsg)
        dbMsg.id = msgId
        state.messages.value.push(dbMsg)

        // Reset streaming state after assistant message is saved
        if (msg.role === 'assistant') {
          state.streaming.value = false
          state.streamingContent.value = ''
        }

        // Update session timestamp
        const { updateSession } = useSessions()
        await updateSession(dbSessionId, {})
      },
      onPillarDone(msg) {
        const dbSessionId = pillarSessionMap.get(msg.pillarId)
        if (!dbSessionId) return
        const { getState } = useSessionState()
        const state = getState(dbSessionId)
        state.streaming.value = false
        state.streamingContent.value = ''

        // Track pillar status
        const status = msg.status || 'idle'
        pillarStatuses.set(msg.pillarId, status)
        const { updateSession } = useSessions()
        updateSession(dbSessionId, { pillarStatus: status })

        // If stopped or error, clean up the map
        if (msg.status === 'stopped' || msg.status === 'error') {
          pillarSessionMap.delete(msg.pillarId)
        }
      },
      onFlowNotificationStart(msg) {
        // Store metadata for tagging the saved message when done
        pendingNotificationMeta = {
          notificationType: msg.notificationType,
          pillar: msg.pillar,
          pillarId: msg.pillarId
        }
        flowProcessingCallback.value = true
        console.log('[mcp] Flow notification start:', pendingNotificationMeta)
      },
      onFlowNotificationStream(event) {
        // Flow callback response streaming — route to the registered Flow session
        if (!registeredFlowDbSessionId) {
          console.warn('[mcp] Flow notification stream but no registered Flow session')
          return
        }
        const { getState } = useSessionState()
        const state = getState(registeredFlowDbSessionId)
        state.streaming.value = true

        // Accumulate text content (same logic as pillar stream)
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              state.streamingContent.value += block.text
            }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            state.streamingContent.value += event.delta.text
          }
        }
      },
      async onFlowNotificationDone() {
        // Flow callback response complete — save as assistant message
        if (!registeredFlowDbSessionId) return
        const { updateSession } = useSessions()
        const { getState } = useSessionState()
        const state = getState(registeredFlowDbSessionId)
        const content = state.streamingContent.value

        if (content) {
          const meta = pendingNotificationMeta || {}
          const dbMsg = {
            sessionId: registeredFlowDbSessionId,
            role: 'assistant',
            content,
            model: 'claude-cli:opus',
            files: [],
            timestamp: Date.now(),
            isCallback: true,
            callbackType: meta.notificationType || null,
            callbackPillar: meta.pillar || null,
            callbackPillarId: meta.pillarId || null
          }
          const msgId = await db.messages.add(dbMsg)
          dbMsg.id = msgId
          state.messages.value.push(dbMsg)
          await updateSession(registeredFlowDbSessionId, {})
          console.log('[mcp] Flow callback response saved, length:', content.length, 'meta:', meta)
        }

        pendingNotificationMeta = null
        flowProcessingCallback.value = false
        state.streaming.value = false
        state.streamingContent.value = ''
      },
      onFlowNotificationError(error) {
        console.error('[mcp] Flow notification error:', error)
        pendingNotificationMeta = null
        flowProcessingCallback.value = false
        if (!registeredFlowDbSessionId) return
        const { getState } = useSessionState()
        const state = getState(registeredFlowDbSessionId)
        state.streaming.value = false
        state.streamingContent.value = ''
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

  function registerFlowSession(cliSessionId, model, cwd, dbSessionId) {
    if (bridge) bridge.registerFlowSession(cliSessionId, model, cwd)
    if (dbSessionId) {
      registeredFlowDbSessionId = dbSessionId
      console.log('[mcp] Registered Flow dbSessionId for callbacks:', dbSessionId)
    }
  }

  function sendPillarUserMessage(pillarId, message) {
    if (bridge && connected.value) {
      bridge.sendPillarUserMessage(pillarId, message)
    }
  }

  function respondToAskUser(answer) {
    if (!pendingAskUser.value || !bridge) return
    bridge.respondToAskUser(pendingAskUser.value.id, answer)
    pendingAskUser.value = null
  }

  function _advanceConfirmationQueue() {
    if (cliToolConfirmationQueue.length > 0) {
      pendingCliToolConfirmation.value = cliToolConfirmationQueue.shift()
    } else {
      pendingCliToolConfirmation.value = null
    }
  }

  function approveCliTool(result) {
    if (!pendingCliToolConfirmation.value || !bridge) return
    bridge.respondToToolConfirmation(pendingCliToolConfirmation.value.id, true, result)
    _advanceConfirmationQueue()
  }

  function denyCliTool(reason) {
    if (!pendingCliToolConfirmation.value || !bridge) return
    bridge.respondToToolConfirmation(pendingCliToolConfirmation.value.id, false, undefined, reason)
    _advanceConfirmationQueue()
  }

  async function resolveProjectPath(name) {
    if (!bridge || !connected.value) return null
    try {
      return await bridge.resolveProjectPath(name)
    } catch {
      return null
    }
  }

  async function exportChats(projectPath) {
    if (!bridge || !connected.value) {
      throw new Error('MCP bridge not connected')
    }
    const rawSessions = await db.sessions
      .where('projectPath')
      .equals(projectPath)
      .toArray()

    const sessions = await Promise.all(rawSessions.map(async (s) => {
      const rawMessages = await db.messages
        .where('sessionId')
        .equals(s.id)
        .sortBy('timestamp')

      const messages = rawMessages.map((m) => {
        const msg = { role: m.role, content: m.content }
        if (m.files?.length) msg.files = m.files
        if (m.model) msg.model = m.model
        if (m.usage) msg.usage = m.usage
        if (m.toolName) msg.toolName = m.toolName
        if (m.toolArgs) msg.toolArgs = m.toolArgs
        if (m.toolCallId) msg.toolCallId = m.toolCallId
        if (m.toolCalls) msg.toolCalls = m.toolCalls
        if (m.timestamp) msg.timestamp = new Date(m.timestamp).toISOString()
        return msg
      })

      return {
        id: s.id,
        title: s.title || 'Untitled',
        model: s.model,
        phase: s.phase,
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
        updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
        messages
      }
    }))

    return bridge.exportChats(projectPath, sessions)
  }

  return {
    connected,
    connectionState,
    servers,
    mcpTools,
    bridgeUrl,
    autoConnect,
    pendingAskUser,
    pendingCliToolConfirmation,
    connect,
    disconnect,
    refreshTools,
    callMcpTool,
    sendClaudeChat,
    stopClaudeChat,
    respondToAskUser,
    approveCliTool,
    denyCliTool,
    resolveProjectPath,
    exportChats,
    getEnabledTools,
    getAutoExecuteServers,
    registerFlowSession,
    sendPillarUserMessage,
    flowProcessingCallback,
    pillarStatuses
  }
}

export function isMcpTool(name) {
  return name.startsWith('mcp__')
}

export function parseMcpToolName(name) {
  const parts = name.split('__')
  return { server: parts[1], tool: parts.slice(2).join('__') }
}
