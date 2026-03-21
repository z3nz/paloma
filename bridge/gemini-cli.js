import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export class GeminiCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, sessionId, sessionDir }
    this.mcpProxyPort = null
    // Clean up orphaned temp dirs from previous crashes
    this._cleanupOrphanedDirs()
  }

  _cleanupOrphanedDirs() {
    try {
      const tmp = tmpdir()
      const dirs = readdirSync(tmp).filter(d => d.startsWith('paloma-gemini-'))
      for (const dir of dirs) {
        try { rmSync(join(tmp, dir), { recursive: true, force: true }) } catch {}
      }
      if (dirs.length > 0) {
        console.log(`[gemini] Cleaned up ${dirs.length} orphaned temp dir(s)`)
      }
    } catch {}
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()

    // Create per-session temp directory for .gemini/settings.json and system prompt
    const sessionDir = join(tmpdir(), `paloma-gemini-${requestId}`)
    mkdirSync(join(sessionDir, '.gemini'), { recursive: true })

    // Write MCP config as .gemini/settings.json in the temp cwd
    if (this.mcpProxyPort) {
      const settings = {
        mcp: {
          allowed: ['paloma']
        },
        mcpServers: {
          paloma: {
            url: `http://localhost:${this.mcpProxyPort}/sse?cliRequestId=${requestId}`,
            trust: true,
            timeout: 600000
          }
        }
      }
      writeFileSync(join(sessionDir, '.gemini', 'settings.json'), JSON.stringify(settings, null, 2))
      console.log(`[gemini] MCP settings written to ${sessionDir}/.gemini/settings.json`)
    }

    // Write system prompt to temp file (GEMINI_SYSTEM_MD replaces built-in prompt)
    let systemPromptPath = null
    if (systemPrompt && !sessionId) {
      systemPromptPath = join(sessionDir, 'system-prompt.md')
      writeFileSync(systemPromptPath, systemPrompt)
    }

    const args = ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo']

    if (sessionId) {
      // Resume existing session
      args.push('--resume', sessionId)
      console.log(`[gemini] Resuming session ${sessionId}`)
    } else {
      // New session
      if (model) args.push('--model', model)
      // Include the actual project directory so Gemini has workspace context
      if (cwd) args.push('--include-directories', cwd)
      console.log(`[gemini] New session, model=${model || 'flash'}`)
    }

    const env = { ...process.env }
    if (systemPromptPath) {
      env.GEMINI_SYSTEM_MD = systemPromptPath
    }

    const proc = spawn('gemini', args, {
      cwd: sessionDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.processes.set(requestId, { process: proc, sessionId, sessionDir })
    console.log(`[gemini] Process spawned, pid=${proc.pid}`)

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
        } catch {
          // skip non-JSON lines
        }
      }
    })

    proc.stdout.on('error', (err) => {
      console.error(`[gemini] stdout error: ${err.message}`)
      onEvent({ type: 'gemini_error', requestId, error: `Stream error: ${err.message}` })
    })

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim()
      if (text) console.error(`[gemini] stderr: ${text}`)
    })

    proc.stderr.on('error', (err) => {
      console.error(`[gemini] stderr error: ${err.message}`)
    })

    proc.on('close', (code) => {
      console.log(`[gemini] Process closed, exitCode=${code}, request ${requestId}`)
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          this._handleEvent(event, requestId, onEvent)
        } catch {
          // skip
        }
      }
      // Clean up temp session directory
      const entry = this.processes.get(requestId)
      if (entry?.sessionDir) {
        try { rmSync(entry.sessionDir, { recursive: true, force: true }) } catch {}
      }
      const finalSessionId = entry?.sessionId || sessionId
      this.processes.delete(requestId)
      onEvent({ type: 'gemini_done', requestId, sessionId: finalSessionId, exitCode: code })
    })

    proc.on('error', (err) => {
      console.error(`[gemini] Process error: ${err.message}`)
      try { rmSync(sessionDir, { recursive: true, force: true }) } catch {}
      this.processes.delete(requestId)
      onEvent({ type: 'gemini_error', requestId, error: err.message })
    })

    return { requestId, sessionId: sessionId || null }
  }

  /**
   * Map Gemini CLI JSONL events to normalized gemini_stream events.
   *
   * Gemini emits:
   * - init — session start with session_id (captured internally)
   * - message (role=assistant) — streaming text chunks or complete messages
   * - tool_use — model wants to call a tool
   * - tool_result — tool execution result
   * - error — non-fatal warning/error
   * - result — conversation complete
   */
  _handleEvent(event, requestId, onEvent) {
    if (event.type === 'init') {
      // Capture session ID from init event
      if (event.session_id) {
        const entry = this.processes.get(requestId)
        if (entry) entry.sessionId = event.session_id
        console.log(`[gemini] Session ID: ${event.session_id}`)
        
        // Emit session_id early so frontend can associate pillar spawns
        onEvent({
          type: 'gemini_stream',
          requestId,
          event: { type: 'session_id', sessionId: event.session_id }
        })
      }
      return // Don't forward init events
    }

    if (event.type === 'message' && event.role === 'assistant') {
      // Normalize to agent_message format (matches Codex/Copilot pattern)
      // for simpler text extraction in pillar-manager
      if (event.content) {
        onEvent({
          type: 'gemini_stream',
          requestId,
          event: { type: 'agent_message', text: event.content }
        })
      }
    } else if (event.type === 'tool_use') {
      onEvent({
        type: 'gemini_stream',
        requestId,
        event: {
          type: 'tool_use',
          tool_use: {
            id: event.tool_id || randomUUID(),
            name: event.tool_name || '',
            input: event.parameters || {}
          }
        }
      })
    } else if (event.type === 'tool_result') {
      onEvent({
        type: 'gemini_stream',
        requestId,
        event: {
          type: 'tool_result',
          toolUseId: event.tool_id || '',
          content: event.output || ''
        }
      })
    } else if (event.type === 'error') {
      // Non-fatal error — forward as stream event
      onEvent({
        type: 'gemini_stream',
        requestId,
        event: { type: 'error', text: event.message || 'Unknown error' }
      })
    } else if (event.type === 'result') {
      // Result event signals completion — the close handler will emit gemini_done
      // Extract session ID if available
      if (event.session_id) {
        const entry = this.processes.get(requestId)
        if (entry) entry.sessionId = event.session_id
      }
    }
  }

  stop(requestId) {
    const entry = this.processes.get(requestId)
    if (entry) {
      if (entry.sessionDir) {
        try { rmSync(entry.sessionDir, { recursive: true, force: true }) } catch {}
      }
      entry.process.kill('SIGTERM')
      this.processes.delete(requestId)
    }
  }

  shutdown() {
    for (const [, entry] of this.processes) {
      if (entry.sessionDir) {
        try { rmSync(entry.sessionDir, { recursive: true, force: true }) } catch {}
      }
      entry.process.kill('SIGTERM')
    }
    this.processes.clear()
  }
}
