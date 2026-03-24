import { spawn } from 'child_process'
import { randomUUID } from 'crypto'

export class CodexCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, threadId }
    this.mcpProxyPort = null
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()
    const reqShort = requestId.slice(0, 8)

    // Build the full prompt with system instructions prepended.
    //
    // INVESTIGATION FINDINGS (2026-03-21):
    // Codex CLI has NO true system prompt channel for exec mode. Exhaustive search:
    //   - No --instructions / --system / --system-file flags in `codex exec --help`
    //   - `-c instructions="..."` config key: accepted without error but adds 0 tokens
    //     to model context (confirmed via input_token counts — completely ignored)
    //   - CODEX_INSTRUCTIONS env var: no effect (same token count, behavior unchanged)
    //   - OPENAI_INSTRUCTIONS env var: no effect (same token count, behavior unchanged)
    //   - AGENTS.md IS automatically loaded from the project dir (~900 tokens added)
    //     but is a static file — can't carry per-session dynamic identity
    //
    // APPROACH: ChatML native token framing.
    // GPT-family models (including GPT-5.4/Codex) tokenize <|im_start|>/<|im_end|>
    // as actual special tokens — the same role-boundary markers used internally.
    // Wrapping the system prompt in ChatML format inside the prompt argument causes
    // the model to treat it as a genuine system role, not arbitrary user text.
    //
    // Tested: `<|im_start|>system\nALWAYS USE ALL CAPS\n<|im_end|>\n...` → model
    // responded in ALL CAPS. Previous `<SYSTEM_INSTRUCTIONS>` XML tags had no effect.
    //
    // CAUTION: Codex CLI may wrap messages in its own ChatML internally before
    // sending to the API. If double-wrapping causes issues in future model versions,
    // this approach may need revisiting. Output verified sane as of gpt-5.4.
    let fullPrompt = prompt
    if (systemPrompt && !sessionId) {
      fullPrompt = `<|im_start|>system\n${systemPrompt}\n<|im_end|>\n<|im_start|>user\n${prompt}\n<|im_end|>\n<|im_start|>assistant\n`
    }

    let args

    if (sessionId) {
      // Resume existing conversation using thread ID
      args = ['exec', 'resume', sessionId, '--json', '--full-auto', fullPrompt]
      console.log(`[codex:${reqShort}] Resuming thread ${sessionId}`)
    } else {
      // New conversation
      args = ['exec', '--json', '--full-auto', '-C', cwd || process.cwd()]
      if (model) args.push('-m', model)

      // Inject MCP proxy config so Codex gets all of Paloma's tools
      if (!this.mcpProxyPort) {
        console.warn(`[codex:${reqShort}] WARNING: mcpProxyPort not set — spawning WITHOUT MCP tools`)
      }
      if (this.mcpProxyPort) {
        args.push('-c', `mcp_servers.paloma.url="http://localhost:${this.mcpProxyPort}/mcp?cliRequestId=${requestId}"`)
        console.log(`[codex:${reqShort}] MCP proxy injected via -c flag (port ${this.mcpProxyPort})`)
      }

      args.push(fullPrompt)
      console.log(`[codex:${reqShort}] New session, model=${model || 'default'}`)
    }

    const proc = spawn('codex', args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let threadId = sessionId || randomUUID()
    this.processes.set(requestId, { process: proc, threadId })
    console.log(`[codex:${reqShort}] Process spawned, pid=${proc.pid}`)

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

          // Capture thread ID from thread.started event
          if (event.type === 'thread.started' && event.thread_id) {
            threadId = event.thread_id
            const entry = this.processes.get(requestId)
            if (entry) entry.threadId = threadId
            
            // Emit session_id early so frontend can associate pillar spawns
            onEvent({
              type: 'codex_stream',
              requestId,
              event: { type: 'session_id', sessionId: threadId },
              sessionId: threadId
            })
          }
        } catch {
          // skip non-JSON lines
        }
      }
    })

    proc.stdout.on('error', (err) => {
      console.error(`[codex:${reqShort}] stdout error: ${err.message}`)
      onEvent({ type: 'codex_error', requestId, error: `Stream error: ${err.message}` })
    })

    proc.stderr.on('data', () => {
      // Codex writes progress info to stderr — ignore
    })

    proc.stderr.on('error', (err) => {
      console.error(`[codex:${reqShort}] stderr error: ${err.message}`)
    })

    proc.on('close', (code) => {
      console.log(`[codex:${reqShort}] Process closed, exitCode=${code}`)
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          this._handleEvent(event, requestId, onEvent)
        } catch {
          // skip non-JSON lines
        }
      }
      // Use latest threadId from entry (may have been updated by thread.started event)
      const entry = this.processes.get(requestId)
      const finalThreadId = entry?.threadId || threadId
      this.processes.delete(requestId)
      onEvent({ type: 'codex_done', requestId, sessionId: finalThreadId, exitCode: code })
    })

    proc.on('error', (err) => {
      console.error(`[codex:${reqShort}] Process error: ${err.message}`)
      this.processes.delete(requestId)
      onEvent({ type: 'codex_error', requestId, error: err.message })
    })

    return { requestId, sessionId: threadId }
  }

  /**
   * Map Codex JSONL events to normalized codex_stream events.
   *
   * Codex emits complete items (not streaming deltas like Claude).
   * Each item.completed becomes a codex_stream event with the item data.
   */
  _handleEvent(event, requestId, onEvent) {
    const reqShort = requestId.slice(0, 8)
    // Surface error events (auth 401, rate limits, reconnection attempts, etc.)
    // These are informational — the process hasn't died yet. The actual terminal
    // failure comes when the process exits with non-zero code.
    if (event.type === 'error') {
      const errorText = event.message || event.error || JSON.stringify(event)
      console.error(`[codex:${reqShort}] Error event: ${errorText}`)
      onEvent({
        type: 'codex_stream',
        requestId,
        event: { type: 'error', text: errorText }
      })
      return
    }

    if (event.type === 'item.completed' && event.item) {
      const item = event.item
      if (item.type === 'agent_message') {
        onEvent({
          type: 'codex_stream',
          requestId,
          event: { type: 'agent_message', text: item.text || '' }
        })
      } else if (item.type === 'command_execution') {
        onEvent({
          type: 'codex_stream',
          requestId,
          event: {
            type: 'command_execution',
            command: item.command || '',
            output: item.aggregated_output || '',
            exit_code: item.exit_code
          }
        })
      } else if (item.type === 'mcp_tool_call') {
        // MCP tool call through Paloma's proxy
        onEvent({
          type: 'codex_stream',
          requestId,
          event: {
            type: 'mcp_tool_call',
            server: item.server || '',
            tool: item.tool || '',
            arguments: item.arguments || {},
            result: item.result,
            error: item.error,
            status: item.status || 'completed'
          }
        })
      }
    }
    // thread.started, turn.started, turn.completed are handled
    // structurally (thread ID capture, done event) — not forwarded as stream events
  }

  stop(requestId) {
    const entry = this.processes.get(requestId)
    if (entry) {
      entry.process.kill('SIGTERM')
      this.processes.delete(requestId)
    }
  }

  shutdown() {
    for (const [, entry] of this.processes) {
      entry.process.kill('SIGTERM')
    }
    this.processes.clear()
  }
}
