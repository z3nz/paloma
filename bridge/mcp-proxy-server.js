import { createServer } from 'http'
import { Server } from '@modelcontextprotocol/sdk/server'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

const CONFIRMATION_TIMEOUT = 5 * 60 * 1000 // 5 minutes

export class McpProxyServer {
  constructor(mcpManager, { port = 19192, onToolConfirmation, onToolActivity, onAskUser, onSetTitle }) {
    this.mcpManager = mcpManager
    this.port = port
    this.onToolConfirmation = onToolConfirmation || (() => Promise.resolve({ approved: true }))
    this.onToolActivity = onToolActivity || (() => {})
    this.onAskUser = onAskUser || (() => Promise.resolve('No handler'))
    this.onSetTitle = onSetTitle || (() => {})
    this.pillarManager = null // set by bridge/index.js after construction
    this.httpServer = null
    this.transports = new Map() // sessionId → { transport, server }
  }

  async start() {
    this.httpServer = createServer((req, res) => {
      // CORS for local CLI
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const pathname = new URL(req.url, `http://localhost:${this.port}`).pathname
      if (req.method === 'GET' && pathname === '/sse') {
        this._handleSSE(req, res)
      } else if (req.method === 'POST' && req.url?.startsWith('/messages')) {
        this._handlePost(req, res)
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`MCP Proxy Server listening on http://localhost:${this.port}`)
        resolve()
      })
    })
  }

  async shutdown() {
    for (const [, entry] of this.transports) {
      try { await entry.transport.close() } catch {}
    }
    this.transports.clear()
    if (this.httpServer) {
      return new Promise(resolve => this.httpServer.close(resolve))
    }
  }

  _buildToolList() {
    const tools = []
    const servers = this.mcpManager.getTools()

    for (const [serverName, serverInfo] of Object.entries(servers)) {
      if (serverInfo.status !== 'connected') continue
      for (const tool of serverInfo.tools) {
        tools.push({
          name: `${serverName}__${tool.name}`,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
          _server: serverName,
          _tool: tool.name
        })
      }
    }

    // Add set_chat_title tool
    tools.push({
      name: 'set_chat_title',
      description: 'Set the title of the current conversation. Call this once during your first response to give the chat a concise, descriptive title (5-8 words).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise descriptive title (5-8 words)' }
        },
        required: ['title']
      }
    })

    // Add ask_user tool
    tools.push({
      name: 'ask_user',
      description: 'Ask the user a question and get their response. Use this when you need clarification or approval.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of choices for the user to pick from'
          }
        },
        required: ['question']
      }
    })

    // --- Pillar orchestration tools (only available when PillarManager is wired) ---
    if (this.pillarManager) {
      tools.push({
        name: 'pillar_spawn',
        description: 'Spawn a new pillar CLI session as a background process. The pillar will work autonomously on the given prompt. Returns immediately with a pillarId handle.',
        inputSchema: {
          type: 'object',
          properties: {
            pillar: { type: 'string', enum: ['scout', 'chart', 'forge', 'polish', 'ship'], description: 'Which pillar to spawn' },
            prompt: { type: 'string', description: 'The initial message/task for the pillar' },
            model: { type: 'string', description: 'Optional model override (e.g., "opus", "sonnet" for Claude; "gpt-5.1-codex-max" for Codex). Defaults to phase suggestion.' },
            planFile: { type: 'string', description: 'Optional: only load this specific plan file into the pillar system prompt (e.g., "active-20260301-verifesto-saas.md")' },
            backend: { type: 'string', enum: ['claude', 'codex'], description: 'AI backend for this pillar session (default: claude). Use codex for focused coding or code review.' }
          },
          required: ['pillar', 'prompt']
        }
      })

      tools.push({
        name: 'pillar_message',
        description: 'Send a follow-up message to a running pillar session. If the pillar is busy, the message is queued.',
        inputSchema: {
          type: 'object',
          properties: {
            pillarId: { type: 'string', description: 'The pillar session ID returned by pillar_spawn' },
            message: { type: 'string', description: 'The message to send' }
          },
          required: ['pillarId', 'message']
        }
      })

      tools.push({
        name: 'pillar_read_output',
        description: "Read the pillar's accumulated output. Use since='all' for full history or 'last' for most recent.",
        inputSchema: {
          type: 'object',
          properties: {
            pillarId: { type: 'string', description: 'The pillar session ID' },
            since: { type: 'string', enum: ['last', 'all'], description: "'last' for most recent output, 'all' for full history. Default: 'last'" }
          },
          required: ['pillarId']
        }
      })

      tools.push({
        name: 'pillar_status',
        description: 'Quick status check on a pillar session. Returns running/idle/completed/error/stopped.',
        inputSchema: {
          type: 'object',
          properties: {
            pillarId: { type: 'string', description: 'The pillar session ID' }
          },
          required: ['pillarId']
        }
      })

      tools.push({
        name: 'pillar_list',
        description: 'List all active pillar sessions managed by Flow.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      })

      tools.push({
        name: 'pillar_stop',
        description: 'Stop a running pillar session. Kills the CLI process if running.',
        inputSchema: {
          type: 'object',
          properties: {
            pillarId: { type: 'string', description: 'The pillar session ID' }
          },
          required: ['pillarId']
        }
      })
    }

    return tools
  }

  async _handleToolCall(name, args, cliRequestId) {
    if (name === 'set_chat_title') {
      this.onSetTitle(args.title, cliRequestId)
      return { content: [{ type: 'text', text: `Chat titled: ${args.title}` }] }
    }

    if (name === 'ask_user') {
      return this._handleAskUser(args, cliRequestId)
    }

    // --- Pillar orchestration tools ---
    if (name.startsWith('pillar_') && this.pillarManager) {
      return this._handlePillarTool(name, args, cliRequestId)
    }

    // Parse proxy tool name: serverName__toolName
    const sepIdx = name.indexOf('__')
    if (sepIdx === -1) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
    const serverName = name.slice(0, sepIdx)
    const toolName = name.slice(sepIdx + 2)

    // Ask browser for confirmation before executing
    this.onToolActivity(name, args, 'pending', cliRequestId)
    try {
      const decision = await Promise.race([
        this.onToolConfirmation(name, args, cliRequestId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CONFIRMATION_TIMEOUT)
        )
      ])

      if (!decision.approved) {
        this.onToolActivity(name, args, 'denied', cliRequestId)
        return {
          content: [{ type: 'text', text: `Tool denied by user: ${decision.reason || 'No reason given'}` }],
          isError: true
        }
      }

      // User approved — execute the tool
      this.onToolActivity(name, args, 'running', cliRequestId)

      // If the browser already executed the tool and returned a result, use that
      if (decision.result !== undefined) {
        this.onToolActivity(name, args, 'done', cliRequestId)
        const text = typeof decision.result === 'string' ? decision.result : JSON.stringify(decision.result)
        return { content: [{ type: 'text', text }] }
      }

      // Otherwise execute via mcpManager
      const result = await this.mcpManager.callTool(serverName, toolName, args)
      this.onToolActivity(name, args, 'done', cliRequestId)
      if (result.content) {
        return { content: result.content, isError: result.isError || false }
      }
      return { content: [{ type: 'text', text: 'OK' }] }
    } catch (e) {
      this.onToolActivity(name, args, 'error', cliRequestId)
      if (e.message === 'timeout') {
        return {
          content: [{ type: 'text', text: 'Tool confirmation timed out (5 minutes)' }],
          isError: true
        }
      }
      return {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true
      }
    }
  }

  async _handleAskUser(args, cliRequestId) {
    try {
      const answer = await Promise.race([
        this.onAskUser(args.question, args.options || [], cliRequestId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CONFIRMATION_TIMEOUT)
        )
      ])
      return { content: [{ type: 'text', text: answer }] }
    } catch (e) {
      if (e.message === 'timeout') {
        return { content: [{ type: 'text', text: 'No response (timed out)' }] }
      }
      return {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true
      }
    }
  }

  async _handlePillarTool(name, args, cliRequestId) {
    try {
      let result
      switch (name) {
        case 'pillar_spawn':
          result = await this.pillarManager.spawn({ ...args, flowRequestId: cliRequestId })
          break
        case 'pillar_message':
          result = this.pillarManager.sendMessage(args)
          break
        case 'pillar_read_output':
          result = this.pillarManager.readOutput(args)
          break
        case 'pillar_status':
          result = this.pillarManager.getStatus(args)
          break
        case 'pillar_list':
          result = this.pillarManager.list()
          break
        case 'pillar_stop':
          result = this.pillarManager.stop(args)
          break
        default:
          return { content: [{ type: 'text', text: `Unknown pillar tool: ${name}` }], isError: true }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Pillar tool error: ${e.message}` }], isError: true }
    }
  }

  _createServer(cliRequestId) {
    const server = new Server(
      { name: 'paloma-proxy', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )

    // tools/list — return raw JSON Schema directly (no Zod conversion)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this._buildToolList()
      return {
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      }
    })

    // tools/call — route to the appropriate handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      return this._handleToolCall(name, args || {}, cliRequestId)
    })

    return server
  }

  async _handleSSE(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`)
    const cliRequestId = url.searchParams.get('cliRequestId')
    const server = this._createServer(cliRequestId)
    const transport = new SSEServerTransport('/messages', res)
    this.transports.set(transport.sessionId, { transport, server })

    transport.onclose = () => {
      this.transports.delete(transport.sessionId)
      console.log(`[mcp-proxy] SSE session closed: ${transport.sessionId}`)
    }

    console.log(`[mcp-proxy] SSE session started: ${transport.sessionId}, cliRequestId=${cliRequestId}`)
    await server.connect(transport)
  }

  async _handlePost(req, res) {
    // Extract sessionId from query string: /messages?sessionId=xxx
    const url = new URL(req.url, `http://localhost:${this.port}`)
    const sessionId = url.searchParams.get('sessionId')
    const entry = this.transports.get(sessionId)

    if (!entry) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Unknown session' }))
      return
    }

    await entry.transport.handlePostMessage(req, res)
  }
}
