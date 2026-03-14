const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]
const TOOL_CALL_TIMEOUT = 5 * 60 * 1000  // 5 minutes for tool calls
const DEFAULT_TIMEOUT = 30 * 1000         // 30 seconds for simple requests

export function createMcpBridge() {
  let ws = null
  let url = ''
  let reconnectAttempt = 0
  let reconnectTimer = null
  let intentionalClose = false
  const pending = new Map() // id -> { resolve, reject, timer }
  const streamListeners = new Map() // id -> { onStream, onDone, onError }
  let onStateChange = null
  let onToolsUpdate = null
  let onCliToolActivity = null
  let onCliToolConfirmation = null
  let onAskUser = null
  let onSetTitle = null
  let onPillarSessionCreated = null
  let onPillarCliSession = null
  let onPillarStream = null
  let onPillarMessageSaved = null
  let onPillarDone = null
  let onFlowNotificationStart = null
  let onFlowNotificationStream = null
  let onFlowNotificationDone = null
  let onFlowNotificationError = null
  let onEmailReceived = null
  let onEmailStream = null
  let onEmailDone = null
  let onEmailError = null

  function getState() {
    if (!ws) return 'disconnected'
    if (ws.readyState === WebSocket.CONNECTING) return 'connecting'
    if (ws.readyState === WebSocket.OPEN) return 'connected'
    return 'disconnected'
  }

  function connect(bridgeUrl = 'ws://localhost:19191', callbacks = {}) {
    onStateChange = callbacks.onStateChange || null
    onToolsUpdate = callbacks.onToolsUpdate || null
    onCliToolActivity = callbacks.onCliToolActivity || null
    onCliToolConfirmation = callbacks.onCliToolConfirmation || null
    onAskUser = callbacks.onAskUser || null
    onSetTitle = callbacks.onSetTitle || null
    onPillarSessionCreated = callbacks.onPillarSessionCreated || null
    onPillarCliSession = callbacks.onPillarCliSession || null
    onPillarStream = callbacks.onPillarStream || null
    onPillarMessageSaved = callbacks.onPillarMessageSaved || null
    onPillarDone = callbacks.onPillarDone || null
    onFlowNotificationStart = callbacks.onFlowNotificationStart || null
    onFlowNotificationStream = callbacks.onFlowNotificationStream || null
    onFlowNotificationDone = callbacks.onFlowNotificationDone || null
    onFlowNotificationError = callbacks.onFlowNotificationError || null
    onEmailReceived = callbacks.onEmailReceived || null
    onEmailStream = callbacks.onEmailStream || null
    onEmailDone = callbacks.onEmailDone || null
    onEmailError = callbacks.onEmailError || null
    url = bridgeUrl
    intentionalClose = false
    _connect()
  }

  function _connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

    try {
      ws = new WebSocket(url)
    } catch {
      _scheduleReconnect()
      return
    }

    onStateChange?.('connecting')

    ws.onopen = () => {
      reconnectAttempt = 0
      onStateChange?.('connected')
      // Auto-discover tools on connect
      discover().catch((e) => {
        console.warn('[bridge] Auto-discover failed:', e.message)
      })
    }

    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      if (msg.type === 'tools') {
        onToolsUpdate?.(msg.servers)
      } else if (msg.type === 'tool_result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ content: msg.content, isError: msg.isError })
        }
      } else if (msg.type === 'export_result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ count: msg.count, path: msg.path })
        }
      } else if (msg.type === 'claude_ack' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ requestId: msg.requestId, sessionId: msg.sessionId })
        }
      } else if (msg.type === 'claude_stream' && msg.id) {
        if (msg.emailTriggered) {
          onEmailStream?.(msg.id, msg.event, msg.emailSubject)
        } else {
          const listener = streamListeners.get(msg.id)
          if (listener) {
            listener.onStream?.(msg.event)
          } else {
            console.warn(`[cli] stream event with no listener: id=${msg.id}`)
          }
        }
      } else if (msg.type === 'claude_done' && msg.id) {
        if (msg.emailTriggered) {
          onEmailDone?.(msg.id, msg.sessionId, msg.exitCode)
        } else {
          const listener = streamListeners.get(msg.id)
          if (listener) {
            streamListeners.delete(msg.id)
            listener.onDone?.(msg.sessionId, msg.exitCode)
          }
        }
      } else if (msg.type === 'claude_error' && msg.id) {
        if (msg.emailTriggered) {
          onEmailError?.(msg.id, msg.error)
        } else {
          console.error(`[cli] error:`, msg.error)
          const listener = streamListeners.get(msg.id)
          if (listener) {
            streamListeners.delete(msg.id)
            listener.onError?.(msg.error)
          }
        }
      } else if (msg.type === 'codex_ack' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ requestId: msg.requestId, sessionId: msg.sessionId })
        }
      } else if (msg.type === 'codex_stream' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          listener.onStream?.(msg.event)
        }
      } else if (msg.type === 'codex_done' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onDone?.(msg.sessionId, msg.exitCode)
        }
      } else if (msg.type === 'codex_error' && msg.id) {
        console.error(`[codex] error:`, msg.error)
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onError?.(msg.error)
        }
      } else if (msg.type === 'copilot_ack' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ requestId: msg.requestId, sessionId: msg.sessionId })
        }
      } else if (msg.type === 'copilot_stream' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          listener.onStream?.(msg.event)
        }
      } else if (msg.type === 'copilot_done' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onDone?.(msg.sessionId, msg.exitCode)
        }
      } else if (msg.type === 'copilot_error' && msg.id) {
        console.error(`[copilot] error:`, msg.error)
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onError?.(msg.error)
        }
      } else if (msg.type === 'ollama_ack' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ requestId: msg.requestId, sessionId: msg.sessionId })
        }
      } else if (msg.type === 'ollama_stream' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          listener.onStream?.(msg.event)
        }
      } else if (msg.type === 'ollama_done' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onDone?.(msg.sessionId, msg.exitCode)
        }
      } else if (msg.type === 'ollama_error' && msg.id) {
        const errorMsg = msg.error || msg.event?.error || 'Unknown Ollama error'
        console.error(`[ollama] error:`, errorMsg)
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onError?.(errorMsg)
        }
      } else if (msg.type === 'resolved_path' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.path)
        }
      } else if (msg.type === 'email_received') {
        onEmailReceived?.(msg)
      } else if (msg.type === 'cli_tool_activity') {
        onCliToolActivity?.(msg.toolName, msg.args, msg.status)
      } else if (msg.type === 'cli_tool_confirmation') {
        onCliToolConfirmation?.(msg.id, msg.toolName, msg.args)
      } else if (msg.type === 'ask_user') {
        onAskUser?.(msg.id, msg.question, msg.options)
      } else if (msg.type === 'set_chat_title') {
        onSetTitle?.(msg.title)
      } else if (msg.type === 'pillar_list_result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.pillars)
        }
      } else if (msg.type === 'pillar_session_created') {
        onPillarSessionCreated?.(msg)
      } else if (msg.type === 'pillar_cli_session') {
        onPillarCliSession?.(msg)
      } else if (msg.type === 'pillar_stream') {
        onPillarStream?.(msg.pillarId, msg.event, msg.backend)
      } else if (msg.type === 'pillar_message_saved') {
        onPillarMessageSaved?.(msg)
      } else if (msg.type === 'pillar_done') {
        onPillarDone?.(msg)
      } else if (msg.type === 'flow_notification_start') {
        onFlowNotificationStart?.(msg)
      } else if (msg.type === 'flow_notification_stream') {
        onFlowNotificationStream?.(msg.event)
      } else if (msg.type === 'flow_notification_done') {
        onFlowNotificationDone?.()
      } else if (msg.type === 'flow_notification_error') {
        onFlowNotificationError?.(msg.error)
      } else if (msg.type === 'error' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.reject(new Error(msg.message))
        }
      }
    }

    ws.onclose = () => {
      ws = null
      onStateChange?.('disconnected')
      // Reject all pending calls
      for (const [id, p] of pending) {
        p.reject(new Error('Bridge connection lost'))
        pending.delete(id)
      }
      // Error all stream listeners (safe against throwing callbacks)
      for (const [id, listener] of streamListeners) {
        try { listener.onError?.('Bridge connection lost') } catch { /* don't let one bad callback block others */ }
        streamListeners.delete(id)
      }
      if (!intentionalClose) _scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after this
    }
  }

  function _scheduleReconnect() {
    if (intentionalClose) return
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    reconnectAttempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      _connect()
    }, delay)
  }

  function disconnect() {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    onStateChange?.('disconnected')
  }

  function _send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Bridge not connected'))
    }
    ws.send(JSON.stringify(msg))
    return Promise.resolve()
  }

  function discover() {
    return _send({ type: 'discover' })
  }

  /**
   * Creates a pending promise with an optional timeout.
   * When the timeout fires, the promise rejects and the entry is cleaned up.
   */
  function _pendingPromise(id, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null
      if (timeoutMs) {
        timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Bridge request timed out after ${Math.round(timeoutMs / 1000)}s`))
        }, timeoutMs)
      }
      const wrappedResolve = (v) => { if (timer) clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { if (timer) clearTimeout(timer); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
    })
  }

  function callTool(server, tool, args) {
    const id = crypto.randomUUID()
    const promise = _pendingPromise(id, TOOL_CALL_TIMEOUT)
    _send({ type: 'call_tool', id, server, tool, arguments: args }).catch((e) => {
      const p = pending.get(id)
      if (p) { pending.delete(id); p.reject(e) }
    })
    return promise
  }

  function sendClaudeChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({
        type: 'claude_chat',
        id,
        prompt: options.prompt,
        model: options.model,
        sessionId: options.sessionId,
        systemPrompt: options.systemPrompt,
        cwd: options.cwd
      }).catch((e) => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function stopClaudeChat(requestId) {
    _send({ type: 'claude_stop', requestId })
  }

  function sendCodexChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({
        type: 'codex_chat',
        id,
        prompt: options.prompt,
        model: options.model,
        sessionId: options.sessionId,
        systemPrompt: options.systemPrompt,
        cwd: options.cwd
      }).catch((e) => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function stopCodexChat(requestId) {
    _send({ type: 'codex_stop', requestId })
  }

  function sendCopilotChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({
        type: 'copilot_chat',
        id,
        prompt: options.prompt,
        model: options.model,
        sessionId: options.sessionId,
        systemPrompt: options.systemPrompt,
        cwd: options.cwd
      }).catch((e) => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function stopCopilotChat(requestId) {
    _send({ type: 'copilot_stop', requestId })
  }

  function sendOllamaChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({
        type: 'ollama_chat',
        id,
        prompt: options.prompt,
        model: options.model,
        sessionId: options.sessionId,
        systemPrompt: options.systemPrompt,
        cwd: options.cwd,
        enableTools: options.enableTools || false
      }).catch((e) => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function stopOllamaChat(requestId) {
    _send({ type: 'ollama_stop', requestId })
  }

  function exportChats(projectPath, sessions) {
    const id = crypto.randomUUID()
    const promise = _pendingPromise(id, TOOL_CALL_TIMEOUT)
    _send({ type: 'export_chats', id, projectPath, sessions }).catch((e) => {
      const p = pending.get(id)
      if (p) { pending.delete(id); p.reject(e) }
    })
    return promise
  }

  function resolveProjectPath(name) {
    const id = crypto.randomUUID()
    const promise = _pendingPromise(id, DEFAULT_TIMEOUT)
    _send({ type: 'resolve_path', id, name }).catch((e) => {
      const p = pending.get(id)
      if (p) { pending.delete(id); p.reject(e) }
    })
    return promise
  }

  function respondToAskUser(id, answer) {
    _send({ type: 'ask_user_response', id, answer })
  }

  function respondToToolConfirmation(id, approved, result, reason) {
    _send({ type: 'tool_confirmation_response', id, approved, result, reason })
  }

  function sendPillarDbSessionId(pillarId, dbSessionId) {
    _send({ type: 'pillar_db_session_id', pillarId, dbSessionId })
  }

  function registerFlowSession(cliSessionId, model, cwd) {
    _send({ type: 'register_flow_session', cliSessionId, model, cwd })
  }

  function listPillars() {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({ type: 'pillar_list', id }).catch((e) => {
        pending.delete(id)
        reject(e)
      })
    })
  }

  function sendPillarUserMessage(pillarId, message) {
    _send({ type: 'pillar_user_message', pillarId, message })
  }

  return { connect, disconnect, discover, callTool, sendClaudeChat, stopClaudeChat, sendCodexChat, stopCodexChat, sendCopilotChat, stopCopilotChat, sendOllamaChat, stopOllamaChat, exportChats, resolveProjectPath, respondToAskUser, respondToToolConfirmation, sendPillarDbSessionId, registerFlowSession, listPillars, sendPillarUserMessage, getState }
}

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
