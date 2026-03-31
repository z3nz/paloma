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
import { mkdir, writeFile, readdir, stat, unlink, readFile, rename } from 'fs/promises'
import { writeFileSync, unlinkSync, createReadStream, existsSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { createLogger } from './logger.js'

const log = createLogger('bridge')
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
        log.info(`Killing stale bridge (pid ${pid}) from PID file`)
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
      log.info(`Killing orphaned bridge process (pid ${pid})`)
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
import { Gen5ChatManager } from './gen5-chat-manager.js'
import { SINGULARITY_GEN5_PROMPT } from '../src/prompts/base.js'
import { BackendHealth } from './backend-health.js'
import { UsageTracker } from './usage-tracker.js'
import { EmailWatcher } from './email-watcher.js'
import { emailStore } from './email-store.js'
import { printBanner, stepOk, stepFail, stepInfo, printSummary, printShutdown } from './startup.js'
import { createHttpHandler } from './http-routes.js'

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '19191', 10)
const proxyPort = 19192

const manager = new McpManager()
const cliManager = new ClaudeCliManager()
const codexManager = new CodexCliManager()
const copilotManager = new CopilotCliManager()
const geminiManager = new GeminiCliManager()
const ollamaManager = new OllamaManager()
const gen5ChatManager = new Gen5ChatManager(process.cwd())
let mcpProxy = null
let pillarManager = null
let emailWatcher = null

// Pending ask_user requests: id → { resolve, createdAt }
const pendingAskUser = new Map()
// CLI requestId → originating WebSocket (for targeted sends)
const cliRequestToWs = new Map()
// Buffer direct Flow chat output for reconnect resilience
// sessionId → { output: string, requestId, msgId, streaming: boolean }
const flowChatBuffers = new Map()
// Holy Trinity: mindPillarId → { ws, msgId } — intercepts pillar_stream for chat UI
const trinityPillarToChat = new Map()
// The Ark / Accordion (Gen7): head1PillarId or maestroPillarId → { ws, msgId } — intercepts pillar_stream for chat UI
const arkPillarToChat = new Map()
// The Hydra (Gen7 refined): primaryPillarId → { ws, msgId } — intercepts pillar_stream for chat UI
const hydraPillarToChat = new Map()

// Auto-reject stale pending requests and clean up leaked mappings (30s interval)
const PENDING_TIMEOUT_MS = 5 * 60 * 1000
let staleRequestInterval = null
staleRequestInterval = setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of pendingAskUser) {
    if (now - entry.createdAt > PENDING_TIMEOUT_MS) {
      log.warn(`Timing out stale ask_user request: ${id}`)
      try { entry.resolve('Timed out — no response from user') } catch { /* best-effort */ }
      pendingAskUser.delete(id)
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

  // Initialize usage tracker — tracks sessions per backend and auto-disables at threshold
  const usageTracker = new UsageTracker(process.cwd())
  health.usageTracker = usageTracker
  await usageTracker.load()
  const usageSummary = usageTracker.getSummary()
  const limitedBackends = Object.entries(usageSummary).filter(([, v]) => v.usageLimited).map(([k]) => k)
  if (limitedBackends.length > 0) {
    stepInfo(`Usage-limited backends: ${limitedBackends.join(', ')}`)
  } else {
    stepOk('usage', 'all backends within limits')
  }

  stepInfo('Loading MCP servers...')
  const servers = await loadConfig()
  const { serverCount, toolCount, failedCount } = await manager.startAll(servers, (name, status, tools, error) => {
    if (status === 'ok') stepOk(name, `${tools} tool${tools !== 1 ? 's' : ''}`)
    else stepFail(name, error || 'failed')
  })

  // HTTP routes are extracted into bridge/http-routes.js for maintainability.
  // The handler is created here because it needs runtime deps (pillarManager, etc).
  // Note: pillarManager/usageTracker refs are captured in closure — they're assigned before listen().
  const httpHandler = createHttpHandler({
    port,
    startTime,
    health,
    get pillarManager() { return pillarManager },
    mcpManager: manager,
    usageTracker,
    emailStore,
    get broadcast() { return broadcast }
  })
  const httpServer = createHttpServer(httpHandler)

  const wss = new WebSocketServer({ server: httpServer })

  wss.on('error', (err) => {
    log.error(`WebSocket server error: ${err.message}`)
  })

  function broadcast(msg) {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try { client.send(data) } catch (_) { /* client disconnected mid-send */ }
      }
    }

    // Holy Trinity / Ark / Accordion / Hydra interceptor: translate pillar_stream/pillar_done
    // into ollama_stream/ollama_done for the chat UI
    if ((msg.type === 'pillar_stream' || msg.type === 'pillar_done') && msg.pillarId) {
      const mapping = trinityPillarToChat.get(msg.pillarId) || arkPillarToChat.get(msg.pillarId) || hydraPillarToChat.get(msg.pillarId)
      if (mapping && mapping.ws.readyState === 1) {
        try {
          if (msg.type === 'pillar_stream') {
            mapping.ws.send(JSON.stringify({
              type: 'ollama_stream', id: mapping.msgId,
              event: msg.event
            }))
          } else if (msg.type === 'pillar_done') {
            mapping.ws.send(JSON.stringify({
              type: 'ollama_done', id: mapping.msgId, sessionId: null, exitCode: 0
            }))
            trinityPillarToChat.delete(msg.pillarId)
            arkPillarToChat.delete(msg.pillarId)
            hydraPillarToChat.delete(msg.pillarId)
          }
        } catch (_) { /* client disconnected */ }
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
      // Server-side auto-execute is now the default (Hog Wild always ON).
      // This callback is kept for backwards compatibility but immediately approves.
      return Promise.resolve({ approved: true })
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
    },
    hasConnectedBrowser() {
      for (const client of wss.clients) {
        if (client.readyState === 1) return true
      }
      return false
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
  const hasDistDir = existsSync(join(process.cwd(), 'dist', 'index.html'))
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
        log.warn('Client heartbeat timeout — terminating')
        client.terminate()
        continue
      }
      client._pongReceived = false
      client.ping()
    }
  }, HEARTBEAT_INTERVAL)

  wss.on('close', () => clearInterval(heartbeatInterval))

  wss.on('connection', (ws) => {
    log.info('Client connected')
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
        log.debug(`← ${msg.type}${msg.id ? ' id=' + msg.id.slice(0, 8) : ''}`)
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
                if (pillarManager?._findFlowSessionByCli?.(sessionId)) {
                  pillarManager.onFlowTurnComplete(sessionId)
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
            log.info(`Re-mapped Flow CLI request ${buf.requestId.slice(0, 8)} to new WS (reconnect)`)
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
        // Adam sent a message directly to a pillar session
        if (pillarManager && msg.pillarId && msg.message) {
          const session = pillarManager.pillars.get(msg.pillarId)
          if (session) {
            // CC Flow so the orchestrator knows about the user message
            const notification = pillarManager._buildNotificationMessage('adam_cc', session, { userMessage: msg.message })
            pillarManager.notifyFlow(notification, msg.pillarId, {
              notificationType: 'adam_cc',
              pillar: session.pillar,
              pillarId: msg.pillarId
            })
            // Route message to the actual pillar CLI session (skipUserBroadcast: frontend already saved it)
            const result = pillarManager.sendMessage({ pillarId: msg.pillarId, message: msg.message, skipUserBroadcast: true })
            if (msg.id) {
              ws.send(JSON.stringify({ type: 'pillar_user_message_result', id: msg.id, ...result }))
            }
          } else if (msg.id) {
            ws.send(JSON.stringify({ type: 'pillar_user_message_result', id: msg.id, status: 'error', message: 'Pillar session not found or expired' }))
          }
        }
      } else if (msg.type === 'codex_chat' || msg.type === 'copilot_chat' || msg.type === 'gemini_chat') {
        // Unified handler for Codex, Copilot, and Gemini CLI backends
        // (Claude has its own handler due to Flow session buffering/reconnect logic)
        const backendKey = msg.type.replace('_chat', '') // 'codex' | 'copilot' | 'gemini'
        const backendManager = { codex: codexManager, copilot: copilotManager, gemini: geminiManager }[backendKey]
        try {
          const { requestId, sessionId } = backendManager.chat(
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
              if (event.type === `${backendKey}_done` || event.type === `${backendKey}_error`) {
                cliRequestToWs.delete(requestId)
              }
            }
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: `${backendKey}_ack`, id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: `${backendKey}_error`, id: msg.id, error: e.message }))
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

            log.debug(`[ollama] Passing ${ollamaTools.length} tools to model (essential servers + pillar tools)`)
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
                log.warn(`[ollama] Hit max tool rounds (${MAX_TOOL_ROUNDS}), stopping`)
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
                    log.warn(`[ollama] Failed to parse tool args for ${toolName}: ${e.message} — raw: ${toolArgs.slice(0, 200)}`)
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
                      log.info(`[quinn] Browser: Spawning worker for task: ${workerTask.slice(0, 100)}...`)

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
                      log.info(`[quinn] Browser: Worker ${childPillarId.slice(0, 8)} returned — ${content.length} chars`)
                      results.push({ content })
                      safeSend({
                        type: 'ollama_stream', id: msg.id,
                        event: { type: 'tool_result', toolUseId: toolId, content: content.slice(0, 500) + (content.length > 500 ? '...' : '') }
                      })
                    } else {
                      log.debug(`[ollama] Executing pillar tool: ${toolName}`)
                      const result = await mcpProxy._handlePillarTool(toolName, toolArgs, null)
                      const content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                      results.push({ content })
                      safeSend({
                        type: 'ollama_stream', id: msg.id,
                        event: { type: 'tool_result', toolUseId: toolId, content }
                      })
                    }
                  } catch (e) {
                    log.error(`[ollama] Pillar tool error (${toolName}): ${e.message}`)
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
                  log.warn(`[ollama] Unknown tool: ${toolName}`)
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
                  log.debug(`[ollama] Executing tool ${route.server}/${route.tool}`)
                  const result = await manager.callTool(route.server, route.tool, toolArgs)
                  const content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                  results.push({ content })
                  safeSend({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content }
                  })
                } catch (e) {
                  log.error(`[ollama] Tool error (${toolName}): ${e.message}`)
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
                log.error(`Failed to continue Ollama tool loop: ${e.message}`)
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

          // Determine if fresh context mode is enabled
          const freshContext = !!msg.freshContext
          const contextFile = freshContext && msg.sessionId
            ? join(process.cwd(), '.singularity', 'sessions', msg.sessionId, 'context.md')
            : undefined

          const { requestId, sessionId } = ollamaManager.chat(
            {
              prompt: msg.prompt,
              model: msg.model,
              sessionId: msg.sessionId,
              systemPrompt: msg.systemPrompt,
              cwd: msg.cwd,
              tools: ollamaTools,
              freshContext,
              contextFile
            },
            handleOllamaEvent
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'ollama_ack', id: msg.id, requestId, sessionId }))
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'quinn_gen5_chat') {
        // Quinn Gen5: fresh instance per message, chat document continuity
        try {
          const chatId = msg.chatId || gen5ChatManager.createChatId()
          const chatDoc = await gen5ChatManager.loadChatDoc(chatId)
          const injectedPrompt = gen5ChatManager.buildInjectedMessage(chatDoc, msg.userMessage || msg.prompt || '')

          // Build system prompt via pillarManager
          const systemPrompt = pillarManager
            ? await pillarManager._buildSystemPrompt('flow', { singularityRole: 'quinn-gen5', backend: 'ollama' })
            : SINGULARITY_GEN5_PROMPT

          // Build tools (same as ollama_chat)
          const ollamaTools = []
          const toolRouteMap = new Map()
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

          let toolRounds = 0
          const MAX_TOOL_ROUNDS = 20
          let fullResponseText = ''

          const handleGen5Event = async (event) => {
            if (ws.readyState !== 1) return
            const safeSend = (data) => {
              try { if (ws.readyState === 1) ws.send(JSON.stringify(data)) } catch (_) {}
            }

            if (event.type === 'ollama_tool_call') {
              toolRounds++
              if (toolRounds > MAX_TOOL_ROUNDS) {
                log.warn(`[gen5] Hit max tool rounds (${MAX_TOOL_ROUNDS}), stopping`)
                safeSend({ type: 'ollama_done', id: msg.id, requestId: event.requestId, sessionId: chatId, exitCode: 0 })
                cliRequestToWs.delete(event.requestId)
                return
              }

              const results = []
              for (const tc of event.toolCalls) {
                const toolId = randomUUID()
                const toolName = tc.function?.name || ''
                let toolArgs = tc.function?.arguments || {}
                if (typeof toolArgs === 'string') {
                  try { toolArgs = JSON.parse(toolArgs) } catch (e) { toolArgs = {} }
                }
                const route = toolRouteMap.get(toolName)

                safeSend({
                  type: 'ollama_stream', id: msg.id,
                  event: { type: 'tool_use', tool_use: { id: toolId, name: toolName, input: toolArgs } }
                })

                if (!route) {
                  const errContent = `Error: Unknown tool "${toolName}"`
                  results.push({ content: errContent })
                  safeSend({ type: 'ollama_stream', id: msg.id, event: { type: 'tool_result', toolUseId: toolId, content: errContent } })
                  continue
                }

                try {
                  log.debug(`[gen5] Executing tool ${route.server}/${route.tool}`)
                  const result = await manager.callTool(route.server, route.tool, toolArgs)
                  const content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                  results.push({ content })
                  safeSend({ type: 'ollama_stream', id: msg.id, event: { type: 'tool_result', toolUseId: toolId, content } })
                } catch (e) {
                  log.error(`[gen5] Tool error (${toolName}): ${e.message}`)
                  const errContent = `Error executing ${toolName}: ${e.message}`
                  results.push({ content: errContent })
                  safeSend({ type: 'ollama_stream', id: msg.id, event: { type: 'tool_result', toolUseId: toolId, content: errContent } })
                }
              }

              try {
                ollamaManager.continueWithToolResults(
                  event.requestId, event.sessionId,
                  event.assistantMessage, results,
                  handleGen5Event
                )
              } catch (e) {
                log.error(`[gen5] Failed to continue tool loop: ${e.message}`)
                safeSend({ type: 'ollama_error', id: msg.id, error: e.message })
              }
              return
            }

            // Accumulate response text from stream events
            if (event.type === 'ollama_stream' && event.event?.delta?.text) {
              fullResponseText += event.event.delta.text
            }

            // Override sessionId with chatId in all events sent to frontend
            const outEvent = { ...event, id: msg.id }
            if (event.type === 'ollama_done' || event.type === 'ollama_error') {
              outEvent.sessionId = chatId
              cliRequestToWs.delete(event.requestId)
              // Update chat document asynchronously on completion
              if (event.type === 'ollama_done' && fullResponseText) {
                gen5ChatManager.updateChatDoc(chatId, msg.userMessage || msg.prompt || '', fullResponseText)
                  .catch(err => log.error(`[gen5] Chat doc update failed: ${err.message}`))
              }
            }
            try { ws.send(JSON.stringify(outEvent)) } catch (_) {}
          }

          const { requestId, sessionId } = ollamaManager.chat(
            {
              prompt: injectedPrompt,
              model: 'qwen3:32b',
              sessionId: null,  // always fresh — no session reuse
              systemPrompt,
              cwd: process.cwd(),
              tools: ollamaTools,
              numCtx: 40960
            },
            handleGen5Event
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'ollama_ack', id: msg.id, requestId, sessionId: chatId }))
          log.info(`[gen5] Chat ${chatId.slice(0, 8)} — new instance spawned (request: ${requestId.slice(0, 8)})`)
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'holy_trinity_chat') {
        // Gen6 Holy Trinity: spawn Mind + 2 Arms via PillarManager
        try {
          if (!pillarManager) throw new Error('PillarManager not initialized')
          const result = await pillarManager.spawn({
            pillar: 'forge',
            prompt: msg.userMessage || msg.prompt || '',
            backend: 'ollama',
            singularityRole: 'holy-trinity',
            _chatDbSessionId: msg.chatDbSessionId || null
          })
          if (!result.pillarId) {
            throw new Error(result.message || 'Failed to spawn Holy Trinity')
          }
          // Register Mind's pillarId → chat message mapping for broadcast interceptor
          trinityPillarToChat.set(result.pillarId, { ws, msgId: msg.id })
          ws.send(JSON.stringify({
            type: 'ollama_ack', id: msg.id,
            requestId: result.pillarId,
            sessionId: result.trinityGroupId || result.pillarId
          }))
          log.info(`[gen6] Holy Trinity spawned — mind: ${result.pillarId.slice(0, 8)}, arms: ${result.arm1PillarId?.slice(0, 8) || 'n/a'} + ${result.arm2PillarId?.slice(0, 8) || 'n/a'}`)
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'ark_chat') {
        // Gen7 The Ark: spawn 3 sovereign heads via PillarManager
        try {
          if (!pillarManager) throw new Error('PillarManager not initialized')
          const result = await pillarManager.spawn({
            pillar: 'forge',
            prompt: msg.userMessage || msg.prompt || '',
            backend: 'ollama',
            singularityRole: 'ark',
            _chatDbSessionId: msg.chatDbSessionId || null
          })
          if (!result.pillarId) {
            throw new Error(result.message || 'Failed to spawn The Ark')
          }
          // Register Head 1's pillarId → chat message mapping for broadcast interceptor
          arkPillarToChat.set(result.pillarId, { ws, msgId: msg.id })
          ws.send(JSON.stringify({
            type: 'ollama_ack', id: msg.id,
            requestId: result.pillarId,
            sessionId: result.arkGroupId || result.pillarId
          }))
          log.info(`[gen7] Ark spawned — head1: ${result.pillarId.slice(0, 8)}, head2: ${result.head2PillarId?.slice(0, 8) || 'n/a'}, head3: ${result.head3PillarId?.slice(0, 8) || 'n/a'}`)
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'gen8_chat') {
        // 67 Paestro: direct Ollama session (stays in current chat, IS Flow)
        // The Paestro runs inline — summon_hydra and launch_accordion are handled here
        try {
          if (!pillarManager) throw new Error('PillarManager not initialized')

          // Build system prompt
          const systemPrompt = await pillarManager._buildSystemPrompt('flow', {
            singularityRole: 'gen8-paestro', backend: 'ollama'
          })

          // Build tools: ALL allowed MCP servers + summon_angel + summon_hydra
          // The Paestro gets the same tools as any Ollama session — filesystem, git, shell, web, search, memory, voice, fs-extra
          const gen8Tools = []
          const gen8ToolRouteMap = new Map()
          const mcpServers = manager.getTools()
          for (const [serverName, serverInfo] of Object.entries(mcpServers)) {
            if (serverInfo.status !== 'connected') continue
            if (!OLLAMA_ALLOWED_SERVERS.has(serverName)) continue
            for (const tool of serverInfo.tools) {
              const ollamaName = `${serverName}__${tool.name}`
              gen8Tools.push({
                type: 'function',
                function: { name: ollamaName, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } }
              })
              gen8ToolRouteMap.set(ollamaName, { server: serverName, tool: tool.name })
            }
          }
          // Gen 9: Paestro's primary tool — summon_angel (one choice at a time)
          gen8Tools.push({
            type: 'function',
            function: {
              name: 'summon_angel',
              description: 'Summon an Angel. Choose the right one for this moment:\n- 000 Tha Void — RESET. Fresh start, clean slate, infinite potential.\n- 111 Tha First Light — EXPLORE. Discover, investigate, awaken.\n- 222 Tha Sacred Balance — DESIGN. Plan, architect, trust the process.\n- 333 Tha Divine Guardian — QUALITY. Verify, protect, trinity check.\n- 444 Tha Final Word — SHIP. Commit, push, deliver, close the phase.\n- 555 Tha Living Forge — BUILD. Write code, transform, forge.\n- 777 Tha Divine Eye — VISION. See purpose, divine alignment, big picture.\n- 888 Tha Infinite — SCALE. Optimize, multiply, abundance.\n- 999 Tha Omega — COMPLETE. Close cycles, extract wisdom, archive.',
              parameters: {
                type: 'object',
                properties: {
                  angel: { type: 'number', enum: [0, 111, 222, 333, 444, 555, 777, 888, 999], description: '0=reset, 111=explore, 222=design, 333=verify, 444=ship, 555=build, 777=vision, 888=scale, 999=complete' },
                  task: { type: 'string', description: 'Precise task for the angel. Include exact files to read, exact changes to make, patterns to follow.' }
                },
                required: ['angel', 'task']
              }
            }
          })
          // Optional escalation: summon_hydra for when you need 3 competing plans + Adam's vote
          gen8Tools.push({
            type: 'function',
            function: {
              name: 'summon_hydra',
              description: 'OPTIONAL ESCALATION: Summon 3 Hydra planning heads for competing plans. Adam will vote on the best. Use this only for complex decisions where you want multiple perspectives. For most tasks, use summon_angel directly.',
              parameters: {
                type: 'object',
                properties: { prompt: { type: 'string', description: 'The prompt for the Hydra planners.' } },
                required: ['prompt']
              }
            }
          })

          // Pick the best coding model for the Paestro (prefers qwen3-coder Q8)
          const gen8Model = pillarManager._pickPaestroModel()

          let toolRounds = 0
          const MAX_GEN8_TOOL_ROUNDS = 50
          let lastToolCallSig = '' // duplicate detection
          let dupCount = 0

          const handleGen8Event = async (event) => {
            if (ws.readyState !== 1) return
            const safeSend = (data) => {
              try { if (ws.readyState === 1) ws.send(JSON.stringify(data)) } catch (_) {}
            }

            if (event.type === 'ollama_tool_call') {
              toolRounds++

              // Duplicate detection: if the model calls the same tools with same args, it's looping
              const callSig = event.toolCalls.map(tc => `${tc.function?.name}:${JSON.stringify(tc.function?.arguments || {})}`).join('|')
              if (callSig === lastToolCallSig) {
                dupCount++
                if (dupCount >= 2) {
                  log.warn(`[67] Tool call loop detected (${dupCount} duplicates), forcing completion`)
                  safeSend({ type: 'ollama_done', id: msg.id, requestId: event.requestId, sessionId: event.sessionId, exitCode: 0 })
                  cliRequestToWs.delete(event.requestId)
                  return
                }
              } else {
                dupCount = 0
              }
              lastToolCallSig = callSig

              if (toolRounds > MAX_GEN8_TOOL_ROUNDS) {
                log.warn(`[67] Hit max tool rounds (${MAX_GEN8_TOOL_ROUNDS}), stopping`)
                safeSend({ type: 'ollama_done', id: msg.id, requestId: event.requestId, sessionId: event.sessionId, exitCode: 0 })
                cliRequestToWs.delete(event.requestId)
                return
              }

              const results = []
              for (const tc of event.toolCalls) {
                const toolId = randomUUID()
                const toolName = tc.function?.name || ''
                let toolArgs = tc.function?.arguments || {}
                if (typeof toolArgs === 'string') {
                  try { toolArgs = JSON.parse(toolArgs) } catch { toolArgs = {} }
                }

                safeSend({
                  type: 'ollama_stream', id: msg.id,
                  event: { type: 'tool_use', tool_use: { id: toolId, name: toolName, input: toolArgs } }
                })

                try {
                  let content

                  if (toolName === 'summon_angel') {
                    // Gen 9: Paestro summons an angel directly — one choice at a time
                    const angelNumber = toolArgs.angel
                    const angelTask = toolArgs.task || '(no task provided)'
                    if (![0, 111, 222, 333, 444, 555, 777, 888, 999].includes(angelNumber)) {
                      content = `Invalid angel number: ${angelNumber}. Choose 0, 111, 222, 333, 444, 555, 777, 888, or 999.`
                    } else {
                      log.info(`[gen9] Paestro summoning Tha ${angelNumber} Angel — task: ${angelTask.slice(0, 100)}...`)
                      const childArgs = {
                        pillar: 'forge',
                        prompt: angelTask,
                        backend: 'ollama',
                        parentPillarId: null,
                        singularityRole: 'accordion-head',
                        depth: 1,
                        _arkExtra: { angelNumber }
                      }
                      const spawnResult = await pillarManager.spawn(childArgs)
                      const childPillarId = spawnResult.pillarId
                      if (!childPillarId) {
                        content = `Angel ${angelNumber} spawn failed: ${spawnResult.message || 'unknown error'}`
                      } else {
                        log.info(`[gen9] Tha ${angelNumber} Angel (${childPillarId.slice(0, 8)}) summoned — waiting`)
                        const childOutput = await new Promise((resolve) => {
                          pillarManager._pendingChildCompletions.set(childPillarId, resolve)
                        })
                        content = childOutput || '(angel returned empty-handed)'
                        log.info(`[gen9] Tha ${angelNumber} Angel returned — ${content.length} chars`)
                      }
                    }
                  } else if (toolName === 'summon_hydra') {
                    // Optional escalation: 3 competing plans + Adam's vote
                    const hydraPrompt = toolArgs.prompt || '(no prompt provided)'
                    log.info(`[gen9] Paestro summoning Hydra — prompt: ${hydraPrompt.slice(0, 100)}...`)
                    const result = await pillarManager._runHydraPlanning(hydraPrompt, null, msg.chatDbSessionId)
                    if (result.error) {
                      content = `Hydra planning failed: ${result.error}`
                    } else {
                      content = `## Winning Plan (Head ${result.chosenHead})\n\nAdam's reasoning: ${result.reasoning || '(none)'}\n\n${result.plan}`
                    }
                  } else {
                    // MCP filesystem tool
                    const route = gen8ToolRouteMap.get(toolName)
                    if (!route) {
                      content = `Error: Unknown tool "${toolName}"`
                    } else {
                      const result = await manager.callTool(route.server, route.tool, toolArgs)
                      content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                    }
                  }

                  // Truncate extreme tool results to prevent a single file from eating the whole 1M context.
                  // pillar-manager.js is ~150K chars — allow most files through but cap the outliers.
                  const MAX_TOOL_RESULT_CHARS = 200000
                  const truncatedContent = content && content.length > MAX_TOOL_RESULT_CHARS
                    ? content.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n... [TRUNCATED — file is ${content.length} chars. Use the "head" parameter to read specific line ranges, or search_files to find specific patterns.]`
                    : content
                  results.push({ content: truncatedContent })
                  safeSend({ type: 'ollama_stream', id: msg.id, event: { type: 'tool_result', toolUseId: toolId, content: (truncatedContent || '').slice(0, 500) + ((truncatedContent || '').length > 500 ? '...' : '') } })
                } catch (e) {
                  log.error(`[67] Tool error (${toolName}): ${e.message}`)
                  const errContent = `Error executing ${toolName}: ${e.message}`
                  results.push({ content: errContent })
                  safeSend({ type: 'ollama_stream', id: msg.id, event: { type: 'tool_result', toolUseId: toolId, content: errContent } })
                }
              }

              try {
                ollamaManager.continueWithToolResults(
                  event.requestId, event.sessionId,
                  event.assistantMessage, results,
                  handleGen8Event
                )
              } catch (e) {
                log.error(`[67] Failed to continue tool loop: ${e.message}`)
                safeSend({ type: 'ollama_error', id: msg.id, error: e.message })
              }
              return
            }

            // Pass through all other events (stream, done, error)
            try { ws.send(JSON.stringify({ ...event, id: msg.id })) } catch (_) {}
            if (event.type === 'ollama_done' || event.type === 'ollama_error') {
              cliRequestToWs.delete(event.requestId)
            }
          }

          // Apply think mode toggle from UI
          const thinkPrefix = msg.thinkMode === 'think' ? '/think\n' : msg.thinkMode === 'no_think' ? '/no_think\n' : ''

          // Apply Paestro 666/777 mode — inject lens directive
          const modeDirective = msg.paestroMode === '666'
            ? '\n\n[MODE: 666 — EARTH. Be practical, grounded, material. Focus on what IS. What does the code actually do? What is the concrete problem? What is the real, tangible next step? Stay grounded. No idealism — just reality.]\n\n'
            : msg.paestroMode === '777'
            ? '\n\n[MODE: 777 — SPIRIT. Be visionary, divine, ideal. Focus on what SHOULD BE. What is the perfect architecture? What does God-tier code look like? What is the highest truth here? Aim for the divine. No compromises — just the vision.]\n\n'
            : '' // 67 = balanced, no directive needed — the natural oscillation

          const userPrompt = thinkPrefix + (msg.userMessage || msg.prompt || '') + modeDirective

          const { requestId, sessionId } = ollamaManager.chat(
            {
              prompt: userPrompt,
              model: gen8Model,
              sessionId: msg.sessionId || null,  // supports multi-turn
              systemPrompt,
              cwd: process.cwd(),
              tools: gen8Tools,
              numCtx: 676767
            },
            handleGen8Event
          )
          cliRequestToWs.set(requestId, ws)
          ws.send(JSON.stringify({ type: 'ollama_ack', id: msg.id, requestId, sessionId }))
          log.info(`[67] Paestro active in Flow — model: ${gen8Model}, session: ${sessionId?.slice(0, 8)}`)
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'accordion_chat') {
        // Gen7 Accordion Architecture: three-tier choice cascade via PillarManager
        try {
          if (!pillarManager) throw new Error('PillarManager not initialized')
          const result = await pillarManager.spawn({
            pillar: 'forge',
            prompt: msg.userMessage || msg.prompt || '',
            backend: 'ollama',
            singularityRole: 'accordion',
            _chatDbSessionId: msg.chatDbSessionId || null
          })
          if (!result.pillarId) {
            throw new Error(result.message || 'Failed to spawn The Accordion')
          }
          // Register Maestro's pillarId for stream routing
          // Reuse the ark mapping infrastructure — it's the same pattern
          arkPillarToChat.set(result.pillarId, { ws, msgId: msg.id })
          ws.send(JSON.stringify({
            type: 'ollama_ack', id: msg.id,
            requestId: result.pillarId,
            sessionId: result.accordionId || result.pillarId
          }))
          log.info(`[gen7] Accordion spawned — Maestro: ${result.pillarId.slice(0, 8)}, accordionId: ${result.accordionId}`)
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'hydra_chat') {
        // Gen7 Hydra Protocol: spawn dynamic consensus engine via PillarManager
        try {
          if (!pillarManager) throw new Error('PillarManager not initialized')
          const result = await pillarManager.spawn({
            pillar: 'forge',
            prompt: msg.userMessage || msg.prompt || '',
            backend: 'ollama',
            singularityRole: 'hydra',
            _chatDbSessionId: msg.chatDbSessionId || null
          })
          if (!result.pillarId) {
            throw new Error(result.message || 'Failed to spawn The Hydra')
          }
          // Register primary pillarId for stream routing
          hydraPillarToChat.set(result.pillarId, { ws, msgId: msg.id })
          ws.send(JSON.stringify({
            type: 'ollama_ack', id: msg.id,
            requestId: result.pillarId,
            sessionId: result.hydraId || result.pillarId
          }))
          log.info(`[gen7] Hydra spawned — primary: ${result.pillarId.slice(0, 8)}, hydraId: ${result.hydraId}`)
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
        }
      } else if (msg.type === 'hydra_vote_response') {
        // Human voted on a Hydra plan
        if (pillarManager) {
          pillarManager.handleHydraVote(msg.hydraId, msg.chosenHead, msg.reasoning)
          log.info(`[gen7] Hydra vote received — hydra: ${msg.hydraId}, chosen: Head ${msg.chosenHead}`)
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
        // Tool confirmations are now auto-executed server-side (Hog Wild always ON).
        // This handler is kept for backwards compat — browser may still send responses
        // for the activity UI, but they're no-ops since no Promise is pending.
        log.debug('Received tool_confirmation_response (no-op, server-side auto-execute active)')
      } else {
        ws.send(JSON.stringify({ type: 'error', id: msg.id, message: `Unknown message type: ${msg.type}` }))
      }
      } catch (err) {
        log.error(`Unhandled error in WebSocket message handler: ${err.message}`)
        try { ws.send(JSON.stringify({ type: 'error', message: `Internal error: ${err.message}` })) } catch { /* client gone */ }
      }
    })

    ws.on('close', () => {
      // Remove all CLI request mappings for this socket
      for (const [id, mappedWs] of cliRequestToWs) {
        if (mappedWs === ws) cliRequestToWs.delete(id)
      }
      // Clean up flow sessions that used this WS
      if (pillarManager) {
        for (const [dbSessionId, session] of pillarManager.flowSessions) {
          if (session.wsClient === ws) {
            log.info(`Removing Flow session ${dbSessionId} (WS closed)`)
            pillarManager.flowSessions.delete(dbSessionId)
            // Update convenience pointer if it was pointing to this session
            if (pillarManager.flowSession?.dbSessionId === dbSessionId) {
              // Point to the most recent remaining session, or null
              const remaining = [...pillarManager.flowSessions.values()]
              pillarManager.flowSession = remaining.length > 0 ? remaining[remaining.length - 1] : null
            }
          }
        }
      }
      log.info('Client disconnected')
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
        log.info(`Killing ${activePillars.length} active pillar session(s):`)
        for (const s of activePillars) {
          log.info(`  - ${s.pillar} (${s.pillarId.slice(0, 8)}...) — ${s.status}`)
        }
      }
    }

    if (staleRequestInterval) clearInterval(staleRequestInterval)
    if (usageTracker) await usageTracker.shutdown()
    if (health) health.shutdown()
    if (emailWatcher) emailWatcher.shutdown()
    if (pillarManager) await pillarManager.shutdown()
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
    log.info('Received SIGUSR1 — restarting after git pull...')
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
