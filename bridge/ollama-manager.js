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
      session = { messages: [], model: model || 'qwen3-coder:30b', tools: null, lastActivity: Date.now() }
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

      // If tool calls were returned via native API, emit them for bridge to execute
      if (collectedToolCalls.length > 0) {
        console.log(`[ollama] ${collectedToolCalls.length} native tool call(s): ${collectedToolCalls.map(tc => tc.function?.name).join(', ')}`)

        // WU-2: Strip any JSON tool call text that the model also wrote as content
        // This prevents double-display (raw JSON + tool result) in the chat
        let cleanedText = fullAssistantText || ''
        if (cleanedText.trim()) {
          const jsonObjects = this._extractJsonObjects(cleanedText)
          if (jsonObjects.length > 0) {
            for (const { raw } of jsonObjects) {
              cleanedText = cleanedText.replace(raw, '')
            }
            // Also strip leftover markdown code fence markers
            cleanedText = cleanedText.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
            cleanedText = cleanedText.trim()
          }
        }

        const assistantMessage = { role: 'assistant', content: cleanedText, tool_calls: collectedToolCalls }

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

      // Fallback: detect tool calls written as text in the response
      // Some models output JSON like {"name": "tool", "arguments": {...}} as text
      // instead of using the native tool_calls API
      if (session.tools?.length > 0 && fullAssistantText.trim()) {
        const parsedCalls = this._parseToolCallsFromText(fullAssistantText, session.tools)
        if (parsedCalls.length > 0) {
          console.log(`[ollama] ${parsedCalls.length} text-parsed tool call(s): ${parsedCalls.map(tc => tc.function?.name).join(', ')}`)

          // Strip the JSON tool call text from the assistant message
          let cleanedFallbackText = fullAssistantText
          const fallbackJsonObjects = this._extractJsonObjects(fullAssistantText)
          for (const { raw } of fallbackJsonObjects) {
            cleanedFallbackText = cleanedFallbackText.replace(raw, '')
          }
          cleanedFallbackText = cleanedFallbackText.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '').trim()

          const assistantMessage = { role: 'assistant', content: cleanedFallbackText, tool_calls: parsedCalls }

          this.requests.delete(requestId)
          onEvent({
            type: 'ollama_tool_call',
            requestId,
            sessionId,
            assistantMessage,
            toolCalls: parsedCalls
          })
          return
        }
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

  /**
   * Extract complete JSON objects from text using balanced-brace counting.
   * Returns array of { parsed, raw } where parsed is the JS object and raw is the original substring.
   * Handles nested braces, strings with escaped characters, and markdown code fences.
   */
  _extractJsonObjects(text) {
    // Strip markdown code fence markers before scanning
    const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
    const results = []
    let i = 0

    while (i < cleaned.length) {
      if (cleaned[i] === '{') {
        let depth = 0
        let inString = false
        let escaped = false
        let start = i

        for (let j = i; j < cleaned.length; j++) {
          const ch = cleaned[j]

          if (escaped) {
            escaped = false
            continue
          }

          if (ch === '\\' && inString) {
            escaped = true
            continue
          }

          if (ch === '"' && !escaped) {
            inString = !inString
            continue
          }

          if (inString) continue

          if (ch === '{') depth++
          else if (ch === '}') {
            depth--
            if (depth === 0) {
              const raw = cleaned.slice(start, j + 1)
              try {
                const parsed = JSON.parse(raw)
                results.push({ parsed, raw })
              } catch {
                // Not valid JSON despite balanced braces
              }
              i = j + 1
              break
            }
          }

          // Safety: if we've scanned too far without closing, bail
          if (j === cleaned.length - 1) {
            i = j + 1
          }
        }

        // If depth never reached 0, move past this opening brace
        if (depth !== 0) i = start + 1
      } else {
        i++
      }
    }

    return results
  }

  /**
   * Parse tool calls that the model wrote as text instead of using native API.
   * Uses balanced-brace JSON extraction to handle nested arguments correctly.
   * Normalizes tool names (strips mcp__paloma__ prefix) and logs all attempts.
   */
  _parseToolCallsFromText(text, tools) {
    const toolNames = new Set(tools.map(t => t.function?.name).filter(Boolean))
    const calls = []

    const jsonObjects = this._extractJsonObjects(text)

    for (const { parsed, raw } of jsonObjects) {
      const rawName = parsed.name || parsed.function_name || ''
      if (!rawName) {
        continue
      }

      const args = parsed.arguments || parsed.function_arg || parsed.parameters || {}

      // Try exact match first, then try stripping mcp__paloma__ prefix
      let resolvedName = rawName
      if (!toolNames.has(resolvedName) && resolvedName.startsWith('mcp__paloma__')) {
        resolvedName = resolvedName.replace(/^mcp__paloma__/, '')
      }

      if (toolNames.has(resolvedName)) {
        calls.push({ function: { name: resolvedName, arguments: args } })
      }
    }

    return calls
  }

  _cleanupSessions() {
    const maxAge = 30 * 60 * 1000 // 30 minutes
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > maxAge) {
        console.log(`[ollama] Expiring inactive session ${sessionId}`)
        // Abort any active requests for this session
        for (const [reqId, entry] of this.requests) {
          if (entry.sessionId === sessionId) {
            entry.abortController?.abort()
            this.requests.delete(reqId)
          }
        }
        this.sessions.delete(sessionId)
      }
    }
  }
}
