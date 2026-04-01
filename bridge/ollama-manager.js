import { randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { createLogger } from './logger.js'

const log = createLogger('ollama')

const MAX_TOOL_ROUNDS = 20  // Safety limit on tool call loops
const MAX_SESSION_MESSAGES = 100  // Sliding window to prevent unbounded message growth

const SUMMARIZER_PROMPT = `/no_think
You are a session memory manager. Your job is to maintain a compressed context document that captures everything important from an ongoing conversation.

## Rules
1. STRUCTURE: Use clear markdown sections — Session Overview, Key Facts, File Map, Recent Activity, Open Tasks
2. COMPRESS: Summarize exchanges, don't transcribe them. A 500-word exchange becomes 2-3 bullet points.
3. PRESERVE: Never lose important facts — file paths, decisions, user preferences, code patterns, tool results
4. UPDATE: Replace outdated info. If a decision was reversed, update it — don't keep both versions.
5. LIMIT: Keep the document under 3000 words. When it grows too large, compress older sections more aggressively.
6. FORMAT: Output ONLY the updated markdown document. No wrapping, no commentary, no code fences around it.`

export class OllamaManager {
  constructor() {
    this.sessions = new Map()   // sessionId → { messages[], model, tools[], lastActivity }
    this.requests = new Map()   // requestId → { sessionId, abortController }
    this._cancelled = new Set()  // requestIds explicitly stopped during tool execution window
    this.baseURL = process.env.OLLAMA_HOST || 'http://localhost:11434'
    this.defaultNumCtx = 32768

    // Clean up inactive sessions every 5 minutes
    this._cleanupInterval = setInterval(() => this._cleanupSessions(), 5 * 60 * 1000)
    this._cleanupInterval.unref() // Don't prevent process exit
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd, tools, numCtx, freshContext, contextFile }, onEvent) {
    const requestId = randomUUID()

    if (!sessionId) {
      sessionId = randomUUID()
    }

    // Create or resume session
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { messages: [], model: model || 'qwen3-coder:30b', tools: null, numCtx: numCtx || null, lastActivity: Date.now(), freshContext: freshContext || false, contextFile: contextFile || null, _lastUserMessage: null, _summarizing: null }
      // Prepend system message on new session
      if (systemPrompt) {
        session.messages.push({ role: 'system', content: systemPrompt })
      }
      this.sessions.set(sessionId, session)
      log.info(`New session ${sessionId}, model=${session.model}`)
    } else {
      log.info(`Resuming session ${sessionId}`)
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
    session._lastUserMessage = prompt
    session.lastActivity = Date.now()

    // Fresh context mode: mark turn start for _streamChat to rebuild messages
    if (session.freshContext) {
      session._freshTurnStart = true
    }

    // Sliding window: keep system message + last N messages to prevent unbounded growth
    // (Skip for freshContext — messages are rebuilt each turn anyway)
    if (!session.freshContext && session.messages.length > MAX_SESSION_MESSAGES) {
      const systemMsg = session.messages[0]?.role === 'system' ? session.messages[0] : null
      session.messages = systemMsg
        ? [systemMsg, ...session.messages.slice(-(MAX_SESSION_MESSAGES - 1))]
        : session.messages.slice(-MAX_SESSION_MESSAGES)
    }

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
    // If stop() was called while tools were executing, don't continue
    if (this._cancelled.has(requestId)) {
      this._cancelled.delete(requestId)
      onEvent({ type: 'ollama_done', requestId, sessionId, exitCode: 0 })
      return
    }

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
      // Fresh context mode: rebuild messages from context file + latest user message
      // Only on turn start (not tool continuations)
      if (session._freshTurnStart && session.freshContext && session.contextFile) {
        session._freshTurnStart = false

        // Wait for any pending summarization from previous turn
        if (session._summarizing) {
          await session._summarizing
          session._summarizing = null
        }

        const context = await readFile(session.contextFile, 'utf8').catch(() => '')
        const systemMsg = session.messages[0]?.role === 'system' ? session.messages[0] : null
        const userMsg = session._lastUserMessage || ''

        // Rebuild: system prompt + single user message (context + actual message)
        session.messages = []
        if (systemMsg) session.messages.push(systemMsg)

        const combinedContent = context
          ? `<session_context>\n${context}\n</session_context>\n\n---\n\n${userMsg}`
          : userMsg
        session.messages.push({ role: 'user', content: combinedContent })

        log.debug(`Fresh context: loaded ${context.length} chars from ${session.contextFile}`)
      }

      const body = {
        model: session.model,
        messages: [...session.messages],
        stream: true,
        keep_alive: -1,  // NEVER unload — prevent "fetch failed" during long tool calls
        options: { num_ctx: session.numCtx || this.defaultNumCtx }
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
        log.error(errorMsg)
        this.requests.delete(requestId)
        onEvent({ type: 'ollama_error', requestId, error: errorMsg })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullAssistantText = ''
      let collectedToolCalls = []
      let promptTokens = 0
      let completionTokens = 0

      // Buffer state for suppressing tool calls in the stream
      let streamBuffer = ''
      let isStreamingSuppressed = false
      const MAX_SUPPRESSION_BUFFER = 2000 // Buffer up to 2KB before giving up on suppression

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
              let text = chunk.message.content
              // Strip Qwen tokenizer artifacts
              text = text.replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/g, '')
              if (!text) continue // skip empty after stripping
              fullAssistantText += text

              // --- Suppression Logic ---
              // If we are at the very start of the response and it looks like a tool call
              // or thinking block (starts with {, <, or <think>), buffer it instead of streaming it immediately.
              if (fullAssistantText.length < MAX_SUPPRESSION_BUFFER && !isStreamingSuppressed) {
                const trimmedFull = fullAssistantText.trim()
                if (trimmedFull.startsWith('{') || trimmedFull.startsWith('<')) {
                  streamBuffer += text
                  continue // Hold back from streaming
                }
              }

              // If we reach here, we've decided this isn't a tool call (or we passed the buffer limit)
              // Flush any buffered text first
              if (streamBuffer) {
                onEvent({
                  type: 'ollama_stream',
                  requestId,
                  event: {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: streamBuffer }
                  }
                })
                streamBuffer = ''
                isStreamingSuppressed = true // Stop buffering for the rest of this turn
              }

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
                if (tc.function?.name) {
                  collectedToolCalls.push(tc)
                } else {
                  log.warn('Skipping malformed tool call (missing function.name):', JSON.stringify(tc).slice(0, 200))
                }
              }
            }

            if (chunk.done) {
              // Capture token usage from the final chunk
              if (chunk.prompt_eval_count) promptTokens = chunk.prompt_eval_count
              if (chunk.eval_count) completionTokens = chunk.eval_count
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
            let text = chunk.message.content.replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/g, '')
            if (text) {
              fullAssistantText += text
              
              // Only stream if not currently suppressed (waiting for end-of-turn tool detection)
              const trimmedFull = fullAssistantText.trim()
              const isPotentialToolOrThink = trimmedFull.startsWith('{') || trimmedFull.startsWith('<')
              
              if (!isPotentialToolOrThink || fullAssistantText.length >= MAX_SUPPRESSION_BUFFER || isStreamingSuppressed) {
                if (streamBuffer) {
                  text = streamBuffer + text
                  streamBuffer = ''
                  isStreamingSuppressed = true
                }
                onEvent({
                  type: 'ollama_stream',
                  requestId,
                  event: {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text }
                  }
                })
              } else {
                streamBuffer += text
              }
            }
          }
          if (chunk.message?.tool_calls?.length > 0) {
            for (const tc of chunk.message.tool_calls) {
              if (tc.function?.name) {
                collectedToolCalls.push(tc)
              } else {
                log.warn('Skipping malformed tool call in buffer flush (missing function.name):', JSON.stringify(tc).slice(0, 200))
              }
            }
          }
        } catch {
          // skip
        }
      }

      // Final decision on the stream buffer:
      // If we finished the turn and detected tool calls (native or text-parsed),
      // we NEVER flush the streamBuffer. This effectively "ghosts" the JSON/XML call from the UI.
      // We also ghost <think> blocks if they are at the start of the response.
      // If no tool calls were detected, we must flush it so Adam sees the text.
      const nativeToolsFound = collectedToolCalls.length > 0
      const textToolsFound = !nativeToolsFound && session.tools?.length > 0 && this._parseToolCallsFromText(fullAssistantText, session.tools).length > 0
      const isThinkBlock = fullAssistantText.trim().startsWith('<think>')

      if (!nativeToolsFound && !textToolsFound && !isThinkBlock && streamBuffer) {
        onEvent({
          type: 'ollama_stream',
          requestId,
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: streamBuffer }
          }
        })
      }

      // If tool calls were returned via native API, emit them for bridge to execute
      if (collectedToolCalls.length > 0) {
        log.debug(`${collectedToolCalls.length} native tool call(s): ${collectedToolCalls.map(tc => tc.function?.name).join(', ')}`)

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
          log.debug(`${parsedCalls.length} text-parsed tool call(s): ${parsedCalls.map(tc => tc.function?.name).join(', ')}`)

          // Strip tool call text (both JSON and XML) from the assistant message
          let cleanedFallbackText = fullAssistantText
          const fallbackJsonObjects = this._extractJsonObjects(fullAssistantText)
          for (const { raw } of fallbackJsonObjects) {
            cleanedFallbackText = cleanedFallbackText.replace(raw, '')
          }
          // Strip XML-style tool calls: <function=...>...</function> or </tool_call>
          cleanedFallbackText = cleanedFallbackText.replace(/<function=\w[\w.]*>[\s\S]*?(?:<\/function>|<\/tool_call>)/g, '')
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
      // Final cleanup of tokenizer artifacts from accumulated text
      fullAssistantText = fullAssistantText.replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/g, '').trim()
      const session2 = this.sessions.get(sessionId)
      if (session2) {
        session2.messages.push({ role: 'assistant', content: fullAssistantText })
        session2.lastActivity = Date.now()

        // Fresh context: trigger background summarization
        if (session2.freshContext && session2.contextFile && fullAssistantText) {
          session2._summarizing = this._updateFreshContext(
            session2.contextFile,
            session2._lastUserMessage || '',
            fullAssistantText
          ).catch(err => log.error('Fresh context update failed:', err.message))
        }
      }

      this.requests.delete(requestId)
      onEvent({
        type: 'ollama_done', requestId, sessionId, exitCode: 0,
        usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
      })

    } catch (err) {
      this.requests.delete(requestId)

      if (err.name === 'AbortError') {
        log.info(`Request ${requestId} aborted`)
        onEvent({ type: 'ollama_done', requestId, sessionId, exitCode: 0 })
        return
      }

      const errorMsg = err.code === 'ECONNREFUSED'
        ? 'Cannot connect to Ollama. Is it running? Try: ollama serve'
        : err.message
      log.error(`Stream error: ${errorMsg}`)
      onEvent({ type: 'ollama_error', requestId, error: errorMsg })
    }
  }

  stop(requestId) {
    const entry = this.requests.get(requestId)
    if (entry) {
      entry.abortController.abort()
      this.requests.delete(requestId)
    } else {
      // Request not in active map — may be in the tool execution window.
      // Mark as cancelled so continueWithToolResults() won't restart streaming.
      this._cancelled.add(requestId)
    }
  }

  shutdown() {
    clearInterval(this._cleanupInterval)
    for (const [id, entry] of this.requests) {
      entry.abortController.abort()
    }
    this.requests.clear()
    this._cancelled.clear()
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

    // Strategy 1: Parse JSON objects (e.g. {"name": "tool", "arguments": {...}})
    const jsonObjects = this._extractJsonObjects(text)
    for (const { parsed, raw } of jsonObjects) {
      const rawName = parsed.name || parsed.function_name || ''
      if (!rawName) continue

      const args = parsed.arguments || parsed.function_arg || parsed.parameters || {}
      const resolvedName = this._resolveToolName(rawName, toolNames)
      if (resolvedName) {
        calls.push({ function: { name: resolvedName, arguments: args } })
      }
    }

    // Strategy 2: Parse XML-style tool calls from Qwen 3 Coder
    // Format: <function=tool_name>\n<parameter=key>value</parameter>\n</function>
    const xmlCalls = this._parseXmlToolCalls(text, toolNames)
    for (const call of xmlCalls) {
      // Avoid duplicates if both JSON and XML matched the same call
      const isDuplicate = calls.some(c => c.function.name === call.function.name)
      if (!isDuplicate) {
        calls.push(call)
      }
    }

    return calls
  }

  /**
   * Resolve a raw tool name against the known tool set.
   * Strips mcp__paloma__ prefix if needed for matching.
   */
  _resolveToolName(rawName, toolNames) {
    if (toolNames.has(rawName)) return rawName
    if (rawName.startsWith('mcp__paloma__')) {
      const stripped = rawName.replace(/^mcp__paloma__/, '')
      if (toolNames.has(stripped)) return stripped
    }
    // Try with server__tool format (model may output filesystem__read_text_file)
    for (const known of toolNames) {
      if (known.endsWith('__' + rawName) || rawName.endsWith('__' + known)) return known
      // Exact suffix match: rawName = 'read_text_file', known = 'filesystem__read_text_file'
      if (known.endsWith(rawName) && known[known.length - rawName.length - 1] === '_') return known
    }
    // Function name extraction: model may hallucinate server prefix but get function name right
    // e.g. "brave-web-search__brave_web_search" → extract "brave_web_search" → match "brave-search__brave_web_search"
    const lastDunder = rawName.lastIndexOf('__')
    if (lastDunder > 0) {
      const funcName = rawName.slice(lastDunder + 2)
      for (const known of toolNames) {
        const knownLastDunder = known.lastIndexOf('__')
        const knownFunc = knownLastDunder > 0 ? known.slice(knownLastDunder + 2) : known
        if (funcName === knownFunc) return known
      }
    }
    return null
  }

  /**
   * Parse XML-style tool calls that Qwen 3 Coder outputs as text.
   * Handles format: <function=tool_name>\n<parameter=key>value</parameter>\n</function>
   * Also handles: </tool_call> closing tags and variations.
   */
  _parseXmlToolCalls(text, toolNames) {
    const calls = []
    // Match <function=NAME> ... </function> or </tool_call>
    const fnRegex = /<function=(\w[\w.]*)>(.*?)(?:<\/function>|<\/tool_call>)/gs
    let match

    while ((match = fnRegex.exec(text)) !== null) {
      const rawName = match[1]
      const body = match[2]
      const args = {}

      // Extract <parameter=KEY>VALUE</parameter> pairs
      const paramRegex = /<parameter=(\w+)>\s*([\s\S]*?)\s*<\/parameter>/g
      let paramMatch
      while ((paramMatch = paramRegex.exec(body)) !== null) {
        let value = paramMatch[2].trim()
        // Try to parse as JSON if it looks like a number, boolean, object, or array
        if (/^[\[{"\d]/.test(value) || value === 'true' || value === 'false' || value === 'null') {
          try { value = JSON.parse(value) } catch { /* keep as string */ }
        }
        args[paramMatch[1]] = value
      }

      const resolvedName = this._resolveToolName(rawName, toolNames)
      if (resolvedName) {
        calls.push({ function: { name: resolvedName, arguments: args } })
      } else {
        log.warn(`XML tool call for unknown tool: ${rawName}`)
      }
    }

    return calls
  }

  /**
   * Update the fresh context document after a turn completes.
   * Calls the summarizer model to produce an updated compressed context.
   */
  async _updateFreshContext(contextFile, userMessage, assistantResponse) {
    const existing = await readFile(contextFile, 'utf8').catch(() => '')

    const userContent = existing
      ? `## Existing Context Document\n\n${existing}\n\n---\n\n## Latest Exchange\n\nUser: ${userMessage}\n\nAssistant: ${assistantResponse}\n\n---\n\nProduce the UPDATED context document incorporating the latest exchange.`
      : `## First Exchange\n\nUser: ${userMessage}\n\nAssistant: ${assistantResponse}\n\n---\n\nCreate the initial context document from this first exchange.`

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:7b',
        messages: [
          { role: 'system', content: SUMMARIZER_PROMPT },
          { role: 'user', content: userContent }
        ],
        stream: false,
        options: { num_ctx: 32768 }
      })
    })

    if (!response.ok) {
      throw new Error(`Summarizer API error ${response.status}`)
    }

    const result = await response.json()
    let summary = result.message?.content || ''

    // Strip any thinking tags from Qwen output
    summary = summary.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    if (!summary) {
      log.warn('Summarizer produced empty output — keeping existing context')
      return
    }

    // Ensure directory exists and write
    await mkdir(dirname(contextFile), { recursive: true })
    await writeFile(contextFile, summary, 'utf8')
    log.debug(`Fresh context updated: ${contextFile} (${summary.length} chars)`)
  }

  _cleanupSessions() {
    const maxAge = 30 * 60 * 1000 // 30 minutes
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > maxAge) {
        log.info(`Expiring inactive session ${sessionId}`)
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
