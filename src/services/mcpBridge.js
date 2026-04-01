const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]
const TOOL_CALL_TIMEOUT = 5 * 60 * 1000  // 5 minutes for tool calls
const DEFAULT_TIMEOUT = 30 * 1000         // 30 seconds for simple requests
const CHAT_ACK_TIMEOUT = 15 * 1000       // 15 seconds to receive chat ack
const PING_INTERVAL = 15 * 1000          // 15 seconds between client pings

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
  let onPillarFallback = null
  let onFlowNotificationStart = null
  let onFlowNotificationStream = null
  let onFlowNotificationDone = null
  let onFlowNotificationError = null
  let onEmailReceived = null
  let onEmailStream = null
  let onEmailDone = null
  let onEmailError = null
  let onEmailStoreUpdated = null
  let onSingularityCreated = null
  let onSingularityReady = null
  let onSingularityComplete = null
  let onTrinityCreated = null
  let onArkCreated = null
  let onHydraUpdate = null
  let onAccordionUpdate = null
  let onPaestroUpdate = null
  let onHydraVoteNeeded = null
  let pingTimer = null
  let lastPongTime = 0

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
    onPillarFallback = callbacks.onPillarFallback || null
    onFlowNotificationStart = callbacks.onFlowNotificationStart || null
    onFlowNotificationStream = callbacks.onFlowNotificationStream || null
    onFlowNotificationDone = callbacks.onFlowNotificationDone || null
    onFlowNotificationError = callbacks.onFlowNotificationError || null
    onEmailReceived = callbacks.onEmailReceived || null
    onEmailStream = callbacks.onEmailStream || null
    onEmailDone = callbacks.onEmailDone || null
    onEmailError = callbacks.onEmailError || null
    onEmailStoreUpdated = callbacks.onEmailStoreUpdated || null
    onSingularityCreated = callbacks.onSingularityCreated || null
    onSingularityReady = callbacks.onSingularityReady || null
    onSingularityComplete = callbacks.onSingularityComplete || null
    onTrinityCreated = callbacks.onTrinityCreated || null
    onArkCreated = callbacks.onArkCreated || null
    onHydraUpdate = callbacks.onHydraUpdate || null
    onAccordionUpdate = callbacks.onAccordionUpdate || null
    onPaestroUpdate = callbacks.onPaestroUpdate || null
    onHydraVoteNeeded = callbacks.onHydraVoteNeeded || null
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
      lastPongTime = Date.now()
      onStateChange?.('connected')
      // Auto-discover tools on connect
      discover().catch((e) => {
        console.warn('[bridge] Auto-discover failed:', e.message)
      })
      // Start client-side ping to detect dead connections
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        // If we haven't received any message (including pong) in 2 ping intervals, connection is dead
        if (Date.now() - lastPongTime > PING_INTERVAL * 3) {
          console.warn('[bridge] Connection appears dead — forcing reconnect')
          ws.close()
          return
        }
        try { ws.send('ping') } catch { /* will trigger onclose */ }
      }, PING_INTERVAL)
    }

    ws.onmessage = (event) => {
      lastPongTime = Date.now() // Any message from server = connection alive
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
      } else if (msg.type === 'system_prompt_result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ prompt: msg.prompt, role: msg.role, pillar: msg.pillar, length: msg.length, approxTokens: msg.approxTokens })
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
      } else if (msg.type === 'gemini_ack' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ requestId: msg.requestId, sessionId: msg.sessionId })
        }
      } else if (msg.type === 'gemini_stream' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          listener.onStream?.(msg.event)
        }
      } else if (msg.type === 'gemini_done' && msg.id) {
        const listener = streamListeners.get(msg.id)
        if (listener) {
          streamListeners.delete(msg.id)
          listener.onDone?.(msg.sessionId, msg.exitCode)
        }
      } else if (msg.type === 'gemini_error' && msg.id) {
        console.error(`[gemini] error:`, msg.error)
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
          listener.onDone?.(msg.sessionId, msg.exitCode, msg.usage)
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
      } else if (msg.type === 'email_store_updated') {
        onEmailStoreUpdated?.()
      } else if (msg.type === 'email_abandoned') {
        console.warn(`[email] Thread abandoned after ${msg.retries} retries: "${msg.subject}" from ${msg.from}`)
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
      } else if (msg.type === 'pillar_resume_result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.result)
        }
      } else if (msg.type === 'pillar_user_message_result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve({ status: msg.status, message: msg.message, pillarId: msg.pillarId })
        }
      } else if (msg.type === 'pillar_queued') {
        // Spawn queue: pillar is waiting for a slot. Log for now — future: show in sidebar.
        console.log(`[pillar] ${msg.pillar} queued (position ${msg.queuePosition})`)
      } else if (msg.type === 'pillar_session_created') {
        onPillarSessionCreated?.(msg)
      } else if (msg.type === 'pillar_cli_session') {
        onPillarCliSession?.(msg)
      } else if (msg.type === 'pillar_stream') {
        onPillarStream?.(msg.pillarId, msg.event, msg.backend, msg.singularityRole, msg.singularityGroupId)
      } else if (msg.type === 'pillar_message_saved') {
        onPillarMessageSaved?.(msg)
      } else if (msg.type === 'pillar_done') {
        onPillarDone?.(msg)
      } else if (msg.type === 'singularity_created') {
        onSingularityCreated?.(msg)
      } else if (msg.type === 'trinity_created') {
        onTrinityCreated?.(msg)
      } else if (msg.type === 'ark_created') {
        onArkCreated?.(msg)
      } else if (msg.type === 'hydra_update') {
        onHydraUpdate?.(msg)
      } else if (msg.type === 'accordion_update') {
        onAccordionUpdate?.(msg)
      } else if (msg.type === 'paestro_update' || msg.type === 'gen8_update') {
        onPaestroUpdate?.(msg)
      } else if (msg.type === 'hydra_vote_needed') {
        onHydraVoteNeeded?.(msg)
      } else if (msg.type === 'singularity_ready') {
        onSingularityReady?.(msg)
      } else if (msg.type === 'singularity_complete') {
        onSingularityComplete?.(msg)
      } else if (msg.type === 'pillar_fallback') {
        onPillarFallback?.(msg)
      } else if (msg.type === 'flow_notification_start') {
        onFlowNotificationStart?.(msg)
      } else if (msg.type === 'flow_notification_stream') {
        onFlowNotificationStream?.(msg.event, msg)
      } else if (msg.type === 'flow_notification_done') {
        onFlowNotificationDone?.(msg)
      } else if (msg.type === 'flow_notification_error') {
        onFlowNotificationError?.(msg)
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
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
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
    const baseDelay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    // Add random jitter (0-50% of base delay) to prevent thundering herd on bridge restart
    const jitter = Math.floor(Math.random() * baseDelay * 0.5)
    const delay = baseDelay + jitter
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

  /**
   * Send a chat message and wait for ack. Rejects if ack doesn't arrive within timeout.
   */
  function _sendChatWithTimeout(type, id, options, callbacks) {
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge message — connection may be stale. Try refreshing the page.'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type,
        id,
        prompt: options.prompt,
        model: options.model,
        sessionId: options.sessionId,
        systemPrompt: options.systemPrompt,
        cwd: options.cwd,
        ...(options.enableTools !== undefined ? { enableTools: options.enableTools } : {}),
        ...(options.freshContext ? { freshContext: true } : {})
      }).catch((e) => {
        clearTimeout(timer)
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function sendClaudeChat(options, callbacks) {
    return _sendChatWithTimeout('claude_chat', crypto.randomUUID(), options, callbacks)
  }

  function stopClaudeChat(requestId) {
    _send({ type: 'claude_stop', requestId })
  }

  function sendCodexChat(options, callbacks) {
    return _sendChatWithTimeout('codex_chat', crypto.randomUUID(), options, callbacks)
  }

  function stopCodexChat(requestId) {
    _send({ type: 'codex_stop', requestId })
  }

  function sendCopilotChat(options, callbacks) {
    return _sendChatWithTimeout('copilot_chat', crypto.randomUUID(), options, callbacks)
  }

  function stopCopilotChat(requestId) {
    _send({ type: 'copilot_stop', requestId })
  }

  function sendGeminiChat(options, callbacks) {
    return _sendChatWithTimeout('gemini_chat', crypto.randomUUID(), options, callbacks)
  }

  function stopGeminiChat(requestId) {
    _send({ type: 'gemini_stop', requestId })
  }

  function sendOllamaChat(options, callbacks) {
    return _sendChatWithTimeout('ollama_chat', crypto.randomUUID(), options, callbacks)
  }

  function sendQuinnGen5Chat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge Gen5 message'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type: 'quinn_gen5_chat',
        id,
        chatId: options.sessionId || null,
        userMessage: options.prompt
      }).catch((e) => {
        clearTimeout(timer)
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function sendHolyTrinityChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge Holy Trinity message'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type: 'holy_trinity_chat',
        id,
        chatDbSessionId: options.chatDbSessionId || null,
        userMessage: options.prompt
      }).catch((e) => {
        clearTimeout(timer)
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function sendArkChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge Ark message'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type: 'ark_chat',
        id,
        chatDbSessionId: options.chatDbSessionId || null,
        userMessage: options.prompt
      }).catch((e) => {
        clearTimeout(timer)
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function sendHydraVote(hydraId, chosenHead, reasoning) {
    _send({ type: 'hydra_vote_response', hydraId, chosenHead, reasoning })
  }

  function sendHydraChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge Hydra message'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type: 'hydra_chat',
        id,
        chatDbSessionId: options.chatDbSessionId || null,
        userMessage: options.prompt
      }).catch((e) => {
        clearTimeout(timer)
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function sendPaestroChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge 67 Paestro message'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type: 'paestro_chat',
        id,
        chatDbSessionId: options.chatDbSessionId || null,
        userMessage: options.prompt,
        modelVariant: options.model || null,
        thinkMode: options.thinkMode || null,
        paestroMode: options.paestroMode || null,
        hydraAngels: options.hydraAngels || null,
        sessionId: options.sessionId || null
      }).catch((e) => {
        clearTimeout(timer)
        pending.delete(id)
        streamListeners.delete(id)
        reject(e)
      })
    })
  }

  function sendAccordionChat(options, callbacks) {
    const id = crypto.randomUUID()
    streamListeners.set(id, {
      onStream: callbacks.onStream,
      onDone: callbacks.onDone,
      onError: callbacks.onError
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          streamListeners.delete(id)
          reject(new Error('Bridge did not acknowledge Accordion message'))
        }
      }, CHAT_ACK_TIMEOUT)
      const wrappedResolve = (v) => { clearTimeout(timer); resolve(v) }
      const wrappedReject = (e) => { clearTimeout(timer); streamListeners.delete(id); reject(e) }
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject })
      _send({
        type: 'accordion_chat',
        id,
        chatDbSessionId: options.chatDbSessionId || null,
        userMessage: options.prompt
      }).catch((e) => {
        clearTimeout(timer)
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

  function registerFlowSession(cliSessionId, model, cwd, dbSessionId) {
    _send({ type: 'register_flow_session', cliSessionId, model, cwd, dbSessionId })
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

  function resumePillar(pillarId) {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      _send({ type: 'pillar_resume', id, pillarId }).catch((e) => {
        pending.delete(id)
        reject(e)
      })
    })
  }

  function getSystemPrompt(singularityRole = 'paestro', pillar = 'flow', paestroMode = null) {
    const id = crypto.randomUUID()
    const promise = _pendingPromise(id, 15000)
    _send({ type: 'get_system_prompt', id, singularityRole, pillar, paestroMode }).catch((e) => {
      const p = pending.get(id)
      if (p) { pending.delete(id); p.reject(e) }
    })
    return promise
  }

  function sendPillarUserMessage(pillarId, message) {
    const id = crypto.randomUUID()
    const promise = _pendingPromise(id, 10000)
    _send({ type: 'pillar_user_message', id, pillarId, message }).catch((e) => {
      const p = pending.get(id)
      if (p) { pending.delete(id); p.reject(e) }
    })
    return promise
  }

  return { connect, disconnect, discover, callTool, sendClaudeChat, stopClaudeChat, sendCodexChat, stopCodexChat, sendCopilotChat, stopCopilotChat, sendGeminiChat, stopGeminiChat, sendOllamaChat, sendQuinnGen5Chat, sendHolyTrinityChat, sendArkChat, sendHydraChat, sendAccordionChat, sendPaestroChat, stopOllamaChat, exportChats, resolveProjectPath, respondToAskUser, respondToToolConfirmation, sendPillarDbSessionId, registerFlowSession, listPillars, resumePillar, sendPillarUserMessage, getSystemPrompt, getState }


}

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
