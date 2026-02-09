import { spawn } from 'child_process'
import { randomUUID } from 'crypto'

export class ClaudeCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, sessionId }
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']

    if (sessionId) {
      // Resume existing conversation
      args.push('--resume', sessionId)
      console.log(`[cli] Resuming session ${sessionId}`)
    } else {
      // New conversation
      sessionId = randomUUID()
      args.push('--session-id', sessionId)
      if (model) args.push('--model', model)
      if (systemPrompt) args.push('--append-system-prompt', systemPrompt)
      console.log(`[cli] New session, model=${model}`)
    }

    const proc = spawn('claude', args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.processes.set(requestId, { process: proc, sessionId })
    console.log(`[cli] Process spawned, pid=${proc.pid}`)

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
          onEvent({ type: 'claude_stream', requestId, event })
        } catch {
          // skip non-JSON lines
        }
      }
    })

    proc.stderr.on('data', () => {
      // Claude CLI writes progress info to stderr — ignore
    })

    proc.on('close', (code) => {
      console.log(`[cli] Process closed, exitCode=${code}, request ${requestId}`)
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          onEvent({ type: 'claude_stream', requestId, event })
        } catch {
          // skip
        }
      }
      this.processes.delete(requestId)
      onEvent({ type: 'claude_done', requestId, sessionId, exitCode: code })
    })

    proc.on('error', (err) => {
      console.error(`[cli] Process error: ${err.message}`)
      this.processes.delete(requestId)
      onEvent({ type: 'claude_error', requestId, error: err.message })
    })

    return { requestId, sessionId }
  }

  stop(requestId) {
    const entry = this.processes.get(requestId)
    if (entry) {
      entry.process.kill('SIGTERM')
      this.processes.delete(requestId)
    }
  }

  shutdown() {
    for (const [id, entry] of this.processes) {
      entry.process.kill('SIGTERM')
    }
    this.processes.clear()
  }
}
