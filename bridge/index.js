import { WebSocketServer } from 'ws'
import { mkdir, writeFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { loadConfig } from './config.js'
import { McpManager } from './mcp-manager.js'
import { ClaudeCliManager } from './claude-cli.js'
import { CodexCliManager } from './codex-cli.js'
import { McpProxyServer } from './mcp-proxy-server.js'
import { PillarManager } from './pillar-manager.js'

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '19191', 10)
const proxyPort = 19192

const manager = new McpManager()
const cliManager = new ClaudeCliManager()
const codexManager = new CodexCliManager()
let mcpProxy = null
let pillarManager = null

// Pending ask_user requests: id → { resolve }
const pendingAskUser = new Map()
// Pending tool confirmation requests: id → { resolve }
const pendingToolConfirm = new Map()
// CLI requestId → originating WebSocket (for targeted sends)
const cliRequestToWs = new Map()

async function main() {
  const servers = await loadConfig()
  await manager.startAll(servers)

  const wss = new WebSocketServer({ port })
  console.log(`MCP Bridge listening on ws://localhost:${port}`)

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
        pendingToolConfirm.set(id, { resolve })
      })
    },
    onToolActivity(toolName, args, status, cliRequestId) {
      sendToOrigin(cliRequestId, { type: 'cli_tool_activity', toolName, args, status })
    },
    onAskUser(question, options, cliRequestId) {
      const id = randomUUID()
      sendToOrigin(cliRequestId, { type: 'ask_user', id, question, options })
      return new Promise(resolve => {
        pendingAskUser.set(id, { resolve })
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
  const backends = { claude: cliManager, codex: codexManager }
  pillarManager = new PillarManager(backends, {
    projectRoot: process.cwd(),
    broadcast
  })
  mcpProxy.pillarManager = pillarManager

  wss.on('connection', (ws) => {
    console.log('Client connected')

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
        console.log('[bridge] Received register_flow_session:', JSON.stringify({ cliSessionId: msg.cliSessionId, model: msg.model, cwd: msg.cwd }))
        if (pillarManager) {
          pillarManager.registerFlowSession({
            cliSessionId: msg.cliSessionId,
            model: msg.model,
            cwd: msg.cwd,
            wsClient: ws
          })
          ws.send(JSON.stringify({ type: 'flow_session_registered', id: msg.id }))
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
      } else if (msg.type === 'claude_stop') {
        cliRequestToWs.delete(msg.requestId)
        cliManager.stop(msg.requestId)
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

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...')
    if (pillarManager) pillarManager.shutdown()
    cliManager.shutdown()
    codexManager.shutdown()
    if (mcpProxy) await mcpProxy.shutdown()
    await manager.shutdown()
    wss.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  console.error('Bridge startup failed:', e)
  process.exit(1)
})
