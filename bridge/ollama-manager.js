import { randomUUID } from 'crypto'

const MAX_TOOL_ROUNDS = 20  // Safety limit on tool call loops

export class OllamaManager {
  constructor() {
    this.sessions = new Map()   // sessionId → { messages[], model, tools[], lastActivity }
    this.requests = new Map()   // requestId → { sessionId, abortController }
    this.baseURL = process.env.OLLAMA_HOST || 'http://localhost:11434'
    this.defaultNumCtx = 32768

    // Clean up inactive sessions every 5 minutes
    this._cleanupInterval = setInterval(() => this._cleanupSessions(), 5 * 60 * 1000)
    this._cleanupInterval.unref() // Don't prevent process exit
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd, tools }, onEvent) {
    const requestId = randomUUID()

    if (!sessionId) {
      sessionId = randomUUID()
    }

    // Create or resume session
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { messages: [], model: model || 'qwen2.5-coder:32b', tools: null, lastActivity: Date.now() }
      // Prepend system message on new session
      if (systemPrompt) {
        session.messages.push({ role: 'system', content: systemPrompt })
      }
      this.sessions.set(sessionId, session)
      console.log(`[ollama] New session ${sessionId}, model=${session.model}`)
    } else {
      console.log(`[ollama] Resuming session ${sessionId}`)
    }

    // Update model if provided (allows switching mid-session)
    if (model) {
      session.model = model
    }

    // Store tools on session (used for all rounds including continuations)
    if (tools?.length > 0) {
      session.tools = tools
    }

    // Append user message
    session.messages.push({ role: 'user', content: prompt })
    session.lastActivity = Date.now()

    // Set up abort controller
    const abortController = new AbortController()
    this.requests.set(requestId, { sessionId, abortController })

    // Start streaming (fire and forget — events flow via onEvent callback)
    this._streamChat(requestId, sessionId, session, abortController, onEvent)

    return { requestId, sessionId }
  }

  /**
   * Continue conversation after tool results have been executed.
   * Called by the bridge after it executes the tool calls.
   */
  continueWithToolResults(requestId, sessionId, assistantMessage, toolResults, onEvent) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      onEvent({ type: 'ollama_error', requestId, error: `Session ${sessionId} not found` })
      return
    }

    // Append the assistant message that contained tool_calls
    session.messages.push(assistantMessage)

    // Append each tool result
    for (const result of toolResults) {
      session.messages.push({ role: 'tool', content: result.content })
    }

    session.lastActivity = Date.now()

    // Set up new abort controller for this round
    const abortController = new AbortController()
    this.requests.set(requestId, { sessionId, abortController })

    // Continue streaming
    this._streamChat(requestId, sessionId, session, abortController, onEvent)
  }

  async _streamChat(requestId, sessionId, session, controller, onEvent) {
    try {
      const body = {
        model: session.model,
        messages: [...session.messages],
        stream: true,
        options: { num_ctx: this.defaultNumCtx }
      }

      // Include tools if available
      if (session.tools?.length > 0) {
        body.tools = session.tools
      }

      const response = await fetch(`${this.baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        const responseBody = await response.text().catch(() => '')
        const errorMsg = `Ollama API error ${response.status}: ${responseBody || response.statusText}`
        console.error(`[ollama] ${errorMsg}`)
        this.requests.delete(requestId)
        onEvent({ type: 'ollama_error', requestId, error: errorMsg })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullAssistantText = ''
      let collectedToolCalls = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // Keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const chunk = JSON.parse(trimmed)

            // Stream text content
            if (chunk.message?.content) {
              const text = chunk.message.content
              fullAssistantText += text

              onEvent({
                type: 'ollama_stream',
                requestId,
                event: {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text }
                }
              })
            }

            // Collect tool calls from the response
            if (chunk.message?.tool_calls?.length > 0) {
              for (const tc of chunk.message.tool_calls) {
                collectedToolCalls.push(tc)
              }
            }

            if (chunk.done) {
              break
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim())
          if (chunk.message?.content) {
            fullAssistantText += chunk.message.content
            onEvent({
              type: 'ollama_stream',
              requestId,
              event: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: chunk.message.content }
              }
            })
          }
          if (chunk.message?.tool_calls?.length > 0) {
            for (const tc of chunk.message.tool_calls) {
              collectedToolCalls.push(tc)
            }
          }
        } catch {
          // skip
        }
      }

      // If tool calls were returned, emit them for bridge to execute
      if (collectedToolCalls.length > 0) {
        console.log(`[ollama] ${collectedToolCalls.length} tool call(s): ${collectedToolCalls.map(tc => tc.function?.name).join(', ')}`)

        const assistantMessage = { role: 'assistant', content: fullAssistantText || '', tool_calls: collectedToolCalls }

        this.requests.delete(requestId)
        onEvent({
          type: 'ollama_tool_call',
          requestId,
          sessionId,
          assistantMessage,
          toolCalls: collectedToolCalls
        })
        return
      }

      // No tool calls — normal completion
      const session2 = this.sessions.get(sessionId)
      if (session2) {
        session2.messages.push({ role: 'assistant', content: fullAssistantText })
        session2.lastActivity = Date.now()
      }

      this.requests.delete(requestId)
      onEvent({ type: 'ollama_done', requestId, sessionId, exitCode: 0 })

    } catch (err) {
      this.requests.delete(requestId)

      if (err.name === 'AbortError') {
        console.log(`[ollama] Request ${requestId} aborted`)
        onEvent({ type: 'ollama_done', requestId, sessionId, exitCode: 0 })
        return
      }

      const errorMsg = err.code === 'ECONNREFUSED'
        ? 'Cannot connect to Ollama. Is it running? Try: ollama serve'
        : err.message
      console.error(`[ollama] Stream error: ${errorMsg}`)
      onEvent({ type: 'ollama_error', requestId, error: errorMsg })
    }
  }

  stop(requestId) {
    const entry = this.requests.get(requestId)
    if (entry) {
      entry.abortController.abort()
      this.requests.delete(requestId)
    }
  }

  shutdown() {
    clearInterval(this._cleanupInterval)
    for (const [id, entry] of this.requests) {
      entry.abortController.abort()
    }
    this.requests.clear()
    this.sessions.clear()
  }

  _cleanupSessions() {
    const maxAge = 30 * 60 * 1000 // 30 minutes
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > maxAge) {
        console.log(`[ollama] Expiring inactive session ${sessionId}`)
        this.sessions.delete(sessionId)
      }
    }
  }
}
