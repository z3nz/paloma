import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { readdir, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attachStreamParser } from './cli-stream-parser.js'
import { createLogger } from './logger.js'

const log = createLogger('claude')

export class ClaudeCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, sessionId, mcpConfigPath }
    this.mcpProxyPort = null
    // Clean up orphaned MCP config files from previous crashes (async, non-blocking)
    this._cleanupOrphanedConfigs()
  }

  async _cleanupOrphanedConfigs() {
    try {
      const tmp = tmpdir()
      const entries = await readdir(tmp)
      const configs = entries.filter(f => f.startsWith('paloma-mcp-') && f.endsWith('.json'))
      if (configs.length === 0) return
      await Promise.allSettled(
        configs.map(f => unlink(join(tmp, f)))
      )
      log.info(`Cleaned up ${configs.length} orphaned MCP config(s)`)
    } catch { /* best-effort */ }
  }

  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) {
    const requestId = randomUUID()
    const reqShort = requestId.slice(0, 8)
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']

    if (sessionId) {
      // Resume existing conversation
      args.push('--resume', sessionId)
      log.info(`[${reqShort}] Resuming session ${sessionId}`)
    } else {
      // New conversation
      sessionId = randomUUID()
      args.push('--session-id', sessionId)
      if (model) args.push('--model', model)
      if (systemPrompt) {
        // Linux limits each execve argument to ~128KB (MAX_ARG_STRLEN = PAGE_SIZE * 32).
        // Large system prompts with many active plans can exceed this, causing E2BIG.
        const promptBytes = Buffer.byteLength(systemPrompt, 'utf-8')
        const MAX_ARG_BYTES = 120000 // conservative threshold below 131072
        if (promptBytes > MAX_ARG_BYTES) {
          log.warn(`[${reqShort}] System prompt is ${(promptBytes / 1024).toFixed(0)}KB — approaching 128KB per-arg limit. Consider reducing active plans.`)
        }
        args.push('--append-system-prompt', systemPrompt)
      }
      log.info(`[${reqShort}] New session, model=${model}`)
    }

    // Inject MCP config if proxy is available
    let mcpConfigPath = null
    if (!this.mcpProxyPort) {
      log.warn(`[${reqShort}] mcpProxyPort not set — spawning WITHOUT MCP tools`)
    }
    if (this.mcpProxyPort) {
      mcpConfigPath = join(tmpdir(), `paloma-mcp-${requestId}.json`)
      const mcpConfig = {
        mcpServers: {
          paloma: {
            type: 'sse',
            url: `http://localhost:${this.mcpProxyPort}/sse?cliRequestId=${requestId}`
          }
        }
      }
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig))
      args.push('--mcp-config', mcpConfigPath)
      // Pre-approve all paloma MCP tools so CLI doesn't prompt for permission
      // (the MCP proxy itself gates execution with browser confirmation)
      args.push('--allowedTools', 'mcp__paloma__*')
      log.debug(`[${reqShort}] MCP config written to ${mcpConfigPath}`)
    }

    const proc = spawn('claude', args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.processes.set(requestId, { process: proc, sessionId, mcpConfigPath })
    log.info(`[${reqShort}] Process spawned, pid=${proc.pid}`)

    const flush = attachStreamParser(proc.stdout, (event) => {
      onEvent({ type: 'claude_stream', requestId, event })
    })

    proc.stdout.on('error', (err) => {
      log.error(`[${reqShort}] stdout error: ${err.message}`)
      onEvent({ type: 'claude_error', requestId, error: `Stream error: ${err.message}` })
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
      // Clean up temp MCP config
      const entry = this.processes.get(requestId)
      if (entry?.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
      }
      this.processes.delete(requestId)
      onEvent({ type: 'claude_done', requestId, sessionId, exitCode: code })
    })

    proc.on('error', (err) => {
      log.error(`[${reqShort}] Process error: ${err.message}`)
      this.processes.delete(requestId)
      onEvent({ type: 'claude_error', requestId, error: err.message })
    })

    return { requestId, sessionId }
  }

  stop(requestId) {
    const entry = this.processes.get(requestId)
    if (entry) {
      // Clean up temp MCP config before deleting the entry
      // (the close handler won't be able to find it after delete)
      if (entry.mcpConfigPath) {
        try { unlinkSync(entry.mcpConfigPath) } catch {}
      }
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
