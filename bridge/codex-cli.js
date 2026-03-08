import { spawn } from 'child_process'
import { randomUUID } from 'crypto'

export class CodexCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, threadId }
    this.mcpProxyPort = null
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()

    // Build the full prompt with system instructions prepended
    // Codex doesn't have --append-system-prompt like Claude CLI.
    // We prepend system instructions to the user prompt with XML delimiters.
    // Alternative: `-c 'instructions="..."'` flag, but shell escaping is fragile
    // for multi-KB prompts. Prompt prepending is reliable with spawn().
    let fullPrompt = prompt
    if (systemPrompt && !sessionId) {
      fullPrompt = `<SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n${prompt}`
    }

    let args

    if (sessionId) {
      // Resume existing conversation using thread ID
      args = ['exec', 'resume', sessionId, '--json', '--full-auto', fullPrompt]
      console.log(`[codex] Resuming thread ${sessionId}`)
    } else {
      // New conversation
      args = ['exec', '--json', '--full-auto', '-C', cwd || process.cwd()]
      if (model) args.push('-m', model)
      args.push(fullPrompt)
      console.log(`[codex] New session, model=${model || 'default'}`)
    }

    const proc = spawn('codex', args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let threadId = sessionId || null
    this.processes.set(requestId, { process: proc, threadId })
    console.log(`[codex] Process spawned, pid=${proc.pid}`)

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
          }
        } catch {
          // skip non-JSON lines
        }
      }
    })

    proc.stderr.on('data', () => {
      // Codex writes progress info to stderr — ignore
    })

    proc.on('close', (code) => {
      console.log(`[codex] Process closed, exitCode=${code}, request ${requestId}`)
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          this._handleEvent(event, requestId, onEvent)
        } catch {
          // skip
        }
      }
      this.processes.delete(requestId)
      onEvent({ type: 'codex_done', requestId, sessionId: threadId, exitCode: code })
    })

    proc.on('error', (err) => {
      console.error(`[codex] Process error: ${err.message}`)
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
