import { WebSocketServer } from 'ws'
import { mkdir, writeFile, readdir, stat, unlink } from 'fs/promises'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { randomUUID } from 'crypto'

const PID_FILE = join(tmpdir(), 'paloma-bridge.pid')
import { loadConfig } from './config.js'
import { McpManager } from './mcp-manager.js'
import { ClaudeCliManager } from './claude-cli.js'
import { CodexCliManager } from './codex-cli.js'
import { OllamaManager } from './ollama-manager.js'
import { McpProxyServer } from './mcp-proxy-server.js'
import { PillarManager } from './pillar-manager.js'
import { EmailWatcher } from './email-watcher.js'
import { printBanner, stepOk, stepFail, stepInfo, printSummary, printShutdown } from './startup.js'

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '19191', 10)
const proxyPort = 19192

const manager = new McpManager()
const cliManager = new ClaudeCliManager()
const codexManager = new CodexCliManager()
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
}, 60000)

async function main() {
  const startTime = Date.now()
  printBanner()

  stepInfo('Loading MCP servers...')
  const servers = await loadConfig()
  const { serverCount, toolCount, failedCount } = await manager.startAll(servers, (name, status, tools, error) => {
    if (status === 'ok') stepOk(name, `${tools} tool${tools !== 1 ? 's' : ''}`)
    else stepFail(name, error || 'failed')
  })

  const wss = new WebSocketServer({ port })

  wss.on('error', (err) => {
    console.error('[bridge] WebSocket server error:', err.message)
  })

  function broadcast(msg) {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data)
    }
  }

  // Send to the originating tab if known, otherwise broadcast to all
  function sendToOrigin(cliRequestId, msg) {
    const ws = cliRequestToWs.get(cliRequestId)
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg))
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

  // Wire PillarManager with multi-backend support
  const backends = { claude: cliManager, codex: codexManager, ollama: ollamaManager }
  pillarManager = new PillarManager(backends, {
    projectRoot: process.cwd(),
    broadcast
  })
  mcpProxy.pillarManager = pillarManager

  // Start email watcher — polls Gmail, spawns new session per email
  emailWatcher = new EmailWatcher(cliManager, { broadcast })
  emailWatcher.start()

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
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
        return
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
              if (ws.readyState !== 1) return // OPEN
              ws.send(JSON.stringify({ ...event, id: msg.id }))
              // Clean up mapping when CLI session ends
              if (event.type === 'claude_done' || event.type === 'claude_error') {
                cliRequestToWs.delete(requestId)
                // If this was the Flow session, mark it as no longer streaming
                // so queued notifications can be processed
                if (pillarManager?.flowSession?.cliSessionId === sessionId) {
                  pillarManager.onFlowTurnComplete()
                }
              }
            }
          )
          // Map this CLI request to the originating WebSocket
          cliRequestToWs.set(requestId, ws)
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
            model: msg.model,
            cwd: msg.cwd,
            wsClient: ws
          })
          ws.send(JSON.stringify({ type: 'flow_session_registered', id: msg.id }))
        }
      } else if (msg.type === 'pillar_list') {
        // Frontend asking for active pillars (e.g., after reconnect to rebuild session map)
        const result = pillarManager ? pillarManager.list() : { pillars: [] }
        ws.send(JSON.stringify({ type: 'pillar_list_result', id: msg.id, pillars: result.pillars }))
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
      } else if (msg.type === 'ollama_chat') {
        try {
          // Convert MCP tools to Ollama's tool format (only if requested)
          // Filter to essential servers only — local models have limited context
          const OLLAMA_ALLOWED_SERVERS = new Set([
            'filesystem', 'git', 'shell', 'web', 'brave-search',
            'voice', 'memory', 'fs-extra'
          ])
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
            console.log(`[ollama] Passing ${ollamaTools.length} tools to model (filtered to essential servers)`)
          }

          let toolRounds = 0
          const MAX_TOOL_ROUNDS = 20

          // Event handler that intercepts tool_call events and executes them
          const handleOllamaEvent = async (event) => {
            if (ws.readyState !== 1) return

            if (event.type === 'ollama_tool_call') {
              toolRounds++
              if (toolRounds > MAX_TOOL_ROUNDS) {
                console.warn(`[ollama] Hit max tool rounds (${MAX_TOOL_ROUNDS}), stopping`)
                ws.send(JSON.stringify({ type: 'ollama_done', id: msg.id, requestId: event.requestId, sessionId: event.sessionId, exitCode: 0 }))
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
                  try { toolArgs = JSON.parse(toolArgs) } catch { toolArgs = {} }
                }
                const route = toolRouteMap.get(toolName)

                // Emit tool_use event to frontend
                ws.send(JSON.stringify({
                  type: 'ollama_stream', id: msg.id,
                  event: { type: 'tool_use', tool_use: { id: toolId, name: toolName, input: toolArgs } }
                }))

                if (!route) {
                  console.warn(`[ollama] Unknown tool: ${toolName}`)
                  const errContent = `Error: Unknown tool "${toolName}"`
                  results.push({ content: errContent })
                  ws.send(JSON.stringify({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content: errContent }
                  }))
                  continue
                }

                try {
                  console.log(`[ollama] Executing tool ${route.server}/${route.tool}`)
                  const result = await manager.callTool(route.server, route.tool, toolArgs)
                  const content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
                  results.push({ content })
                  ws.send(JSON.stringify({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content }
                  }))
                } catch (e) {
                  console.error(`[ollama] Tool error (${toolName}):`, e.message)
                  const errContent = `Error executing ${toolName}: ${e.message}`
                  results.push({ content: errContent })
                  ws.send(JSON.stringify({
                    type: 'ollama_stream', id: msg.id,
                    event: { type: 'tool_result', toolUseId: toolId, content: errContent }
                  }))
                }
              }

              // Continue conversation with tool results
              ollamaManager.continueWithToolResults(
                event.requestId, event.sessionId,
                event.assistantMessage, results,
                handleOllamaEvent
              )
              return
            }

            // Pass through all other events (stream, done, error)
            ws.send(JSON.stringify({ ...event, id: msg.id }))
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
    if (emailWatcher) emailWatcher.shutdown()
    if (pillarManager) pillarManager.shutdown()
    cliManager.shutdown()
    codexManager.shutdown()
    ollamaManager.shutdown()
    if (mcpProxy) await mcpProxy.shutdown()
    await manager.shutdown()
    wss.close()
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
