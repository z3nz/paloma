import { ref, reactive, computed, watch } from 'vue'
import { createMcpBridge } from '../services/mcpBridge.js'
import { useSessions } from './useSessions.js'
import { useSessionState } from './useSessionState.js'
import { useToolExecution } from './useToolExecution.js'
import { useProject } from './useProject.js'
import { classifyResult } from '../utils/toolClassifier.js'
import db from '../services/db.js'

// Map pillarId → dbSessionId for routing stream events
const pillarSessionMap = new Map()
// Map Flow CLI session IDs to their browser DB session IDs for correct pillar routing
const flowDbSessionMap = new Map()
// The most recently registered Flow dbSessionId (used for notification routing)
let activeFlowDbSessionId = null
// Track pending notification metadata between start and done events
let pendingNotificationMeta = null
// Email session routing
const emailSessionMap = new Map() // requestId → dbSessionId
const pendingEmailSessions = new Map() // emailSubject → dbSessionId
let activeEmailDbSessionId = null
// Email tool tracking (parallel to useCliChat.js toolUseToActivity/toolUseMeta)
const emailToolUseToActivity = new Map() // `${requestId}:${toolUseId}` → activityId
const emailToolUseMeta = new Map()       // `${requestId}:${toolUseId}` → { name, args }
const emailUsageMap = new Map()          // requestId → { promptTokens, completionTokens, totalTokens }

// Reactive: whether Flow is currently processing a callback notification
const flowProcessingCallback = ref(false)

// pillarId → 'running' | 'streaming' | 'idle' | 'error' | 'stopped'
const pillarStatuses = reactive(new Map())
// pillarId → phase name ('scout', 'chart', 'forge', 'polish', 'ship')
const pillarPhases = reactive(new Map())
// pillarId → parent Flow dbSessionId (for scoping pillar display to parent chat)
const pillarParents = reactive(new Map())
// pillarId → dbSessionId (for navigating to pillar chat)
const pillarDbSessions = reactive(new Map())
// Track cleanup timers to prevent unbounded accumulation
const pillarCleanupTimers = new Map()
// Buffer stream events that arrive before onPillarSessionCreated completes (race condition fix)
const pillarStreamBuffer = new Map() // pillarId → [{ event, backend }]

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

// Shared helper: accumulate text from a pillar stream event into session state
function _accumulatePillarStream(state, event, backend) {
  if (backend === 'codex') {
    if (event.type === 'agent_message' && event.text) {
      state.streamingContent.value += event.text
    }
  } else {
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
  }
}

export function useMCP() {
  function connect(url) {
    if (url) bridgeUrl.value = url

    if (!bridge) {
      bridge = createMcpBridge()
    }

    bridge.connect(bridgeUrl.value, {
      async onStateChange(state) {
        connectionState.value = state
        connected.value = state === 'connected'
        // On reconnect, rebuild pillarSessionMap from IndexedDB + active backend pillars
        if (state === 'connected') {
          try {
            await _reconcilePillarSessions()
          } catch (e) {
            console.warn('[pillar] Failed to reconcile pillar sessions on reconnect:', e)
          }
        }
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
        const targetId = activeEmailDbSessionId !== null ? activeEmailDbSessionId : activeSessionId.value
        if (targetId && title) {
          updateSession(targetId, { title })
        }
      },
      async onPillarSessionCreated(msg) {
        // Create a real session in IndexedDB for the pillar
        const { createPillarSession } = useSessions()
        const { projectName } = useProject()
        const projectPath = projectName.value || 'paloma'
        // Look up the correct parent Flow session by CLI session ID
        const parentDbSessionId = (msg.flowCliSessionId && flowDbSessionMap.get(msg.flowCliSessionId)) || activeFlowDbSessionId
        const dbSessionId = await createPillarSession(
          projectPath,
          msg.model,
          msg.pillar,
          msg.pillarId,
          parentDbSessionId,
          msg.prompt
        )
        // Map pillarId to dbSessionId for stream routing
        pillarSessionMap.set(msg.pillarId, dbSessionId)
        // Tell the bridge about the dbSessionId
        if (bridge) {
          bridge.sendPillarDbSessionId(msg.pillarId, dbSessionId)
        }
        pillarStatuses.set(msg.pillarId, 'running')
        pillarPhases.set(msg.pillarId, msg.pillar)
        pillarParents.set(msg.pillarId, parentDbSessionId)
        pillarDbSessions.set(msg.pillarId, dbSessionId)

        // Drain any stream events that arrived before the session was created (race condition)
        const buffered = pillarStreamBuffer.get(msg.pillarId)
        if (buffered) {
          pillarStreamBuffer.delete(msg.pillarId)
          const { getState } = useSessionState()
          const state = getState(dbSessionId)
          state.streaming.value = true
          for (const { event, backend } of buffered) {
            _accumulatePillarStream(state, event, backend)
          }
        }
      },
      async onPillarCliSession(msg) {
        // Backend is telling us the cliSessionId — persist to IndexedDB for resume-after-restart
        const dbSessionId = pillarSessionMap.get(msg.pillarId)
        if (dbSessionId) {
          const { updateSession } = useSessions()
          await updateSession(dbSessionId, { cliSessionId: msg.cliSessionId })
        }
      },
      onPillarStream(pillarId, event, backend) {
        const dbSessionId = pillarSessionMap.get(pillarId)
        if (!dbSessionId) {
          // Session creation still in progress — buffer the event
          if (!pillarStreamBuffer.has(pillarId)) {
            pillarStreamBuffer.set(pillarId, [])
          }
          pillarStreamBuffer.get(pillarId).push({ event, backend })
          return
        }
        const { getState } = useSessionState()
        const state = getState(dbSessionId)
        state.streaming.value = true
        pillarStatuses.set(pillarId, 'streaming')
        _accumulatePillarStream(state, event, backend)
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
      async onPillarDone(msg) {
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
        // Clear cliSessionId so we don't try to reattach completed sessions
        await updateSession(dbSessionId, { cliSessionId: null, pillarStatus: status })

        // Only clean up session mapping for truly terminal states.
        // 'idle' pillars can still receive follow-up messages via pillar_message,
        // so we must keep their routing entry alive.
        const isTerminal = status === 'stopped' || status === 'error'
        if (isTerminal) {
          pillarSessionMap.delete(msg.pillarId)
          pillarStreamBuffer.delete(msg.pillarId)
        }

        // Clean up status display after delay for all done states
        {
          const existingTimer = pillarCleanupTimers.get(msg.pillarId)
          if (existingTimer) clearTimeout(existingTimer)
          const timer = setTimeout(() => {
            pillarStatuses.delete(msg.pillarId)
            pillarPhases.delete(msg.pillarId)
            pillarParents.delete(msg.pillarId)
            pillarDbSessions.delete(msg.pillarId)
            pillarCleanupTimers.delete(msg.pillarId)
          }, 30000)
          pillarCleanupTimers.set(msg.pillarId, timer)
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
      },
      onFlowNotificationStream(event) {
        // Flow callback response streaming — route to the registered Flow session
        if (!activeFlowDbSessionId) {
          console.warn('[mcp] Flow notification stream but no registered Flow session')
          return
        }
        const { getState } = useSessionState()
        const state = getState(activeFlowDbSessionId)
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
        if (!activeFlowDbSessionId) return
        const { updateSession } = useSessions()
        const { getState } = useSessionState()
        const state = getState(activeFlowDbSessionId)
        const content = state.streamingContent.value

        if (content) {
          const meta = pendingNotificationMeta || {}
          const dbMsg = {
            sessionId: activeFlowDbSessionId,
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
          await updateSession(activeFlowDbSessionId, {})
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
        if (!activeFlowDbSessionId) return
        const { getState } = useSessionState()
        const state = getState(activeFlowDbSessionId)
        state.streaming.value = false
        state.streamingContent.value = ''
      },
      async onEmailReceived(msg) {
        const { createPillarSession, updateSession } = useSessions()
        const { projectName } = useProject()
        const projectPath = projectName.value || 'paloma'
        const summary = [`From: ${msg.from}`, `Subject: ${msg.subject}`, '', msg.body || ''].join('\n')
        const dbSessionId = await createPillarSession(
          projectPath,
          'claude-cli:opus',
          'flow',
          `email:${msg.messageId}`,
          null,
          summary
        )
        await updateSession(dbSessionId, { title: msg.subject })
        pendingEmailSessions.set(msg.subject, dbSessionId)
        activeEmailDbSessionId = dbSessionId
      },
      async onEmailStream(id, event, emailSubject) {
        let dbSessionId = emailSessionMap.get(id)
        if (!dbSessionId) {
          dbSessionId = pendingEmailSessions.get(emailSubject)
          if (dbSessionId) {
            pendingEmailSessions.delete(emailSubject)
          } else {
            // email_received didn't arrive first — create session on-the-fly
            const { createPillarSession, updateSession } = useSessions()
            const { projectName } = useProject()
            const projectPath = projectName.value || 'paloma'
            dbSessionId = await createPillarSession(
              projectPath,
              'claude-cli:opus',
              'flow',
              `email:${id}`,
              null,
              null
            )
            await updateSession(dbSessionId, { title: emailSubject || 'Incoming Email' })
          }
          emailSessionMap.set(id, dbSessionId)
          activeEmailDbSessionId = dbSessionId
        }
        const { getState } = useSessionState()
        const state = getState(dbSessionId)
        const { addActivity, markActivityDone } = useToolExecution(state)
        state.streaming.value = true

        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              state.streamingContent.value += block.text
            } else if (block.type === 'tool_use') {
              // Track tool use — same as useCliChat.js
              const activityId = addActivity(block.name, block.input)
              emailToolUseToActivity.set(`${id}:${block.id}`, activityId)
              emailToolUseMeta.set(`${id}:${block.id}`, { name: block.name, args: block.input })
            }
          }
        } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          // CLI stream-json emits tool_use via content_block_start
          const block = event.content_block
          const activityId = addActivity(block.name, block.input || {})
          emailToolUseToActivity.set(`${id}:${block.id}`, activityId)
          emailToolUseMeta.set(`${id}:${block.id}`, { name: block.name, args: block.input || {} })
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            state.streamingContent.value += event.delta.text
          }
        } else if (event.type === 'user' && event.message?.content) {
          // Tool results come as user-type events with tool_result content blocks
          for (const block of event.message.content) {
            if (block.type === 'tool_result') {
              const key = `${id}:${block.tool_use_id}`
              const activityId = emailToolUseToActivity.get(key)
              const meta = emailToolUseMeta.get(key)

              // Normalize result content to string
              let resultStr
              try {
                resultStr = Array.isArray(block.content)
                  ? block.content.map(c => c.text || '').join('')
                  : typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
              } catch {
                resultStr = '[Error serializing tool result]'
              }

              if (activityId) markActivityDone(activityId, resultStr)

              // Persist as role:'tool' message — same as useCliChat.js
              if (meta) {
                const toolMsg = JSON.parse(JSON.stringify({
                  sessionId: dbSessionId,
                  role: 'tool',
                  toolCallId: activityId || block.tool_use_id,
                  toolName: meta.name,
                  toolArgs: meta.args,
                  content: resultStr,
                  resultType: classifyResult(meta.name, resultStr),
                  timestamp: Date.now()
                }))
                const toolMsgId = await db.messages.add(toolMsg)
                toolMsg.id = toolMsgId
                state.messages.value.push(toolMsg)
              }

              emailToolUseToActivity.delete(key)
              emailToolUseMeta.delete(key)
            }
          }
        } else if (event.type === 'result') {
          // Capture usage data for attachment in onEmailDone
          if (event.usage) {
            emailUsageMap.set(id, {
              promptTokens: event.usage.input_tokens || 0,
              completionTokens: event.usage.output_tokens || 0,
              totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
            })
          }
          // Result event may contain tool_result blocks
          if (event.result?.content) {
            for (const block of (Array.isArray(event.result.content) ? event.result.content : [])) {
              if (block.type === 'tool_result') {
                const key = `${id}:${block.tool_use_id}`
                const activityId = emailToolUseToActivity.get(key)
                const meta = emailToolUseMeta.get(key)
                const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                if (activityId) markActivityDone(activityId, resultContent)
                if (meta) {
                  const toolMsg = JSON.parse(JSON.stringify({
                    sessionId: dbSessionId,
                    role: 'tool',
                    toolCallId: activityId || block.tool_use_id,
                    toolName: meta.name,
                    toolArgs: meta.args,
                    content: resultContent,
                    resultType: classifyResult(meta.name, resultContent),
                    timestamp: Date.now()
                  }))
                  const toolMsgId = await db.messages.add(toolMsg)
                  toolMsg.id = toolMsgId
                  state.messages.value.push(toolMsg)
                }
                emailToolUseToActivity.delete(key)
                emailToolUseMeta.delete(key)
              }
            }
          }
        }
      },
      async onEmailDone(id, cliSessionId, exitCode) {
        const dbSessionId = emailSessionMap.get(id)
        if (!dbSessionId) return
        const { getState } = useSessionState()
        const { updateSession } = useSessions()
        const state = getState(dbSessionId)
        const { snapshotActivity, clearActivity, toolActivity, markActivityDone } = useToolExecution(state)
        const content = state.streamingContent.value

        // Safety net: mark any still-running activities as done (same as useCliChat.js)
        for (const activity of toolActivity.value) {
          if (activity.status === 'running') {
            markActivityDone(activity.id)
          }
        }

        if (content) {
          const toolActivitySnapshot = snapshotActivity()
          const usage = emailUsageMap.get(id) || null

          const dbMsg = {
            sessionId: dbSessionId,
            role: 'assistant',
            content,
            model: 'claude-cli:opus',
            files: [],
            timestamp: Date.now()
          }
          if (usage) dbMsg.usage = usage
          if (toolActivitySnapshot?.length) dbMsg.toolActivity = toolActivitySnapshot

          const msgId = await db.messages.add(dbMsg)
          dbMsg.id = msgId
          state.messages.value.push(dbMsg)
        }

        await updateSession(dbSessionId, {})
        state.streaming.value = false
        state.streamingContent.value = ''
        clearActivity()
        emailSessionMap.delete(id)
        emailUsageMap.delete(id)
        // Clean up any lingering tool tracking for this request
        for (const key of emailToolUseToActivity.keys()) {
          if (key.startsWith(`${id}:`)) emailToolUseToActivity.delete(key)
        }
        for (const key of emailToolUseMeta.keys()) {
          if (key.startsWith(`${id}:`)) emailToolUseMeta.delete(key)
        }
        if (activeEmailDbSessionId === dbSessionId) activeEmailDbSessionId = null
      },
      onEmailError(id, error) {
        console.error('[mcp] Email session error:', error)
        const dbSessionId = emailSessionMap.get(id)
        if (!dbSessionId) return
        const { getState } = useSessionState()
        const state = getState(dbSessionId)
        state.streaming.value = false
        state.streamingContent.value = ''
        emailSessionMap.delete(id)
        if (activeEmailDbSessionId === dbSessionId) activeEmailDbSessionId = null
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

  function sendCodexChat(options, callbacks) {
    if (!bridge || !connected.value) throw new Error('Bridge not connected')
    return bridge.sendCodexChat(options, callbacks)
  }

  function stopCodexChat(requestId) {
    if (bridge) bridge.stopCodexChat(requestId)
  }

  function sendOllamaChat(options, callbacks) {
    if (!bridge || !connected.value) throw new Error('Bridge not connected')
    return bridge.sendOllamaChat(options, callbacks)
  }

  function stopOllamaChat(requestId) {
    if (bridge) bridge.stopOllamaChat(requestId)
  }

  function registerFlowSession(cliSessionId, model, cwd, dbSessionId) {
    if (bridge) bridge.registerFlowSession(cliSessionId, model, cwd)
    if (dbSessionId && cliSessionId) {
      flowDbSessionMap.set(cliSessionId, dbSessionId)
      activeFlowDbSessionId = dbSessionId
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

  /**
   * Rebuild pillarSessionMap after WebSocket reconnect.
   * Asks the bridge which pillars are still running, then cross-references
   * against IndexedDB sessions to restore the in-memory routing map.
   */
  async function _reconcilePillarSessions() {
    if (!bridge) return
    const activePillars = await bridge.listPillars()
    if (!activePillars || activePillars.length === 0) return

    const activePillarIds = new Set(activePillars.map(p => p.pillarId))
    const allSessions = await db.sessions.toArray()

    for (const session of allSessions) {
      if (session.pillarId && activePillarIds.has(session.pillarId) && !pillarSessionMap.has(session.pillarId)) {
        pillarSessionMap.set(session.pillarId, session.id)
        bridge.sendPillarDbSessionId(session.pillarId, session.id)
        // Restore parent/session maps for UI scoping
        if (session.parentFlowSessionId) {
          pillarParents.set(session.pillarId, session.parentFlowSessionId)
        }
        pillarDbSessions.set(session.pillarId, session.id)
        // Restore phase from activePillars list
        const pillarInfo = activePillars.find(p => p.pillarId === session.pillarId)
        if (pillarInfo) {
          pillarStatuses.set(session.pillarId, pillarInfo.status || 'running')
          pillarPhases.set(session.pillarId, session.phase || pillarInfo.pillar)
        }
        console.log(`[pillar] Reconnected pillar ${session.pillarId.slice(0, 8)} → db session ${session.id}`)
      }
    }
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
    sendCodexChat,
    stopCodexChat,
    sendOllamaChat,
    stopOllamaChat,
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
    pillarStatuses,
    pillarPhases,
    pillarParents,
    pillarDbSessions
  }
}

export function isMcpTool(name) {
  return name.startsWith('mcp__')
}

export function parseMcpToolName(name) {
  const parts = name.split('__')
  return { server: parts[1], tool: parts.slice(2).join('__') }
}
