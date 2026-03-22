import { spawn, execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

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
      console.log(`[copilot] Instructions dir written to ${instructionsDirPath}`)
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
      console.log(`[copilot] Resuming session ${sessionId}`)
    } else {
      // New session — generate a session ID for tracking
      sessionId = randomUUID()
      args.push('--resume', sessionId) // Copilot accepts UUID for new sessions too
      args.push('-p', fullPrompt)
      args.push('--allow-all')
      args.push('--no-ask-user')
      if (model) args.push('--model', model)
      if (cwd) args.push('--add-dir', cwd)
      console.log(`[copilot] New session, model=${model || 'default'}`)
    }

    // Inject MCP config if proxy is available
    let mcpConfigPath = null
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
      console.log(`[copilot] MCP config written to ${mcpConfigPath}`)
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
    console.log(`[copilot] Process spawned, pid=${proc.pid}`)

    let buffer = ''

    proc.stdout.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed)
          this._handleEvent(event, requestId, onEvent)

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
          }
        } catch {
          // skip non-JSON lines
        }
      }
    })

    proc.stdout.on('error', (err) => {
      console.error(`[copilot] stdout error: ${err.message}`)
      onEvent({ type: 'copilot_error', requestId, error: `Stream error: ${err.message}` })
    })

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim()
      if (text) console.error(`[copilot] stderr: ${text}`)
    })

    proc.stderr.on('error', (err) => {
      console.error(`[copilot] stderr error: ${err.message}`)
    })

    proc.on('close', (code) => {
      console.log(`[copilot] Process closed, exitCode=${code}, request ${requestId}`)
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          this._handleEvent(event, requestId, onEvent)
          if (event.type === 'result' && event.sessionId) {
            sessionId = event.sessionId
          }
        } catch {
          // skip non-JSON lines
        }
      }
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
      console.error(`[copilot] Process error: ${err.message}`)
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
   * Copilot emits:
   * - assistant.message_delta — streaming text chunks (deltaContent)
   * - assistant.message — complete message with content
   * - assistant.turn_start / assistant.turn_end — turn boundaries
   * - result — session complete with sessionId, usage
   */
  _handleEvent(event, requestId, onEvent) {
    if (event.type === 'assistant.message_delta' && event.data?.deltaContent) {
      // Streaming text delta — forward to UI
      onEvent({
        type: 'copilot_stream',
        requestId,
        event: { type: 'agent_message', text: event.data.deltaContent }
      })
    } else if (event.type === 'assistant.message' && event.data?.content) {
      // Complete message — skip if we already streamed deltas (to avoid duplicate text).
      // Only emit if there were no deltas (e.g., tool-only turns).
      // The pillar manager accumulates text from deltas, so this is just for completeness.
    } else if (event.type === 'assistant.tool_call' && event.data) {
      const toolId = randomUUID()
      const toolName = event.data.toolName || event.data.tool || ''
      const args = event.data.arguments || {}
      const status = event.data.status || 'started'

      // Emit tool_use so the UI shows the tool call in the activity panel
      onEvent({
        type: 'copilot_stream',
        requestId,
        event: {
          type: 'tool_use',
          tool_use: { id: toolId, name: toolName, input: args }
        }
      })

      // If status indicates completion, also emit tool_result
      if (status === 'completed' || status === 'finished' || status === 'done') {
        const resultContent = event.data.result || event.data.output || ''
        onEvent({
          type: 'copilot_stream',
          requestId,
          event: {
            type: 'tool_result',
            toolUseId: toolId,
            content: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent)
          }
        })
      }
    } else if (event.type === 'assistant.tool_result' && event.data) {
      // Future-proofing: handle separate tool_result events if Copilot ever emits them
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
    // session.tools_updated, user.message, turn_start/end, result
    // are structural — not forwarded as stream events
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
