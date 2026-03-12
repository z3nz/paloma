import { randomUUID } from 'crypto'

export class OllamaManager {
  constructor() {
    this.sessions = new Map()   // sessionId → { messages[], model, lastActivity }
    this.requests = new Map()   // requestId → { sessionId, abortController }
    this.baseURL = process.env.OLLAMA_HOST || 'http://localhost:11434'
    this.defaultNumCtx = 32768

    // Clean up inactive sessions every 5 minutes
    this._cleanupInterval = setInterval(() => this._cleanupSessions(), 5 * 60 * 1000)
    this._cleanupInterval.unref() // Don't prevent process exit
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()

    if (!sessionId) {
      sessionId = randomUUID()
    }

    // Create or resume session
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { messages: [], model: model || 'qwen2.5-coder:32b', lastActivity: Date.now() }
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

    // Append user message
    session.messages.push({ role: 'user', content: prompt })
    session.lastActivity = Date.now()

    // Set up abort controller
    const abortController = new AbortController()
    this.requests.set(requestId, { sessionId, abortController })

    // Start streaming (fire and forget — events flow via onEvent callback)
    this._streamChat(requestId, sessionId, session.model, [...session.messages], abortController, onEvent)

    return { requestId, sessionId }
  }

  async _streamChat(requestId, sessionId, model, messages, controller, onEvent) {
    try {
      const response = await fetch(`${this.baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: { num_ctx: this.defaultNumCtx }
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        const errorMsg = `Ollama API error ${response.status}: ${body || response.statusText}`
        console.error(`[ollama] ${errorMsg}`)
        this.requests.delete(requestId)
        onEvent({ type: 'ollama_error', requestId, event: { error: errorMsg } })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullAssistantText = ''

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

            if (chunk.message?.content) {
              const text = chunk.message.content
              fullAssistantText += text

              // Emit with Claude-compatible content_block_delta shape
              onEvent({
                type: 'ollama_stream',
                requestId,
                event: {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text }
                }
              })
            }

            // Ollama signals completion with done: true
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
        } catch {
          // skip
        }
      }

      // Append assistant message to session history
      const session = this.sessions.get(sessionId)
      if (session) {
        session.messages.push({ role: 'assistant', content: fullAssistantText })
        session.lastActivity = Date.now()
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
      onEvent({ type: 'ollama_error', requestId, event: { error: errorMsg } })
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
    // Abort all active requests
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
