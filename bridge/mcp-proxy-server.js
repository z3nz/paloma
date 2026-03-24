import crypto from 'crypto'
import { createServer } from 'http'
import { Server } from '@modelcontextprotocol/sdk/server'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from './logger.js'

const log = createLogger('mcp-proxy')

const CONFIRMATION_TIMEOUT = 5 * 60 * 1000 // 5 minutes

// Per-tool timeout overrides (ms). Tools not listed use CONFIRMATION_TIMEOUT.
const TOOL_TIMEOUTS = {
  'web__web_fetch':       10 * 60 * 1000, // 10 min — web fetches can be slow
  'web__web_download':    10 * 60 * 1000,
  'brave-search__brave_web_search': 3 * 60 * 1000,
  'brave-search__brave_local_search': 3 * 60 * 1000,
  'ollama__ollama_chat':  10 * 60 * 1000, // local LLM inference
  'ollama__ollama_generate': 10 * 60 * 1000,
  'gmail__email_wait':    10 * 60 * 1000, // email polling waits
  'exec__bash_exec':       5 * 60 * 1000,
}

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
    this.transports = new Map() // sessionId → { transport, server } (SSE)
    this.streamableTransports = new Map() // sessionId → { transport, server } (Streamable HTTP)
  }

  async start() {
    this.httpServer = createServer((req, res) => {
      try {
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
        } else if (pathname === '/mcp') {
          this._handleStreamableHTTP(req, res)
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      } catch (e) {
        log.error('HTTP handler error', e.message)
        if (!res.headersSent) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      }
    })

    this.httpServer.on('error', (err) => {
      log.error('HTTP server error', err.message)
    })

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        log.info(`Listening on http://localhost:${this.port}`)
        resolve()
      })
    })
  }

  async shutdown() {
    const closeWithTimeout = async (transport, label) => {
      try {
        await Promise.race([
          transport.close(),
          new Promise(resolve => setTimeout(resolve, 5000))
        ])
      } catch { /* swallow close errors */ }
    }
    for (const [id, entry] of this.transports) {
      await closeWithTimeout(entry.transport, `sse-${id}`)
    }
    this.transports.clear()
    for (const [id, entry] of this.streamableTransports) {
      await closeWithTimeout(entry.transport, `http-${id}`)
    }
    this.streamableTransports.clear()
    if (this.httpServer) {
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve(), 5000)
        this.httpServer.close(() => { clearTimeout(timer); resolve() })
      })
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
            backend: { type: 'string', enum: ['claude', 'codex', 'copilot', 'gemini', 'ollama'], description: 'AI backend for this pillar session (defaults to your current backend). Use copilot for GitHub Copilot CLI, ollama for local Qwen model, gemini for Google models.' },
            recursive: { type: 'boolean', description: 'Enable recursive mode — sub-instance MUST delegate to further sub-instances. Default: false.' },
            depth: { type: 'number', description: 'Current recursion depth (set automatically by parent). Default: 0.' },
            parentPillarId: { type: 'string', description: 'Parent pillar ID (set automatically for recursive spawns).' },
            singularityRole: { type: 'string', enum: ['quinn', 'quinn-gen4', 'worker', 'voice', 'thinker'], description: 'Singularity role for the session. Use quinn-gen4 for recursive self-prompting Quinn.' },
            generation: { type: 'number', description: 'Generation number for quinn-gen4 sessions. Default: 1.' }
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
        name: 'pillar_resume',
        description: 'Resume an interrupted pillar session. Use this after a bridge restart to continue an interrupted task using the captured session ID.',
        inputSchema: {
          type: 'object',
          properties: {
            pillarId: { type: 'string', description: 'The pillar session ID to resume' }
          },
          required: ['pillarId']
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

      tools.push({
        name: 'pillar_stop_tree',
        description: 'Kill switch — stop an entire recursive session tree. Stops the given session and ALL its descendant sub-instances.',
        inputSchema: {
          type: 'object',
          properties: {
            pillarId: { type: 'string', description: 'The root session ID of the tree to stop' }
          },
          required: ['pillarId']
        }
      })

      tools.push({
        name: 'pillar_orchestrate',
        description: 'Analyze a plan\'s work units and get orchestration recommendations. Parses all WUs, checks dependencies, determines which are ready, and suggests dispatch order with parallelism analysis.',
        inputSchema: {
          type: 'object',
          properties: {
            planFile: { type: 'string', description: 'Plan filename containing work units (e.g., "active-20260301-verifesto-saas.md")' }
          },
          required: ['planFile']
        }
      })

      tools.push({
        name: 'pillar_decompose',
        description: 'Add or update a work unit in a plan document. Writes a formatted work unit spec to the ## Work Units section. Use this for recursive orchestration — decomposing large plans into focused work units.',
        inputSchema: {
          type: 'object',
          properties: {
            planFile: { type: 'string', description: 'Plan filename (e.g., "active-20260301-verifesto-saas.md")' },
            unitId: { type: 'string', description: 'Work unit ID (e.g., "WU-1")' },
            feature: { type: 'string', description: 'Feature group name (e.g., "Backend Foundation")' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'], description: 'Work unit status (default: pending)' },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'WU-IDs this depends on (e.g., ["WU-1", "WU-3"])' },
            files: { type: 'array', items: { type: 'string' }, description: 'Files to create/modify' },
            scope: { type: 'string', description: '1-3 sentence description of what this unit does' },
            acceptance: { type: 'string', description: 'How to verify success' },
            result: { type: 'string', description: 'Completion summary (set after done)' }
          },
          required: ['planFile', 'unitId', 'scope', 'files']
        }
      })

      tools.push({
        name: 'pillar_notifications',
        description: 'Retrieve pending pillar callback notifications. Use this after spawning pillars from a non-browser CLI session (Copilot/Codex/standalone Claude) to get completion callbacks that would normally be pushed automatically. Returns and clears the notification queue.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      })
    }

    // --- Bridge self-restart tool ---
    tools.push({
      name: 'restart_bridge',
      description: 'Restart the Paloma bridge server. Performs a graceful shutdown (stops all MCP servers, email watcher, pillar sessions) then respawns. Use after code changes to bridge files.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the restart is needed (logged to console)' }
        }
      }
    })

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

    if (name === 'restart_bridge') {
      const reason = args.reason || 'no reason given'
      log.info('Bridge restart requested', { reason })
      // Return response before restarting (short delay so the response reaches the CLI)
      setTimeout(() => {
        if (this.restartBridge) this.restartBridge()
      }, 500)
      return { content: [{ type: 'text', text: `Bridge restart initiated. Reason: ${reason}. The bridge will be back in ~2 seconds.` }] }
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

    // Validate parsed names to prevent routing confusion
    if (!/^[a-zA-Z0-9_-]+$/.test(serverName) || !/^[a-zA-Z0-9_-]+$/.test(toolName)) {
      return { content: [{ type: 'text', text: `Invalid tool name format: ${name}` }], isError: true }
    }

    // Ask browser for confirmation before executing
    // Use per-tool timeout if configured, otherwise default
    const toolKey = `${serverName}__${toolName}`
    const timeout = TOOL_TIMEOUTS[toolKey] || CONFIRMATION_TIMEOUT
    this.onToolActivity(name, args, 'pending', cliRequestId)
    try {
      const decision = await Promise.race([
        this.onToolConfirmation(name, args, cliRequestId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeout)
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
          content: [{ type: 'text', text: `Tool confirmation timed out (${Math.round(timeout / 60000)} minutes)` }],
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
        case 'pillar_resume':
          result = await this.pillarManager.resumeSession(args)
          break
        case 'pillar_stop':
          result = this.pillarManager.stop(args)
          break
        case 'pillar_stop_tree':
          result = this.pillarManager.stopTree(args)
          break
        case 'pillar_decompose':
          result = await this.pillarManager.decompose(args)
          break
        case 'pillar_orchestrate':
          result = await this.pillarManager.orchestrate(args)
          break
        case 'pillar_notifications':
          result = this.pillarManager.getNotifications()
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
      log.info('SSE session closed', { sessionId: transport.sessionId })
    }

    log.info('SSE session started', { sessionId: transport.sessionId, cliRequestId })
    try {
      await server.connect(transport)
    } catch (e) {
      log.error('SSE connect failed', { sessionId: transport.sessionId, error: e.message })
      this.transports.delete(transport.sessionId)
    }
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

    try {
      await entry.transport.handlePostMessage(req, res)
    } catch (e) {
      log.error('POST handler error', { sessionId, error: e.message })
      if (!res.headersSent) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'Internal error' }))
      }
    }
  }

  /**
   * Handle Streamable HTTP MCP transport requests (used by Codex CLI).
   * POST /mcp — JSON-RPC requests (initialize, tools/list, tools/call)
   * GET /mcp — SSE stream for server-initiated notifications
   * DELETE /mcp — close session
   */
  async _handleStreamableHTTP(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`)
    const cliRequestId = url.searchParams.get('cliRequestId')

    // Check for existing session
    const sessionId = req.headers['mcp-session-id']
    if (sessionId && this.streamableTransports.has(sessionId)) {
      const entry = this.streamableTransports.get(sessionId)
      try {
        await entry.transport.handleRequest(req, res)
      } catch (e) {
        log.error('Streamable HTTP error', { sessionId, error: e.message })
        if (!res.headersSent) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      }
      return
    }

    // New session — only POST (initialize) can create one
    if (req.method !== 'POST') {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'No valid session. Send an initialize request first.' }))
      return
    }

    // Create new server + transport for this connection
    const server = this._createServer(cliRequestId)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID()
    })

    transport.onclose = () => {
      const sid = transport.sessionId
      this.streamableTransports.delete(sid)
      log.info('Streamable HTTP session closed', { sessionId: sid })
    }

    log.info('Streamable HTTP session starting', { cliRequestId })

    try {
      await server.connect(transport)
      // handleRequest processes the initialize and sets the session ID
      await transport.handleRequest(req, res)
      // Now sessionId is available — store for routing subsequent requests
      if (transport.sessionId) {
        this.streamableTransports.set(transport.sessionId, { transport, server, cliRequestId })
        log.info('Streamable HTTP session started', { sessionId: transport.sessionId })
      }
    } catch (e) {
      log.error('Streamable HTTP init failed', e.message)
      if (!res.headersSent) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'Failed to initialize session' }))
      }
    }
  }
}
