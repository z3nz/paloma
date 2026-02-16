const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]

export function createMcpBridge() {
  let ws = null
  let url = ''
  let reconnectAttempt = 0
  let reconnectTimer = null
  let intentionalClose = false
  const pending = new Map() // id -> { resolve, reject }
  const streamListeners = new Map() // id -> { onStream, onDone, onError }
  let onStateChange = null
  let onToolsUpdate = null
  let onCliToolActivity = null
  let onCliToolConfirmation = null
  let onAskUser = null
  let onSetTitle = null

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
      discover().catch(() => {})
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
        const listener = streamListeners.get(msg.id)
        if (listener) {
          listener.onStream?.(msg.event)
        } else {
          console.warn(`[cli] stream event with no listener: id=${msg.id}`)
        }
      } else if (msg.type === 'claude_done' && msg.id) {
        console.log(`[cli] done: exitCode=${msg.exitCode}`)
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onDone?.(msg.sessionId, msg.exitCode)
        }
      } else if (msg.type === 'claude_error' && msg.id) {
        console.error(`[cli] error:`, msg.error)
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onError?.(msg.error)
        }
      } else if (msg.type === 'resolved_path' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.path)
        }
      } else if (msg.type === 'cli_tool_activity') {
        onCliToolActivity?.(msg.toolName, msg.args, msg.status)
      } else if (msg.type === 'cli_tool_confirmation') {
        onCliToolConfirmation?.(msg.id, msg.toolName, msg.args)
      } else if (msg.type === 'ask_user') {
        onAskUser?.(msg.id, msg.question, msg.options)
      } else if (msg.type === 'set_chat_title') {
        onSetTitle?.(msg.title)
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
      // Error all stream listeners
      for (const [id, listener] of streamListeners) {
        listener.onError?.('Bridge connection lost')
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

  function callTool(server, tool, args) {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({ type: 'call_tool', id, server, tool, arguments: args }).catch((e) => {
        pending.delete(id)
        reject(e)
      })
    })
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

  function exportChats(projectPath, sessions) {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({ type: 'export_chats', id, projectPath, sessions }).catch((e) => {
        pending.delete(id)
        reject(e)
      })
    })
  }

  function resolveProjectPath(name) {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({ type: 'resolve_path', id, name }).catch((e) => {
        pending.delete(id)
        reject(e)
      })
    })
  }

  function respondToAskUser(id, answer) {
    _send({ type: 'ask_user_response', id, answer })
  }

  function respondToToolConfirmation(id, approved, result, reason) {
    _send({ type: 'tool_confirmation_response', id, approved, result, reason })
  }

  return { connect, disconnect, discover, callTool, sendClaudeChat, stopClaudeChat, exportChats, resolveProjectPath, respondToAskUser, respondToToolConfirmation, getState }
}

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
