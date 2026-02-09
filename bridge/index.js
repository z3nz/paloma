import { WebSocketServer } from 'ws'
import { loadConfig } from './config.js'
import { McpManager } from './mcp-manager.js'
import { ClaudeCliManager } from './claude-cli.js'

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '19191', 10)

const manager = new McpManager()
const cliManager = new ClaudeCliManager()

async function main() {
  const servers = await loadConfig()
  await manager.startAll(servers)

  const wss = new WebSocketServer({ port })
  console.log(`MCP Bridge listening on ws://localhost:${port}`)

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
          }
        )
        ws.send(JSON.stringify({ type: 'claude_ack', id: msg.id, requestId, sessionId }))
      } else if (msg.type === 'claude_stop') {
        cliManager.stop(msg.requestId)
      } else {
        ws.send(JSON.stringify({ type: 'error', id: msg.id, message: `Unknown message type: ${msg.type}` }))
      }
    })

    ws.on('close', () => console.log('Client disconnected'))
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...')
    cliManager.shutdown()
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
