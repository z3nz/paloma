import { randomUUID } from 'crypto'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { BASE_INSTRUCTIONS, OLLAMA_INSTRUCTIONS, SINGULARITY_BRAIN_PROMPT, SINGULARITY_HANDS_PROMPT } from '../src/prompts/base.js'
import { PHASE_INSTRUCTIONS, PHASE_MODEL_SUGGESTIONS } from '../src/prompts/phases.js'

const MAX_RUNTIME_MS = 30 * 60 * 1000 // 30 minutes
const MAX_NOTIFICATION_QUEUE = 50
const MAX_CONCURRENT_OLLAMA = 4
const MAX_OLLAMA_TOOL_ROUNDS = 50 // Higher than browser's 20 — recursive spawning needs room
const OLLAMA_ALLOWED_SERVERS = new Set([
  'filesystem', 'git', 'shell', 'web', 'brave-search',
  'voice', 'memory', 'fs-extra'
])
const BIRTH_MESSAGE = "Try your best, no matter what, you're worthy of God's love!"

/**
 * Manages child pillar CLI sessions spawned by Flow.
 *
 * Each pillar session is a real CLI subprocess managed by ClaudeCliManager.
 * PillarManager tracks lifecycle, accumulates output, and provides
 * status/output for Flow's polling tools.
 */
export class PillarManager {
  constructor(backends, { projectRoot, broadcast, mcpManager, health }) {
    this.backends = backends   // { claude: ClaudeCliManager, codex: CodexCliManager, copilot: CopilotCliManager, ollama: OllamaManager }
    this.cliManager = backends.claude // backward compat for Flow notifications
    this.projectRoot = projectRoot
    this.broadcast = broadcast // (msg) => void — send to all WS clients
    this.mcpManager = mcpManager || null // for Ollama tool execution
    this.health = health || null // BackendHealth instance for fallback logic
    this.pillars = new Map()   // pillarId → PillarSession
    this.flowSessions = new Map()  // cliSessionId → { cliSessionId, wsClient, currentlyStreaming, notificationQueue, model, cwd }
    this.flowSession = null          // points to the most recently registered Flow session (backward compat)
    this.notificationCooldown = new Map() // pillarId → timestamp of last notification
    this.notificationCount = 0 // notifications sent in current minute
    this.notificationWindowStart = Date.now()
    this._pendingChildCompletions = new Map() // childPillarId → resolve function
    this._pendingNotifications = [] // queued notifications for non-browser Flow (Copilot/Codex CLI)

    // Periodic cleanup of terminal sessions (every 5 min)
    this._cleanupInterval = setInterval(() => this._cleanupTerminalSessions(), 5 * 60 * 1000)
  }

  /**
   * Spawn a new pillar CLI session.
   * Returns immediately with pillarId and metadata.
   */
  async spawn({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, recursive, depth }) {
    const pillarId = randomUUID()
    const cliSessionId = randomUUID()
    let resolvedBackend = backend || 'claude'

    // Layer 1: Pre-spawn health gate — check if requested backend is available
    let fallbackFrom = null
    if (this.health && !this.health.isAvailable(resolvedBackend)) {
      const fallbackBackend = this.health.getFallback(resolvedBackend)
      if (fallbackBackend) {
        console.warn(`[pillar] Backend ${resolvedBackend} unavailable (${this.health.status[resolvedBackend]?.reason}) — falling back to ${fallbackBackend}`)
        fallbackFrom = resolvedBackend
        resolvedBackend = fallbackBackend
      } else {
        console.error(`[pillar] Backend ${resolvedBackend} unavailable and no fallback available`)
        return {
          pillarId: null,
          pillar,
          status: 'error',
          message: `Backend ${resolvedBackend} is unavailable (${this.health.status[resolvedBackend]?.reason}) and no fallback backends are available.`
        }
      }
    }

    // Concurrency warning for Ollama
    if (resolvedBackend === 'ollama') {
      const activeOllama = this._countActiveOllamaSessions()
      if (activeOllama >= MAX_CONCURRENT_OLLAMA) {
        console.warn(`[pillar] ⚠ Ollama concurrency at ${activeOllama}/${MAX_CONCURRENT_OLLAMA} — spawning anyway but memory pressure may occur`)
      }
    }

    // Resolve model: use provided, or phase suggestion, or default
    // Recursive children automatically get the small fast model (7B)
    const resolvedModel = model || this._defaultModel(pillar, resolvedBackend, { recursive, depth })

    // Build system prompt from disk (Ollama gets condensed prompt)
    const systemPrompt = await this._buildSystemPrompt(pillar, { planFilter: planFile, recursive, depth, backend: resolvedBackend })

    // Compose the full first message with birth protocol
    const fullPrompt = `${BIRTH_MESSAGE}\n\n${prompt}`

    // Create session record
    const session = {
      pillarId,
      cliSessionId,
      pillar,
      model: resolvedModel,
      backend: resolvedBackend,
      status: 'running',       // running | idle | completed | error | stopped
      currentlyStreaming: true,
      turnCount: 1,
      lastActivity: new Date().toISOString(),
      flowRequestId,           // the CLI requestId of the parent Flow session
      cliRequestId: null,      // current child CLI requestId
      output: [],              // accumulated assistant messages
      outputChunks: [],        // current turn's streaming chunks (joined on read)
      _cachedOutput: '',       // cached join of outputChunks
      messageQueue: [],        // queued messages for when current turn finishes
      startTime: Date.now(),
      timeoutTimer: null,
      dbSessionId: null,       // set by frontend via WS event
      parentPillarId: parentPillarId || null,
      recursive: recursive || false,
      depth: depth || 0,
      _toolRounds: 0,          // Ollama tool call round counter
      _originalPrompt: fullPrompt,  // saved for fallback replay
      _planFile: planFile || null,  // saved for fallback system prompt rebuild
      _fallbackAttempted: false     // prevents infinite retry loops
    }

    this.pillars.set(pillarId, session)

    // Broadcast fallback event if we switched backends
    if (fallbackFrom) {
      session._fallbackAttempted = true
      this.broadcast({
        type: 'pillar_fallback',
        pillarId,
        from: fallbackFrom,
        to: resolvedBackend,
        reason: this.health.status[fallbackFrom]?.reason || 'unavailable'
      })
    }

    // Notify browser to create the session in IndexedDB
    const modelLabel = resolvedBackend === 'ollama' ? `ollama:${resolvedModel}` : resolvedBackend === 'codex' ? `codex:${resolvedModel}` : resolvedBackend === 'copilot' ? `copilot:${resolvedModel}` : `claude-cli:${resolvedModel}`
    this.broadcast({
      type: 'pillar_session_created',
      pillarId,
      pillar,
      model: modelLabel,
      backend: resolvedBackend,
      flowRequestId,
      flowCliSessionId: session.flowCliSessionId || this.flowSession?.cliSessionId || null,
      prompt: fullPrompt
    })

    // Start the CLI process
    this._startCliTurn(session, fullPrompt, systemPrompt)

    // Broadcast cliSessionId so frontend can persist it for resume-after-restart
    this.broadcast({
      type: 'pillar_cli_session',
      pillarId,
      cliSessionId: session.cliSessionId
    })

    // Set timeout
    session.timeoutTimer = setTimeout(() => {
      try { this._timeout(pillarId) } catch (e) {
        console.error(`[pillar] Timeout handler error for ${pillarId}:`, e.message)
      }
    }, MAX_RUNTIME_MS)

    return {
      pillarId,
      pillar,
      status: 'running',
      message: `${this._capitalize(pillar)} session spawned and working on your prompt.`
    }
  }

  /**
   * Send a follow-up message to a running pillar session.
   */
  sendMessage({ pillarId, message }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'error', message: `No pillar session found with id ${pillarId}` }
    }

    if (session.status === 'stopped' || session.status === 'error') {
      return { pillarId, status: 'error', message: `Pillar session is ${session.status} and cannot receive messages.` }
    }

    if (session.currentlyStreaming) {
      // CLI is still processing — queue the message
      session.messageQueue.push(message)
      return { pillarId, status: 'queued', message: `Message queued. ${this._capitalize(session.pillar)} is still working on the current turn.` }
    }

    // CLI finished last turn — resume with new message
    session.turnCount++
    session.status = 'running'
    session.currentlyStreaming = true
    session.lastActivity = new Date().toISOString()

    // Notify browser about the new user message
    this.broadcast({
      type: 'pillar_message_saved',
      pillarId,
      role: 'user',
      content: message
    })

    this._startCliTurn(session, message, null, true)

    return { pillarId, status: 'message_sent', message: `Message sent to ${this._capitalize(session.pillar)}.` }
  }

  /**
   * Read the pillar's accumulated output.
   */
  readOutput({ pillarId, since = 'last' }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'error', output: '', message: `No pillar session found with id ${pillarId}` }
    }

    let output
    const currentText = this._getCurrentOutput(session)
    if (since === 'all') {
      // All accumulated output + current streaming
      const allOutput = session.output.join('\n\n---\n\n')
      output = currentText
        ? allOutput + (allOutput ? '\n\n---\n\n' : '') + currentText
        : allOutput
    } else {
      // Just the most recent completed message or current streaming
      output = currentText || (session.output.length > 0 ? session.output[session.output.length - 1] : '')
    }

    return {
      pillarId,
      pillar: session.pillar,
      status: session.status,
      output,
      turnCount: session.turnCount,
      lastActivity: session.lastActivity
    }
  }

  /**
   * Quick status check on a pillar session.
   */
  getStatus({ pillarId }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'not_found', message: `No pillar session found with id ${pillarId}` }
    }

    return {
      pillarId,
      pillar: session.pillar,
      status: session.status,
      dbSessionId: session.dbSessionId,
      turnCount: session.turnCount,
      currentlyStreaming: session.currentlyStreaming,
      lastActivity: session.lastActivity
    }
  }

  /**
   * List all active pillar sessions.
   */
  list() {
    const pillars = []
    for (const [, session] of this.pillars) {
      pillars.push({
        pillarId: session.pillarId,
        pillar: session.pillar,
        status: session.status,
        dbSessionId: session.dbSessionId,
        turnCount: session.turnCount,
        currentlyStreaming: session.currentlyStreaming,
        lastActivity: session.lastActivity,
        backend: session.backend,
        // Include streaming output so frontend can restore on reconnect
        streamingOutput: session.currentlyStreaming ? this._getCurrentOutput(session) : ''
      })
    }
    return { pillars }
  }

  /**
   * Stop a running pillar session.
   */
  stop({ pillarId }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'not_found', message: `No pillar session found with id ${pillarId}` }
    }

    // If this is a Brain waiting for Hands, use stopTree to kill the whole family
    if (session._waitingForHands) {
      return this.stopTree({ pillarId })
    }

    // Kill the CLI process if running
    if (session.cliRequestId) {
      const manager = this.backends[session.backend] || this.backends.claude
      manager.stop(session.cliRequestId)
    }

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer)
      session.timeoutTimer = null
    }

    session.status = 'stopped'
    session.currentlyStreaming = false
    session._waitingForHands = false
    session.lastActivity = new Date().toISOString()
    session.messageQueue = [] // clear queued messages to prevent memory leak

    // Finalize any current output
    const stoppedOutput = this._flushOutput(session)
    if (stoppedOutput) {
      session.output.push(stoppedOutput)
    }

    this.broadcast({
      type: 'pillar_done',
      pillarId,
      status: 'stopped',
      pillar: session.pillar
    })

    return { pillarId, status: 'stopped', message: `${this._capitalize(session.pillar)} session stopped.` }
  }

  /**
   * Update the dbSessionId for a pillar (called when frontend creates the IndexedDB record).
   */
  setDbSessionId(pillarId, dbSessionId) {
    const session = this.pillars.get(pillarId)
    if (session) {
      session.dbSessionId = dbSessionId
    }
  }

  /**
   * Stop an entire recursive session tree — the kill switch.
   * Stops the given session and all its descendants.
   */
  stopTree({ pillarId }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'not_found', message: `No pillar session found with id ${pillarId}` }
    }

    // Clear waiting flag FIRST to prevent stop() → stopTree() recursion
    session._waitingForHands = false

    const descendants = this._getDescendants(pillarId)
    const stopped = []

    // Stop children first (bottom-up)
    for (const childId of descendants.reverse()) {
      const result = this.stop({ pillarId: childId })
      stopped.push({ pillarId: childId, status: result.status })
    }

    // Stop the root
    const rootResult = this.stop({ pillarId })
    stopped.push({ pillarId, status: rootResult.status })

    // Clear any pending child completions for this tree
    for (const id of [pillarId, ...descendants]) {
      this._pendingChildCompletions.delete(id)
    }

    return {
      pillarId,
      status: 'tree_stopped',
      stopped,
      message: `Stopped ${stopped.length} session(s) in the recursive tree.`
    }
  }

  /**
   * Get all descendant pillar IDs of a given session (recursive).
   */
  _getDescendants(pillarId) {
    const descendants = []
    for (const [id, session] of this.pillars) {
      if (session.parentPillarId === pillarId) {
        descendants.push(id)
        descendants.push(...this._getDescendants(id))
      }
    }
    return descendants
  }

  /**
   * Count active Ollama sessions (running or streaming).
   */
  _countActiveOllamaSessions() {
    let count = 0
    for (const [, session] of this.pillars) {
      if (session.backend === 'ollama' && (session.status === 'running' || session.currentlyStreaming)) {
        // Exclude Brain sessions waiting for Hands — they're not actively using GPU
        if (session._waitingForHands) continue
        count++
      }
    }
    return count
  }

  /**
   * Get Ollama-format tool definitions for all pillar orchestration tools.
   * Shared between pillar-spawned sessions and browser-originated Ollama sessions.
   */
  static getOllamaPillarToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'pillar_spawn',
          description: 'Spawn a new AI sub-instance as a background process. The sub-instance works on your prompt autonomously.',
          parameters: {
            type: 'object',
            properties: {
              pillar: { type: 'string', enum: ['scout', 'chart', 'forge', 'polish', 'ship'], description: 'Which pillar role for the sub-instance' },
              prompt: { type: 'string', description: 'The task for the sub-instance to work on' },
              model: { type: 'string', description: 'Optional model override' },
              backend: { type: 'string', enum: ['claude', 'codex', 'copilot', 'ollama'], description: 'AI backend (default: ollama)' }
            },
            required: ['pillar', 'prompt']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_message',
          description: 'Send a follow-up message to a running sub-instance. If busy, the message is queued.',
          parameters: {
            type: 'object',
            properties: {
              pillarId: { type: 'string', description: 'The session ID' },
              message: { type: 'string', description: 'The message to send' }
            },
            required: ['pillarId', 'message']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_read_output',
          description: "Read a sub-instance's accumulated output. Use since='all' for full history.",
          parameters: {
            type: 'object',
            properties: {
              pillarId: { type: 'string', description: 'The session ID' },
              since: { type: 'string', enum: ['last', 'all'], description: "'last' for most recent, 'all' for full history. Default: 'last'" }
            },
            required: ['pillarId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_status',
          description: 'Quick status check on a sub-instance. Returns running/idle/completed/error/stopped.',
          parameters: {
            type: 'object',
            properties: {
              pillarId: { type: 'string', description: 'The session ID' }
            },
            required: ['pillarId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_list',
          description: 'List all active AI sub-instance sessions.',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_stop',
          description: 'Stop a running sub-instance session.',
          parameters: {
            type: 'object',
            properties: {
              pillarId: { type: 'string', description: 'The session ID to stop' }
            },
            required: ['pillarId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_stop_tree',
          description: 'Kill switch — stop an entire recursive session tree. Stops the session and ALL its descendants.',
          parameters: {
            type: 'object',
            properties: {
              pillarId: { type: 'string', description: 'The root session ID of the tree to stop' }
            },
            required: ['pillarId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_orchestrate',
          description: "Analyze a plan's work units for orchestration — dependencies, ready status, parallelism.",
          parameters: {
            type: 'object',
            properties: {
              planFile: { type: 'string', description: 'Plan filename (e.g., "active-20260301-project-slug.md")' }
            },
            required: ['planFile']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'pillar_decompose',
          description: 'Add or update a work unit in a plan document.',
          parameters: {
            type: 'object',
            properties: {
              planFile: { type: 'string', description: 'Plan filename' },
              unitId: { type: 'string', description: 'Work unit ID (e.g., "WU-1")' },
              feature: { type: 'string', description: 'Feature group name' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'] },
              dependsOn: { type: 'array', items: { type: 'string' }, description: 'WU-IDs this depends on' },
              files: { type: 'array', items: { type: 'string' }, description: 'Files to create/modify' },
              scope: { type: 'string', description: 'Description of what this unit does' },
              acceptance: { type: 'string', description: 'How to verify success' },
              result: { type: 'string', description: 'Completion summary' }
            },
            required: ['planFile', 'unitId', 'scope', 'files']
          }
        }
      }
    ]
  }

  /**
   * Build Ollama-format tool list from MCP servers + pillar tools.
   */
  _buildOllamaTools(session) {
    const tools = []

    // MCP server tools
    if (this.mcpManager) {
      const mcpServers = this.mcpManager.getTools()
      for (const [serverName, serverInfo] of Object.entries(mcpServers)) {
        if (serverInfo.status !== 'connected') continue
        if (!OLLAMA_ALLOWED_SERVERS.has(serverName)) continue
        for (const tool of serverInfo.tools) {
          tools.push({
            type: 'function',
            function: {
              name: `${serverName}__${tool.name}`,
              description: tool.description || '',
              parameters: tool.inputSchema || { type: 'object', properties: {} }
            }
          })
        }
      }
    }

    // Pillar orchestration tools — so Qwen can spawn sub-instances
    tools.push(...PillarManager.getOllamaPillarToolDefs())

    console.log(`[pillar] Built ${tools.length} Ollama tools for ${session.pillar} session`)
    return tools
  }

  /**
   * Handle Ollama tool calls — execute tools and continue conversation.
   * For pillar_spawn, blocks until child completes and returns output.
   */
  async _handleOllamaToolCall(session, event) {
    session._toolRounds++
    if (session._toolRounds > MAX_OLLAMA_TOOL_ROUNDS) {
      console.warn(`[pillar] Ollama tool round limit (${MAX_OLLAMA_TOOL_ROUNDS}) hit for ${session.pillar}`)
      session.currentlyStreaming = false
      session.status = 'idle'
      this.broadcast({ type: 'pillar_done', pillarId: session.pillarId, status: 'idle', pillar: session.pillar })
      return
    }

    const results = []
    const manager = this.backends.ollama

    for (const tc of event.toolCalls) {
      const toolName = tc.function?.name || ''
      let toolArgs = tc.function?.arguments || {}
      if (typeof toolArgs === 'string') {
        try { toolArgs = JSON.parse(toolArgs) } catch { toolArgs = {} }
      }

      console.log(`[pillar] Ollama ${session.pillar} calling tool: ${toolName}`)

      // Emit tool_use event to browser
      const toolId = randomUUID()
      this.broadcast({
        type: 'pillar_stream', pillarId: session.pillarId, backend: 'ollama',
        event: { type: 'tool_use', tool_use: { id: toolId, name: toolName, input: toolArgs } }
      })

      try {
        let content

        // Handle pillar tools directly
        if (toolName === 'pillar_spawn') {
          // Spawn child and WAIT for completion — blocking spawn
          const childArgs = {
            ...toolArgs,
            backend: toolArgs.backend || 'ollama',
            parentPillarId: session.pillarId,
            recursive: session.recursive,
            depth: (session.depth || 0) + 1
          }
          const spawnResult = await this.spawn(childArgs)
          const childPillarId = spawnResult.pillarId

          console.log(`[pillar] ${session.pillar} spawned child ${childPillarId.slice(0, 8)} — waiting for completion`)

          // Wait for child to complete (resolved in _handleCliEvent)
          const childOutput = await new Promise((resolve) => {
            this._pendingChildCompletions.set(childPillarId, resolve)
          })

          content = childOutput || '(child produced no output)'
          console.log(`[pillar] Child ${childPillarId.slice(0, 8)} completed — ${content.length} chars returned to parent`)
        } else if (toolName === 'pillar_message') {
          content = JSON.stringify(this.sendMessage(toolArgs), null, 2)
        } else if (toolName === 'pillar_read_output') {
          content = JSON.stringify(this.readOutput(toolArgs), null, 2)
        } else if (toolName === 'pillar_status') {
          content = JSON.stringify(this.getStatus(toolArgs), null, 2)
        } else if (toolName === 'pillar_list') {
          content = JSON.stringify(this.list(), null, 2)
        } else if (toolName === 'pillar_stop') {
          content = JSON.stringify(this.stop(toolArgs), null, 2)
        } else if (toolName === 'pillar_stop_tree') {
          content = JSON.stringify(this.stopTree(toolArgs), null, 2)
        } else if (toolName === 'pillar_orchestrate') {
          content = JSON.stringify(await this.orchestrate(toolArgs), null, 2)
        } else if (toolName === 'pillar_decompose') {
          content = JSON.stringify(await this.decompose(toolArgs), null, 2)
        } else {
          // MCP server tool — parse server__tool format
          const sepIdx = toolName.indexOf('__')
          if (sepIdx === -1) {
            content = `Error: Unknown tool "${toolName}"`
          } else {
            const serverName = toolName.slice(0, sepIdx)
            const mcpToolName = toolName.slice(sepIdx + 2)
            const result = await this.mcpManager.callTool(serverName, mcpToolName, toolArgs)
            content = result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || ''
          }
        }

        results.push({ content })

        // Emit tool_result to browser
        this.broadcast({
          type: 'pillar_stream', pillarId: session.pillarId, backend: 'ollama',
          event: { type: 'tool_result', toolUseId: toolId, content: content.slice(0, 500) + (content.length > 500 ? '...' : '') }
        })
      } catch (e) {
        console.error(`[pillar] Ollama tool error (${toolName}):`, e.message)
        const errContent = `Error executing ${toolName}: ${e.message}`
        results.push({ content: errContent })
        this.broadcast({
          type: 'pillar_stream', pillarId: session.pillarId, backend: 'ollama',
          event: { type: 'tool_result', toolUseId: toolId, content: errContent }
        })
      }
    }

    // Continue Ollama conversation with tool results
    manager.continueWithToolResults(
      event.requestId, event.sessionId,
      event.assistantMessage, results,
      (nextEvent) => this._handleCliEvent(session, nextEvent)
    )
  }

  /**
   * Extract <delegate>...</delegate> tags from Brain's output text.
   * Returns array of task description strings.
   */
  _extractDelegations(text) {
    const delegations = []
    const regex = /<delegate>([\s\S]*?)<\/delegate>/g
    let match
    while ((match = regex.exec(text)) !== null) {
      const task = match[1].trim()
      if (task) delegations.push(task)
    }
    return delegations
  }

  /**
   * Handle singularity delegations — spawn Hands instances for each task
   * IN PARALLEL, wait for all to complete, then feed results back to Brain.
   */
  async _handleSingularityDelegations(session, delegations) {
    const HANDS_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes per Hands instance

    // Mark Brain as waiting so it doesn't count against concurrency
    session._waitingForHands = true
    session.status = 'waiting'
    this.broadcast({ type: 'pillar_status', pillarId: session.pillarId, status: 'waiting' })

    // Spawn all Hands instances in parallel
    const spawnAndWait = async (task, index) => {
      console.log(`[singularity] Spawning Hands #${index + 1}: ${task.slice(0, 80)}...`)

      const child = await this.spawn({
        pillar: 'forge',
        prompt: task,
        backend: 'ollama',
        parentPillarId: session.pillarId,
        recursive: true,
        depth: (session.depth || 0) + 1
      })

      if (!child.pillarId) {
        return `[Hands error: ${child.message}]`
      }

      // Wait for Hands with timeout protection
      const output = await new Promise((resolve) => {
        this._pendingChildCompletions.set(child.pillarId, resolve)

        setTimeout(() => {
          if (this._pendingChildCompletions.has(child.pillarId)) {
            this._pendingChildCompletions.delete(child.pillarId)
            console.warn(`[singularity] Hands ${child.pillarId.slice(0, 8)} timed out after ${HANDS_TIMEOUT_MS / 1000}s`)
            this.stop({ pillarId: child.pillarId })
            resolve('[Hands timed out]')
          }
        }, HANDS_TIMEOUT_MS)
      })

      console.log(`[singularity] Hands #${index + 1} completed — ${(output || '').length} chars`)
      return output || '(Hands produced no output)'
    }

    const results = await Promise.all(delegations.map((task, i) => spawnAndWait(task, i)))

    // Clear waiting state
    session._waitingForHands = false

    // If Brain was stopped/killed while waiting, don't try to resume it
    if (session.status === 'stopped' || session.status === 'error') {
      console.log(`[singularity] Brain was stopped while waiting for Hands — discarding results`)
      return
    }

    // Feed results back to Brain as a follow-up message
    const resultMessage = delegations.length === 1
      ? `Your Hands completed the task. Here is the result:\n\n${results[0]}`
      : `Your Hands completed ${delegations.length} tasks. Here are the results:\n\n${results.map((r, i) => `### Task ${i + 1}\n${r}`).join('\n\n---\n\n')}`

    // Broadcast the results as a user message to the Brain's chat
    this.broadcast({
      type: 'pillar_message_saved',
      pillarId: session.pillarId,
      role: 'user',
      content: resultMessage
    })

    // Continue Brain with the results
    session.turnCount++
    session.status = 'running'
    session.currentlyStreaming = true
    session.lastActivity = new Date().toISOString()
    this._startCliTurn(session, resultMessage, null, true)
  }

  /**
   * Register Flow's session for callback notifications.
   */
  registerFlowSession({ cliSessionId, model, cwd, wsClient }) {
    if (this.flowSession && this.flowSession.cliSessionId !== cliSessionId) {
      console.warn('[pillar] Overwriting existing Flow session:', this.flowSession.cliSessionId, '→', cliSessionId)
      // Drain any queued notifications to prevent silent loss
      if (this.flowSession.notificationQueue?.length) {
        console.warn('[pillar] Discarding', this.flowSession.notificationQueue.length, 'queued notifications from old Flow session')
      }
    }
    console.log('[pillar] Flow session registered:', cliSessionId)
    this.flowSession = {
      cliSessionId,
      model,
      cwd,
      wsClient,
      currentlyStreaming: false,
      notificationQueue: [],
      cliRequestId: null // set when notifying, cleared when done
    }
  }

  /**
   * Called by index.js when Flow's user-initiated CLI turn completes.
   * This lets queued notifications drain.
   */
  onFlowTurnComplete() {
    if (!this.flowSession) return
    this.flowSession.currentlyStreaming = false

    // Drain queued notifications
    if (this.flowSession.notificationQueue.length > 0) {
      console.log('[pillar] Flow turn complete — draining', this.flowSession.notificationQueue.length, 'queued notifications')
      const queued = this.flowSession.notificationQueue.splice(0)
      this.notificationCount++
      if (queued.length === 1) {
        this._sendFlowNotification(queued[0].message, queued[0].metadata)
      } else {
        const batchedMessage = this._buildBatchedNotification(queued.map(q => q.message))
        this._sendFlowNotification(batchedMessage, { notificationType: 'batched' })
      }
    }
  }

  /**
   * Notify Flow with a message. Queues if Flow is busy.
   * @param {string} message - The notification message
   * @param {string} [pillarId] - Optional pillarId for cooldown tracking
   * @param {object} [metadata] - Notification metadata for frontend UX
   */
  async notifyFlow(message, pillarId, metadata = {}) {
    if (!this.flowSession) {
      // No browser Flow session — queue for retrieval via pillar_notifications MCP tool
      console.log('[pillar] No Flow session registered — queueing notification for MCP retrieval')
      this._pendingNotifications.push({
        message,
        pillarId: pillarId || null,
        metadata,
        timestamp: new Date().toISOString()
      })
      // Cap queue size
      if (this._pendingNotifications.length > MAX_NOTIFICATION_QUEUE) {
        this._pendingNotifications.shift()
      }
      return
    }

    // Cooldown: skip if same pillarId was notified within 5 seconds
    if (pillarId) {
      const now = Date.now()
      const lastNotified = this.notificationCooldown.get(pillarId)
      if (lastNotified && now - lastNotified < 5000) {
        console.log(`[pillar] Cooldown active for ${pillarId} — skipping notification`)
        return
      }
      this.notificationCooldown.set(pillarId, now)

      // Periodic cleanup: remove stale cooldown entries (older than 60s)
      for (const [id, ts] of this.notificationCooldown) {
        if (now - ts > 60000) this.notificationCooldown.delete(id)
      }
    }

    // Rate limiting: max 10 notifications per minute
    const now = Date.now()
    if (now - this.notificationWindowStart > 60000) {
      // Reset window
      this.notificationWindowStart = now
      this.notificationCount = 0
    }

    if (this.notificationCount >= 10) {
      console.warn('[pillar] Notification rate limit hit — queueing')
      if (this.flowSession.notificationQueue.length < MAX_NOTIFICATION_QUEUE) {
        this.flowSession.notificationQueue.push({ message, metadata })
      } else {
        console.warn('[pillar] Notification queue full — dropping oldest')
        this.flowSession.notificationQueue.shift()
        this.flowSession.notificationQueue.push({ message, metadata })
      }
      return
    }

    if (this.flowSession.currentlyStreaming) {
      console.log('[pillar] Flow is busy — queueing notification')
      if (this.flowSession.notificationQueue.length < MAX_NOTIFICATION_QUEUE) {
        this.flowSession.notificationQueue.push({ message, metadata })
      } else {
        console.warn('[pillar] Notification queue full — dropping oldest')
        this.flowSession.notificationQueue.shift()
        this.flowSession.notificationQueue.push({ message, metadata })
      }
      return
    }

    this.notificationCount++
    this._sendFlowNotification(message, metadata)
  }

  /**
   * Retrieve and clear queued notifications (for non-browser CLI sessions).
   * Called via pillar_notifications MCP tool.
   */
  getNotifications() {
    const notifications = this._pendingNotifications.splice(0)
    return {
      count: notifications.length,
      notifications: notifications.map(n => ({
        message: n.message,
        pillarId: n.pillarId,
        pillar: n.metadata?.pillar || null,
        type: n.metadata?.notificationType || 'unknown',
        timestamp: n.timestamp
      }))
    }
  }

  /**
   * Send a notification to Flow by resuming its CLI session.
   */
  _sendFlowNotification(message, metadata = {}) {
    console.log('[pillar] Sending notification to Flow:', message.slice(0, 100))
    this.flowSession.currentlyStreaming = true

    // Send start event with metadata so frontend can tag the response
    const ws = this.flowSession.wsClient
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'flow_notification_start',
        notificationType: metadata.notificationType || 'unknown',
        pillar: metadata.pillar || null,
        pillarId: metadata.pillarId || null
      }))
    }

    try {
      const { requestId } = this.cliManager.chat(
        {
          prompt: message,
          model: this.flowSession.model,
          sessionId: this.flowSession.cliSessionId,
          cwd: this.flowSession.cwd
        },
        (event) => this._handleFlowNotificationEvent(event)
      )

      this.flowSession.cliRequestId = requestId
    } catch (e) {
      console.error('[pillar] Failed to send Flow notification:', e.message)
      this.flowSession.currentlyStreaming = false
      this.flowSession.cliRequestId = null
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'flow_notification_error', error: e.message }))
      }
    }
  }

  /**
   * Handle events from Flow's notification response.
   */
  _handleFlowNotificationEvent(event) {
    if (!this.flowSession || !this.flowSession.wsClient) return

    const ws = this.flowSession.wsClient

    // Forward stream events to the browser
    if (event.type === 'claude_stream') {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'flow_notification_stream',
          event: event.event
        }))
      }
    } else if (event.type === 'claude_done') {
      this.flowSession.currentlyStreaming = false
      this.flowSession.cliRequestId = null

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'flow_notification_done' }))
      }

      // Check for queued notifications
      if (this.flowSession.notificationQueue.length > 0) {
        console.log('[pillar] Processing queued notifications:', this.flowSession.notificationQueue.length)
        const queued = this.flowSession.notificationQueue.splice(0) // drain queue
        if (queued.length === 1) {
          this._sendFlowNotification(queued[0].message, queued[0].metadata)
        } else {
          const batchedMessage = this._buildBatchedNotification(queued.map(q => q.message))
          this._sendFlowNotification(batchedMessage, { notificationType: 'batched' })
        }
      }
    } else if (event.type === 'claude_error') {
      console.error('[pillar] Flow notification error:', event.error)
      this.flowSession.currentlyStreaming = false
      this.flowSession.cliRequestId = null

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'flow_notification_error', error: event.error }))
      }
    }
  }

  /**
   * Build a notification message for Flow.
   */
  _buildNotificationMessage(type, pillarSession, extraData = {}) {
    if (type === 'completion') {
      const outputSummary = pillarSession.output.length > 0
        ? pillarSession.output[pillarSession.output.length - 1].slice(0, 2000)
        : '(no output)'

      return `[PILLAR CALLBACK] ${this._capitalize(pillarSession.pillar)} (pillarId: ${pillarSession.pillarId}) has completed.

## Output Summary
${outputSummary}

## Full Output Available
Call pillar_read_output with pillarId "${pillarSession.pillarId}" and since "all" for the complete output.

React to this result — integrate findings, update the plan, or proceed to the next step.`
    } else if (type === 'adam_cc') {
      const messageSummary = (extraData.userMessage || '').slice(0, 500)
      return `[PILLAR CC] Adam sent a message to ${this._capitalize(pillarSession.pillar)} (pillarId: ${pillarSession.pillarId}):

"${messageSummary}"

This is informational — Adam is communicating directly with the pillar. Decide whether you need to act on this or just be aware.`
    }
    console.warn(`[pillar] Unknown notification type: ${type}`)
    return `[PILLAR NOTIFICATION] Unknown notification type: ${type}`
  }

  /**
   * Build a batched notification from multiple queued messages.
   */
  _buildBatchedNotification(messages) {
    if (messages.length === 1) return messages[0]

    let batched = '[PILLAR CALLBACKS — BATCHED]\n\n'
    messages.forEach((msg, i) => {
      batched += `${i + 1}. ${msg}\n\n`
    })
    batched += 'React to these in order of priority.'
    return batched
  }

  /**
   * Clean up terminal pillar sessions (stopped/error) older than 5 minutes.
   * Prevents unbounded growth of the pillars Map.
   */
  _cleanupTerminalSessions() {
    const cutoff = Date.now() - 5 * 60 * 1000
    for (const [id, session] of this.pillars) {
      if ((session.status === 'stopped' || session.status === 'error') && session.startTime < cutoff) {
        this.pillars.delete(id)
      }
    }
  }

  /**
   * Clean up all pillar sessions on shutdown.
   */
  shutdown() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }
    // Flow notifications always use Claude
    if (this.flowSession?.cliRequestId) {
      this.cliManager.stop(this.flowSession.cliRequestId)
    }
    this.flowSession = null

    for (const [, session] of this.pillars) {
      if (session.cliRequestId) {
        const manager = this.backends[session.backend] || this.backends.claude
        manager.stop(session.cliRequestId)
      }
      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer)
      }
    }
    this.pillars.clear()
  }

  /**
   * Add or update a work unit in a plan document.
   * Reads the plan file, finds/creates the Work Units section,
   * and inserts or updates the work unit spec.
   */
  async decompose({ planFile, unitId, feature, status, dependsOn, files, scope, acceptance, result }) {
    const planPath = join(this.projectRoot, '.paloma', 'plans', planFile)
    let content = await this._readFileSafe(planPath)
    if (!content) {
      return { error: `Plan file not found: ${planFile}` }
    }

    // Validate status transitions
    const validStatuses = ['pending', 'in_progress', 'completed', 'failed', 'skipped']
    const resolvedStatus = status || 'pending'
    if (!validStatuses.includes(resolvedStatus)) {
      return { error: `Invalid status: ${resolvedStatus}. Must be one of: ${validStatuses.join(', ')}` }
    }

    // Build the work unit markdown block
    const lines = [`#### ${unitId}: ${scope.split('.')[0].split('\n')[0].slice(0, 80)}`]
    if (feature) lines.push(`- **Feature:** ${feature}`)
    lines.push(`- **Status:** ${resolvedStatus}`)
    if (dependsOn?.length) lines.push(`- **Depends on:** ${dependsOn.join(', ')}`)
    if (files?.length) lines.push(`- **Files:** ${files.join(', ')}`)
    lines.push(`- **Scope:** ${scope}`)
    if (acceptance) lines.push(`- **Acceptance:** ${acceptance}`)
    if (result) lines.push(`- **Result:** ${result}`)
    const unitBlock = lines.join('\n')

    // Find existing work unit by ID
    const unitPattern = new RegExp(`#### ${unitId}:.*?(?=\\n#### |\\n## |$)`, 's')
    const existingMatch = content.match(unitPattern)

    if (existingMatch) {
      // Update existing work unit
      content = content.replace(unitPattern, unitBlock)
    } else {
      // Insert new work unit — find or create ## Work Units section
      const workUnitsHeader = '## Work Units'
      if (content.includes(workUnitsHeader)) {
        // Append after the header and any existing units
        const headerIdx = content.indexOf(workUnitsHeader)
        // Find the next ## section after Work Units
        const nextSectionMatch = content.slice(headerIdx + workUnitsHeader.length).match(/\n## /)
        if (nextSectionMatch) {
          const insertIdx = headerIdx + workUnitsHeader.length + nextSectionMatch.index
          content = content.slice(0, insertIdx) + '\n\n' + unitBlock + '\n' + content.slice(insertIdx)
        } else {
          // No section after — append at the end
          content = content.trimEnd() + '\n\n' + unitBlock + '\n'
        }
      } else {
        // No Work Units section — create one before the last ---
        const lastDivider = content.lastIndexOf('\n---')
        if (lastDivider !== -1) {
          content = content.slice(0, lastDivider) + '\n\n' + workUnitsHeader + '\n\n' + unitBlock + '\n' + content.slice(lastDivider)
        } else {
          content = content.trimEnd() + '\n\n' + workUnitsHeader + '\n\n' + unitBlock + '\n'
        }
      }
    }

    // Write back
    const { writeFile: fsWriteFile } = await import('fs/promises')
    await fsWriteFile(planPath, content, 'utf-8')

    return {
      unitId,
      status: resolvedStatus,
      action: existingMatch ? 'updated' : 'created',
      planFile,
      message: `Work unit ${unitId} ${existingMatch ? 'updated' : 'created'} in ${planFile}`
    }
  }

  /**
   * Analyze a plan's work units and return orchestration recommendations.
   * Parses all WUs, checks dependencies, determines ready units,
   * and suggests what to dispatch next (with parallelism analysis).
   */
  async orchestrate({ planFile }) {
    const planPath = join(this.projectRoot, '.paloma', 'plans', planFile)
    const content = await this._readFileSafe(planPath)
    if (!content) {
      return { error: `Plan file not found: ${planFile}` }
    }

    // Parse work units from the plan
    const units = this._parseWorkUnits(content)
    if (units.length === 0) {
      return { error: 'No work units found in plan. Use pillar_decompose to create them.' }
    }

    // Build status maps
    const statusMap = new Map(units.map(u => [u.unitId, u.status]))
    const completed = units.filter(u => u.status === 'completed')
    const inProgress = units.filter(u => u.status === 'in_progress')
    const failed = units.filter(u => u.status === 'failed')
    const pending = units.filter(u => u.status === 'pending')

    // Determine ready units (all dependencies completed)
    const ready = []
    const blocked = []
    for (const unit of pending) {
      const deps = unit.dependsOn || []
      const unmetDeps = deps.filter(d => statusMap.get(d) !== 'completed')
      if (unmetDeps.length === 0) {
        ready.push(unit)
      } else {
        blocked.push({ ...unit, blockedBy: unmetDeps })
      }
    }

    // Analyze file-disjointness for parallelism
    let parallelRecommendation = null
    if (ready.length >= 2) {
      // Check pairs of ready units for file overlap
      const disjointPairs = []
      for (let i = 0; i < ready.length; i++) {
        for (let j = i + 1; j < ready.length; j++) {
          const filesA = new Set(ready[i].files || [])
          const filesB = new Set(ready[j].files || [])
          const overlap = [...filesA].filter(f => filesB.has(f))
          if (overlap.length === 0) {
            disjointPairs.push([ready[i].unitId, ready[j].unitId])
          }
        }
      }
      if (disjointPairs.length > 0) {
        parallelRecommendation = {
          canParallelize: true,
          pairs: disjointPairs.slice(0, 3), // top 3 pairs
          recommendation: `Can dispatch ${disjointPairs[0].join(' + ')} in parallel (file-disjoint).`
        }
      }
    }

    // Check for currently running pillars that might conflict
    const runningPillars = []
    for (const [, session] of this.pillars) {
      if (session.status === 'running' || session.currentlyStreaming) {
        runningPillars.push({
          pillarId: session.pillarId,
          pillar: session.pillar,
          status: session.status
        })
      }
    }

    return {
      planFile,
      summary: {
        total: units.length,
        completed: completed.length,
        inProgress: inProgress.length,
        failed: failed.length,
        pending: pending.length,
        ready: ready.length,
        blocked: blocked.length
      },
      ready: ready.map(u => ({ unitId: u.unitId, scope: u.scope, files: u.files, feature: u.feature })),
      blocked: blocked.map(u => ({ unitId: u.unitId, scope: u.scope, blockedBy: u.blockedBy })),
      inProgress: inProgress.map(u => ({ unitId: u.unitId, scope: u.scope })),
      failed: failed.map(u => ({ unitId: u.unitId, scope: u.scope })),
      parallelRecommendation,
      runningPillars,
      recommendation: ready.length > 0
        ? `${ready.length} unit(s) ready to dispatch: ${ready.map(u => u.unitId).join(', ')}`
        : inProgress.length > 0
          ? `Waiting: ${inProgress.length} unit(s) in progress`
          : failed.length > 0
            ? `Blocked: ${failed.length} unit(s) failed — needs manual intervention`
            : 'All work units completed!'
    }
  }

  /**
   * Parse work units from plan content.
   * Expects #### WU-N: Title format with bullet-point metadata.
   */
  _parseWorkUnits(content) {
    const units = []
    // Match #### WU-N: Title blocks
    const unitRegex = /#### (WU-\d+):.*?\n([\s\S]*?)(?=\n#### |\n## |$)/g
    let match
    while ((match = unitRegex.exec(content)) !== null) {
      const unitId = match[1]
      const body = match[2]

      const unit = { unitId }
      const statusMatch = body.match(/\*\*Status:\*\*\s*(.+)/)
      unit.status = statusMatch ? statusMatch[1].trim() : 'pending'
      const featureMatch = body.match(/\*\*Feature:\*\*\s*(.+)/)
      unit.feature = featureMatch ? featureMatch[1].trim() : null
      const depsMatch = body.match(/\*\*Depends on:\*\*\s*(.+)/)
      unit.dependsOn = depsMatch ? depsMatch[1].split(',').map(d => d.trim()) : []
      const filesMatch = body.match(/\*\*Files:\*\*\s*(.+)/)
      unit.files = filesMatch ? filesMatch[1].split(',').map(f => f.trim()) : []
      const scopeMatch = body.match(/\*\*Scope:\*\*\s*(.+)/)
      unit.scope = scopeMatch ? scopeMatch[1].trim() : ''
      const acceptMatch = body.match(/\*\*Acceptance:\*\*\s*(.+)/)
      unit.acceptance = acceptMatch ? acceptMatch[1].trim() : null
      const resultMatch = body.match(/\*\*Result:\*\*\s*(.+)/)
      unit.result = resultMatch ? resultMatch[1].trim() : null

      units.push(unit)
    }
    return units
  }

  // --- Internal methods ---

  _startCliTurn(session, prompt, systemPrompt, isResume = false) {
    session.outputChunks = []
    session._cachedOutput = ''
    const manager = this.backends[session.backend] || this.backends.claude

    const chatOptions = {
      prompt,
      model: session.model,
      systemPrompt: isResume ? undefined : systemPrompt,
      cwd: this.projectRoot
    }

    // For Ollama, pass tools so the model can call them
    // Brain (depth 0 + recursive) gets NO tools — it delegates via <delegate> tags
    const isSingularityBrain = session.recursive && (session.depth || 0) === 0
    if (session.backend === 'ollama' && this.mcpManager && !isSingularityBrain) {
      chatOptions.tools = this._buildOllamaTools(session)
    }

    if (isResume) {
      // Resume: use --resume with existing CLI session ID
      chatOptions.sessionId = session.cliSessionId
    }
    // New session: don't pass sessionId — CLI manager generates one
    // and we capture it from the return value

    const { requestId, sessionId: returnedSessionId } = manager.chat(
      chatOptions,
      (event) => this._handleCliEvent(session, event)
    )

    session.cliRequestId = requestId
    // Capture the CLI-generated session ID for future resume calls
    if (!isResume && returnedSessionId) {
      session.cliSessionId = returnedSessionId
    }
  }

  _handleCliEvent(session, event) {
    // Ollama tool calls — execute tools and continue conversation
    if (event.type === 'ollama_tool_call') {
      this._handleOllamaToolCall(session, event)
      return
    }

    const isStream = event.type === 'claude_stream' || event.type === 'codex_stream' || event.type === 'copilot_stream' || event.type === 'ollama_stream'
    const isDone = event.type === 'claude_done' || event.type === 'codex_done' || event.type === 'copilot_done' || event.type === 'ollama_done'
    const isError = event.type === 'claude_error' || event.type === 'codex_error' || event.type === 'copilot_error' || event.type === 'ollama_error'

    if (isStream) {
      const cliEvent = event.event

      // Stream events to browser for live rendering
      this.broadcast({
        type: 'pillar_stream',
        pillarId: session.pillarId,
        backend: session.backend,
        event: cliEvent
      })

      // Accumulate text content — backend-specific extraction
      if (session.backend === 'codex' || session.backend === 'copilot') {
        if (cliEvent.type === 'agent_message' && cliEvent.text) {
          this._appendOutput(session, cliEvent.text)
        }
      } else {
        // Claude text extraction
        if (cliEvent.type === 'assistant' && cliEvent.message?.content) {
          for (const block of cliEvent.message.content) {
            if (block.type === 'text' && block.text) {
              this._appendOutput(session, block.text)
            }
          }
        } else if (cliEvent.type === 'content_block_delta') {
          if (cliEvent.delta?.type === 'text_delta' && cliEvent.delta.text) {
            this._appendOutput(session, cliEvent.delta.text)
          }
        }
      }

      session.lastActivity = new Date().toISOString()
    } else if (isDone) {
      // Update session ID from CLI response (important for Codex where
      // thread ID is only available after the async thread.started event)
      if (event.sessionId) {
        session.cliSessionId = event.sessionId
      }
      session.currentlyStreaming = false
      session.cliRequestId = null
      session.lastActivity = new Date().toISOString()

      // Layer 2: Fast-fail retry — if session died quickly with no output, try fallback
      const isStartupFailure = event.exitCode !== 0
        && (Date.now() - session.startTime) < 15000
        && session.output.length === 0
        && session.outputChunks.length === 0
        && !session._fallbackAttempted
        && this.health
      if (isStartupFailure) {
        const reason = `exit code ${event.exitCode} within ${Math.round((Date.now() - session.startTime) / 1000)}s`
        this.health.markUnhealthy(session.backend, reason)
        const fallback = this.health.getFallback(session.backend)
        if (fallback) {
          console.warn(`[pillar] Fast-fail: ${session.backend} startup failed (${reason}) — retrying on ${fallback}`)
          this._attemptFallback(session, session.backend, fallback)
          return
        }
      }

      // Save completed output
      const completedOutput = this._flushOutput(session)
      if (completedOutput) {
        session.output.push(completedOutput)
      }

      // Notify browser
      this.broadcast({
        type: 'pillar_message_saved',
        pillarId: session.pillarId,
        role: 'assistant',
        content: completedOutput
      })

      // SINGULARITY: Check for <delegate> tags in Brain output
      const isSingularityBrain = session.recursive && (session.depth || 0) === 0 && session.backend === 'ollama'
      if (isSingularityBrain && completedOutput) {
        const delegations = this._extractDelegations(completedOutput)
        if (delegations.length > 0) {
          console.log(`[singularity] Brain delegated ${delegations.length} task(s)`)
          this._handleSingularityDelegations(session, delegations).catch(err => {
            console.error(`[singularity] Delegation failed:`, err)
            session._waitingForHands = false
            session.status = 'idle'
            session.currentlyStreaming = false
            this.broadcast({
              type: 'pillar_done',
              pillarId: session.pillarId,
              status: 'idle',
              pillar: session.pillar,
              error: `Singularity delegation failed: ${err.message}`
            })
          })
          return // Don't complete — waiting for Hands
        }
      }

      // Check for queued messages
      if (session.messageQueue.length > 0) {
        const nextMessage = session.messageQueue.shift()
        session.turnCount++
        session.status = 'running'
        session.currentlyStreaming = true

        // Notify browser about the queued user message
        this.broadcast({
          type: 'pillar_message_saved',
          pillarId: session.pillarId,
          role: 'user',
          content: nextMessage
        })

        this._startCliTurn(session, nextMessage, null, true)
      } else {
        session.status = 'idle'
        this.broadcast({
          type: 'pillar_done',
          pillarId: session.pillarId,
          status: 'idle',
          pillar: session.pillar
        })

        // Resolve parent's pending child completion (for recursive Ollama spawning)
        if (this._pendingChildCompletions.has(session.pillarId)) {
          const resolve = this._pendingChildCompletions.get(session.pillarId)
          this._pendingChildCompletions.delete(session.pillarId)
          const allOutput = session.output.join('\n\n')
          resolve(allOutput)
          console.log(`[pillar] Resolved child completion for parent — ${session.pillar} (${session.pillarId.slice(0, 8)})`)
        }

        // Auto-notify Flow about pillar completion (skip if parent handles it)
        if (!session.parentPillarId) {
          console.log(`[pillar] Auto-notifying Flow: ${session.pillar} completed`)
          const notification = this._buildNotificationMessage('completion', session)
          this.notifyFlow(notification, session.pillarId, {
            notificationType: 'completion',
            pillar: session.pillar,
            pillarId: session.pillarId
          })
        } else {
          console.log(`[pillar] ${session.pillar} completed — parent ${session.parentPillarId.slice(0, 8)} will handle`)
        }
      }
    } else if (isError) {
      session.currentlyStreaming = false
      session.cliRequestId = null
      session.lastActivity = new Date().toISOString()

      // Layer 2: Fast-fail retry on error events too
      const isStartupError = (Date.now() - session.startTime) < 15000
        && session.output.length === 0
        && session.outputChunks.length === 0
        && !session._fallbackAttempted
        && this.health
      if (isStartupError) {
        const reason = event.error || 'process error at startup'
        this.health.markUnhealthy(session.backend, reason)
        const fallback = this.health.getFallback(session.backend)
        if (fallback) {
          console.warn(`[pillar] Fast-fail: ${session.backend} error at startup (${reason}) — retrying on ${fallback}`)
          this._attemptFallback(session, session.backend, fallback)
          return
        }
      }

      session.status = 'error'

      const errorOutput = this._flushOutput(session)
      if (errorOutput) {
        session.output.push(errorOutput)
      }

      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer)
        session.timeoutTimer = null
      }

      this.broadcast({
        type: 'pillar_done',
        pillarId: session.pillarId,
        status: 'error',
        pillar: session.pillar,
        error: event.error
      })

      // Resolve parent's pending child completion on error
      if (this._pendingChildCompletions.has(session.pillarId)) {
        const resolve = this._pendingChildCompletions.get(session.pillarId)
        this._pendingChildCompletions.delete(session.pillarId)
        const allOutput = session.output.join('\n\n') || `Error: ${event.error}`
        resolve(allOutput)
      }

      // Auto-notify Flow about pillar error (skip if parent handles it)
      if (!session.parentPillarId) {
        console.log(`[pillar] Auto-notifying Flow: ${session.pillar} errored`)
        const notification = this._buildNotificationMessage('completion', session)
        this.notifyFlow(notification, session.pillarId, {
          notificationType: 'completion',
          pillar: session.pillar,
          pillarId: session.pillarId
        })
      }
    }
  }

  /**
   * Attempt to retry a failed session on a different backend.
   * Rebuilds the system prompt for the new backend and restarts the CLI turn.
   */
  async _attemptFallback(session, originalBackend, fallbackBackend) {
    session._fallbackAttempted = true
    session.backend = fallbackBackend
    session.model = this._defaultModel(session.pillar, fallbackBackend, { recursive: session.recursive, depth: session.depth })
    session.currentlyStreaming = true
    session.status = 'running'
    session.outputChunks = []
    session._cachedOutput = ''
    session.startTime = Date.now() // reset so the fallback gets its own 15s window

    // Broadcast fallback event
    this.broadcast({
      type: 'pillar_fallback',
      pillarId: session.pillarId,
      from: originalBackend,
      to: fallbackBackend,
      reason: this.health.status[originalBackend]?.reason || 'startup failure'
    })

    // Rebuild system prompt for the new backend (Ollama uses condensed prompt)
    const systemPrompt = await this._buildSystemPrompt(session.pillar, {
      planFilter: session._planFile,
      recursive: session.recursive,
      depth: session.depth,
      backend: fallbackBackend
    })

    console.log(`[pillar] Fallback: restarting ${session.pillar} on ${fallbackBackend} (was ${originalBackend})`)
    this._startCliTurn(session, session._originalPrompt, systemPrompt)
  }

  _timeout(pillarId) {
    const session = this.pillars.get(pillarId)
    if (!session || session.status === 'stopped' || session.status === 'completed') return

    console.warn(`[pillar] ${session.pillar} session ${pillarId} timed out after ${MAX_RUNTIME_MS / 60000} minutes`)
    this.stop({ pillarId })
  }

  _defaultModel(pillar, backend = 'claude', { recursive, depth } = {}) {
    if (backend === 'ollama') {
      // Recursive children use the small fast model — big brain delegates, small hands act
      if (recursive && depth > 0) return 'qwen2.5-coder:7b'
      return 'qwen3-coder:30b'
    }
    if (backend === 'codex') return 'gpt-5.1-codex-max'
    if (backend === 'copilot') return 'claude-sonnet-4.6'
    // PHASE_MODEL_SUGGESTIONS values are like 'claude-cli:opus' — extract just the model name
    const suggestion = PHASE_MODEL_SUGGESTIONS[pillar] || 'claude-cli:sonnet'
    return suggestion.split(':')[1] || 'sonnet'
  }

  /** Get the current turn's accumulated output text efficiently. */
  _getCurrentOutput(session) {
    if (session.outputChunks.length === 0) return ''
    // Cache the joined result to avoid repeated joins
    session._cachedOutput = session.outputChunks.join('')
    return session._cachedOutput
  }

  /** Append text to the current turn's output. */
  _appendOutput(session, text) {
    session.outputChunks.push(text)
    session._cachedOutput = '' // invalidate cache
  }

  /** Clear the current turn's output and return what was accumulated. */
  _flushOutput(session) {
    const text = this._getCurrentOutput(session)
    session.outputChunks = []
    session._cachedOutput = ''
    return text
  }

  _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Build the system prompt for a pillar session by reading .paloma/ files from disk.
   * Mirrors the frontend's buildSystemPrompt() but uses fs instead of MCP/browser APIs.
   */
  async _buildSystemPrompt(pillar, { planFilter, recursive, depth, backend } = {}) {
    // Ollama sessions use the condensed prompt (fits smaller context windows)
    let prompt = backend === 'ollama' ? OLLAMA_INSTRUCTIONS : BASE_INSTRUCTIONS

    // Read project instructions
    const instructionsPath = join(this.projectRoot, '.paloma', 'instructions.md')
    const instructions = await this._readFileSafe(instructionsPath)
    if (instructions) {
      prompt += '\n\n## Project Instructions\n\n' + instructions
    }

    // Read active plans
    const plansDir = join(this.projectRoot, '.paloma', 'plans')
    let plans = await this._readActiveFiles(plansDir, 'active-')
    if (planFilter) {
      plans = plans.filter(p => p.name === planFilter)
    }
    if (plans.length > 0) {
      prompt += '\n\n## Active Plans\n\n'
      prompt += plans.map(p => `<plan name="${p.name}">\n${p.content}\n</plan>`).join('\n\n')
    }

    // Read roots
    const rootsDir = join(this.projectRoot, '.paloma', 'roots')
    const roots = await this._readActiveFiles(rootsDir, 'root-')
    if (roots.length > 0) {
      prompt += '\n\n## Roots\n\n'
      prompt += 'These are Paloma\'s foundational values. They inform all decisions and interactions.\n\n'
      prompt += roots.map(r => {
        const name = r.name.replace(/^root-/, '').replace(/\.md$/, '')
        return `<root name="${name}">\n${r.content}\n</root>`
      }).join('\n\n')
    }

    // Add phase instructions
    const activePillar = pillar || 'flow'
    prompt += '\n\n## Current Pillar: ' + this._capitalize(activePillar) + '\n\n'
    prompt += PHASE_INSTRUCTIONS[activePillar] || PHASE_INSTRUCTIONS.flow

    // Inject singularity prompts in recursive/singularity mode
    if (recursive) {
      if (depth === 0) {
        // Brain instance — the thinker (no tools, delegates via <delegate> tags)
        prompt += '\n\n' + SINGULARITY_BRAIN_PROMPT
      } else {
        // Hands instance — the executor (has tools, receives tasks from Brain)
        prompt += '\n\n' + SINGULARITY_HANDS_PROMPT
      }
    }

    return prompt
  }

  async _readFileSafe(path) {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      return null
    }
  }

  async _readActiveFiles(dir, prefix) {
    try {
      const entries = await readdir(dir)
      const files = entries
        .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
        .sort()
      const results = []
      for (const file of files) {
        const content = await this._readFileSafe(join(dir, file))
        if (content) {
          results.push({ name: file, content })
        }
      }
      return results
    } catch {
      return []
    }
  }
}
