import { randomUUID } from 'crypto'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { BASE_INSTRUCTIONS, OLLAMA_INSTRUCTIONS, QWEN_RECURSIVE_INSTRUCTIONS } from '../src/prompts/base.js'
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
  constructor(backends, { projectRoot, broadcast, mcpManager }) {
    this.backends = backends   // { claude: ClaudeCliManager, codex: CodexCliManager, copilot: CopilotCliManager, ollama: OllamaManager }
    this.cliManager = backends.claude // backward compat for Flow notifications
    this.projectRoot = projectRoot
    this.broadcast = broadcast // (msg) => void — send to all WS clients
    this.mcpManager = mcpManager || null // for Ollama tool execution
    this.pillars = new Map()   // pillarId → PillarSession
    this.flowSessions = new Map()  // cliSessionId → { cliSessionId, wsClient, currentlyStreaming, notificationQueue, model, cwd }
    this.flowSession = null          // points to the most recently registered Flow session (backward compat)
    this.notificationCooldown = new Map() // pillarId → timestamp of last notification
    this.notificationCount = 0 // notifications sent in current minute
    this.notificationWindowStart = Date.now()
    this._pendingChildCompletions = new Map() // childPillarId → resolve function
    this._spawnQueue = [] // FIFO queue for Ollama spawns when at concurrency limit

    // Periodic cleanup of terminal sessions (every 5 min)
    this._cleanupInterval = setInterval(() => this._cleanupTerminalSessions(), 5 * 60 * 1000)
  }

  /**
   * Spawn a new pillar CLI session.
   * Returns immediately with pillarId and metadata.
   */
  async spawn({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, recursive, depth }) {
    const pillarId = randomUUID()
    const resolvedBackend = backend || 'claude'

    // Check Ollama concurrency — queue if at limit
    if (resolvedBackend === 'ollama') {
      const activeOllama = this._countActiveOllamaSessions()
      if (activeOllama >= MAX_CONCURRENT_OLLAMA) {
        return this._enqueueSpawn(pillarId, { pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId, recursive, depth })
      }
    }

    return this._executeSpawn(pillarId, { pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId, recursive, depth })
  }

  /**
   * Queue an Ollama spawn when concurrency limit is reached.
   * Creates a placeholder session with status 'queued' and returns immediately.
   */
  _enqueueSpawn(pillarId, params) {
    const resolvedModel = params.model || this._defaultModel(params.pillar, params.backend, { recursive: params.recursive, depth: params.depth })

    // Create queued session record so it shows in list/status
    const session = {
      pillarId,
      cliSessionId: null,
      pillar: params.pillar,
      model: resolvedModel,
      backend: params.backend,
      status: 'queued',
      currentlyStreaming: false,
      turnCount: 0,
      lastActivity: new Date().toISOString(),
      flowRequestId: params.flowRequestId,
      cliRequestId: null,
      output: [],
      outputChunks: [],
      _cachedOutput: '',
      messageQueue: [],
      startTime: Date.now(),
      timeoutTimer: null,
      dbSessionId: null,
      parentPillarId: params.parentPillarId || null,
      recursive: params.recursive || false,
      depth: params.depth || 0,
      _toolRounds: 0
    }
    this.pillars.set(pillarId, session)

    // Add to FIFO queue
    this._spawnQueue.push({ pillarId, params, enqueuedAt: Date.now() })
    const queuePosition = this._spawnQueue.length

    console.log(`[pillar] Ollama ${params.pillar} session ${pillarId.slice(0, 8)} queued — ${this._countActiveOllamaSessions()}/${MAX_CONCURRENT_OLLAMA} active, position ${queuePosition}`)

    // Notify browser
    this.broadcast({
      type: 'pillar_queued',
      pillarId,
      pillar: params.pillar,
      backend: params.backend,
      queuePosition
    })

    return {
      pillarId,
      pillar: params.pillar,
      status: 'queued',
      queuePosition,
      message: `${this._capitalize(params.pillar)} session queued — Ollama concurrency limit (${MAX_CONCURRENT_OLLAMA}) reached. Queue position: ${queuePosition}`
    }
  }

  /**
   * Execute a spawn immediately — creates/upgrades session, starts CLI, sets timeout.
   * Called for both immediate spawns and when dequeuing.
   */
  async _executeSpawn(pillarId, params) {
    const { pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, recursive, depth } = params
    const cliSessionId = randomUUID()

    // Resolve model: use provided, or phase suggestion, or default
    // Recursive children automatically get the small fast model (7B)
    const resolvedModel = model || this._defaultModel(pillar, backend, { recursive, depth })

    // Build system prompt from disk (Ollama gets condensed prompt)
    const systemPrompt = await this._buildSystemPrompt(pillar, { planFilter: planFile, recursive, depth, backend })

    // Compose the full first message with birth protocol
    const fullPrompt = `${BIRTH_MESSAGE}\n\n${prompt}`

    // Check if session already exists (queued → executing)
    let session = this.pillars.get(pillarId)
    if (session && session.status === 'queued') {
      // Upgrade queued session to running
      session.cliSessionId = cliSessionId
      session.model = resolvedModel
      session.status = 'running'
      session.currentlyStreaming = true
      session.turnCount = 1
      session.lastActivity = new Date().toISOString()
    } else {
      // Create new session record
      session = {
        pillarId,
        cliSessionId,
        pillar,
        model: resolvedModel,
        backend,
        status: 'running',       // running | idle | completed | error | stopped | queued
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
        _toolRounds: 0           // Ollama tool call round counter
      }
      this.pillars.set(pillarId, session)
    }

    // Notify browser to create the session in IndexedDB
    const modelLabel = backend === 'ollama' ? `ollama:${resolvedModel}` : backend === 'codex' ? `codex:${resolvedModel}` : backend === 'copilot' ? `copilot:${resolvedModel}` : `claude-cli:${resolvedModel}`
    this.broadcast({
      type: 'pillar_session_created',
      pillarId,
      pillar,
      model: modelLabel,
      backend,
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

    if (session.status === 'stopped' || session.status === 'error' || session.status === 'queued') {
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

    const result = {
      pillarId,
      pillar: session.pillar,
      status: session.status,
      dbSessionId: session.dbSessionId,
      turnCount: session.turnCount,
      currentlyStreaming: session.currentlyStreaming,
      lastActivity: session.lastActivity
    }

    if (session.status === 'queued') {
      const queueIdx = this._spawnQueue.findIndex(e => e.pillarId === pillarId)
      result.queuePosition = queueIdx >= 0 ? queueIdx + 1 : null
    }

    return result
  }

  /**
   * List all active pillar sessions.
   */
  list() {
    const pillars = []
    for (const [, session] of this.pillars) {
      const entry = {
        pillarId: session.pillarId,
        pillar: session.pillar,
        status: session.status,
        dbSessionId: session.dbSessionId,
        turnCount: session.turnCount,
        currentlyStreaming: session.currentlyStreaming,
        lastActivity: session.lastActivity
      }
      if (session.status === 'queued') {
        const queueIdx = this._spawnQueue.findIndex(e => e.pillarId === session.pillarId)
        entry.queuePosition = queueIdx >= 0 ? queueIdx + 1 : null
      }
      pillars.push(entry)
    }
    return {
      pillars,
      ollamaQueue: {
        length: this._spawnQueue.length,
        active: this._countActiveOllamaSessions(),
        max: MAX_CONCURRENT_OLLAMA
      }
    }
  }

  /**
   * Stop a running pillar session.
   */
  stop({ pillarId }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'not_found', message: `No pillar session found with id ${pillarId}` }
    }

    // If session is queued, remove from queue and mark stopped
    if (session.status === 'queued') {
      this._spawnQueue = this._spawnQueue.filter(e => e.pillarId !== pillarId)
      session.status = 'stopped'
      session.lastActivity = new Date().toISOString()
      this.broadcast({ type: 'pillar_done', pillarId, status: 'stopped', pillar: session.pillar })
      return { pillarId, status: 'stopped', message: `${this._capitalize(session.pillar)} session removed from queue.` }
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

    const wasOllama = session.backend === 'ollama'

    session.status = 'stopped'
    session.currentlyStreaming = false
    session.lastActivity = new Date().toISOString()
    session.messageQueue = [] // clear queued messages to prevent memory leak

    // Finalize any current output
    const stoppedOutput = this._flushOutput(session)
    if (stoppedOutput) {
      session.output.push(stoppedOutput)
    }

    // Resolve any parent waiting for this child's completion
    const pendingResolve = this._pendingChildCompletions.get(pillarId)
    if (pendingResolve) {
      this._pendingChildCompletions.delete(pillarId)
      const finalOutput = session.output.map(o => o.text || o).join('\n')
      pendingResolve(finalOutput || `(child ${pillarId.slice(0, 8)} was stopped)`)
    }

    this.broadcast({
      type: 'pillar_done',
      pillarId,
      status: 'stopped',
      pillar: session.pillar
    })

    // Dequeue waiting spawns if an Ollama slot freed up
    if (wasOllama) {
      this._dequeueOllamaSpawns().catch(e => console.error('[pillar] Dequeue error after stop:', e.message))
    }

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

    const descendants = this._getDescendants(pillarId)

    // Remove any queued descendants from spawn queue
    const treeIds = new Set([pillarId, ...descendants])
    this._spawnQueue = this._spawnQueue.filter(e => !treeIds.has(e.pillarId))

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

    // Dequeue waiting spawns since slots may have freed up
    this._dequeueOllamaSpawns().catch(e => console.error('[pillar] Dequeue error after stopTree:', e.message))

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
   * Excludes parents blocked waiting for child completions to prevent deadlock.
   */
  _countActiveOllamaSessions() {
    // Find parents currently blocked waiting for child completions —
    // these hold no Ollama inference slot and shouldn't count toward the limit.
    // This prevents deadlock: parent P waiting for child C shouldn't block C's slot.
    const waitingParents = new Set()
    for (const [childId] of this._pendingChildCompletions) {
      const childSession = this.pillars.get(childId)
      if (childSession?.parentPillarId) {
        waitingParents.add(childSession.parentPillarId)
      }
    }

    let count = 0
    for (const [, session] of this.pillars) {
      if (session.backend === 'ollama' && (session.status === 'running' || session.currentlyStreaming)) {
        if (waitingParents.has(session.pillarId)) continue
        count++
      }
    }
    return count
  }

  /**
   * Dequeue waiting Ollama spawns when slots become available.
   * Called after session completion, stop, error, or when a parent starts waiting for a child.
   */
  async _dequeueOllamaSpawns() {
    while (this._spawnQueue.length > 0) {
      const active = this._countActiveOllamaSessions()
      if (active >= MAX_CONCURRENT_OLLAMA) break

      const entry = this._spawnQueue.shift()
      console.log(`[pillar] Dequeuing ${entry.params.pillar} session ${entry.pillarId.slice(0, 8)} \u2014 ${active}/${MAX_CONCURRENT_OLLAMA} active`)

      // Notify browser
      this.broadcast({
        type: 'pillar_dequeued',
        pillarId: entry.pillarId,
        pillar: entry.params.pillar
      })

      try {
        await this._executeSpawn(entry.pillarId, entry.params)
      } catch (e) {
        console.error(`[pillar] Failed to execute dequeued spawn ${entry.pillarId}:`, e.message)
        const session = this.pillars.get(entry.pillarId)
        if (session) {
          session.status = 'error'
          session.lastActivity = new Date().toISOString()
        }
      }
    }
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

          console.log(`[pillar] ${session.pillar} spawned child ${childPillarId.slice(0, 8)} — ${spawnResult.status === 'queued' ? 'queued' : 'running'}`)

          // Wait for child to complete (resolved in _handleCliEvent), with timeout
          const CHILD_TIMEOUT_MS = 35 * 60 * 1000 // 35 minutes (slightly longer than session MAX_RUNTIME_MS)
          const childOutput = await new Promise((resolve, reject) => {
            let settled = false
            const timer = setTimeout(() => {
              if (settled) return
              settled = true
              this._pendingChildCompletions.delete(childPillarId)
              reject(new Error(`Child ${childPillarId.slice(0, 8)} timed out after 35 minutes`))
            }, CHILD_TIMEOUT_MS)
            this._pendingChildCompletions.set(childPillarId, (output) => {
              if (settled) return
              settled = true
              clearTimeout(timer)
              resolve(output)
            })
            // If child was queued, parent is now "waiting" — trigger dequeue.
            // _countActiveOllamaSessions() will exclude this parent (it's in
            // _pendingChildCompletions), freeing a slot for the child.
            if (spawnResult.status === 'queued') {
              this._dequeueOllamaSpawns().catch(e =>
                console.error('[pillar] Dequeue error after parent wait:', e.message))
            }
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
    try {
      manager.continueWithToolResults(
        event.requestId, event.sessionId,
        event.assistantMessage, results,
        (nextEvent) => this._handleCliEvent(session, nextEvent)
      )
    } catch (e) {
      console.error(`[pillar] Failed to continue Ollama conversation for ${session.pillar}:`, e.message)
      session.currentlyStreaming = false
      session.status = 'error'
      this.broadcast({ type: 'pillar_done', pillarId: session.pillarId, status: 'error', pillar: session.pillar })
    }
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
      console.warn('[pillar] No Flow session registered — notification dropped')
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
    // Set cooldown AFTER successful send (not before) so failed sends don't block retries
    if (pillarId) {
      this.notificationCooldown.set(pillarId, Date.now())
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

    // Clear spawn queue
    this._spawnQueue = []

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
    if (session.backend === 'ollama' && this.mcpManager) {
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
          }).catch(e => console.error('[pillar] Failed to notify Flow of completion:', e.message))
        } else {
          console.log(`[pillar] ${session.pillar} completed — parent ${session.parentPillarId.slice(0, 8)} will handle`)
        }

        // Dequeue waiting Ollama spawns if a slot freed up
        if (session.backend === 'ollama') {
          this._dequeueOllamaSpawns().catch(e => console.error('[pillar] Dequeue error after completion:', e.message))
        }
      }
    } else if (isError) {
      session.currentlyStreaming = false
      session.status = 'error'
      session.cliRequestId = null
      session.lastActivity = new Date().toISOString()

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
        }).catch(e => console.error('[pillar] Failed to notify Flow of error:', e.message))
      }

      // Dequeue waiting Ollama spawns if a slot freed up
      if (session.backend === 'ollama') {
        this._dequeueOllamaSpawns().catch(e => console.error('[pillar] Dequeue error after error:', e.message))
      }
    }
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
      return 'qwen2.5-coder:32b'
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

    // Inject recursive Qwen instructions when in recursive mode
    if (recursive) {
      const recursivePrompt = QWEN_RECURSIVE_INSTRUCTIONS
        .replace(/\{\{DEPTH\}\}/g, String(depth || 0))
        .replace(/\{\{MAX_DEPTH\}\}/g, '5')
      prompt += '\n\n' + recursivePrompt
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
