import { WebSocketServer } from 'ws'
import { createServer as createHttpServer } from 'http'

// Global error handlers — prevent unhandled errors from crashing the bridge
process.on('unhandledRejection', (reason, promise) => {
  console.error('[bridge] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[bridge] Uncaught exception:', err)
  // Don't exit — the bridge should stay alive. Only fatal errors (like ENOMEM) will kill it.
})
import { mkdir, writeFile, readdir, stat, unlink, readFile } from 'fs/promises'
import { writeFileSync, unlinkSync, createReadStream, existsSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'

const PID_FILE = join(tmpdir(), 'paloma-bridge.pid')

/**
 * Kill any stale bridge processes before starting.
 * Two-pronged approach:
 *   1. PID file — kill the process recorded from last startup
 *   2. Process scan — catch orphans that lost their PID file
 */
function killStaleBridgeProcesses() {
  const myPid = process.pid
  let killedAny = false

  // Strategy 1: PID file — most reliable
  try {
    const pidStr = readFileSync(PID_FILE, 'utf8').trim()
    const pid = parseInt(pidStr, 10)
    if (pid && pid !== myPid) {
      try {
        process.kill(pid, 0) // probe — throws if not alive
        console.log(`[bridge] Killing stale bridge (pid ${pid}) from PID file`)
        process.kill(pid, 'SIGTERM')
        killedAny = true
        // Synchronous wait: give it up to 3s to die, then SIGKILL
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          try { process.kill(pid, 0); execSync('sleep 0.1') } catch { break }
        }
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL') } catch { /* dead */ }
      } catch {
        // Process not alive — just clean up the stale PID file
      }
      try { unlinkSync(PID_FILE) } catch { /* best-effort */ }
    }
  } catch {
    // No PID file or unreadable — fine
  }

  // Strategy 2: Scan for orphaned bridge processes that lost their PID file
  try {
    const psOutput = execSync('ps aux', { encoding: 'utf8', timeout: 5000 })
    for (const line of psOutput.split('\n')) {
      if (!line.includes('node') || !line.includes('bridge/index.js')) continue
      if (line.includes('grep') || line.includes('run.js')) continue
      const parts = line.trim().split(/\s+/)
      const pid = parseInt(parts[1], 10)
      if (!pid || pid === myPid) continue
      console.log(`[bridge] Killing orphaned bridge process (pid ${pid})`)
      try { process.kill(pid, 'SIGTERM'); killedAny = true } catch { /* dead or no permission */ }
    }
  } catch {
    // ps not available — non-fatal
  }

  return killedAny
}

const killedStaleProcesses = killStaleBridgeProcesses()
import { loadConfig } from './config.js'
import { McpManager } from './mcp-manager.js'
import { ClaudeCliManager } from './claude-cli.js'
import { CodexCliManager } from './codex-cli.js'
import { CopilotCliManager } from './copilot-cli.js'
import { GeminiCliManager } from './gemini-cli.js'
import { OllamaManager } from './ollama-manager.js'
import { McpProxyServer } from './mcp-proxy-server.js'
import { PillarManager, OLLAMA_ALLOWED_SERVERS } from './pillar-manager.js'
import { BackendHealth } from './backend-health.js'
import { EmailWatcher } from './email-watcher.js'
import { emailStore } from './email-store.js'
import { printBanner, stepOk, stepFail, stepInfo, printSummary, printShutdown } from './startup.js'

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '19191', 10)
const proxyPort = 19192

const manager = new McpManager()
const cliManager = new ClaudeCliManager()
const codexManager = new CodexCliManager()
const copilotManager = new CopilotCliManager()
const geminiManager = new GeminiCliManager()
const ollamaManager = new OllamaManager()
let mcpProxy = null
let pillarManager = null
let emailWatcher = null

// Pending ask_user requests: id → { resolve, createdAt }
const pendingAskUser = new Map()
// Pending tool confirmation requests: id → { resolve, createdAt }
const pendingToolConfirm = new Map()
// CLI requestId → originating WebSocket (for targeted sends)
const cliRequestToWs = new Map()
// Buffer direct Flow chat output for reconnect resilience
// sessionId → { output: string, requestId, msgId, streaming: boolean }
const flowChatBuffers = new Map()

// Auto-reject stale pending requests (5 min timeout)
const PENDING_TIMEOUT_MS = 5 * 60 * 1000
let staleRequestInterval = null
staleRequestInterval = setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of pendingAskUser) {
    if (now - entry.createdAt > PENDING_TIMEOUT_MS) {
      console.warn('[bridge] Timing out stale ask_user request:', id)
      try { entry.resolve('Timed out — no response from user') } catch { /* best-effort */ }
      pendingAskUser.delete(id)
    }
  }
  for (const [id, entry] of pendingToolConfirm) {
    if (now - entry.createdAt > PENDING_TIMEOUT_MS) {
      console.warn('[bridge] Timing out stale tool confirmation:', id)
      try { entry.resolve({ approved: false, reason: 'Timed out — no response from user' }) } catch { /* best-effort */ }
      pendingToolConfirm.delete(id)
    }
  }
  // Clean up leaked flowChatBuffers and cliRequestToWs entries
  // whose CLI processes no longer exist (e.g., process hung and never closed)
  for (const [reqId] of flowChatBuffers) {
    if (!cliManager.processes.has(reqId) && !codexManager.processes?.has(reqId) &&
        !copilotManager.processes?.has(reqId) && !geminiManager.processes?.has(reqId)) {
      flowChatBuffers.delete(reqId)
    }
  }
  for (const [reqId] of cliRequestToWs) {
    if (!cliManager.processes.has(reqId) && !codexManager.processes?.has(reqId) &&
        !copilotManager.processes?.has(reqId) && !geminiManager.processes?.has(reqId)) {
      cliRequestToWs.delete(reqId)
    }
  }
}, 60000)
staleRequestInterval.unref() // Don't prevent process exit

async function main() {
  const startTime = Date.now()
  printBanner()

  // Brief pause to let killed processes release their ports
  if (killedStaleProcesses) await new Promise(r => setTimeout(r, 500))

  // Check backend health
  const health = new BackendHealth()
  health.setProjectRoot(process.cwd())
  stepInfo('Checking AI backends...')
  const healthSummary = await health.checkAll()
  for (const [backend, info] of Object.entries(healthSummary)) {
    if (info.available) {
      const detail = backend === 'ollama' && info.models?.length
        ? `${info.reason} (${info.models.join(', ')})`
        : info.reason
      stepOk(backend, detail)
    } else {
      stepFail(backend, info.reason)
    }
  }

  stepInfo('Loading MCP servers...')
  const servers = await loadConfig()
  const { serverCount, toolCount, failedCount } = await manager.startAll(servers, (name, status, tools, error) => {
    if (status === 'ok') stepOk(name, `${tools} tool${tools !== 1 ? 's' : ''}`)
    else stepFail(name, error || 'failed')
  })

  // Serve built frontend from dist/ if available
  const distDir = join(process.cwd(), 'dist')
  const hasDistDir = existsSync(join(distDir, 'index.html'))

  const MIME_TYPES = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.map': 'application/json'
  }

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    const pathname = url.pathname

    // CORS headers for API routes (dev mode: Vite on :5173 → Bridge on :19191)
    const corsHeaders = pathname.startsWith('/api/') ? {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    } : {}

    // Handle CORS preflight
    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    // ─── Email API Routes ───────────────────────────────────────────────────

    if (pathname === '/api/emails' && req.method === 'GET') {
      try {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10)
        const offset = parseInt(url.searchParams.get('offset') || '0', 10)
        const search = url.searchParams.get('search') || ''
        const result = emailStore.getThreads({ limit, offset, search })
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify(result))
      } catch (err) {
        console.error('[bridge] GET /api/emails error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    if (pathname.startsWith('/api/emails/') && req.method === 'GET') {
      try {
        const parts = pathname.split('/')

        // GET /api/emails/session/:sessionId/history
        if (parts.length >= 6 && parts[3] === 'session' && parts[5] === 'history') {
          const sessionId = parts[4]
          const events = emailStore.getSessionEvents(sessionId)
          if (events) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ sessionId, events }))
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: 'Session not found' }))
          }
          return
        }

        const lastPart = parts[parts.length - 1]
        if (lastPart === 'stats') {
          const result = emailStore.getStats()
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify(result))
          return
        }

        if (lastPart) {
          const result = emailStore.getThread(lastPart)
          if (result) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify(result))
          } else {
            res.writeHead(404, corsHeaders)
            res.end('Thread not found')
          }
          return
        }
      } catch (err) {
        console.error('[bridge] GET /api/emails/:id error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.round((Date.now() - startTime) / 1000),
        backends: health ? health.status : {},
        pillars: pillarManager ? pillarManager.list().pillars.length : 0,
        mcpServers: manager ? Object.keys(manager.servers).length : 0
      }
      res.end(JSON.stringify(status, null, 2))
      return
    }

    if (pathname === '/api/emails/sync' && req.method === 'POST') {
      try {
        const result = await emailStore.syncFromGmail()
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify(result))
        // Broadcast that the store has been updated
        broadcast({ type: 'email_store_updated' })
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // ─── Frontend Static Serving ───────────────────────────────────────────

    if (!hasDistDir) {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Paloma: run "npm run build" first to generate the frontend')
      return
    }

    let filePath = join(distDir, pathname === '/' ? 'index.html' : pathname)
    const ext = extname(filePath)

    // SPA fallback: non-file routes serve index.html
    if (!ext) filePath = join(distDir, 'index.html')

    const mime = MIME_TYPES[ext] || 'application/octet-stream'
    const stream = createReadStream(filePath)
    stream.on('open', () => {
      const headers = { 'Content-Type': mime }
      if (pathname.startsWith('/assets/')) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable'
      } else {
        // Prevent caching of index.html and other non-hashed files
        // so rebuilds are picked up immediately without "Disable cache" in DevTools
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
      }
      res.writeHead(200, headers)
      stream.pipe(res)
    })
    stream.on('error', () => {
      // File not found → SPA fallback
      const indexStream = createReadStream(join(distDir, 'index.html'))
      indexStream.on('open', () => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        indexStream.pipe(res)
      })
      indexStream.on('error', () => {
        res.writeHead(404)
        res.end('Not found')
      })
    })
  })

  const wss = new WebSocketServer({ server: httpServer })

  wss.on('error', (err) => {
    console.error('[bridge] WebSocket server error:', err.message)
  })

  function broadcast(msg) {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try { client.send(data) } catch (_) { /* client disconnected mid-send */ }
      }
    }
  }

  // Send to the originating tab if known, otherwise broadcast to all
  function sendToOrigin(cliRequestId, msg) {
    const ws = cliRequestToWs.get(cliRequestId)
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(msg)) } catch (_) { broadcast(msg) }
    } else {
      broadcast(msg)
    }
  }

  // Start MCP proxy server for CLI tool access
  // broadcast and sendToOrigin are defined below after wss is created,
  // but we need the proxy server reference first — pillarManager is wired after
  mcpProxy = new McpProxyServer(manager, {
    port: proxyPort,
    onToolConfirmation(toolName, args, cliRequestId) {
      const id = randomUUID()
      sendToOrigin(cliRequestId, { type: 'cli_tool_confirmation', id, toolName, args })
      return new Promise(resolve => {
        pendingToolConfirm.set(id, { resolve, createdAt: Date.now() })
      })
    },
    onToolActivity(toolName, args, status, cliRequestId) {
      sendToOrigin(cliRequestId, { type: 'cli_tool_activity', toolName, args, status })
    },
    onAskUser(question, options, cliRequestId) {
      const id = randomUUID()
      sendToOrigin(cliRequestId, { type: 'ask_user', id, question, options })
      return new Promise(resolve => {
        pendingAskUser.set(id, { resolve, createdAt: Date.now() })
      })
    },
    onSetTitle(title, cliRequestId) {
      sendToOrigin(cliRequestId, { type: 'set_chat_title', title })
    }
  })
  await mcpProxy.start()
  cliManager.mcpProxyPort = proxyPort
  codexManager.mcpProxyPort = proxyPort
  copilotManager.mcpProxyPort = proxyPort
  geminiManager.mcpProxyPort = proxyPort

  // Wire PillarManager with multi-backend support
  const backends = { claude: cliManager, codex: codexManager, copilot: copilotManager, gemini: geminiManager, ollama: ollamaManager }
  pillarManager = new PillarManager(backends, {
    projectRoot: process.cwd(),
    broadcast,
    mcpManager: manager,
    health,
    flowChatBuffers
  })
  mcpProxy.pillarManager = pillarManager

  // Start email watcher — polls Gmail, spawns new session per email
  emailWatcher = new EmailWatcher(backends, { broadcast })
  emailWatcher.start()

  // Start HTTP + WebSocket server
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  \x1b[31m✘\x1b[0m Port ${port} is already in use. Is another bridge instance running?`)
    } else {
      console.error(`\n  \x1b[31m✘\x1b[0m HTTP server error: ${err.message}`)
    }
    process.exit(1)
  })
  httpServer.listen(port)
  if (hasDistDir) {
    stepOk('frontend', `serving built files at http://localhost:${port}`)
  } else {
    stepInfo('frontend: run "npm run build" to enable — Vite dev server still works')
  }

  printSummary({
    serverCount,
    toolCount,
    failedCount,
    wsPort: port,
    proxyPort,
    emailWatcher: emailWatcher.running,
    startTime
  })

  // Heartbeat: detect dead connections (30s interval, 10s timeout)
  const HEARTBEAT_INTERVAL = 30000
  const HEARTBEAT_TIMEOUT = 10000
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client._pongReceived === false) {
        console.log('[bridge] Client heartbeat timeout — terminating')
        client.terminate()
        continue
      }
      client._pongReceived = false
      client.ping()
    }
  }, HEARTBEAT_INTERVAL)

  wss.on('close', () => clearInterval(heartbeatInterval))

  wss.on('connection', (ws) => {
    console.log('Client connected')
    ws._pongReceived = true
    ws.on('pong', () => { ws._pongReceived = true })

    ws.on('message', async (data) => {
      try {
      const raw = data.toString()
      // Client-side keepalive ping — respond with pong
      if (raw === 'ping') {
        try { ws.send('pong') } catch { /* client gone */ }
        return
      }
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
        return
      }
      // Log all incoming messages for debugging
      if (msg.type !== 'discover') {
        console.log(`[bridge] ← ${msg.type}${msg.id ? ' id=' + msg.id.slice(0, 8) : ''}`)
      }

      if (msg.type === 'discover') {
        ws.send(JSON.stringify({ type: 'tools', servers: manager.getTools() }))
      } else if (msg.type === 'call_tool') {
        try {
          const result = await manager.callTool(msg.server, msg.tool, msg.arguments || {})
          // Flatten MCP result content into a string
          let content = ''
          let isError = false
          if (result.content) {
            content = result.content.map(c => c.text || JSON.stringify(c)).join('\n')
          }
          if (result.isError) isError = true
          ws.send(JSON.stringify({ type: 'tool_result', id: msg.id, content, isError }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: e.message }))
        }
      } else if (msg.type === 'claude_chat') {
        try {
          const { requestId, sessionId } = cliManager.chat(
            {
              prompt: msg.prompt,
              model: msg.model,
              sessionId: msg.sessionId,
              systemPrompt: msg.systemPrompt,
              cwd: msg.cwd
            },
            (event) => {
              // Buffer output for reconnect resilience (always, even if WS is dead)
              const buf = flowChatBuffers.get(sessionId)
              if (buf && event.type === 'claude_stream' && event.event) {
                const ev = event.event
                if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                  buf.output += ev.delta.text
                } else if (ev.type === 'assistant' && ev.message?.content) {
                  for (const block of ev.message.content) {
                    if (block.type === 'text') buf.output += block.text
                  }
                }
              }

              // Use dynamic WS lookup so reconnected clients receive events
              const targetWs = cliRequestToWs.get(requestId) || ws
              // Clean up mapping when CLI session ends (even if WS is dead)
              if (event.type === 'claude_done' || event.type === 'claude_error') {
                cliRequestToWs.delete(requestId)
                flowChatBuffers.delete(sessionId)
                if (pillarManager?.flowSession?.cliSessionId === sessionId) {
                  pillarManager.onFlowTurnComplete()
                }
              }
              if (targetWs.readyState !== 1) return // OPEN
              targetWs.send(JSON.stringify({ ...event, id: msg.id }))
            }
          )
          // Map this CLI request to the originating WebSocket
          cliRequestToWs.set(requestId, ws)
          // Buffer for reconnect resilience
          flowChatBuffers.set(sessionId, { output: '', requestId, msgId: msg.id, streaming: true })
          // If this is a message to the registered Flow session, mark it as streaming
          if (pillarManager?.flowSession?.cliSessionId === (msg.sessionId || sessionId)) {
            pillarManager.flowSession.currentlyStreaming = true
          }
          ws.send(JSON.stringify({ type: 'claude_ack', id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'claude_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'export_chats') {
        try {
          const dir = join(process.cwd(), 'chats')
          await mkdir(dir, { recursive: true })
          let count = 0
          for (const session of msg.sessions) {
            const slug = session.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
            const filename = `${slug}-${session.id}.json`
            await writeFile(join(dir, filename), JSON.stringify(session, null, 2))
            count++
          }
          ws.send(JSON.stringify({ type: 'export_result', id: msg.id, count, path: dir }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: e.message }))
        }
      } else if (msg.type === 'resolve_path') {
        // Find a directory by name under $HOME (max 3 levels deep)
        const target = msg.name
        let found = null
        async function search(dir, depth) {
          if (found || depth > 3) return
          try {
            const entries = await readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (!entry.isDirectory() || entry.name.startsWith('.')) continue
              const full = join(dir, entry.name)
              if (entry.name === target) {
                // Prefer directories that have .paloma/ (our projects)
                try {
                  await stat(join(full, '.paloma'))
                  found = full
                  return
                } catch {
                  if (!found) found = full
                }
              }
              if (depth < 3) await search(full, depth + 1)
            }
          } catch { /* permission denied, etc */ }
        }
        await search(homedir(), 0)
        ws.send(JSON.stringify({ type: 'resolved_path', id: msg.id, path: found }))
      } else if (msg.type === 'register_flow_session') {
        // Frontend is registering a Flow session for callback notifications
        if (pillarManager) {
          pillarManager.registerFlowSession({
            cliSessionId: msg.cliSessionId,
            dbSessionId: msg.dbSessionId,
            model: msg.model,
            cwd: msg.cwd,
            wsClient: ws,
            flowChatBuffers // Pass the buffers Map for persistence
          })
          // Re-map any active CLI requests to the new WS (reconnect after page refresh)
          const buf = flowChatBuffers.get(msg.cliSessionId)
          if (buf && buf.requestId) {
            cliRequestToWs.set(buf.requestId, ws)
            console.log(`[bridge] Re-mapped Flow CLI request ${buf.requestId.slice(0, 8)} to new WS (reconnect)`)
          }
          // Return any buffered output so frontend can restore streaming content
          const bufferedOutput = buf?.output || ''
          ws.send(JSON.stringify({ type: 'flow_session_registered', id: msg.id, bufferedOutput }))
        }
      } else if (msg.type === 'pillar_list') {
        // Frontend asking for active pillars (e.g., after reconnect to rebuild session map)
        const result = pillarManager ? pillarManager.list() : { pillars: [] }
        ws.send(JSON.stringify({ type: 'pillar_list_result', id: msg.id, pillars: result.pillars }))
      } else if (msg.type === 'pillar_resume') {
        if (pillarManager) {
          try {
            const result = await pillarManager.resumeSession({ pillarId: msg.pillarId })
            ws.send(JSON.stringify({ type: 'pillar_resume_result', id: msg.id, result }))
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', id: msg.id, message: e.message }))
          }
        }
      } else if (msg.type === 'pillar_db_session_id') {
        // Frontend created the IndexedDB session — store the ID on the pillar
        if (pillarManager) {
          pillarManager.setDbSessionId(msg.pillarId, msg.dbSessionId)
        }
      } else if (msg.type === 'pillar_user_message') {
        // Adam sent a message directly to a pillar session — CC Flow
        if (pillarManager && msg.pillarId && msg.message) {
          const session = pillarManager.pillars.get(msg.pillarId)
          if (session) {
            const notification = pillarManager._buildNotificationMessage('adam_cc', session, { userMessage: msg.message })
            pillarManager.notifyFlow(notification, msg.pillarId, {
              notificationType: 'adam_cc',
              pillar: session.pillar,
              pillarId: msg.pillarId
            })
          }
        }
      } else if (msg.type === 'codex_chat') {
        try {
          const { requestId, sessionId } = codexManager.chat(
            {
              prompt: msg.prompt,
              model: msg.model,
              sessionId: msg.sessionId,
              systemPrompt: msg.systemPrompt,
              cwd: msg.cwd
            },
            (event) => {
              if (ws.readyState !== 1) return
              ws.send(JSON.stringify({ ...event, id: msg.id }))
              if (event.type === 'codex_done' || event.type === 'codex_error') {
                cliRequestToWs.delete(requestId)
              }
            }
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'codex_ack', id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'codex_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'copilot_chat') {
        try {
          const { requestId, sessionId } = copilotManager.chat(
            {
              prompt: msg.prompt,
              model: msg.model,
              sessionId: msg.sessionId,
              systemPrompt: msg.systemPrompt,
              cwd: msg.cwd
            },
            (event) => {
              if (ws.readyState !== 1) return
              ws.send(JSON.stringify({ ...event, id: msg.id }))
              if (event.type === 'copilot_done' || event.type === 'copilot_error') {
                cliRequestToWs.delete(requestId)
              }
            }
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'copilot_ack', id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'copilot_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'gemini_chat') {
        try {
          const { requestId, sessionId } = geminiManager.chat(
            {
              prompt: msg.prompt,
              model: msg.model,
              sessionId: msg.sessionId,
              systemPrompt: msg.systemPrompt,
              cwd: msg.cwd
            },
            (event) => {
              if (ws.readyState !== 1) return
              ws.send(JSON.stringify({ ...event, id: msg.id }))
              if (event.type === 'gemini_done' || event.type === 'gemini_error') {
                cliRequestToWs.delete(requestId)
              }
            }
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'gemini_ack', id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'gemini_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'ollama_chat') {
        try {
          // Convert MCP tools to Ollama's tool format (only if requested)
          // Filter to essential servers only — local models have limited context
          const ollamaTools = []
          const toolRouteMap = new Map() // ollamaName → { server, tool }
          if (msg.enableTools) {
            const mcpServers = manager.getTools()
            for (const [serverName, serverInfo] of Object.entries(mcpServers)) {
              if (serverInfo.status !== 'connected') continue
              if (!OLLAMA_ALLOWED_SERVERS.has(serverName)) continue
              for (const tool of serverInfo.tools) {
                const ollamaName = `${serverName}__${tool.name}`
                ollamaTools.push({
                  type: 'function',
                  function: {
                    name: ollamaName,
                    description: tool.description || '',
                    parameters: tool.inputSchema || { type: 'object', properties: {} }
                  }
                })
                toolRouteMap.set(ollamaName, { server: serverName, tool: tool.name })
              }
            }
            // Add pillar orchestration tools — enables recursive Qwen sub-instance spawning
            if (pillarManager) {
              for (const tool of PillarManager.getOllamaPillarToolDefs()) {
                ollamaTools.push(tool)
                toolRouteMap.set(tool.function.name, { _pillar: true })
              }

              // Add spawn_worker tool — Quinn's only tool for self-spawning singularity mode
              ollamaTools.push({
                type: 'function',
                function: {
                  name: 'spawn_worker',
                  description: 'Create a smaller version of yourself to interact with the world. Your worker has full access to files, git, shell, web, search, memory, and voice. Describe what you need it to do.',
                  parameters: {
                    type: 'object',
                    properties: {
                      task: { type: 'string', description: 'What should your worker do? Be specific — include file paths, search terms, or questions.' }
                    },
                    required: ['task']
                  }
                }
              })
              toolRouteMap.set('spawn_worker', { _pillar: true, _spawnWorker: true })
            }

            console.log(`[ollama] Passing ${ollamaTools.length} tools to model (essential servers + pillar tools)`)
          }

          let toolRounds = 0
          const MAX_TOOL_ROUNDS = 20

          // Event handler that intercepts tool_call events and executes them
          const handleOllamaEvent = async (event) => {
            if (ws.readyState !== 1) return
            // Safe send — WebSocket may close during async tool execution
            const safeSend = (data) => {
              try { if (ws.readyState === 1) ws.send(JSON.stringify(data)) } catch (_) { /* client disconnected */ }
            }

            if (event.type === 'ollama_tool_call') {
              toolRounds++
              if (toolRounds > MAX_TOOL_ROUNDS) {
                console.warn(`[ollama] Hit max tool rounds (${MAX_TOOL_ROUNDS}), stopping`)
                safeSend({ type: 'ollama_done', id: msg.id, requestId: event.requestId, sessionId: event.sessionId, exitCode: 0 })
                cliRequestToWs.delete(event.requestId)
                return
              }

              // Execute each tool call via MCP, emitting tool_use/tool_result pairs
              const results = []
              for (const tc of event.toolCalls) {
                const toolId = randomUUID()
                const toolName = tc.function?.name || ''
                let toolArgs = tc.function?.arguments || {}
                if (typeof toolArgs === 'string') {
                  try { toolArgs = JSON.parse(toolArgs) } catch (e) {
                    console.warn(`[ollama] Failed to parse tool args for ${toolName}: ${e.message} — raw: ${toolArgs.slice(0, 200)}`)
                    toolArgs = {}
                  }
                }
                const route = toolRouteMap.get(toolName)

                // Emit tool_use event to frontend
                safeSend({
                  type: 'ollama_stream', id: msg.id,
                  event: { type: 'tool_use', tool_use: { id: toolId, name: toolName, input: toolArgs } }
                })

                // Pillar tools — route through MCP proxy's pillar handler
                if (route?._pillar) {
                  try {
                    // spawn_worker — Quinn's self-spawning: create a 7B worker with all MCP tools
                    if (route._spawnWorker) {
                      const workerTask = toolArgs.task || toolArgs.prompt || JSON.stringify(toolArgs)
                      console.log(`[quinn] Browser: Spawning worker for task: ${workerTask.slice(0, 100)}...`)

                      const spawnResult = await pillarManager.spawn({
                        pillar: 'forge',
                        prompt: workerTask,
                        backend: 'ollama',
                        singularityRole: 'worker',
                        depth: 1
                      })
                      const childPillarId = spawnResult.pillarId

                      // Wait for worker to complete
                      const childOutput = await new Promise((resolve) => {
                        pillarManager._pendingChildCompletions.set(childPillarId, resolve)
                      })

                      const content = childOutput || '(worker returned empty-handed)'
                      console.log(`[quinn] Browser: Worker ${childPillarId.slice(0, 8)} returned — ${content.length} chars`)
                      results.push({ content })
                      safeSend({
                        type: 'ollama_stream', id: msg.id,
                        event: { type: 'tool_result', toolUseId: toolId, content: content.slice(0, 500) + (content.length > 500 ? '...' : '') }
                      })
                    } else {
                      console.log(`[ollama] Executing pillar tool: ${toolName}`)
                      const result = await mcpProxy._handlePillarTool(toolName, toolArgs, null)
                      const content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                      results.push({ content })
                      safeSend({
                        type: 'ollama_stream', id: msg.id,
                        event: { type: 'tool_result', toolUseId: toolId, content }
                      })
                    }
                  } catch (e) {
                    console.error(`[ollama] Pillar tool error (${toolName}):`, e.message)
                    const errContent = `Error executing ${toolName}: ${e.message}`
                    results.push({ content: errContent })
                    safeSend({
                      type: 'ollama_stream', id: msg.id,
                      event: { type: 'tool_result', toolUseId: toolId, content: errContent }
                    })
                  }
                  continue
                }

                if (!route) {
                  console.warn(`[ollama] Unknown tool: ${toolName}`)
                  const errContent = `Error: Unknown tool "${toolName}"`
                  results.push({ content: errContent })
                  safeSend({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content: errContent }
                  })
                  continue
                }

                try {
                  if (!route.server || !route.tool) {
                    throw new Error(`Malformed route for tool "${toolName}": missing server or tool name`)
                  }
                  console.log(`[ollama] Executing tool ${route.server}/${route.tool}`)
                  const result = await manager.callTool(route.server, route.tool, toolArgs)
                  const content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                  results.push({ content })
                  safeSend({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content }
                  })
                } catch (e) {
                  console.error(`[ollama] Tool error (${toolName}):`, e.message)
                  const errContent = `Error executing ${toolName}: ${e.message}`
                  results.push({ content: errContent })
                  safeSend({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content: errContent }
                  })
                }
              }

              // Continue conversation with tool results
              try {
                ollamaManager.continueWithToolResults(
                  event.requestId, event.sessionId,
                  event.assistantMessage, results,
                  handleOllamaEvent
                )
              } catch (e) {
                console.error('[bridge] Failed to continue Ollama tool loop:', e.message)
                safeSend({ type: 'ollama_error', id: msg.id, error: e.message })
              }
              return
            }

            // Pass through all other events (stream, done, error)
            try { ws.send(JSON.stringify({ ...event, id: msg.id })) } catch (_) { /* client disconnected */ }
            if (event.type === 'ollama_done' || event.type === 'ollama_error') {
              cliRequestToWs.delete(event.requestId)
            }
          }

          const { requestId, sessionId } = ollamaManager.chat(
            {
              prompt: msg.prompt,
              model: msg.model,
              sessionId: msg.sessionId,
              systemPrompt: msg.systemPrompt,
              cwd: msg.cwd,
              tools: ollamaTools
            },
            handleOllamaEvent
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'ollama_ack', id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'claude_stop') {
        cliRequestToWs.delete(msg.requestId)
        cliManager.stop(msg.requestId)
      } else if (msg.type === 'codex_stop') {
        cliRequestToWs.delete(msg.requestId)
        codexManager.stop(msg.requestId)
      } else if (msg.type === 'copilot_stop') {
        cliRequestToWs.delete(msg.requestId)
        copilotManager.stop(msg.requestId)
      } else if (msg.type === 'gemini_stop') {
        cliRequestToWs.delete(msg.requestId)
        geminiManager.stop(msg.requestId)
      } else if (msg.type === 'ollama_stop') {
        cliRequestToWs.delete(msg.requestId)
        ollamaManager.stop(msg.requestId)
      } else if (msg.type === 'ask_user_response') {
        const pending = pendingAskUser.get(msg.id)
        if (pending) {
          pendingAskUser.delete(msg.id)
          pending.resolve(msg.answer)
        }
      } else if (msg.type === 'tool_confirmation_response') {
        const pending = pendingToolConfirm.get(msg.id)
        if (pending) {
          pendingToolConfirm.delete(msg.id)
          pending.resolve({
            approved: msg.approved,
            reason: msg.reason,
            result: msg.result
          })
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', id: msg.id, message: `Unknown message type: ${msg.type}` }))
      }
      } catch (err) {
        console.error(`[bridge] Unhandled error in WebSocket message handler:`, err)
        try { ws.send(JSON.stringify({ type: 'error', message: `Internal error: ${err.message}` })) } catch { /* client gone */ }
      }
    })

    ws.on('close', () => {
      // Remove all CLI request mappings for this socket
      for (const [id, mappedWs] of cliRequestToWs) {
        if (mappedWs === ws) cliRequestToWs.delete(id)
      }
      console.log('Client disconnected')
    })
  })

  // Write PID file now that startup succeeded — git hooks use this to signal restarts
  writeFileSync(PID_FILE, String(process.pid))

  // Graceful shutdown
  const RESTART_CODE = 75
  let shuttingDown = false
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true

    printShutdown()

    // Log active sessions being killed so Adam sees the blast radius
    if (pillarManager) {
      const activePillars = [...pillarManager.pillars.values()]
        .filter(s => s.status === 'running' || s.currentlyStreaming)
      if (activePillars.length > 0) {
        console.log(`  \x1b[33m▲\x1b[0m Killing ${activePillars.length} active pillar session(s):`)
        for (const s of activePillars) {
          console.log(`    - ${s.pillar} (${s.pillarId.slice(0, 8)}...) — ${s.status}`)
        }
      }
    }

    if (staleRequestInterval) clearInterval(staleRequestInterval)
    if (health) health.shutdown()
    if (emailWatcher) emailWatcher.shutdown()
    if (pillarManager) pillarManager.shutdown()
    cliManager.shutdown()
    codexManager.shutdown()
    copilotManager.shutdown()
    geminiManager.shutdown()
    ollamaManager.shutdown()
    if (mcpProxy) await mcpProxy.shutdown()
    await manager.shutdown()
    wss.close()
    httpServer.close()
    try { await unlink(PID_FILE) } catch { /* best-effort */ }
    process.exit(exitCode)
  }
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  // SIGUSR1 = restart request (sent by git post-merge/post-rewrite hooks)
  process.on('SIGUSR1', () => {
    console.log('[bridge] Received SIGUSR1 — restarting after git pull...')
    shutdown(RESTART_CODE)
  })

  // Expose restart to MCP proxy — graceful shutdown + exit code 75
  // (bridge/run.js wrapper catches code 75 and respawns)
  mcpProxy.restartBridge = () => shutdown(RESTART_CODE)
}

main().catch((e) => {
  console.error('Bridge startup failed:', e)
  try { unlinkSync(PID_FILE) } catch { /* best-effort */ }
  process.exit(1)
})
