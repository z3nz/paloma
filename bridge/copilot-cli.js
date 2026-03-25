import { spawn, execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import { attachStreamParser } from './cli-stream-parser.js'
import { createLogger } from './logger.js'

const execFileAsync = promisify(execFile)
const log = createLogger('copilot')

export class CopilotCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, sessionId, mcpConfigPath, instructionsDirPath }
    this.mcpProxyPort = null
    this._cachedGhToken = null
    // Persistent cache of systemPrompt per Copilot session ID.
    // Pillar-manager passes systemPrompt=undefined on resumed turns; we re-inject
    // from here so every CLI invocation gets the instructions via the proper channel.
    this._sessionPrompts = new Map() // copilotSessionId → systemPrompt string
    // Warm the GH token asynchronously at construction time
    this._warmAuth()
  }

  async _warmAuth() {
    try {
      const { stdout } = await execFileAsync('gh', ['auth', 'token'])
      this._cachedGhToken = stdout.trim()
    } catch {
      // gh CLI not available or not authenticated — copilot will use its own auth
    }
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()
    const reqShort = requestId.slice(0, 8)

    // Per-request state: track which messageIds have received streaming deltas
    // so we can avoid emitting duplicate text from assistant.message events.
    const deltaMessageIds = new Set()

    // IDENTITY INJECTION: Copilot CLI supports COPILOT_CUSTOM_INSTRUCTIONS_DIRS — an env var
    // that points to additional directories searched for instruction files (AGENTS.md,
    // copilot-instructions.md, etc.). Content is loaded as TRUE system-level instructions,
    // not user-turn text. Confirmed via WU-5 investigation (2026-03-22):
    //   - Setting COPILOT_CUSTOM_INSTRUCTIONS_DIRS=/tmpdir with AGENTS.md present caused
    //     the model to load the content as "hidden instructions" (its own words)
    //   - This delivers identity reliably on EVERY turn (new + resumed), because each
    //     copilot --resume invocation re-reads the env var and the file
    //   - Far superior to the prior XML user-turn prepend, which GPT-family models treat
    //     as conversational context rather than behavioral anchoring
    //
    // On resumed turns, pillar-manager passes systemPrompt=undefined — we retrieve the
    // cached prompt from this._sessionPrompts so identity stays fresh every turn.
    //
    // Previous approach (for reference — DO NOT restore):
    //   if (systemPrompt && !sessionId) {
    //     fullPrompt = `<SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n${prompt}`
    //   }

    // Retrieve cached system prompt for resumed sessions
    const effectiveSystemPrompt = systemPrompt || this._sessionPrompts.get(sessionId)

    const fullPrompt = prompt

    const args = ['--output-format', 'json']

    // Build instructions temp dir for this invocation
    let instructionsDirPath = null
    if (effectiveSystemPrompt) {
      instructionsDirPath = join(tmpdir(), `paloma-copilot-inst-${requestId}`)
      mkdirSync(instructionsDirPath, { recursive: true })
      writeFileSync(join(instructionsDirPath, 'AGENTS.md'), effectiveSystemPrompt, 'utf8')
      log.debug(`[${reqShort}] Instructions dir written to ${instructionsDirPath}`)
    }

    if (sessionId) {
      // Resume existing session
      args.push('--resume', sessionId)
      args.push('-p', fullPrompt)
      // These flags are needed for both new and resumed sessions since
      // stdin is set to 'ignore' — without them, Copilot may hang waiting
      // for interactive input and exit with an error.
      args.push('--allow-all')
      args.push('--no-ask-user')
      log.info(`[${reqShort}] Resuming session ${sessionId}`)
    } else {
      // New session — generate a session ID for tracking
      sessionId = randomUUID()
      args.push('--resume', sessionId) // Copilot accepts UUID for new sessions too
      args.push('-p', fullPrompt)
      args.push('--allow-all')
      args.push('--no-ask-user')
      if (model) args.push('--model', model)
      if (cwd) args.push('--add-dir', cwd)
      log.info(`[${reqShort}] New session, model=${model || 'default'}`)
    }

    // Inject MCP config if proxy is available
    let mcpConfigPath = null
    if (!this.mcpProxyPort) {
      log.warn(`[${reqShort}] mcpProxyPort not set — spawning WITHOUT MCP tools`)
    }
    if (this.mcpProxyPort) {
      mcpConfigPath = join(tmpdir(), `paloma-copilot-mcp-${requestId}.json`)
      const mcpConfig = {
        mcpServers: {
          paloma: {
            type: 'sse',
            url: `http://localhost:${this.mcpProxyPort}/sse?cliRequestId=${requestId}`
          }
        }
      }
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig))
      args.push('--additional-mcp-config', `@${mcpConfigPath}`)
      args.push('--allow-tool', 'paloma')
      log.debug(`[${reqShort}] MCP config written to ${mcpConfigPath}`)
    }

    // Use GH_TOKEN from gh auth for authentication
    const env = { ...process.env }

    // Inject instructions dir via env var (extends any existing dirs)
    if (instructionsDirPath) {
      const existing = env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS
      env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS = existing
        ? `${existing},${instructionsDirPath}`
        : instructionsDirPath
    }
    if (!env.COPILOT_GITHUB_TOKEN && !env.GH_TOKEN && !env.GITHUB_TOKEN) {
      if (this._cachedGhToken) {
        env.GH_TOKEN = this._cachedGhToken
      }
      // Token is fetched asynchronously at startup via warmAuth()
    }

    const proc = spawn('copilot', args, {
      cwd: cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.processes.set(requestId, { process: proc, sessionId, mcpConfigPath, instructionsDirPath })
    log.info(`[${reqShort}] Process spawned, pid=${proc.pid}`)

    const flush = attachStreamParser(proc.stdout, (event) => {
      this._handleEvent(event, requestId, onEvent, deltaMessageIds)

      // Capture session ID from result event
      if (event.type === 'result' && event.sessionId) {
        const entry = this.processes.get(requestId)
        if (entry) entry.sessionId = event.sessionId
        // Cache system prompt keyed by Copilot's final session ID so resumed turns
        // can re-inject it via COPILOT_CUSTOM_INSTRUCTIONS_DIRS
        if (effectiveSystemPrompt) {
          this._sessionPrompts.set(event.sessionId, effectiveSystemPrompt)
        }
        sessionId = event.sessionId

        // Emit session ID early as a stream event so frontend can update immediately
        onEvent({
          type: 'copilot_stream',
          requestId,
          event: { type: 'session_id', sessionId: event.sessionId },
          sessionId: event.sessionId
        })
      }
    })

    proc.stdout.on('error', (err) => {
      log.error(`[${reqShort}] stdout error: ${err.message}`)
      onEvent({ type: 'copilot_error', requestId, error: `Stream error: ${err.message}` })
    })

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim()
      if (text) log.warn(`[${reqShort}] stderr: ${text}`)
    })

    proc.stderr.on('error', (err) => {
      log.error(`[${reqShort}] stderr error: ${err.message}`)
    })

    proc.on('close', (code) => {
      log.info(`[${reqShort}] Process closed, exitCode=${code}`)
      flush()
      // Clean up temp files
      const entry = this.processes.get(requestId)
      if (entry?.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
      }
      if (entry?.instructionsDirPath) {
        try { rmSync(entry.instructionsDirPath, { recursive: true, force: true }) } catch {}
      }
      const finalSessionId = entry?.sessionId || sessionId
      this.processes.delete(requestId)
      onEvent({ type: 'copilot_done', requestId, sessionId: finalSessionId, exitCode: code })
    })

    proc.on('error', (err) => {
      log.error(`[${reqShort}] Process error: ${err.message}`)
      if (mcpConfigPath) {
        try { unlinkSync(mcpConfigPath) } catch {}
      }
      if (instructionsDirPath) {
        try { rmSync(instructionsDirPath, { recursive: true, force: true }) } catch {}
      }
      this.processes.delete(requestId)
      onEvent({ type: 'copilot_error', requestId, error: err.message })
    })

    return { requestId, sessionId }
  }

  /**
   * Map Copilot CLI JSONL events to normalized copilot_stream events.
   *
   * Actual Copilot CLI event types (from --output-format json):
   * - assistant.message_delta — streaming text chunks (deltaContent)
   * - assistant.message — complete message with content AND toolRequests[]
   * - assistant.reasoning_delta — model reasoning chunks (not forwarded)
   * - assistant.turn_start / assistant.turn_end — turn boundaries
   * - tool.execution_start — tool call started (toolCallId, toolName, arguments)
   * - tool.execution_complete — tool call finished (toolCallId, result)
   * - result — session complete with sessionId, usage
   * - session.* — MCP server status, tools updated (ephemeral, ignored)
   * - user.message — echo of user input (ignored)
   *
   * @param {Set<string>} deltaMessageIds - tracks messageIds that received streaming deltas
   */
  _handleEvent(event, requestId, onEvent, deltaMessageIds) {
    if (event.type === 'assistant.message_delta' && event.data?.deltaContent) {
      // Track that this messageId received deltas (to avoid duplicate from assistant.message)
      if (event.data.messageId) {
        deltaMessageIds.add(event.data.messageId)
      }
      // Streaming text delta — forward to UI
      onEvent({
        type: 'copilot_stream',
        requestId,
        event: { type: 'agent_message', text: event.data.deltaContent }
      })
    } else if (event.type === 'assistant.message' && event.data) {
      // Complete message — contains final content AND toolRequests.
      //
      // Content: only emit if we didn't already stream deltas for this messageId
      // (avoids duplicate text). For tool-only turns, content is usually just whitespace.
      const messageId = event.data.messageId
      const content = event.data.content || ''
      if (content.trim() && (!messageId || !deltaMessageIds.has(messageId))) {
        onEvent({
          type: 'copilot_stream',
          requestId,
          event: { type: 'agent_message', text: content }
        })
      }

      // Tool requests: emit each as a tool_use event so the UI shows tool activity.
      // Copilot embeds tool calls in assistant.message.data.toolRequests[] —
      // it does NOT emit separate assistant.tool_call events.
      if (event.data.toolRequests && event.data.toolRequests.length > 0) {
        for (const req of event.data.toolRequests) {
          onEvent({
            type: 'copilot_stream',
            requestId,
            event: {
              type: 'tool_use',
              tool_use: {
                id: req.toolCallId || randomUUID(),
                name: req.name || '',
                input: req.arguments || {}
              }
            }
          })
        }
      }
    } else if (event.type === 'tool.execution_start' && event.data) {
      // Tool execution starting — Copilot executes tools locally.
      // We already emit tool_use from assistant.message.toolRequests above,
      // so this is mainly for tools that appear without a preceding assistant.message.
      // Skip emitting here to avoid duplicate tool_use events.
    } else if (event.type === 'tool.execution_complete' && event.data) {
      // Tool execution finished — forward as tool_result
      const toolCallId = event.data.toolCallId || ''
      const result = event.data.result
      let resultContent = ''
      if (result) {
        resultContent = typeof result.content === 'string'
          ? result.content
          : typeof result === 'string'
            ? result
            : JSON.stringify(result)
      }
      onEvent({
        type: 'copilot_stream',
        requestId,
        event: {
          type: 'tool_result',
          toolUseId: toolCallId,
          content: resultContent,
          success: event.data.success !== false
        }
      })
    } else if (event.type === 'assistant.tool_call' && event.data) {
      // Legacy handler: some Copilot versions may emit separate tool_call events
      const toolId = event.data.toolCallId || randomUUID()
      const toolName = event.data.toolName || event.data.name || event.data.tool || ''
      const args = event.data.arguments || {}

      onEvent({
        type: 'copilot_stream',
        requestId,
        event: {
          type: 'tool_use',
          tool_use: { id: toolId, name: toolName, input: args }
        }
      })
    } else if (event.type === 'assistant.tool_result' && event.data) {
      // Legacy handler: future-proofing for separate tool_result events
      onEvent({
        type: 'copilot_stream',
        requestId,
        event: {
          type: 'tool_result',
          toolUseId: event.data.toolCallId || event.data.id || '',
          content: event.data.result || event.data.output || event.data.content || ''
        }
      })
    }
    // session.*, user.message, assistant.turn_start/turn_end, assistant.reasoning_delta,
    // assistant.reasoning, result — structural events, not forwarded as stream events.
    // Result is handled in the stream parser callback above for session ID capture.
  }

  stop(requestId) {
    const entry = this.processes.get(requestId)
    if (entry) {
      if (entry.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
      }
      if (entry.instructionsDirPath) {
        try { rmSync(entry.instructionsDirPath, { recursive: true, force: true }) } catch {}
      }
      entry.process.kill('SIGTERM')
      this.processes.delete(requestId)
    }
  }

  shutdown() {
    for (const [, entry] of this.processes) {
      if (entry.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
      }
      if (entry.instructionsDirPath) {
        try { rmSync(entry.instructionsDirPath, { recursive: true, force: true }) } catch {}
      }
      entry.process.kill('SIGTERM')
    }
    this.processes.clear()
    this._sessionPrompts.clear()
  }
}
