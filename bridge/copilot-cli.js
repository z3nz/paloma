import { spawn, execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export class CopilotCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, sessionId, mcpConfigPath }
    this.mcpProxyPort = null
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()

    // Copilot CLI doesn't have --append-system-prompt like Claude CLI.
    // Prepend system instructions to the prompt with XML delimiters (same as Codex).
    let fullPrompt = prompt
    if (systemPrompt && !sessionId) {
      fullPrompt = `<SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n${prompt}`
    }

    const args = ['--output-format', 'json']

    if (sessionId) {
      // Resume existing session
      args.push('--resume', sessionId)
      args.push('-p', fullPrompt)
      console.log(`[copilot] Resuming session ${sessionId}`)
    } else {
      // New session — generate a session ID for tracking
      sessionId = randomUUID()
      args.push('--resume', sessionId) // Copilot accepts UUID for new sessions too
      args.push('-p', fullPrompt)
      // Allow all tools and paths for non-interactive operation
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
    if (!env.COPILOT_GITHUB_TOKEN && !env.GH_TOKEN && !env.GITHUB_TOKEN) {
      try {
        env.GH_TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim()
      } catch {
        // Will use whatever auth copilot has configured
      }
    }

    const proc = spawn('copilot', args, {
      cwd: cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.processes.set(requestId, { process: proc, sessionId, mcpConfigPath })
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
            sessionId = event.sessionId
          }
        } catch {
          // skip non-JSON lines
        }
      }
    })

    proc.stdout.on('error', (err) => {
      console.error(`[copilot] stdout error: ${err.message}`)
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
      // Clean up temp MCP config
      const entry = this.processes.get(requestId)
      if (entry?.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
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
      // Tool call events
      onEvent({
        type: 'copilot_stream',
        requestId,
        event: {
          type: 'tool_call',
          tool: event.data.toolName || event.data.tool || '',
          arguments: event.data.arguments || {},
          status: event.data.status || 'started'
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
      entry.process.kill('SIGTERM')
      this.processes.delete(requestId)
    }
  }

  shutdown() {
    for (const [, entry] of this.processes) {
      if (entry.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
      }
      entry.process.kill('SIGTERM')
    }
    this.processes.clear()
  }
}
