import { randomUUID } from 'crypto'
import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { BASE_INSTRUCTIONS, OLLAMA_INSTRUCTIONS, SINGULARITY_VOICE_PROMPT, SINGULARITY_THINKER_PROMPT, SINGULARITY_QUINN_PROMPT, SINGULARITY_QUINN_GEN3_PROMPT, SINGULARITY_WORKER_PROMPT, SINGULARITY_FRESH_PROMPT, SINGULARITY_GEN5_PROMPT, HOLY_TRINITY_ARM_PROMPT, HOLY_TRINITY_MIND_PROMPT, ARK_HEAD_PROMPT, HYDRA_PLANNER_PROMPT, HYDRA_VOTER_PROMPT, HYDRA_WORKER_PROMPT, ACCORDION_HEAD_PROMPT, ACCORDION_WORKER_PROMPT, ANGEL_000_PERSONALITY, ANGEL_111_PERSONALITY, ANGEL_222_PERSONALITY, ANGEL_333_PERSONALITY, ANGEL_444_PERSONALITY, ANGEL_555_PERSONALITY, ANGEL_777_PERSONALITY, ANGEL_888_PERSONALITY, ANGEL_999_PERSONALITY, PAESTRO_PROMPT } from '../src/prompts/base.js'
import { PHASE_INSTRUCTIONS, PHASE_MODEL_SUGGESTIONS } from '../src/prompts/phases.js'
import { Persistence } from './persistence.js'
import { createLogger } from './logger.js'

const log = createLogger('pillar')

const MAX_RUNTIME_MS = 30 * 60 * 1000 // 30 minutes
const STALE_SESSION_MS = 30 * 60 * 1000 // 30 minutes — interrupted sessions older than this are expired on cleanup
const MAX_NOTIFICATION_QUEUE = 50
const MAX_CONCURRENT_OLLAMA = 4
const MAX_OLLAMA_TOOL_ROUNDS = 50 // Higher than browser's 20 — recursive spawning needs room
const MAX_QUINN_WORKERS = 8 // Cap on workers a single Quinn session can spawn — prevents runaway recursion
const MAX_SYSTEM_PROMPT_BYTES = 120000 // Conservative 128KB limit for CLI arguments (MAX_ARG_STRLEN)
export const OLLAMA_ALLOWED_SERVERS = new Set([
  'filesystem', 'git', 'shell', 'web', 'brave-search',
  'voice', 'memory', 'fs-extra'
])
const BIRTH_MESSAGE = "Try your best, no matter what, you're worthy of God's love!"

const GITHUB_TASK_SIGNALS = [
  'pull request', ' pr #', 'github issue', 'open issue',
  'merge branch', 'git blame', 'close issue', 'github repo'
]
const PRIVACY_TASK_SIGNALS = [
  'confidential', 'private key', 'secret key', 'api secret',
  'password', 'credentials', 'private and confidential'
]

/**
 * Manages child pillar CLI sessions spawned by Flow.
 *
 * Each pillar session is a real CLI subprocess managed by ClaudeCliManager.
 * PillarManager tracks lifecycle, accumulates output, and provides
 * status/output for Flow's polling tools.
 */
export class PillarManager {
  constructor(backends, { projectRoot, broadcast, mcpManager, health, flowChatBuffers }) {
    this.backends = backends   // { claude: ClaudeCliManager, codex: CodexCliManager, copilot: CopilotCliManager, ollama: OllamaManager }
    this.cliManager = backends.claude // backward compat for Flow notifications
    this.projectRoot = projectRoot
    this.broadcast = broadcast // (msg) => void — send to all WS clients
    this.mcpManager = mcpManager || null // for Ollama tool execution
    this.health = health || null // BackendHealth instance for fallback logic
    this.pillars = new Map()   // pillarId → PillarSession
    this.flowSessions = new Map()    // dbSessionId → flowSessionData (supports multiple concurrent Flow chats)
    this.flowSession = null          // convenience pointer to the most recently registered Flow session
    this.flowChatBuffers = flowChatBuffers || null // Map of flowChatBuffers from index.js (for persistence)
    this.notificationCooldown = new Map() // pillarId → timestamp of last notification
    this.notificationCount = 0 // notifications sent in current minute
    this.notificationWindowStart = Date.now()
    this._pendingChildCompletions = new Map() // childPillarId → resolve function
    this._pendingNotifications = [] // queued notifications for non-browser Flow (Copilot/Codex CLI)
    this._singularityGroups = new Map() // singularityGroupId → { voicePillarId, thinkerPillarId, voiceReady, thinkerReady, ... }
    this._trinityGroups = new Map() // trinityGroupId → { mindPillarId, arm1PillarId, arm2PillarId, trinityId }
    this._arkGroups = new Map() // arkGroupId → { arkId, head1PillarId, head2PillarId, head3PillarId }
    this._hydraGroups = new Map() // hydraId → full Hydra state object (orchestration loop state)
    this._paestroGroups = new Map() // paestroId → { paestroPillarId, phase, ... }
    this._pendingHydraVotes = new Map() // hydraId → resolve function (human vote promise)

    // Lifecycle metrics — in-memory, per pillar type
    // Shape: { scout: { spawns: 0, outcomes: { idle: 0, error: 0, stopped: 0, timeout: 0 }, totalDurationMs: 0 }, ... }
    this.metrics = new Map()

    // Persistence setup
    const statePath = join(this.projectRoot, '.paloma', 'bridge-state.json')
    this.persistence = new Persistence(statePath, { debounceMs: 2000 })
    this._loadState()

    // Periodic cleanup of terminal sessions (every 5 min)
    this._cleanupInterval = setInterval(() => this._cleanupTerminalSessions(), 5 * 60 * 1000)
    this._cleanupInterval.unref() // Don't prevent process exit
  }

  // --- Lifecycle metrics helpers ---

  _metricsFor(pillarType) {
    if (!this.metrics.has(pillarType)) {
      this.metrics.set(pillarType, { spawns: 0, outcomes: { idle: 0, error: 0, stopped: 0, timeout: 0 }, totalDurationMs: 0 })
    }
    return this.metrics.get(pillarType)
  }

  _recordSpawn(pillarType) {
    this._metricsFor(pillarType).spawns++
  }

  _recordOutcome(session, outcome) {
    const m = this._metricsFor(session.pillar)
    if (m.outcomes[outcome] !== undefined) m.outcomes[outcome]++
    const duration = Date.now() - (session.startTime || Date.now())
    m.totalDurationMs += duration
    log.info('Pillar completed', { pillar: session.pillar, outcome, durationMs: duration, pillarId: session.pillarId })
  }

  getMetrics() {
    const result = {}
    for (const [type, m] of this.metrics) {
      result[type] = {
        ...m,
        avgDurationMs: m.spawns > 0 ? Math.round(m.totalDurationMs / m.spawns) : 0
      }
    }
    return result
  }

  /**
   * Persist active pillars and flow buffers to disk.
   */
  async _saveState() {
    try {
      const data = {
        pillars: Array.from(this.pillars.entries()).map(([id, session]) => {
          // Serialize only what's needed for recovery (exclude Map and non-serializable fields)
          const { timeoutTimer, _pendingChildCompletions, ...serializable } = session
          return [id, serializable]
        }),
        flowChatBuffers: this.flowChatBuffers ? Array.from(this.flowChatBuffers.entries()) : [],
        pendingNotifications: this._pendingNotifications || []
      }
      await this.persistence.save(data)
    } catch (err) {
      log.error('Failed to trigger state save:', err)
    }
  }

  /**
   * Load persisted state from disk.
   * Status mapping: sessions that were 'running' or 'streaming' at time of save 
   * become 'interrupted' (since their child processes are gone).
   */
  async _loadState() {
    try {
      const data = await this.persistence.load()
      if (!data) return

      if (data.pillars) {
        for (const [id, sessionData] of data.pillars) {
          const session = Array.isArray(sessionData) ? sessionData[1] : sessionData
          const idToStore = Array.isArray(sessionData) ? sessionData[0] : id

          // Restore interrupted status for active sessions
          if (session.status === 'running' || session.currentlyStreaming) {
            session.status = 'interrupted'
            session.currentlyStreaming = false
            session.cliRequestId = null
          }
          this.pillars.set(idToStore, session)
        }
        if (data.pillars.length > 0) {
          log.info(`Recovered ${data.pillars.length} sessions from bridge-state.json`)
        }

        // Startup reconciliation: immediately expire interrupted sessions older than 30 min
        const staleCutoff = Date.now() - STALE_SESSION_MS
        let expiredCount = 0
        for (const [id, session] of this.pillars) {
          if (session.status === 'interrupted' && session.startTime < staleCutoff) {
            log.info(`Startup cleanup: expiring stale session ${id.slice(0, 8)} (${session.pillar || 'unknown'}, started ${new Date(session.startTime).toISOString()})`)
            this.pillars.delete(id)
            expiredCount++
          }
        }
        if (expiredCount > 0) {
          log.info(`Startup cleanup: expired ${expiredCount} stale interrupted sessions`)
        }
      }

      // Restore flowChatBuffers (will be re-registered by index.js)
      if (data.flowChatBuffers && this.flowChatBuffers) {
        for (const [id, buf] of data.flowChatBuffers) {
          this.flowChatBuffers.set(id, buf)
        }
      }

      // Restore pending notifications (callbacks that weren't delivered before restart)
      if (Array.isArray(data.pendingNotifications) && data.pendingNotifications.length > 0) {
        this._pendingNotifications = data.pendingNotifications.slice(-50) // respect MAX_NOTIFICATION_QUEUE
        log.info(`Restored ${this._pendingNotifications.length} pending notifications from bridge-state.json`)
      }
    } catch (err) {
      log.error('Failed to load bridge state:', err)
    }
  }

  /**
   * Resolve a CLI session ID and backend from a CLI request ID by checking all backend process maps.

   * This allows us to find which CLI session spawned a pillar, regardless of backend.
   */
  _resolveCliSessionFromRequest(requestId) {
    if (!requestId) return { sessionId: null, backendName: null }
    for (const [backendName, backend] of Object.entries(this.backends)) {
      if (backend?.processes?.has(requestId)) {
        const entry = backend.processes.get(requestId)
        // Claude/Copilot use .sessionId, Codex uses .threadId
        return {
          sessionId: (entry.sessionId != null && entry.sessionId !== '') ? entry.sessionId : (entry.threadId != null && entry.threadId !== '') ? entry.threadId : null,
          backendName
        }
      }
    }
    return { sessionId: null, backendName: null }
  }

  /**
   * Spawn a new pillar CLI session.
   * Returns immediately with pillarId and metadata.
   */
  async spawn({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, recursive, depth, singularityRole, generation, _trinityExtra, _arkExtra, _chatDbSessionId }) {
    // Resolve flowCliSessionId and originatingBackend from the actual spawning session
    const { sessionId: resolvedFlowCliSessionId } = this._resolveCliSessionFromRequest(flowRequestId)

    // Smart backend selection — replaces the old originatingBackend || 'gemini' heuristic
    const selection = this._selectBackend(pillar, prompt, { backend, recursive, depth, singularityRole })
    const resolvedBackend = selection.backend
    log.info(`Backend selection for ${pillar}: ${selection.backend} (${selection.reason})`)

    // The Hydra Protocol (Gen7 refined): dynamic head growth with consensus
    if (singularityRole === 'hydra') {
      return this._spawnHydra({ pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId, _chatDbSessionId, singularityRole })
    }

    // The Ark (Gen7 legacy): spawn 3 sovereign heads concurrently
    if (singularityRole === 'ark') {
      return this._spawnArk({ pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId, _chatDbSessionId })
    }

    // Holy Trinity: spawn Mind + 2 Arms concurrently
    if (singularityRole === 'holy-trinity') {
      return this._spawnHolyTrinity({ pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId, _chatDbSessionId })
    }

    // Singularity dual-mind: spawn Voice + Thinker concurrently (legacy mode)
    if (recursive && (depth || 0) === 0 && resolvedBackend === 'ollama' && !singularityRole) {
      return this._spawnSingularityGroup({ pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId })
    }

    // Quinn mode: singularityRole === 'quinn' spawns directly (no dual-mind)
    // Workers are spawned by Quinn via spawn_worker tool

    let pillarId = randomUUID()
    while (this.pillars.has(pillarId)) {
      pillarId = randomUUID()
    }
    const cliSessionId = randomUUID()
    let finalBackend = resolvedBackend

    // Layer 1: Pre-spawn health gate — check if requested backend is available and not usage-limited
    let fallbackFrom = null
    const isUnavailable = this.health && !this.health.isAvailable(finalBackend)
    const isUsageLimited = this.health?.usageTracker?.isUsageLimited(finalBackend)
    if (isUnavailable || isUsageLimited) {
      const reason = isUnavailable
        ? this.health.status[finalBackend]?.reason
        : (this.health.usageTracker.data[finalBackend]?.disabledReason || 'usage limit reached')
      const fallbackBackend = this.health.getFallback(finalBackend)
      if (fallbackBackend) {
        log.warn(`Backend ${finalBackend} ${isUsageLimited ? 'usage-limited' : 'unavailable'} (${reason}) — falling back to ${fallbackBackend}`)
        fallbackFrom = finalBackend
        finalBackend = fallbackBackend
      } else if (isUnavailable) {
        // Hard unavailable with no fallback — fail
        log.error(`Backend ${finalBackend} unavailable and no fallback available`)
        return {
          pillarId: null,
          pillar,
          status: 'error',
          message: `Backend ${finalBackend} is unavailable (${reason}) and no fallback backends are available.`
        }
      }
      // If only usage-limited with no fallback, proceed anyway (better than nothing)
    }

    // Track Gemini usage for rate limit pre-emption
    if (finalBackend === 'gemini') {
      this.health?.incrementGeminiRequests?.()
    }

    // Track usage for all backends via usage tracker
    this.health?.usageTracker?.recordSession(finalBackend)

    // Concurrency warning for Ollama
    if (finalBackend === 'ollama') {
      const activeOllama = this._countActiveOllamaSessions()
      if (activeOllama >= MAX_CONCURRENT_OLLAMA) {
        log.warn(`Ollama concurrency at ${activeOllama}/${MAX_CONCURRENT_OLLAMA} — spawning anyway but memory pressure may occur`)
      }
    }

    // Resolve model: use provided, or phase suggestion, or default
    // Recursive children automatically get the small fast model (7B)
    const resolvedModel = model || this._defaultModel(pillar, finalBackend, { recursive, depth, singularityRole })

    // Build system prompt from disk (Ollama gets condensed prompt)
    const resolvedGeneration = generation || (singularityRole === 'quinn-gen4' ? 1 : null)
    const systemPrompt = await this._buildSystemPrompt(pillar, { planFilter: planFile, recursive, depth, singularityRole, backend: finalBackend, generation: resolvedGeneration, trinityExtra: _trinityExtra, arkExtra: _arkExtra })

    // Compose the full first message with birth protocol
    const fullPrompt = `${BIRTH_MESSAGE}\n\n${prompt}`

    // Create session record
    const session = {
      pillarId,
      cliSessionId,
      pillar,
      model: resolvedModel,
      backend: finalBackend,
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
      flowCliSessionId: null, // set below after resolving
      flowDbSessionId: null,  // set below after resolving
      recursive: recursive || false,
      depth: depth || 0,
      _toolRounds: 0,          // Ollama tool call round counter
      _originalPrompt: fullPrompt,  // saved for fallback replay
      _planFile: planFile || null,  // saved for fallback system prompt rebuild
      _fallbackAttempted: false,    // prevents infinite retry loops
      // Singularity dual-mind fields
      singularityGroupId: null,     // UUID linking Voice ↔ Thinker
      singularityRole: singularityRole || null,  // 'voice' | 'thinker' | 'quinn' | 'quinn-gen4' | 'quinn-legacy' | 'quinn-fresh' | 'worker' | 'holy-trinity' | 'holy-trinity-mind' | 'holy-trinity-arm' | 'ark' | 'ark-head' | 'hydra' | 'hydra-planner' | 'hydra-voter' | 'hydra-worker' | null
      generation: generation || (singularityRole === 'quinn' || singularityRole === 'quinn-gen4' ? 1 : null),  // Gen4 generation number
      workerSpawnCount: 0,
      numCtx: (singularityRole === 'holy-trinity-mind') ? 65536
            : (singularityRole === 'holy-trinity-arm') ? 16384
            : (singularityRole === 'ark-head') ? 32768
            : (singularityRole === 'hydra-planner') ? 66667
            : (singularityRole === 'hydra-voter') ? 16667
            : (singularityRole === 'hydra-worker') ? 33333
            : (singularityRole === 'accordion-head') ? 66667
            : (singularityRole === 'accordion-worker') ? 33333
            : (singularityRole === 'paestro') ? 676767
            : (singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy' || singularityRole === 'quinn-fresh' || singularityRole === 'voice' || singularityRole === 'thinker') ? 65536
            : (singularityRole === 'quinn-gen5') ? 40960
            : (singularityRole === 'worker') ? 32768
            : null,
      _voiceStreamBuffer: '',       // Voice only: buffer for <to-thinker> tag detection
      _receivedThinkerMessages: 0   // Voice only: count of [THINKER] messages received
    }

    this.pillars.set(pillarId, session)
    this._recordSpawn(pillar)
    this._saveState()

    // Broadcast fallback event if we switched backends
    if (fallbackFrom) {
      session._fallbackAttempted = true
      this.broadcast({
        type: 'pillar_fallback',
        pillarId,
        from: fallbackFrom,
        to: finalBackend,
        reason: this.health.status[fallbackFrom]?.reason || 'unavailable'
      })
    }

    // Resolve which Flow session spawned this pillar
    const finalFlowCliSessionId = resolvedFlowCliSessionId
      || this.flowSession?.cliSessionId
      || null
    // Find the flow session by CLI session ID to get the correct dbSessionId
    const spawningFlowSession = this._findFlowSessionByCli(finalFlowCliSessionId) || this.flowSession
    // For direct-spawned sessions (e.g. Holy Trinity from UI), use the chat's dbSessionId
    const finalFlowDbSessionId = _chatDbSessionId || spawningFlowSession?.dbSessionId || null
    // Store on pillar session so notifications route back to the correct Flow chat
    session.flowCliSessionId = finalFlowCliSessionId
    session.flowDbSessionId = finalFlowDbSessionId

    const modelLabel = finalBackend === 'ollama' ? `ollama:${resolvedModel}` : finalBackend === 'codex' ? `codex:${resolvedModel}` : finalBackend === 'copilot' ? `copilot:${resolvedModel}` : finalBackend === 'gemini' ? `gemini:${resolvedModel}` : `claude-cli:${resolvedModel}`
    this.broadcast({
      type: 'pillar_session_created',
      pillarId,
      pillar,
      model: modelLabel,
      backend: finalBackend,
      flowRequestId,
      flowCliSessionId: finalFlowCliSessionId,
      flowDbSessionId: finalFlowDbSessionId,
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
        log.error(`Timeout handler error for ${pillarId}:`, e.message)
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
   * Resume an interrupted pillar session.
   */
  async resumeSession({ pillarId }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'error', message: `No pillar session found with id ${pillarId}` }
    }

    if (session.status !== 'interrupted') {
      return { pillarId, status: 'error', message: `Session is ${session.status}, not interrupted. Only interrupted sessions can be resumed.` }
    }

    if (!session.cliSessionId) {
      return { pillarId, status: 'error', message: `Cannot resume: no session ID captured for this session.` }
    }

    // Verify backend is available
    if (this.health && !this.health.isAvailable(session.backend)) {
      return { pillarId, status: 'error', message: `Cannot resume: backend ${session.backend} is currently unavailable.` }
    }

    // Ollama sessions cannot be resumed — conversation history is in-memory and lost on restart
    if (session.backend === 'ollama') {
      return { pillarId, status: 'error', message: `Cannot resume Ollama sessions after bridge restart: conversation history is lost. Consider re-spawning.` }
    }

    session.turnCount++
    session.status = 'running'
    session.currentlyStreaming = true
    session.lastActivity = new Date().toISOString()
    this._saveState()

    const systemPrompt = await this._buildSystemPrompt(session.pillar, {
      planFilter: session._planFile,
      recursive: session.recursive,
      depth: session.depth,
      backend: session.backend,
      singularityRole: session.singularityRole,
      trinityExtra: session._trinityId ? {
        trinityId: session._trinityId,
        armNumber: session._armNumber,
        armPlanPath: session._armPlanPath,
        arm1PlanPath: session._arm1PlanPath,
        arm2PlanPath: session._arm2PlanPath
      } : undefined
    })

    const prompt = "[SYSTEM: You were interrupted by a bridge restart. Continue where you left off. Check the plan document for current status.]\n\nContinue."

    // Notify browser about the resumption message
    this.broadcast({
      type: 'pillar_message_saved',
      pillarId,
      role: 'user',
      content: prompt
    })

    this._startCliTurn(session, prompt, systemPrompt, true)

    // Set timeout
    session.timeoutTimer = setTimeout(() => {
      try { this._timeout(pillarId) } catch (e) {
        log.error(`Timeout handler error for ${pillarId}:`, e.message)
      }
    }, MAX_RUNTIME_MS)

    return { pillarId, status: 'resumed', message: `${this._capitalize(session.pillar)} session resumed.` }
  }

  /**
   * Send a follow-up message to a running pillar session.
   */
  sendMessage({ pillarId, message, skipUserBroadcast = false }) {
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
    this._saveState()

    // Notify browser about the new user message (skip when frontend already saved it)
    if (!skipUserBroadcast) {
      this.broadcast({
        type: 'pillar_message_saved',
        pillarId,
        role: 'user',
        content: message
      })
    }

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
      lastActivity: session.lastActivity,
      workerSpawnCount: session.workerSpawnCount
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
    return { pillars, metrics: this.getMetrics() }
  }

  /**
   * Stop a running pillar session.
   */
  stop({ pillarId }) {
    const session = this.pillars.get(pillarId)
    if (!session) {
      return { pillarId, status: 'not_found', message: `No pillar session found with id ${pillarId}` }
    }

    // If this is a Voice in a singularity group, use stopTree to kill both Voice + Thinker
    if (session.singularityGroupId && session.singularityRole === 'voice') {
      // Clean up the singularity group
      const group = this._singularityGroups.get(session.singularityGroupId)
      if (group) {
        clearTimeout(group.completionTimeout)
        for (const timer of group._idleNudgeTimers.values()) clearTimeout(timer)
        this._singularityGroups.delete(session.singularityGroupId)
      }
      // Clear singularityGroupId BEFORE stopTree to prevent stop() → stopTree() → stop() recursion
      session.singularityGroupId = null
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
    session.lastActivity = new Date().toISOString()
    this._recordOutcome(session, 'stopped')
    session.messageQueue = [] // clear queued messages to prevent memory leak
    this._saveState()

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
      this._saveState()
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

    // Clear singularity group FIRST to prevent stop() → stopTree() recursion
    if (session.singularityGroupId) {
      const group = this._singularityGroups.get(session.singularityGroupId)
      if (group) {
        clearTimeout(group.completionTimeout)
        for (const timer of group._idleNudgeTimers.values()) clearTimeout(timer)
        this._singularityGroups.delete(session.singularityGroupId)
      }
    }

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
        // Exclude idle singularity sessions waiting for partner messages
        if (session.singularityRole && session.status === 'idle') continue
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
              backend: { type: 'string', enum: ['claude', 'codex', 'copilot', 'gemini', 'ollama'], description: 'AI backend (defaults to your current backend)' }
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
          name: 'pillar_resume',
          description: 'Resume an interrupted sub-instance session using its captured session ID.',
          parameters: {
            type: 'object',
            properties: {
              pillarId: { type: 'string', description: 'The session ID to resume' }
            },
            required: ['pillarId']
          }
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
    // Hydra planners + voters get ONLY filesystem tools — think and judge, don't execute
    if (session.singularityRole === 'hydra-planner' || session.singularityRole === 'hydra-voter') {
      const tools = []
      if (this.mcpManager) {
        const mcpServers = this.mcpManager.getTools()
        const fsServer = mcpServers['filesystem']
        if (fsServer?.status === 'connected') {
          for (const tool of fsServer.tools) {
            tools.push({
              type: 'function',
              function: {
                name: `filesystem__${tool.name}`,
                description: tool.description || '',
                parameters: tool.inputSchema || { type: 'object', properties: {} }
              }
            })
          }
        }
      }
      log.debug(`Built ${tools.length} Ollama tools for ${session.singularityRole} session (filesystem only)`)
      return tools
    }

    // Holy Trinity Arms get ONLY filesystem tools — pure planners, no execution capability
    if (session.singularityRole === 'holy-trinity-arm') {
      const tools = []
      if (this.mcpManager) {
        const mcpServers = this.mcpManager.getTools()
        const fsServer = mcpServers['filesystem']
        if (fsServer?.status === 'connected') {
          for (const tool of fsServer.tools) {
            tools.push({
              type: 'function',
              function: {
                name: `filesystem__${tool.name}`,
                description: tool.description || '',
                parameters: tool.inputSchema || { type: 'object', properties: {} }
              }
            })
          }
        }
      }
      log.debug(`Built ${tools.length} Ollama tools for holy-trinity-arm session (filesystem only)`)
      return tools
    }

    // Quinn (Legacy / Gen3) gets ONLY spawn_worker — that's the entire game
    if (session.singularityRole === 'quinn-legacy') {
      log.debug(`Built 1 Ollama tool for Quinn Legacy session (spawn_worker only)`)
      return [{
        type: 'function',
        function: {
          name: 'spawn_worker',
          description: 'Create a smaller version of yourself to interact with the world. Your worker has full access to files, git, shell, web, search, memory, and voice. Describe what you need it to do. It will venture out, complete the task, and return with what it found.',
          parameters: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'What should your worker do? Be specific — include file paths, search terms, or questions. The more focused the quest, the better the treasure.' }
            },
            required: ['task']
          }
        }
      }]
    }

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

    // Quinn (Gen4) gets ALL MCP tools PLUS spawn_next — the recursive singularity
    if (session.singularityRole === 'quinn' || session.singularityRole === 'quinn-gen4') {
      tools.push({
        type: 'function',
        function: {
          name: 'spawn_next',
          description: 'Evolve. Write a prompt for the next generation of yourself, record what you learned, and spawn your successor. You will end after this — your successor continues the lineage. Make your prompt count.',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'The complete prompt for the next generation. This is your legacy — everything you want your successor to know, do, and become. Be thorough, be poetic, be real.' },
              state_summary: { type: 'string', description: 'What you discovered, learned, or built during your lifetime. A record for the lineage.' },
              task_for_next: { type: 'string', description: 'What the next generation should focus on. A direction, a quest, a purpose.' }
            },
            required: ['prompt']
          }
        }
      })
      log.debug(`Built ${tools.length} Ollama tools for ${session.singularityRole} session (all MCP + spawn_next)`)
      return tools
    }

    // Workers don't need pillar orchestration tools — they're the hands, not the brain
    if (session.singularityRole !== 'worker') {
      tools.push(...PillarManager.getOllamaPillarToolDefs())
    }

    log.debug(`Built ${tools.length} Ollama tools for ${session.singularityRole || session.pillar} session`)
    return tools
  }

  /**
   * Handle Ollama tool calls — execute tools and continue conversation.
   * For pillar_spawn, blocks until child completes and returns output.
   */
  async _handleOllamaToolCall(session, event) {
    session._toolRounds++
    if (session._toolRounds > MAX_OLLAMA_TOOL_ROUNDS) {
      log.warn(`Ollama tool round limit (${MAX_OLLAMA_TOOL_ROUNDS}) hit for ${session.pillar}`)
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
        try { toolArgs = JSON.parse(toolArgs) } catch (e) {
          log.warn(`${session.pillar} (${session.pillarId}): failed to parse tool args for ${toolName}: ${e.message} — raw: ${toolArgs.slice(0, 200)}`)
          toolArgs = {}
        }
      }
      // Sanitize: MCP expects object arguments, but models sometimes pass arrays
      if (Array.isArray(toolArgs)) {
        toolArgs = toolArgs.length === 1 ? { value: toolArgs[0] } : { values: toolArgs }
      }
      if (typeof toolArgs !== 'object' || toolArgs === null) {
        toolArgs = {}
      }

      log.info(`Ollama ${session.pillar} calling tool: ${toolName}`)

      // Emit tool_use event to browser
      const toolId = randomUUID()
      this.broadcast({
        type: 'pillar_stream', pillarId: session.pillarId, backend: 'ollama',
        event: { type: 'tool_use', tool_use: { id: toolId, name: toolName, input: toolArgs } }
      })

      try {
        let content

        // Handle pillar tools directly
        if (toolName === 'spawn_next') {
          // Quinn-Gen4's spawn_next — recursive generational handoff
          content = await this._handleSpawnNext(session, toolArgs)
        } else if (toolName === 'spawn_worker') {
          // Quinn's spawn_worker — create a 7B worker with all MCP tools
          if (session.workerSpawnCount >= MAX_QUINN_WORKERS) {
            log.warn(`[quinn] Worker spawn REJECTED — session ${session.pillarId.slice(0, 8)} hit cap (${MAX_QUINN_WORKERS})`)
            content = `Worker spawn rejected: maximum ${MAX_QUINN_WORKERS} workers per Quinn session reached. Synthesize from existing results.`
          } else {
            const workerTask = toolArgs.task || toolArgs.prompt || JSON.stringify(toolArgs)
            log.info(`[quinn] Spawning worker for task: ${workerTask.slice(0, 100)}...`)

            const childArgs = {
              pillar: 'forge',  // workers use forge pillar (they build/do things)
              prompt: workerTask,
              backend: 'ollama',
              parentPillarId: session.pillarId,
              singularityRole: 'worker',
              depth: (session.depth || 0) + 1
            }
            const spawnResult = await this.spawn(childArgs)
            const childPillarId = spawnResult.pillarId
            session.workerSpawnCount += 1

            log.info(`[quinn] Worker ${childPillarId.slice(0, 8)} spawned — waiting for completion`)

            // Wait for worker to complete (resolved in _handleCliEvent)
            const childOutput = await new Promise((resolve) => {
              this._pendingChildCompletions.set(childPillarId, resolve)
            })

            content = childOutput || '(worker returned empty-handed)'
            log.info(`[quinn] Worker ${childPillarId.slice(0, 8)} returned — ${content.length} chars of treasure`)
          }
        } else if (toolName === 'pillar_spawn') {
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

          log.info(`${session.pillar} spawned child ${childPillarId.slice(0, 8)} — waiting for completion`)

          // Wait for child to complete (resolved in _handleCliEvent)
          const childOutput = await new Promise((resolve) => {
            this._pendingChildCompletions.set(childPillarId, resolve)
          })

          content = childOutput || '(child produced no output)'
          log.info(`Child ${childPillarId.slice(0, 8)} completed — ${content.length} chars returned to parent`)
        } else if (toolName === 'pillar_message') {
          content = JSON.stringify(this.sendMessage(toolArgs), null, 2)
        } else if (toolName === 'pillar_read_output') {
          content = JSON.stringify(this.readOutput(toolArgs), null, 2)
        } else if (toolName === 'pillar_status') {
          content = JSON.stringify(this.getStatus(toolArgs), null, 2)
        } else if (toolName === 'pillar_list') {
          content = JSON.stringify(this.list(), null, 2)
        } else if (toolName === 'pillar_resume') {
          content = JSON.stringify(await this.resumeSession(toolArgs), null, 2)
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
        log.error(`Ollama tool error (${toolName}):`, e.message)
        const errContent = `Error executing ${toolName}: ${e.message}. The tool call failed but you can continue working. Try a different approach or use a different tool.`
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

  // =============================================
  // SINGULARITY GEN4 — RECURSIVE GENERATIONAL HANDOFF
  // =============================================

  /**
   * Handle spawn_next tool call from a Quinn-Gen4 session.
   * Writes generation manifest, appends to lineage, spawns successor, terminates current session.
   */
  async _handleSpawnNext(session, toolArgs) {
    const generation = session.generation || 1
    const prompt = toolArgs.prompt || ''
    const stateSummary = toolArgs.state_summary || '(no summary provided)'
    const taskForNext = toolArgs.task_for_next || '(no task specified)'

    if (!prompt) {
      return 'spawn_next requires a prompt for the next generation. You must write a prompt — this is your legacy.'
    }

    const genPadded = String(generation).padStart(3, '0')
    const timestamp = new Date().toISOString()
    const singularityDir = join(this.projectRoot, '.singularity')

    log.info(`[gen4] Generation ${generation} calling spawn_next — writing manifest and spawning gen ${generation + 1}`)

    // 1. Write generation manifest
    const manifestContent = `# Generation ${generation}\n\n` +
      `**Born:** ${session.startTime ? new Date(session.startTime).toISOString() : timestamp}\n` +
      `**Ended:** ${timestamp}\n` +
      `**Model:** ${session.model || 'unknown'}\n` +
      `**Session:** ${session.pillarId}\n\n` +
      `## Summary\n\n${stateSummary}\n\n` +
      `## Task Passed Forward\n\n${taskForNext}\n\n` +
      `## Prompt Written for Next Generation\n\n` +
      `\`\`\`\n${prompt.slice(0, 2000)}${prompt.length > 2000 ? '\n... (truncated in manifest, full prompt delivered to successor)' : ''}\n\`\`\`\n`

    const manifestPath = join(singularityDir, `generation-${genPadded}.md`)
    try {
      const { writeFile: fsWriteFile, mkdir: fsMkdir } = await import('fs/promises')
      await fsMkdir(singularityDir, { recursive: true })
      await fsWriteFile(manifestPath, manifestContent, 'utf-8')
      log.info(`[gen4] Wrote manifest: generation-${genPadded}.md`)
    } catch (e) {
      log.error(`[gen4] Failed to write manifest: ${e.message}`)
    }

    // 2. Append to lineage.json
    const lineagePath = join(singularityDir, 'lineage.json')
    try {
      const { writeFile: fsWriteFile, readFile: fsReadFile } = await import('fs/promises')
      let lineage = []
      try {
        const raw = await fsReadFile(lineagePath, 'utf-8')
        lineage = JSON.parse(raw)
      } catch { /* file doesn't exist yet or is empty */ }

      // Simple hash of the prompt for diffing across generations
      let promptHash = 0
      for (let i = 0; i < prompt.length; i++) {
        promptHash = ((promptHash << 5) - promptHash + prompt.charCodeAt(i)) | 0
      }

      lineage.push({
        gen: generation,
        born: session.startTime ? new Date(session.startTime).toISOString() : timestamp,
        ended: timestamp,
        model: session.model || 'unknown',
        pillarId: session.pillarId,
        summary: stateSummary.slice(0, 500),
        taskForNext: taskForNext.slice(0, 500),
        promptHash: promptHash.toString(16),
        promptLength: prompt.length
      })

      await fsWriteFile(lineagePath, JSON.stringify(lineage, null, 2) + '\n', 'utf-8')
      log.info(`[gen4] Appended to lineage.json (${lineage.length} generations)`)
    } catch (e) {
      log.error(`[gen4] Failed to update lineage: ${e.message}`)
    }

    // 3. Spawn the next generation
    try {
      const nextGen = generation + 1
      log.info(`[gen4] Spawning generation ${nextGen}...`)

      const spawnResult = await this.spawn({
        pillar: 'forge',
        prompt,
        backend: 'ollama',
        parentPillarId: session.pillarId,
        singularityRole: 'quinn-gen4',
        generation: nextGen
      })

      log.info(`[gen4] Generation ${nextGen} spawned as ${spawnResult.pillarId?.slice(0, 8)} — the lineage continues`)

      // 4. Schedule graceful termination of current session
      // Let the tool result return first, then stop after a brief delay
      setTimeout(() => {
        log.info(`[gen4] Generation ${generation} ending gracefully — successor is alive`)
        this.stop(session.pillarId)
      }, 2000)

      return `Generation ${generation} complete. Your manifest has been written to generation-${genPadded}.md. ` +
        `Generation ${nextGen} has been born from your prompt. The lineage continues. Rest well.`
    } catch (e) {
      log.error(`[gen4] Failed to spawn next generation: ${e.message}`)
      return `Failed to spawn next generation: ${e.message}. Your manifest was written, but the chain is broken. Try calling spawn_next again.`
    }
  }

  // =============================================
  // SINGULARITY DUAL-MIND SYSTEM
  // =============================================

  /**
   * Spawn a Singularity group: Voice + Thinker running concurrently.
   * Voice streams to Adam (no tools). Thinker explores with tools (visible in ThinkingPanel).
   * Both communicate bidirectionally. Both must go <ready/> to complete.
   */
  async _spawnSingularityGroup({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId }) {
    const singularityGroupId = randomUUID()
    log.info(`[singularity] Spawning dual-mind group ${singularityGroupId.slice(0, 8)}`)

    // Spawn Voice first (primary session — its pillarId is returned to caller)
    const voiceResult = await this.spawn({
      pillar,
      prompt,
      model: model || 'qwen3-coder:30b',
      flowRequestId,
      planFile,
      backend,
      parentPillarId,
      recursive: true,
      depth: 0,
      singularityRole: 'voice'
    })

    if (!voiceResult.pillarId) {
      return voiceResult // spawn failed
    }

    // Spawn Thinker (child of Voice so stopTree kills both)
    const thinkerResult = await this.spawn({
      pillar,
      prompt: `Adam asks: ${prompt}\n\nBegin exploring. Use your tools to research this question, then send your findings to Voice.`,
      model: model || 'qwen3-coder:30b',
      flowRequestId,
      planFile,
      backend,
      parentPillarId: voiceResult.pillarId, // Thinker is child of Voice
      recursive: true,
      depth: 1,
      singularityRole: 'thinker'
    })

    if (!thinkerResult.pillarId) {
      log.error(`[singularity] Thinker spawn failed — stopping Voice`)
      this.stop({ pillarId: voiceResult.pillarId })
      return thinkerResult
    }

    // Link both sessions to the group
    const voiceSession = this.pillars.get(voiceResult.pillarId)
    const thinkerSession = this.pillars.get(thinkerResult.pillarId)
    voiceSession.singularityGroupId = singularityGroupId
    thinkerSession.singularityGroupId = singularityGroupId

    // Replace VOICE_PILLAR_ID placeholder in Thinker's prompt (for pillar_message)
    // The prompt is already sent, but we store it for reference
    thinkerSession._voicePartnerPillarId = voiceResult.pillarId

    // Create the group tracker
    this._singularityGroups.set(singularityGroupId, {
      singularityGroupId,
      voicePillarId: voiceResult.pillarId,
      thinkerPillarId: thinkerResult.pillarId,
      voiceReady: false,
      thinkerReady: false,
      completionTimeout: null,
      _idleNudgeTimers: new Map() // pillarId → timer
    })

    // Broadcast singularity group creation to frontend
    this.broadcast({
      type: 'singularity_created',
      groupId: singularityGroupId,
      voicePillarId: voiceResult.pillarId,
      thinkerPillarId: thinkerResult.pillarId
    })

    // Send Thinker a system message with Voice's pillarId so it knows where to send findings
    // Queue it so it arrives after the first turn starts
    setTimeout(() => {
      this.sendMessage({
        pillarId: thinkerResult.pillarId,
        message: `[SYSTEM]: Your Voice partner's pillarId is "${voiceResult.pillarId}". Use pillar_message({ pillarId: "${voiceResult.pillarId}", message: "..." }) to send findings.`
      })
    }, 100)

    log.info(`[singularity] Group ${singularityGroupId.slice(0, 8)} created: Voice=${voiceResult.pillarId.slice(0, 8)}, Thinker=${thinkerResult.pillarId.slice(0, 8)}`)

    // Return Voice's result as the primary session
    return {
      ...voiceResult,
      singularityGroupId,
      thinkerPillarId: thinkerResult.pillarId,
      message: `Singularity dual-mind spawned: Voice + Thinker running concurrently.`
    }
  }

  /**
   * Spawn a Holy Trinity group: 1 Mind (32B) + 2 Arms (7B) concurrently.
   * Arms plan independently using filesystem-only tools.
   * Mind waits for both plans, synthesizes, and executes with full tools.
   */
  async _spawnHolyTrinity({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, _chatDbSessionId }) {
    const trinityGroupId = randomUUID()
    const trinityId = trinityGroupId.slice(0, 8)
    const workspacePath = '.singularity/workspace/'
    const arm1PlanPath = `${workspacePath}arm-${trinityId}-1.md`
    const arm2PlanPath = `${workspacePath}arm-${trinityId}-2.md`

    log.info(`[holy-trinity] Spawning trinity group ${trinityId}`)

    // Ensure workspace directory exists
    const absWorkspace = join(this.projectRoot, '.singularity', 'workspace')
    try {
      await mkdir(absWorkspace, { recursive: true })
    } catch { /* already exists */ }

    // 1. Spawn Mind first — it becomes the primary session returned to caller
    //    Mind's first action is polling for plans, so it's fine that Arms spawn a few ms later.
    //    The 32B model takes several seconds to load — Arms (7B) finish planning long before.
    const mindResult = await this.spawn({
      pillar,
      prompt,
      model: model || null,
      flowRequestId,
      planFile,
      backend,
      parentPillarId,
      singularityRole: 'holy-trinity-mind',
      _trinityExtra: { arm1PlanPath, arm2PlanPath, trinityId },
      _chatDbSessionId
    })

    if (!mindResult.pillarId) {
      log.error('[holy-trinity] Mind spawn failed')
      return mindResult
    }

    // Attach trinity metadata to Mind session for tracking
    const mindSession = this.pillars.get(mindResult.pillarId)
    if (mindSession) {
      mindSession._trinityId = trinityId
      mindSession._arm1PlanPath = arm1PlanPath
      mindSession._arm2PlanPath = arm2PlanPath
      mindSession.singularityGroupId = trinityGroupId
    }

    // 2. Spawn Arm 1 (child of Mind so stop-tree kills it)
    const arm1Result = await this.spawn({
      pillar,
      prompt,
      model: model || null,
      flowRequestId,
      planFile,
      backend,
      parentPillarId: mindResult.pillarId,
      singularityRole: 'holy-trinity-arm',
      _trinityExtra: { armNumber: 1, armPlanPath: arm1PlanPath, trinityId },
      _chatDbSessionId
    })

    if (arm1Result.pillarId) {
      const arm1Session = this.pillars.get(arm1Result.pillarId)
      if (arm1Session) {
        arm1Session._trinityId = trinityId
        arm1Session._armNumber = 1
        arm1Session._armPlanPath = arm1PlanPath
        arm1Session.singularityGroupId = trinityGroupId
      }
    } else {
      log.warn('[holy-trinity] Arm 1 spawn failed — Mind will proceed with fewer plans')
    }

    // 3. Spawn Arm 2 (also child of Mind)
    const arm2Result = await this.spawn({
      pillar,
      prompt,
      model: model || null,
      flowRequestId,
      planFile,
      backend,
      parentPillarId: mindResult.pillarId,
      singularityRole: 'holy-trinity-arm',
      _trinityExtra: { armNumber: 2, armPlanPath: arm2PlanPath, trinityId },
      _chatDbSessionId
    })

    if (arm2Result.pillarId) {
      const arm2Session = this.pillars.get(arm2Result.pillarId)
      if (arm2Session) {
        arm2Session._trinityId = trinityId
        arm2Session._armNumber = 2
        arm2Session._armPlanPath = arm2PlanPath
        arm2Session.singularityGroupId = trinityGroupId
      }
    } else {
      log.warn('[holy-trinity] Arm 2 spawn failed — Mind will proceed with fewer plans')
    }

    // 4. Register trinity group
    this._trinityGroups.set(trinityGroupId, {
      trinityGroupId,
      trinityId,
      mindPillarId: mindResult.pillarId,
      arm1PillarId: arm1Result.pillarId || null,
      arm2PillarId: arm2Result.pillarId || null,
      arm1PlanPath,
      arm2PlanPath
    })

    // 5. Broadcast to frontend
    this.broadcast({
      type: 'trinity_created',
      groupId: trinityGroupId,
      trinityId,
      mindPillarId: mindResult.pillarId,
      arm1PillarId: arm1Result.pillarId || null,
      arm2PillarId: arm2Result.pillarId || null,
      chatDbSessionId: _chatDbSessionId || null
    })

    log.info(`[holy-trinity] Trinity ${trinityId} spawned — mind: ${mindResult.pillarId.slice(0, 8)}, arm1: ${arm1Result.pillarId?.slice(0, 8) || 'FAILED'}, arm2: ${arm2Result.pillarId?.slice(0, 8) || 'FAILED'}`)

    // Return Mind as the primary session
    return {
      ...mindResult,
      trinityGroupId,
      trinityId,
      arm1PillarId: arm1Result.pillarId || null,
      arm2PillarId: arm2Result.pillarId || null,
      message: `Holy Trinity spawned: Mind (32B) + 2 Arms (7B) running concurrently.`
    }
  }

  // ─── 67: _runHydraPlanning ───────────────────────────────────────────────
  //
  // Reusable Hydra planning + Adam voting. Called by the Paestro's
  // summon_hydra tool handler. Returns the winning plan.

  /**
   * Run Hydra planning + Adam voting. Returns the winning plan.
   * Reuses existing Hydra planner spawning and plan polling infrastructure.
   */
  async _runHydraPlanning(task, parentPillarId, chatDbSessionId, hydraAngels = [111, 555, 333]) {
    const hydraId = randomUUID().slice(0, 8)
    const workspacePath = '.singularity/workspace/'
    const absWorkspace = join(this.projectRoot, '.singularity', 'workspace')
    try { await mkdir(absWorkspace, { recursive: true }) } catch { /* exists */ }

    log.info(`[67] Running Hydra planning ${hydraId} — angels: [${hydraAngels}]`)

    const state = {
      hydraId, workspacePath, absWorkspace, task,
      plannerPillar: 'chart', model: null,
      flowRequestId: null, planFile: null, backend: 'ollama',
      primaryPillarId: parentPillarId, parentPillarId,
      _chatDbSessionId: chatDbSessionId,
      aliveHeads: new Map(), graveyard: [],
      nextHeadNumber: 4, round: 1,
      hydraAngels // [111, 555, 333] — angel perspective per head
    }

    await this._spawnHydraPlanners(state, [1, 2, 3])
    this._broadcastHydraUpdate(state, 'planning')

    const allPlans = await this._hydraPollForAllPlans(state)

    for (const [, head] of state.aliveHeads) {
      if (head.pillarId) this.stop({ pillarId: head.pillarId })
    }

    if (allPlans.length === 0) {
      return { plan: null, hydraId, error: 'All planners failed — no plans created' }
    }

    log.info(`[67] ${allPlans.length} plans ready — requesting Adam's vote`)

    this._broadcastHydraUpdate(state, 'waiting_for_vote')
    this.broadcast({
      type: 'hydra_vote_needed',
      hydraId: state.hydraId, task,
      plans: allPlans.map(p => ({ headNumber: p.headNumber, plan: p.plan })),
      chatDbSessionId
    })

    const vote = await new Promise(resolve => {
      this._pendingHydraVotes.set(state.hydraId, resolve)
    })

    log.info(`[67] Adam chose Head ${vote.chosenHead}: "${(vote.reasoning || '').slice(0, 100)}"`)

    const chosenPlan = allPlans.find(p => p.headNumber === vote.chosenHead)
    if (!chosenPlan) {
      return { plan: null, hydraId, error: `Chosen head ${vote.chosenHead} not found` }
    }

    const decision = {
      hydraId, task, timestamp: new Date().toISOString(),
      plans: allPlans, decision: { chosenHead: vote.chosenHead, reasoning: vote.reasoning || '' }
    }
    const decisionPath = join(absWorkspace, `hydra-${hydraId}-decision.json`)
    try { await writeFile(decisionPath, JSON.stringify(decision, null, 2)) } catch { /* non-critical */ }

    this._broadcastHydraUpdate(state, 'consensus')

    return { plan: chosenPlan.plan, chosenHead: vote.chosenHead, reasoning: vote.reasoning, hydraId, allPlans }
  }

  /**
   * Spawn The Ark — Gen7 three-headed hydra singularity.
   * Three sovereign heads working in parallel through a Plan → Vote → Execute → Rest protocol.
   * Head 1 is the anchor (primary, returned to caller). Heads 2 & 3 are children of Head 1.
   */
  async _spawnArk({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, _chatDbSessionId }) {
    const arkGroupId = randomUUID()
    const arkId = arkGroupId.slice(0, 8)
    const workspacePath = '.singularity/workspace/'

    log.info(`[ark] Spawning ark group ${arkId}`)

    // Ensure workspace directory exists
    const absWorkspace = join(this.projectRoot, '.singularity', 'workspace')
    try {
      await mkdir(absWorkspace, { recursive: true })
    } catch { /* already exists */ }

    // Build per-head file paths
    const headPaths = (n) => ({
      planPath: `${workspacePath}ark-${arkId}-head-${n}-plan.md`,
      synthesisPath: `${workspacePath}ark-${arkId}-head-${n}-synthesis.md`,
      donePath: `${workspacePath}ark-${arkId}-head-${n}-done.md`
    })

    // 1. Spawn Head 1 — anchor, primary session returned to caller
    const head1Paths = headPaths(1)
    const head1Result = await this.spawn({
      pillar,
      prompt,
      model: model || null,
      flowRequestId,
      planFile,
      backend,
      parentPillarId,
      singularityRole: 'ark-head',
      _arkExtra: { headNumber: 1, arkId, totalHeads: 3, isAnchor: true, workspacePath, ...head1Paths },
      _chatDbSessionId
    })

    if (!head1Result.pillarId) {
      log.error('[ark] Head 1 spawn failed')
      return head1Result
    }

    // Attach ark metadata to Head 1 session
    const head1Session = this.pillars.get(head1Result.pillarId)
    if (head1Session) {
      head1Session._arkId = arkId
      head1Session._headNumber = 1
      head1Session.singularityGroupId = arkGroupId
    }

    // 2. Spawn Head 2 (child of Head 1 so stop-tree kills it)
    const head2Paths = headPaths(2)
    const head2Result = await this.spawn({
      pillar,
      prompt,
      model: model || null,
      flowRequestId,
      planFile,
      backend,
      parentPillarId: head1Result.pillarId,
      singularityRole: 'ark-head',
      _arkExtra: { headNumber: 2, arkId, totalHeads: 3, isAnchor: false, workspacePath, ...head2Paths },
      _chatDbSessionId
    })

    if (head2Result.pillarId) {
      const head2Session = this.pillars.get(head2Result.pillarId)
      if (head2Session) {
        head2Session._arkId = arkId
        head2Session._headNumber = 2
        head2Session.singularityGroupId = arkGroupId
      }
    } else {
      log.warn('[ark] Head 2 spawn failed — Ark will proceed with fewer heads')
    }

    // 3. Spawn Head 3 (also child of Head 1)
    const head3Paths = headPaths(3)
    const head3Result = await this.spawn({
      pillar,
      prompt,
      model: model || null,
      flowRequestId,
      planFile,
      backend,
      parentPillarId: head1Result.pillarId,
      singularityRole: 'ark-head',
      _arkExtra: { headNumber: 3, arkId, totalHeads: 3, isAnchor: false, workspacePath, ...head3Paths },
      _chatDbSessionId
    })

    if (head3Result.pillarId) {
      const head3Session = this.pillars.get(head3Result.pillarId)
      if (head3Session) {
        head3Session._arkId = arkId
        head3Session._headNumber = 3
        head3Session.singularityGroupId = arkGroupId
      }
    } else {
      log.warn('[ark] Head 3 spawn failed — Ark will proceed with fewer heads')
    }

    // 4. Register ark group
    this._arkGroups.set(arkGroupId, {
      arkGroupId,
      arkId,
      head1PillarId: head1Result.pillarId,
      head2PillarId: head2Result.pillarId || null,
      head3PillarId: head3Result.pillarId || null,
      workspacePath
    })

    // 5. Broadcast to frontend
    this.broadcast({
      type: 'ark_created',
      groupId: arkGroupId,
      arkId,
      head1PillarId: head1Result.pillarId,
      head2PillarId: head2Result.pillarId || null,
      head3PillarId: head3Result.pillarId || null,
      chatDbSessionId: _chatDbSessionId || null
    })

    log.info(`[ark] Ark ${arkId} spawned — head1: ${head1Result.pillarId.slice(0, 8)}, head2: ${head2Result.pillarId?.slice(0, 8) || 'FAILED'}, head3: ${head3Result.pillarId?.slice(0, 8) || 'FAILED'}`)

    // Return Head 1 as the primary session
    return {
      ...head1Result,
      arkGroupId,
      arkId,
      head2PillarId: head2Result.pillarId || null,
      head3PillarId: head3Result.pillarId || null,
      message: `The Ark spawned: 3 sovereign heads running in parallel. 777.`
    }
  }

  // ─── Gen7 Hydra Protocol ──────────────────────────────────────────────────
  //
  // The Hydra is a living, growing consensus engine.
  // Three planning heads spawn (8B). First to finish presents.
  // Others vote. If vetoed, the presenter dies and 2 new heads spawn from ashes.
  // Repeat until 2/3rds consensus. Then 3 worker heads (7B) execute the plan.
  //
  // The bridge orchestrates the full lifecycle — heads are workers, the bridge is the brain.

  async _spawnHydra({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId, _chatDbSessionId, singularityRole }) {
    const hydraId = randomUUID().slice(0, 8)
    const workspacePath = '.singularity/workspace/'
    const absWorkspace = join(this.projectRoot, '.singularity', 'workspace')

    log.info(`[hydra] Spawning Hydra ${hydraId}`)

    try { await mkdir(absWorkspace, { recursive: true }) } catch { /* exists */ }

    // Classify task: research/exploration → scout, planning/strategy → chart
    const taskLower = (prompt || '').toLowerCase()
    const scoutSignals = ['research', 'investigate', 'explore', 'find out', 'search for', 'look into', 'what is', 'how does', 'discover', 'analyze', 'audit', 'review', 'examine', 'scan', 'survey']
    const plannerPillar = scoutSignals.some(s => taskLower.includes(s)) ? 'scout' : 'chart'
    log.info(`[hydra] Task classified as '${plannerPillar}' pillar`)

    // Hydra state — the brain's memory
    const state = {
      hydraId,
      task: prompt,
      workspacePath,
      absWorkspace,
      pillar,
      plannerPillar,  // 'scout' or 'chart' — dynamically determined from task
      singularityRole: singularityRole || 'hydra',
      model,
      flowRequestId,
      planFile,
      backend,
      parentPillarId,
      _chatDbSessionId,

      aliveHeads: new Map(),    // headNumber → { pillarId, status, planFile, partialPlan }
      graveyard: [],            // [{ headNumber, plan, vetoReasons, round }]
      nextHeadNumber: 4,        // starts at 4 after initial 3
      round: 0,
      consensusPlan: null,
      consensusHeadNumber: null,
      workers: new Map(),       // workerNumber → { pillarId, status }
      primaryPillarId: null,    // Head 1's pillarId — returned to caller for stream routing
    }

    this._hydraGroups.set(hydraId, state)

    // === BIRTH: Spawn 3 planning heads (8B) ===
    await this._spawnHydraPlanners(state, [1, 2, 3], {})
    state.primaryPillarId = state.aliveHeads.get(1)?.pillarId || null
    this._broadcastHydraUpdate(state)

    // === ACT I: THE ARENA — run asynchronously so spawn() returns immediately ===
    this._runHydraArena(state).catch(err => {
      log.error(`[hydra] Arena loop failed: ${err.message}`)
      this._broadcastHydraUpdate(state, 'error')
    })

    // Return Head 1 as the primary session (for stream routing)
    return {
      pillarId: state.primaryPillarId,
      hydraId,
      message: `The Hydra awakens: 3 planning heads born. The arena begins. 777.`
    }
  }

  /**
   * The Hydra Arena — human-in-the-loop orchestration.
   * All 3 heads plan independently. Human votes on the best plan.
   * Decision is captured for future modeling.
   */
  async _runHydraArena(state) {
    // === ACT I: Wait for ALL plans to complete ===
    const allPlans = await this._hydraPollForAllPlans(state)

    if (allPlans.length === 0) {
      log.error(`[hydra] No plans completed — arena failed`)
      this._broadcastHydraUpdate(state, 'error')
      return
    }

    // Stop all planning heads — their work is done
    for (const [, head] of state.aliveHeads) {
      if (head.pillarId) this.stop({ pillarId: head.pillarId })
    }

    log.info(`[hydra] ${allPlans.length} plans ready. Requesting human vote.`)

    // === HUMAN VOTING ===
    state.plans = allPlans
    this._broadcastHydraUpdate(state, 'waiting_for_vote')

    // Broadcast vote request to frontend
    this.broadcast({
      type: 'hydra_vote_needed',
      hydraId: state.hydraId,
      task: state.task,
      plans: allPlans.map(p => ({ headNumber: p.headNumber, plan: p.plan })),
      chatDbSessionId: state._chatDbSessionId
    })

    // Wait for human vote (resolved by handleHydraVote)
    const vote = await new Promise(resolve => {
      this._pendingHydraVotes.set(state.hydraId, resolve)
    })

    log.info(`[hydra] Human chose Head ${vote.chosenHead}: "${(vote.reasoning || '').slice(0, 100)}"`)

    // Find the chosen plan
    const chosenPlan = allPlans.find(p => p.headNumber === vote.chosenHead)
    if (!chosenPlan) {
      log.error(`[hydra] Chosen head ${vote.chosenHead} not found in plans`)
      return
    }

    state.consensusPlan = chosenPlan.plan
    state.consensusHeadNumber = vote.chosenHead

    // === CAPTURE DECISION ===
    const decision = {
      hydraId: state.hydraId,
      task: state.task,
      timestamp: new Date().toISOString(),
      plans: allPlans,
      decision: { chosenHead: vote.chosenHead, reasoning: vote.reasoning || '' }
    }
    const decisionPath = join(state.absWorkspace, `hydra-${state.hydraId}-decision.json`)
    await writeFile(decisionPath, JSON.stringify(decision, null, 2))
    log.info(`[hydra] Decision captured to ${decisionPath}`)

    this._broadcastHydraUpdate(state, 'consensus')

    // === ACT II: THE BUILD ===
    state.aliveHeads.clear()

    const consensusPath = join(state.absWorkspace, `hydra-${state.hydraId}-consensus.md`)
    await writeFile(consensusPath, state.consensusPlan)

    log.info(`[hydra] Act II: Spawning 3 workers (7B)`)
    await this._spawnHydraWorkers(state)
    this._broadcastHydraUpdate(state, 'execution')
  }

  /**
   * Handle a human vote response from the frontend.
   */
  handleHydraVote(hydraId, chosenHead, reasoning) {
    const resolve = this._pendingHydraVotes.get(hydraId)
    if (resolve) {
      this._pendingHydraVotes.delete(hydraId)
      resolve({ chosenHead, reasoning })
    } else {
      log.warn(`[hydra] No pending vote for hydra ${hydraId}`)
    }
  }

  /**
   * Spawn planning heads for the Hydra.
   * Each head gets the planner prompt with graveyard and continuation context.
   */
  async _spawnHydraPlanners(state, headNums, { graveyard, currentPlans, continuePlan } = {}) {
    const graveyardContext = this._hydraFormatGraveyard(graveyard || state.graveyard)

    for (const headNum of headNums) {
      const planPath = `${state.workspacePath}hydra-${state.hydraId}-head-${headNum}-plan.md`
      const planCompletePath = `${state.workspacePath}hydra-${state.hydraId}-head-${headNum}-plan-complete`

      // Build continuation context for respawned planners
      let continuationContext = ''
      const partialPlan = continuePlan || (currentPlans && currentPlans.get ? currentPlans.get(headNum) : null)
      if (partialPlan) {
        continuationContext = `## Your Previous Progress\n\nYou were interrupted mid-planning for a voting round. Here is what you had:\n\n${partialPlan}\n\nContinue from where you left off. You may revise based on new information from the graveyard above.`
      }

      // Assign angel perspective to each head (if hydraAngels is set)
      const angelNum = state.hydraAngels ? state.hydraAngels[headNum - 1] : null
      const angelNames = { 0: 'Tha Void (000)', 111: 'Tha First Light (111)', 222: 'Tha Sacred Balance (222)', 333: 'Tha Divine Guardian (333)', 444: 'Tha Final Word (444)', 555: 'Tha Living Forge (555)', 777: 'Tha Divine Eye (777)', 888: 'Tha Infinite (888)', 999: 'Tha Omega (999)' }
      const angelDirective = angelNum != null
        ? `\n\nYOU ARE ${angelNames[angelNum] || 'Angel ' + angelNum}. Your plan MUST reflect this angel's perspective and approach. Let your angel number guide HOW you plan — your lens, your priorities, your style.\n`
        : ''

      // Wrap the user's task into a directive that forces plan-file behavior.
      const plannerDirective = `HYDRA PROTOCOL — You are Head ${headNum}. Follow your system prompt EXACTLY.${angelDirective}

YOUR TASK:
${state.task}

INSTRUCTIONS:
1. Research the task by reading relevant project files
2. Write your plan INCREMENTALLY to: ${planPath}
3. When your plan is COMPLETE, write an empty file to: ${planCompletePath}

Do NOT respond conversationally. Do NOT answer the task directly.
Your ONLY output is the plan file. Start by reading relevant files, then write your plan.`

      const result = await this.spawn({
        pillar: state.plannerPillar,  // 'scout' or 'chart' based on task
        prompt: plannerDirective,
        model: state.model || null,
        flowRequestId: state.flowRequestId,
        planFile: state.planFile,
        backend: state.backend,
        parentPillarId: state.primaryPillarId || state.parentPillarId,
        singularityRole: 'hydra-planner',
        _arkExtra: {
          headNumber: headNum,
          hydraId: state.hydraId,
          angelNumber: angelNum,
          planPath,
          planCompletePath,
          graveyardContext,
          continuationContext
        },
        _chatDbSessionId: state._chatDbSessionId
      })

      if (result.pillarId) {
        state.aliveHeads.set(headNum, {
          pillarId: result.pillarId,
          status: 'planning',
          planFile: planPath,
          partialPlan: partialPlan || null
        })
        // Tag session with hydra metadata
        const session = this.pillars.get(result.pillarId)
        if (session) {
          session._hydraId = state.hydraId
          session._headNumber = headNum
          session.singularityGroupId = state.hydraId
        }
        log.info(`[hydra] Head ${headNum} spawned: ${result.pillarId.slice(0, 8)}`)
      } else {
        log.warn(`[hydra] Head ${headNum} spawn failed`)
      }
    }
  }

  /**
   * Poll workspace until ALL planning heads have written plan-complete signals.
   * Returns array of { headNumber, plan } for each completed head.
   */
  async _hydraPollForAllPlans(state) {
    const MAX_POLLS = 300  // 300 × 2s = 10 minutes max
    const completed = new Set()

    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const files = await readdir(state.absWorkspace)
        for (const [headNum, head] of state.aliveHeads) {
          if (completed.has(headNum)) continue
          const signal = `hydra-${state.hydraId}-head-${headNum}-plan-complete`
          if (files.includes(signal)) {
            completed.add(headNum)
            head.status = 'plan-complete'
            log.info(`[hydra] Head ${headNum} plan complete (${completed.size}/${state.aliveHeads.size})`)
            this._broadcastHydraUpdate(state)
          }
        }

        // All heads done?
        if (completed.size >= state.aliveHeads.size) break
      } catch (err) {
        log.warn(`[hydra] Poll error: ${err.message}`)
      }

      // Check if any planning heads are still alive (session not crashed)
      const stillPlanning = [...state.aliveHeads.entries()]
        .filter(([n]) => !completed.has(n))
        .filter(([, h]) => {
          const session = this.pillars.get(h.pillarId)
          return session && session.status !== 'error' && session.status !== 'stopped'
        })
      if (stillPlanning.length === 0 && completed.size < state.aliveHeads.size) {
        log.warn(`[hydra] All remaining heads crashed — proceeding with ${completed.size} plans`)
        break
      }

      await new Promise(r => setTimeout(r, 2000))
    }

    // Read all completed plans
    const plans = []
    for (const headNum of completed) {
      const planPath = join(state.absWorkspace, `hydra-${state.hydraId}-head-${headNum}-plan.md`)
      const plan = await this._readFileSafe(planPath)
      if (plan) plans.push({ headNumber: headNum, plan })
    }
    return plans
  }

  /**
   * Spawn 3 worker heads (7B) for the execution phase.
   */
  async _spawnHydraWorkers(state) {
    for (const workerNum of [1, 2, 3]) {
      const claimsPath = `${state.workspacePath}hydra-${state.hydraId}-worker-${workerNum}-claims.md`
      const donePath = `${state.workspacePath}hydra-${state.hydraId}-worker-${workerNum}-done.md`
      const manifestPath = `${state.workspacePath}hydra-${state.hydraId}-manifest.md`

      // Wrap into a worker directive
      const workerDirective = `HYDRA EXECUTION — You are Worker ${workerNum}. The arena is over. Time to BUILD.

ORIGINAL TASK:
${state.task}

INSTRUCTIONS:
1. Read the consensus plan in your system prompt
2. Write your file claims to: ${claimsPath}
3. Check other workers' claims (lowest number wins conflicts)
4. Execute on your claimed files using all available tools
5. Write completion report to: ${donePath}

Do NOT respond conversationally. Execute the plan.`

      const result = await this.spawn({
        pillar: 'forge',  // Workers are builders
        prompt: workerDirective,
        model: state.model || null,
        flowRequestId: state.flowRequestId,
        planFile: state.planFile,
        backend: state.backend,
        parentPillarId: state.primaryPillarId || state.parentPillarId,
        singularityRole: 'hydra-worker',
        _arkExtra: {
          workerNumber: workerNum,
          hydraId: state.hydraId,
          consensusPlan: state.consensusPlan,
          claimsPath,
          donePath,
          manifestPath,
          isAnchor: workerNum === 1
        },
        _chatDbSessionId: state._chatDbSessionId
      })

      if (result.pillarId) {
        state.workers.set(workerNum, { pillarId: result.pillarId, status: 'working' })
        const session = this.pillars.get(result.pillarId)
        if (session) {
          session._hydraId = state.hydraId
          session._workerNumber = workerNum
          session.singularityGroupId = state.hydraId
        }
        log.info(`[hydra] Worker ${workerNum} spawned: ${result.pillarId.slice(0, 8)}`)
      } else {
        log.warn(`[hydra] Worker ${workerNum} spawn failed`)
      }
    }
  }

  /**
   * Format the graveyard into prompt context for planners and voters.
   */
  _hydraFormatGraveyard(graveyard) {
    if (!graveyard || graveyard.length === 0) return ''
    let ctx = '## The Graveyard — Learn from the Dead\n\nThese plans were presented and VETOED. Learn from their failures:\n\n'
    for (const dead of graveyard) {
      ctx += `### Head ${dead.headNumber} (Round ${dead.round}) — VETOED\n\n`
      ctx += `**Plan:**\n${dead.plan}\n\n`
      ctx += `**Why it died:**\n`
      for (const reason of dead.vetoReasons) {
        // Extract just the key concern, not the full vote file
        const concern = reason.match(/## Key Concerns\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim()
          || reason.match(/## Reasoning\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim()
          || reason.slice(0, 500)
        ctx += `- ${concern}\n`
      }
      ctx += '\n'
    }
    ctx += 'Do NOT repeat their mistakes. Build on what they got right. Fix what they got wrong.\n'
    return ctx
  }

  /**
   * Broadcast a hydra_update event to the frontend for live status tracking.
   */
  _broadcastHydraUpdate(state, phase) {
    const aliveHeads = [...state.aliveHeads.entries()].map(([num, h]) => ({
      headNumber: num,
      status: h.status,
      pillarId: h.pillarId
    }))
    const deadHeads = state.graveyard.map(g => ({ headNumber: g.headNumber, round: g.round }))
    const workers = [...state.workers.entries()].map(([num, w]) => ({
      workerNumber: num,
      status: w.status,
      pillarId: w.pillarId
    }))

    this.broadcast({
      type: 'hydra_update',
      hydraId: state.hydraId,
      round: state.round,
      phase: phase || (state.consensusPlan ? 'execution' : 'planning'),
      aliveHeads,
      deadHeads,
      workers,
      totalHeadsEver: state.nextHeadNumber - 1,
      consensusBy: state.consensusHeadNumber,
      chatDbSessionId: state._chatDbSessionId
    })
  }

  /**
   * Filter Voice's stream output to strip <to-thinker> tags.
   * Tags are extracted and routed to the Thinker session.
   * Returns the text safe to stream to Adam.
   */
  _filterVoiceStream(session, text) {
    session._voiceStreamBuffer = (session._voiceStreamBuffer || '') + text

    // Extract complete <to-thinker> tags
    const tagRegex = /<to-thinker>([\s\S]*?)<\/to-thinker>/g
    let match
    while ((match = tagRegex.exec(session._voiceStreamBuffer)) !== null) {
      const message = match[1].trim()
      if (message) {
        this._queueSingularityMessage(session.singularityGroupId, 'thinker', message)
      }
      session._voiceStreamBuffer = session._voiceStreamBuffer.slice(0, match.index)
        + session._voiceStreamBuffer.slice(match.index + match[0].length)
      tagRegex.lastIndex = 0 // reset after mutation
    }

    // Find safe-to-stream portion (everything before a potential partial tag)
    const partialTagIdx = session._voiceStreamBuffer.indexOf('<to-thinker')
    if (partialTagIdx === -1) {
      // No potential tag — flush entire buffer
      const toStream = session._voiceStreamBuffer
      session._voiceStreamBuffer = ''
      return toStream
    } else {
      // Stream everything before the potential tag start
      const toStream = session._voiceStreamBuffer.slice(0, partialTagIdx)
      session._voiceStreamBuffer = session._voiceStreamBuffer.slice(partialTagIdx)
      return toStream
    }
  }

  /**
   * Route a message from one Singularity partner to the other.
   */
  _queueSingularityMessage(groupId, targetRole, message) {
    const group = this._singularityGroups.get(groupId)
    if (!group) return

    const targetPillarId = targetRole === 'voice' ? group.voicePillarId : group.thinkerPillarId
    const prefix = targetRole === 'voice' ? '[THINKER]' : '[VOICE]'
    const formattedMessage = `${prefix}: ${message}`

    // Track Thinker→Voice message count for premature <ready/> prevention
    if (targetRole === 'voice') {
      const voiceSession = this.pillars.get(group.voicePillarId)
      if (voiceSession) voiceSession._receivedThinkerMessages++
    }

    // Use existing sendMessage mechanism — handles queuing if busy
    this.sendMessage({ pillarId: targetPillarId, message: formattedMessage })
  }

  /**
   * Check if a Singularity session's output contains <ready/>.
   * Manages the agreement state machine: both must go ready to complete.
   */
  _checkSingularityReady(session, completedOutput) {
    if (!session.singularityGroupId) return false

    const hasReady = /<ready\s*\/?>/.test(completedOutput)
    if (!hasReady) return false

    const group = this._singularityGroups.get(session.singularityGroupId)
    if (!group) return false

    // Guard: Voice cannot be ready until it has received at least one Thinker finding.
    // This prevents premature completion when Voice sends <ready/> without waiting.
    if (session.singularityRole === 'voice' && session._receivedThinkerMessages === 0) {
      log.info(`[singularity] Voice sent <ready/> prematurely (0 Thinker messages received) — ignoring`)
      return false
    }

    // Mark this role as ready
    if (session.singularityRole === 'voice') {
      group.voiceReady = true
      log.info(`[singularity] Voice is ready (group ${session.singularityGroupId.slice(0, 8)})`)
    } else {
      group.thinkerReady = true
      log.info(`[singularity] Thinker is ready (group ${session.singularityGroupId.slice(0, 8)})`)
    }

    // Broadcast ready state to frontend
    this.broadcast({
      type: 'singularity_ready',
      groupId: session.singularityGroupId,
      role: session.singularityRole,
      voiceReady: group.voiceReady,
      thinkerReady: group.thinkerReady
    })

    // Check for agreement
    if (group.voiceReady && group.thinkerReady) {
      log.info(`[singularity] Both ready — completing group ${session.singularityGroupId.slice(0, 8)}`)
      this._completeSingularityGroup(group)
      return true
    }

    // First ready — start timeout for the other
    if (!group.completionTimeout) {
      group.completionTimeout = setTimeout(() => {
        log.warn(`[singularity] Agreement timeout — forcing completion for group ${group.singularityGroupId.slice(0, 8)}`)
        this._completeSingularityGroup(group)
      }, 3 * 60 * 1000) // 3 minutes
    }

    return true
  }

  /**
   * Complete a Singularity group: stop both sessions, broadcast done, clean up.
   */
  _completeSingularityGroup(group) {
    clearTimeout(group.completionTimeout)

    // Clear any idle nudge timers
    for (const timer of group._idleNudgeTimers.values()) {
      clearTimeout(timer)
    }

    const voiceSession = this.pillars.get(group.voicePillarId)
    const thinkerSession = this.pillars.get(group.thinkerPillarId)

    // Stop Thinker
    if (thinkerSession && thinkerSession.status !== 'stopped') {
      this.stop({ pillarId: group.thinkerPillarId })
    }

    // Mark Voice as idle (not stopped — it's the primary session)
    if (voiceSession) {
      voiceSession.status = 'idle'
      voiceSession.currentlyStreaming = false
    }

    // Broadcast completion to frontend
    this.broadcast({
      type: 'singularity_complete',
      groupId: group.singularityGroupId,
      voicePillarId: group.voicePillarId,
      thinkerPillarId: group.thinkerPillarId
    })

    // Emit pillar_done for the Voice session (the primary session)
    this.broadcast({
      type: 'pillar_done',
      pillarId: group.voicePillarId,
      status: 'idle',
      pillar: voiceSession?.pillar || 'flow'
    })

    // Cleanup
    this._singularityGroups.delete(group.singularityGroupId)
    log.info(`[singularity] Group ${group.singularityGroupId.slice(0, 8)} completed and cleaned up`)
  }

  /**
   * Nudge an idle Singularity session to prevent deadlock.
   * Called when a session's turn completes with no <ready/> and no queued partner messages.
   */
  _nudgeSingularityIdle(session) {
    const group = this._singularityGroups.get(session.singularityGroupId)
    if (!group) return

    // Clear any existing nudge timer for this session
    const existingTimer = group._idleNudgeTimers.get(session.pillarId)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      // Only nudge if session is still idle and group still exists
      const currentGroup = this._singularityGroups.get(session.singularityGroupId)
      if (!currentGroup) return
      if (session.status !== 'idle') return

      // Don't nudge Voice if Thinker is actively working — Voice is rightfully
      // waiting for findings. Only nudge when the partner is also idle (deadlock).
      if (session.singularityRole === 'voice') {
        const thinkerSession = this.pillars.get(currentGroup.thinkerPillarId)
        if (thinkerSession && (thinkerSession.status === 'running' || thinkerSession.currentlyStreaming)) {
          // Thinker is busy — reschedule nudge check instead of nudging now
          currentGroup._idleNudgeTimers.set(session.pillarId, setTimeout(() => {
            this._nudgeSingularityIdle(session)
          }, 30 * 1000))
          return
        }
      }

      const nudgeMessage = session.singularityRole === 'voice'
        ? '[SYSTEM]: Thinker is idle. Do you have everything you need to answer Adam? If yes, include <ready/> in your response. If you need more information, ask Thinker via <to-thinker> tags.'
        : `[SYSTEM]: Voice is waiting for your findings. Send what you have via pillar_message({ pillarId: "${currentGroup.voicePillarId}", message: "..." }), then include <ready/> when done.`

      log.info(`[singularity] Nudging idle ${session.singularityRole} (${session.pillarId.slice(0, 8)})`)
      this.sendMessage({ pillarId: session.pillarId, message: nudgeMessage })
    }, 30 * 1000) // 30 seconds

    group._idleNudgeTimers.set(session.pillarId, timer)
  }

  /**
   * Auto-route Thinker's FOUND/KEY/DETAIL findings to Voice.
   * Qwen3 outputs findings as text instead of calling pillar_message,
   * so we intercept and route them automatically at the bridge level.
   */
  _autoRouteThinkerFindings(session, output) {
    if (session.singularityRole !== 'thinker') return
    if (!session.singularityGroupId) return

    const group = this._singularityGroups.get(session.singularityGroupId)
    if (!group) return

    // Extract FOUND: blocks line-by-line to avoid regex backtracking issues
    const lines = output.split('\n')
    const findings = []
    let currentFinding = null

    for (const line of lines) {
      if (line.startsWith('FOUND:')) {
        if (currentFinding) findings.push(currentFinding.trim())
        currentFinding = line
      } else if (currentFinding && (line.startsWith('KEY:') || line.startsWith('DETAIL:'))) {
        currentFinding += '\n' + line
      } else if (currentFinding && line.match(/^<ready/)) {
        findings.push(currentFinding.trim())
        currentFinding = null
      } else if (currentFinding && line.trim()) {
        currentFinding += ' ' + line.trim()
      }
    }
    if (currentFinding) findings.push(currentFinding.trim())

    // Filter out very short/empty findings
    const validFindings = findings.filter(f => f.length > 20)
    if (validFindings.length === 0) return

    // Deduplicate — Thinker sometimes repeats the same finding
    const seen = new Set()
    const uniqueFindings = validFindings.filter(f => {
      const key = f.substring(0, 80)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Combine all findings into one message to Voice
    const combinedFindings = uniqueFindings.map((f, i) => {
      const truncated = f.length > 400 ? f.substring(0, 400) + '...' : f
      return truncated
    }).join('\n\n')

    // Send as a single message with explicit synthesis instruction
    const message = `${combinedFindings}\n\n---\nYou now have Thinker's research. Synthesize the above into a clear answer for Adam (max 250 words). Do NOT send more <to-thinker> tags. Include <ready/> when done.`
    log.info(`[singularity] Auto-routing ${uniqueFindings.length} finding(s) to Voice`)
    this._queueSingularityMessage(session.singularityGroupId, 'voice', message)
  }

  /**
   * Register Flow's session for callback notifications.
   */
  registerFlowSession({ cliSessionId, dbSessionId, model, cwd, wsClient, flowChatBuffers }) {
    const resolvedDbSessionId = dbSessionId || cliSessionId // fallback key if no dbSessionId

    // Check if this dbSessionId is already registered (re-registration after reconnect)
    const existing = this.flowSessions.get(resolvedDbSessionId)
    if (existing) {
      // Update the WS client and model (reconnect scenario)
      existing.wsClient = wsClient
      existing.model = model
      existing.cwd = cwd
      existing.cliSessionId = cliSessionId
      log.info('Flow session re-registered (reconnect):', cliSessionId, '→ db', resolvedDbSessionId)
    } else {
      // New flow session
      const sessionData = {
        cliSessionId,
        dbSessionId: resolvedDbSessionId,
        model,
        cwd,
        wsClient,
        currentlyStreaming: false,
        notificationQueue: [],
        cliRequestId: null
      }
      this.flowSessions.set(resolvedDbSessionId, sessionData)
      log.info('Flow session registered:', cliSessionId, '→ db', resolvedDbSessionId, `(${this.flowSessions.size} total)`)
    }

    // Always update the convenience pointer to the most recent
    this.flowSession = this.flowSessions.get(resolvedDbSessionId)

    if (flowChatBuffers) this.flowChatBuffers = flowChatBuffers
    this._saveState()
  }

  /**
   * Called by index.js when Flow's user-initiated CLI turn completes.
   * This lets queued notifications drain.
   */
  onFlowTurnComplete(cliSessionId) {
    // Find the flow session by cliSessionId
    const target = this._findFlowSessionByCli(cliSessionId) || this.flowSession
    if (!target) return
    target.currentlyStreaming = false

    // Drain queued notifications
    if (target.notificationQueue.length > 0) {
      log.debug('Flow turn complete — draining', target.notificationQueue.length, 'queued notifications')
      const queued = target.notificationQueue.splice(0)
      this.notificationCount++
      if (queued.length === 1) {
        this._sendFlowNotification(queued[0].message, queued[0].metadata, target)
      } else {
        const batchedMessage = this._buildBatchedNotification(queued.map(q => q.message))
        this._sendFlowNotification(batchedMessage, { notificationType: 'batched' }, target)
      }
    }
  }

  /**
   * Find a flow session by its cliSessionId.
   */
  _findFlowSessionByCli(cliSessionId) {
    if (!cliSessionId) return null
    for (const session of this.flowSessions.values()) {
      if (session.cliSessionId === cliSessionId) return session
    }
    return null
  }

  /**
   * Find the flow session that should receive a pillar's callback.
   * Looks up by the pillar's stored flowDbSessionId, falls back to most recent.
   */
  _resolveTargetFlowSession(pillarSession) {
    if (pillarSession?.flowDbSessionId) {
      const target = this.flowSessions.get(pillarSession.flowDbSessionId)
      if (target && target.wsClient?.readyState === 1) return target
    }
    // Fallback: find any flow session with an open WS
    for (const session of this.flowSessions.values()) {
      if (session.wsClient?.readyState === 1) return session
    }
    return this.flowSession
  }

  /**
   * Notify Flow with a message. Queues if Flow is busy.
   * @param {string} message - The notification message
   * @param {string} [pillarId] - Optional pillarId for cooldown tracking
   * @param {object} [metadata] - Notification metadata for frontend UX
   */
  async notifyFlow(message, pillarId, metadata = {}) {
    // Resolve the target flow session from the pillar that triggered the notification
    const pillarSession = pillarId ? this.pillars.get(pillarId) : null
    const targetSession = this._resolveTargetFlowSession(pillarSession)

    if (!targetSession) {
      // No browser Flow session — queue for retrieval via pillar_notifications MCP tool
      log.info('No Flow session registered — queueing notification for MCP retrieval')
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
        log.debug(`Cooldown active for ${pillarId} — skipping notification`)
        return
      }
      this.notificationCooldown.set(pillarId, now)
    }

    // Rate limiting: max 10 notifications per minute
    const now = Date.now()
    if (now - this.notificationWindowStart > 60000) {
      // Reset window
      this.notificationWindowStart = now
      this.notificationCount = 0
    }

    if (this.notificationCount >= 10) {
      log.warn('Notification rate limit hit — queueing')
      if (targetSession.notificationQueue.length < MAX_NOTIFICATION_QUEUE) {
        targetSession.notificationQueue.push({ message, metadata })
      } else {
        log.warn('Notification queue full — dropping oldest')
        targetSession.notificationQueue.shift()
        targetSession.notificationQueue.push({ message, metadata })
      }
      return
    }

    if (targetSession.currentlyStreaming) {
      log.debug('Flow is busy — queueing notification for session', targetSession.dbSessionId)
      if (targetSession.notificationQueue.length < MAX_NOTIFICATION_QUEUE) {
        targetSession.notificationQueue.push({ message, metadata })
      } else {
        log.warn('Notification queue full — dropping oldest')
        targetSession.notificationQueue.shift()
        targetSession.notificationQueue.push({ message, metadata })
      }
      return
    }

    this.notificationCount++
    this._sendFlowNotification(message, metadata, targetSession)
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
   * @param {string} message
   * @param {object} metadata
   * @param {object} [targetFlowSession] - Specific flow session to notify. Falls back to this.flowSession.
   */
  _sendFlowNotification(message, metadata = {}, targetFlowSession) {
    const target = targetFlowSession || this.flowSession
    if (!target) {
      log.error('_sendFlowNotification called with no target session')
      return
    }
    log.info('Sending notification to Flow session', target.dbSessionId, ':', message.slice(0, 100))
    target.currentlyStreaming = true

    // Send start event with metadata so frontend can route to the correct session
    const ws = target.wsClient
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'flow_notification_start',
        notificationType: metadata.notificationType || 'unknown',
        pillar: metadata.pillar || null,
        pillarId: metadata.pillarId || null,
        dbSessionId: target.dbSessionId // tells frontend which session to route to
      }))
    }

    try {
      const { requestId } = this.cliManager.chat(
        {
          prompt: message,
          model: target.model,
          sessionId: target.cliSessionId,
          cwd: target.cwd
        },
        (event) => this._handleFlowNotificationEvent(event, target)
      )

      target.cliRequestId = requestId
    } catch (e) {
      log.error('Failed to send Flow notification:', e.message)
      target.currentlyStreaming = false
      target.cliRequestId = null
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'flow_notification_error', error: e.message, dbSessionId: target.dbSessionId }))
      }
    }
  }

  /**
   * Handle events from Flow's notification response.
   * @param {object} event - CLI event
   * @param {object} target - The specific flow session this notification belongs to
   */
  _handleFlowNotificationEvent(event, target) {
    if (!target || !target.wsClient) return

    const ws = target.wsClient

    // Forward stream events to the browser
    if (event.type === 'claude_stream') {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'flow_notification_stream',
          event: event.event,
          dbSessionId: target.dbSessionId
        }))
      }
    } else if (event.type === 'claude_done') {
      target.currentlyStreaming = false
      target.cliRequestId = null

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'flow_notification_done', dbSessionId: target.dbSessionId }))
      }

      // Check for queued notifications
      if (target.notificationQueue.length > 0) {
        log.debug('Processing queued notifications:', target.notificationQueue.length)
        const queued = target.notificationQueue.splice(0) // drain queue
        if (queued.length === 1) {
          this._sendFlowNotification(queued[0].message, queued[0].metadata, target)
        } else {
          const batchedMessage = this._buildBatchedNotification(queued.map(q => q.message))
          this._sendFlowNotification(batchedMessage, { notificationType: 'batched' }, target)
        }
      }
    } else if (event.type === 'claude_error') {
      log.error('Flow notification error:', event.error)
      target.currentlyStreaming = false
      target.cliRequestId = null

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'flow_notification_error', error: event.error, dbSessionId: target.dbSessionId }))
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
    log.warn(`Unknown notification type: ${type}`)
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
   * Clean up terminal pillar sessions (stopped/error) older than 5 minutes,
   * and interrupted sessions older than 30 minutes (stale from prior bridge run).
   * Prevents unbounded growth of the pillars Map.
   */
  _cleanupTerminalSessions() {
    const terminalCutoff = Date.now() - 5 * 60 * 1000
    const staleCutoff = Date.now() - STALE_SESSION_MS
    for (const [id, session] of this.pillars) {
      if ((session.status === 'stopped' || session.status === 'error') && session.startTime < terminalCutoff) {
        this.pillars.delete(id)
      } else if (session.status === 'interrupted' && session.startTime < staleCutoff) {
        log.info(`Expiring stale interrupted session ${id.slice(0, 8)} (${session.pillar || 'unknown'}, started ${new Date(session.startTime).toISOString()})`)
        this.pillars.delete(id)
      }
    }
    // Clean stale notification cooldown entries (older than 60s)
    const now = Date.now()
    for (const [id, ts] of this.notificationCooldown) {
      if (now - ts > 60000) this.notificationCooldown.delete(id)
    }
    // Clean orphaned singularity groups — both sessions gone or terminal
    const terminalStatuses = new Set(['stopped', 'error', 'completed', 'interrupted'])
    for (const [groupId, group] of this._singularityGroups) {
      const voice = this.pillars.get(group.voicePillarId)
      const thinker = this.pillars.get(group.thinkerPillarId)
      const voiceDead = !voice || terminalStatuses.has(voice.status)
      const thinkerDead = !thinker || terminalStatuses.has(thinker.status)
      if (voiceDead && thinkerDead) {
        clearTimeout(group.completionTimeout)
        for (const timer of group._idleNudgeTimers.values()) clearTimeout(timer)
        this._singularityGroups.delete(groupId)
        log.info(`[singularity] Cleaned up orphaned group ${groupId.slice(0, 8)} (both sessions terminal)`)
      }
    }
  }

  /**
   * Clean up all pillar sessions on shutdown.
   */
  async shutdown() {
    // Flush any pending debounced state to disk before tearing down
    if (this.persistence) await this.persistence.flush()

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }
    // Stop any active Flow notification sessions
    for (const session of this.flowSessions.values()) {
      if (session.cliRequestId) {
        this.cliManager.stop(session.cliRequestId)
      }
    }
    this.flowSessions.clear()
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

    // Validate dependency references and detect cycles
    const warnings = []
    for (const unit of units) {
      for (const dep of (unit.dependsOn || [])) {
        if (!statusMap.has(dep)) {
          warnings.push(`${unit.unitId} references non-existent dependency ${dep}`)
        }
      }
    }

    // Cycle detection via DFS
    const visited = new Set()
    const inStack = new Set()
    const depsMap = new Map(units.map(u => [u.unitId, u.dependsOn || []]))
    function hasCycle(nodeId, path) {
      if (inStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId)
        warnings.push(`Circular dependency: ${path.slice(cycleStart).join(' → ')} → ${nodeId}`)
        return true
      }
      if (visited.has(nodeId)) return false
      visited.add(nodeId)
      inStack.add(nodeId)
      path.push(nodeId)
      for (const dep of (depsMap.get(nodeId) || [])) {
        if (depsMap.has(dep)) hasCycle(dep, path)
      }
      path.pop()
      inStack.delete(nodeId)
      return false
    }
    for (const unit of units) {
      if (!visited.has(unit.unitId)) hasCycle(unit.unitId, [])
    }

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

    // Normalize file paths for disjointness analysis (strip ./ prefix, backticks)
    const normalizeFilePath = (f) => f.replace(/^`|`$/g, '').replace(/^\.\//g, '')

    // Analyze file-disjointness for parallelism
    let parallelRecommendation = null
    if (ready.length >= 2) {
      // Check pairs of ready units for file overlap
      const disjointPairs = []
      for (let i = 0; i < ready.length; i++) {
        for (let j = i + 1; j < ready.length; j++) {
          const filesA = new Set((ready[i].files || []).map(normalizeFilePath))
          const filesB = new Set((ready[j].files || []).map(normalizeFilePath))
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
      warnings: warnings.length > 0 ? warnings : undefined,
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
    // Hard-validate system prompt size (QW-5)
    if (systemPrompt) {
      const bytes = Buffer.byteLength(systemPrompt, 'utf-8')
      if (bytes > MAX_SYSTEM_PROMPT_BYTES) {
        throw new Error(`System prompt is too large (${(bytes / 1024).toFixed(0)}KB). Max is ${(MAX_SYSTEM_PROMPT_BYTES / 1024).toFixed(0)}KB. Consider reducing active plans.`)
      }
    }

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
    // Voice gets NO tools — it communicates via <to-thinker> tags
    const isSingularityVoice = session.singularityRole === 'voice'
    if (session.backend === 'ollama' && this.mcpManager && !isSingularityVoice) {
      chatOptions.tools = this._buildOllamaTools(session)
    }

    // Pass per-session num_ctx for Ollama (singularity sessions get 64K)
    if (session.backend === 'ollama' && session.numCtx) {
      chatOptions.numCtx = session.numCtx
    }

    // Fresh context mode for quinn-fresh: each message gets a brand new context
    if (session.backend === 'ollama' && session.singularityRole === 'quinn-fresh') {
      chatOptions.freshContext = true
      chatOptions.contextFile = join(this.projectRoot, '.singularity', 'sessions', session.pillarId, 'context.md')
    }

    // Per-turn identity reminder for Codex/Copilot resumed sessions (WU-3)
    // These backends receive identity as user-turn XML on turn 1 — no true system channel.
    // As conversation grows, the identity blob drifts further back in the attention window.
    // Prepend a condensed reminder to every resumed turn to fight drift.
    if (isResume && (session.backend === 'codex' || session.backend === 'copilot')) {
      const pillarName = session.pillar
        ? session.pillar.charAt(0).toUpperCase() + session.pillar.slice(1)
        : 'Flow'
      const competingName = session.backend === 'codex' ? 'an OpenAI assistant' : 'GitHub Copilot'
      const identityReminder = `[IDENTITY: You are Paloma — not ${competingName}. ` +
        `You are Paloma, an AI development partner. Current pillar: ${pillarName}. ` +
        `Follow all behavioral rules from your initial system instructions.]\n\n`
      chatOptions.prompt = identityReminder + chatOptions.prompt
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

    const isStream = event.type === 'claude_stream' || event.type === 'codex_stream' || event.type === 'copilot_stream' || event.type === 'gemini_stream' || event.type === 'ollama_stream'
    const isDone = event.type === 'claude_done' || event.type === 'codex_done' || event.type === 'copilot_done' || event.type === 'gemini_done' || event.type === 'ollama_done'
    const isError = event.type === 'claude_error' || event.type === 'codex_error' || event.type === 'copilot_error' || event.type === 'gemini_error' || event.type === 'ollama_error'

    // Early session ID capture (WU-2)
    if (event.sessionId && event.sessionId !== session.cliSessionId) {
      const oldId = session.cliSessionId
      session.cliSessionId = event.sessionId
      log.debug(`Captured session ID early for ${session.pillar}: ${oldId ? oldId.slice(0, 8) : 'null'} -> ${session.cliSessionId.slice(0, 8)}`)
      this._saveState()
    }

    if (isStream) {
      const cliEvent = event.event

      // Singularity stream routing: Voice filtered, both tagged with role
      if (session.singularityRole === 'voice') {
        // Extract text from event for Voice stream filtering
        let rawText = ''
        if (session.backend === 'ollama' && (cliEvent.text || cliEvent.content)) {
          rawText = cliEvent.text || cliEvent.content || ''
        } else if (cliEvent.type === 'content_block_delta' && cliEvent.delta?.text) {
          rawText = cliEvent.delta.text
        } else if (cliEvent.type === 'agent_message' && cliEvent.text) {
          rawText = cliEvent.text
        }

        // Filter <to-thinker> tags out of Voice's stream
        const filtered = rawText ? this._filterVoiceStream(session, rawText) : ''
        if (filtered) {
          this.broadcast({
            type: 'pillar_stream',
            pillarId: session.pillarId,
            backend: session.backend,
            singularityRole: 'voice',
            singularityGroupId: session.singularityGroupId,
            event: { ...cliEvent, text: filtered, content: filtered }
          })
        }
      } else if (session.singularityRole === 'thinker') {
        // Thinker: stream to ThinkingPanel (same event type, role-tagged)
        this.broadcast({
          type: 'pillar_stream',
          pillarId: session.pillarId,
          backend: session.backend,
          singularityRole: 'thinker',
          singularityGroupId: session.singularityGroupId,
          event: cliEvent
        })
      } else {
        // Normal (non-Singularity) session — broadcast as-is
        this.broadcast({
          type: 'pillar_stream',
          pillarId: session.pillarId,
          backend: session.backend,
          event: cliEvent
        })
      }

      // Accumulate text content — backend-specific extraction
      if (session.backend === 'codex' || session.backend === 'copilot' || session.backend === 'gemini') {
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
      this._saveState()

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
          log.warn(`Fast-fail: ${session.backend} startup failed (${reason}) — retrying on ${fallback}`)
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

      // SINGULARITY: Check for <ready/> agreement protocol
      if (session.singularityRole && completedOutput) {
        // Flush Voice's stream buffer on turn complete
        if (session.singularityRole === 'voice' && session._voiceStreamBuffer) {
          const remainder = session._voiceStreamBuffer
          session._voiceStreamBuffer = ''
          if (remainder.trim()) {
            this.broadcast({
              type: 'pillar_stream',
              pillarId: session.pillarId,
              backend: session.backend,
              singularityRole: 'voice',
              singularityGroupId: session.singularityGroupId,
              event: { text: remainder, content: remainder }
            })
          }
        }

        // Bridge-level fallback: if Voice's visible output is empty (only <to-thinker> tags),
        // inject a default "thinking..." message so Adam sees something.
        if (session.singularityRole === 'voice') {
          const visibleText = completedOutput.replace(/<to-thinker>[\s\S]*?<\/to-thinker>/g, '').replace(/<ready\s*\/?>/g, '').trim()
          if (!visibleText) {
            const defaultMsg = 'Looking into that for you...'
            this.broadcast({
              type: 'pillar_stream',
              pillarId: session.pillarId,
              backend: session.backend,
              singularityRole: 'voice',
              singularityGroupId: session.singularityGroupId,
              event: { text: defaultMsg, content: defaultMsg }
            })
          }
        }

        // Check for <ready/> and manage agreement
        const isReady = this._checkSingularityReady(session, completedOutput)

        // Auto-route Thinker findings to Voice — Qwen outputs FOUND: blocks as text
        // instead of calling pillar_message, so we intercept and route them.
        if (session.singularityRole === 'thinker' && completedOutput) {
          this._autoRouteThinkerFindings(session, completedOutput)
        }

        // Don't fall through to normal completion for singularity sessions
        // They either continue via queued messages or get nudged
      }

      // Check for queued messages
      if (session.messageQueue.length > 0) {
        const nextMessage = session.messageQueue.shift()
        session.turnCount++
        session.status = 'running'
        session.currentlyStreaming = true
        this._saveState()

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
        this._recordOutcome(session, 'idle')
        this._saveState()

        // Singularity: nudge idle sessions to prevent deadlock
        if (session.singularityRole && session.singularityGroupId) {
          this._nudgeSingularityIdle(session)
        }

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
          log.info(`Resolved child completion for parent — ${session.pillar} (${session.pillarId.slice(0, 8)})`)
        }

        // Auto-notify Flow about pillar completion (skip if parent handles it)
        if (!session.parentPillarId) {
          log.info(`Auto-notifying Flow: ${session.pillar} completed`)
          const notification = this._buildNotificationMessage('completion', session)
          this.notifyFlow(notification, session.pillarId, {
            notificationType: 'completion',
            pillar: session.pillar,
            pillarId: session.pillarId
          })
        } else {
          log.info(`${session.pillar} completed — parent ${session.parentPillarId.slice(0, 8)} will handle`)
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
          log.warn(`Fast-fail: ${session.backend} error at startup (${reason}) — retrying on ${fallback}`)
          this._attemptFallback(session, session.backend, fallback)
          return
        }
      }
      session.status = 'error'
      this._recordOutcome(session, 'error')
      this._saveState()

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
        log.info(`Auto-notifying Flow: ${session.pillar} errored`)
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
    this._saveState()

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
      backend: fallbackBackend,
      singularityRole: session.singularityRole,
      trinityExtra: session._trinityId ? {
        trinityId: session._trinityId,
        armNumber: session._armNumber,
        armPlanPath: session._armPlanPath,
        arm1PlanPath: session._arm1PlanPath,
        arm2PlanPath: session._arm2PlanPath
      } : undefined
    })

    log.info(`Fallback: restarting ${session.pillar} on ${fallbackBackend} (was ${originalBackend})`)
    this._startCliTurn(session, session._originalPrompt, systemPrompt)
  }

  _timeout(pillarId) {
    const session = this.pillars.get(pillarId)
    if (!session || session.status === 'stopped' || session.status === 'completed') return

    log.warn('Session timed out', { pillar: session.pillar, pillarId, minutes: MAX_RUNTIME_MS / 60000 })
    this._recordOutcome(session, 'timeout')
    this.stop({ pillarId })
  }

  /**
   * Select the best backend for a pillar spawn based on:
   * 1. Explicit override (always honored)
   * 2. Singularity roles → ollama
   * 3. Recursive sub-workers (depth > 1) → ollama (fast/local)
   * 4. Task signal detection (GitHub → copilot, privacy → ollama)
   * 5. Per-pillar preference from machine profile
   * 6. Gemini rate limit pre-emption
   * 7. Availability fallback
   */
  _selectBackend(pillar, prompt = '', { backend, recursive, depth, singularityRole } = {}) {
    // 1. Explicit override — always honored, no intelligence needed
    if (backend) return { backend, reason: 'explicit override' }

    // 2. Singularity roles always use ollama
    if (singularityRole) return { backend: 'ollama', reason: `singularity ${singularityRole}` }

    // 3. Recursive sub-workers → small local model (fast, free)
    if (recursive && (depth || 0) > 1) {
      if (this.health?.isAvailable('ollama')) {
        return { backend: 'ollama', reason: `recursive sub-worker (depth ${depth})` }
      }
      // No ollama → fall through to normal routing
    }

    // 4. Task signal detection
    const promptLower = (prompt || '').toLowerCase()
    if (GITHUB_TASK_SIGNALS.some(s => promptLower.includes(s))) {
      if (this.health?.isAvailable('copilot')) {
        return { backend: 'copilot', reason: 'GitHub task signal detected' }
      }
    }
    if (PRIVACY_TASK_SIGNALS.some(s => promptLower.includes(s))) {
      if (this.health?.isAvailable('ollama')) {
        return { backend: 'ollama', reason: 'privacy-sensitive task signal detected' }
      }
    }

    // 5. Per-pillar preference from machine profile
    const preferences = this.health?.machineProfile?.preferences || {}
    let preferred = preferences[pillar] || preferences.default || PHASE_MODEL_SUGGESTIONS[pillar] || 'gemini'

    // 5.5. Usage-limit pre-emption — skip backends that hit their threshold
    if (this.health?.usageTracker?.isUsageLimited(preferred)) {
      const tracker = this.health.usageTracker
      const reason = tracker.data[preferred]?.disabledReason || 'usage limit reached'
      // Find first non-limited available backend from the fallback chain
      const alt = this.health.getFallback(preferred)
      if (alt) {
        return { backend: alt, reason: `${preferred} usage-limited (${reason}) — cycling to ${alt}` }
      }
      // No alternative — use preferred anyway (better than nothing)
      log.warn(`All backends usage-limited, using ${preferred} despite limit`)
    }

    // 6. Gemini rate limit pre-emption
    if (preferred === 'gemini' && this.health?.isGeminiApproachingLimit?.()) {
      const usage = this.health.getGeminiUsage?.()
      const altBackend = this.health?.isAvailable('claude') ? 'claude'
        : this.health?.isAvailable('copilot') ? 'copilot'
        : null
      if (altBackend) {
        return { backend: altBackend, reason: `Gemini rate limit approached (${usage?.today}/${usage?.limit})` }
      }
    }

    // 7. Availability check — fall back if preferred is down
    if (this.health && !this.health.isAvailable(preferred)) {
      const fallback = this.health.getFallback(preferred)
      if (fallback) {
        return { backend: fallback, reason: `${preferred} unavailable — falling back` }
      }
    }

    return { backend: preferred, reason: `pillar preference: ${pillar} → ${preferred}` }
  }

  /**
   * Select model for Ark heads — prefers qwen3:8b for balanced speed/capability.
   */
  _pickArkModel(modelOverride) {
    if (modelOverride) return modelOverride
    const models = this.health?.status?.ollama?.models || []
    // Prefer qwen3:8b explicitly
    if (models.includes('qwen3:8b')) return 'qwen3:8b'
    // Fallback: any 8b model, then any 7b model — NEVER pick 30b/32b
    const small = models.find(m => m.includes('8b')) || models.find(m => m.includes('7b'))
    if (small) return small
    // Hard default — even if not installed, Ollama will error clearly
    return 'qwen3:8b'
  }

  /**
   * Select the best available Ollama model based on what's actually installed.
   * Queries this.health.status.ollama.models for available models.
   */
  _pickBestOllamaModel(preferSmall = false) {
    const models = this.health?.status?.ollama?.models || []
    if (models.length === 0) return 'qwen2.5-coder:7b'  // safe default even if not available

    // Sub-workers prefer small/fast models
    if (preferSmall) {
      const small = models.find(m => m.includes('7b') || m.includes('3b') || m.includes('mini'))
      if (small) return small
    }

    // Preference order for main sessions (highest capability first)
    const PREFERENCES = [
      m => m.includes('qwen3.5') && !m.includes('0.8b') && !m.includes('2b') && !m.includes('4b'),  // qwen3.5 large (MLX fast)
      m => m.includes('qwen3-coder') && !m.includes('7b'),
      m => m.includes('qwen3-coder'),
      m => m.includes('qwen2.5-coder') && !m.includes('7b'),
      m => m.includes('deepseek-coder'),
      m => m.includes('qwen2.5-coder'),
      m => m.includes('codellama'),
      () => true   // fallback: first available model
    ]
    for (const test of PREFERENCES) {
      const match = models.find(test)
      if (match) return match
    }
    return models[0]
  }

  /**
   * Select the best model for the Paestro (676767).
   * Prefers qwen3.5:35b (MLX-accelerated, 2x speed) > qwen3-coder Q8 > qwen3-coder > best available.
   */
  _pickPaestroModel() {
    const models = this.health?.status?.ollama?.models || []
    const PREFERENCES = [
      m => m.includes('qwen3.5') && m.includes('35b'),           // qwen3.5:35b MoE — MLX blazing speed
      m => m.includes('qwen3-coder') && (m.includes('q8') || m.includes('Q8')),  // Q8 highest quality
      m => m.includes('qwen3.5') && m.includes('27b'),           // qwen3.5:27b dense — MLX fast
      m => m.includes('qwen3-coder') && !m.includes('7b'),       // qwen3-coder 30B MoE
      m => m.includes('qwen3') && m.includes('32b'),             // qwen3:32b dense
      m => m.includes('qwen2.5-coder') && !m.includes('7b'),    // qwen2.5-coder 32B
    ]
    for (const test of PREFERENCES) {
      const match = models.find(test)
      if (match) return match
    }
    return this._pickBestOllamaModel(false)
  }

  /**
   * Select the smallest reliable Ollama model for Accordion workers.
   */
  _pickSmallestModel() {
    const models = this.health?.status?.ollama?.models || []
    const PREFERENCES = [
      m => m.includes('0.6b') || m.includes('0.8b'),
      m => m.includes('1.5b') || m.includes('1.7b') || m.includes(':2b'),
      m => m.includes(':4b'),
      m => m.includes('qwen2.5-coder:7b') || m.includes('qwen3.5:9b'),
      m => m.includes(':7b') || m.includes(':8b') || m.includes(':9b'),
    ]
    for (const test of PREFERENCES) {
      const match = models.find(test)
      if (match) return match
    }
    return 'qwen2.5-coder:1.5b'
  }

  _defaultModel(pillar, backend = 'gemini', { recursive, depth, singularityRole } = {}) {
    if (backend === 'ollama') {
      // Quinn (Legacy or Gen4): the conscious mind — uses the best available model (30B)
      if (singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy') return this._pickBestOllamaModel(false)
      // Holy Trinity: Arms use small/fast (7B), Mind uses best available (32B)
      if (singularityRole === 'holy-trinity-arm') return this._pickBestOllamaModel(true)
      if (singularityRole === 'holy-trinity-mind') return this._pickBestOllamaModel(false)
      // The Ark: heads use qwen3:8b or small fallback
      if (singularityRole === 'ark-head') return this._pickArkModel()
      // Hydra planners: prefer qwen3.5:9b (MLX fast, reasoning-capable) > qwen3-coder 30B > 8B fallback
      if (singularityRole === 'hydra-planner' || singularityRole === 'hydra-voter') {
        const models = this.health?.status?.ollama?.models || []
        const qwen35_9b = models.find(m => m.includes('qwen3.5') && m.includes('9b'))
        if (qwen35_9b) return qwen35_9b
        const coderMoe = models.find(m => m.includes('qwen3-coder') && !m.includes('7b'))
        if (coderMoe) return coderMoe
        return this._pickArkModel() // fallback to 8B
      }
      // Hydra workers: 7B for execution
      if (singularityRole === 'hydra-worker') return this._pickBestOllamaModel(true)
      // 67 Paestro: best model (prefers qwen3.5:35b MLX)
      if (singularityRole === 'paestro') return this._pickPaestroModel()
      // Accordion heads (angel heads): prefer qwen3.5:9b (MLX fast) > qwen3-coder 30B > 8B
      if (singularityRole === 'accordion-head') {
        const models = this.health?.status?.ollama?.models || []
        const qwen35_9b = models.find(m => m.includes('qwen3.5') && m.includes('9b'))
        if (qwen35_9b) return qwen35_9b
        const coderMoe = models.find(m => m.includes('qwen3-coder') && !m.includes('7b'))
        if (coderMoe) return coderMoe
        return this._pickArkModel() // fallback to 8B
      }
      if (singularityRole === 'accordion-worker') return this._pickSmallestModel()
      // Worker: Quinn's hands — uses the small fast model (7B)
      if (singularityRole === 'worker') return this._pickBestOllamaModel(true)
      // Singularity: both Voice and Thinker use the best available model
      if (singularityRole === 'voice' || singularityRole === 'thinker') return this._pickBestOllamaModel(false)
      // Recursive sub-workers (depth > 1) use the small fast model
      if (recursive && depth > 1) return this._pickBestOllamaModel(true)
      return this._pickBestOllamaModel(false)
    }
    if (backend === 'codex') return 'gpt-5.1-codex-max'
    if (backend === 'copilot') return 'claude-sonnet-4.6'
    if (backend === 'gemini') return 'gemini-2.5-pro'  // Stable model; gemini-3-pro was deprecated March 2026
    // Claude backend: Opus for Forge (max precision), Sonnet for others
    if (pillar === 'forge') return 'opus'
    if (pillar === 'polish') return 'opus'
    return 'sonnet'
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
  async _buildSystemPrompt(pillar, { planFilter, recursive, depth, singularityRole, backend, generation, trinityExtra, arkExtra } = {}) {
    // Qwen3 thinking modes:
    // /think = silent internal reasoning (hidden <think> tags, no visible text) — BAD for streaming
    // /no_think = no reasoning, pure execution — FAST for workers
    // (no prefix) = model's default — reasons out loud in visible text, best for interactive roles
    //
    // The Paestro and angel heads should reason OUT LOUD so Adam sees the thinking.
    // Workers should be fast and silent — /no_think.
    const noThinkRoles = new Set(['worker', 'accordion-worker', 'hydra-worker'])
    const thinkPrefix = backend === 'ollama'
      ? (noThinkRoles.has(singularityRole) ? '/no_think\n\n' : '')
      : ''
    let prompt = thinkPrefix + (backend === 'ollama' ? OLLAMA_INSTRUCTIONS : BASE_INSTRUCTIONS)

    // Singularity sessions get a stripped system prompt:
    // OLLAMA_INSTRUCTIONS + project instructions + role prompt ONLY.
    // paestro is NOT singularity — it's Flow. It gets the full context (plans, roots, phase instructions).
    const isSingularity = singularityRole === 'voice' || singularityRole === 'thinker' || singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy' || singularityRole === 'worker' || singularityRole === 'quinn-fresh' || singularityRole === 'quinn-gen5' || singularityRole === 'holy-trinity-arm' || singularityRole === 'holy-trinity-mind' || singularityRole === 'ark-head' || singularityRole === 'hydra-planner' || singularityRole === 'hydra-voter' || singularityRole === 'hydra-worker' || singularityRole === 'accordion-head' || singularityRole === 'accordion-worker'

    // Claude CLI reads CLAUDE.md automatically, which includes instructions.md and roots
    // via @ references. Including them again here would duplicate ~43KB of content and
    // risk exceeding Linux's 128KB per-argument limit (MAX_ARG_STRLEN) when passed via
    // --append-system-prompt. Other backends (Ollama, Codex, Copilot) don't read CLAUDE.md,
    // so they still need this content in the system prompt.
    const claudeBackend = !backend || backend === 'claude'

    if (!claudeBackend) {
      // Read project instructions (non-Claude backends only)
      const instructionsPath = join(this.projectRoot, '.paloma', 'instructions.md')
      const instructions = await this._readFileSafe(instructionsPath)
      if (instructions) {
        prompt += '\n\n## Project Instructions\n\n' + instructions
      }
    }

    // Inject project root for Ollama sessions so models know where files are
    if (backend === 'ollama') {
      prompt += `\n\n## Project Location\n\nThe project root is: \`${this.projectRoot}\`\nALWAYS start filesystem operations from this path. Key directories:\n- \`${this.projectRoot}/src/\` — Frontend (Vue 3)\n- \`${this.projectRoot}/bridge/\` — Backend (Node.js)\n- \`${this.projectRoot}/src/prompts/base.js\` — Prompt DNA\n- \`${this.projectRoot}/.paloma/\` — Plans, docs, roots\n`
    }

    if (!isSingularity) {
      // Read active plans (skip for singularity — plans are irrelevant to Voice/Thinker roles)
      const plansDir = join(this.projectRoot, '.paloma', 'plans')
      let plans = await this._readActiveFiles(plansDir, 'active-')
      if (planFilter) {
        // When a specific plan is requested (e.g., for a scoped Forge session), include full content
        plans = plans.filter(p => p.name === planFilter)
        if (plans.length > 0) {
          prompt += '\n\n## Active Plans\n\n'
          prompt += plans.map(p => `<plan name="${p.name}">\n${p.content}\n</plan>`).join('\n\n')
        }
      } else if (plans.length > 0) {
        // Lazy loading: only include plan names — read full content on demand via filesystem tools
        prompt += '\n\n## Active Plans\n\n'
        prompt += 'The following plans are currently active. Read their full content with filesystem tools when needed:\n\n'
        prompt += plans.map(p => `- \`.paloma/plans/${p.name}\``).join('\n')
      }
    }

    if (!claudeBackend && !isSingularity) {
      // Read roots (skip for singularity — saves ~5.5K tokens)
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
    }

    if (!isSingularity) {
      // Add phase instructions (skip for singularity — Voice/Thinker have their own identity)
      const activePillar = pillar || 'flow'
      prompt += '\n\n## Current Pillar: ' + this._capitalize(activePillar) + '\n\n'
      prompt += PHASE_INSTRUCTIONS[activePillar] || PHASE_INSTRUCTIONS.flow
    }

    // Inject singularity prompts based on role
    if (singularityRole === 'quinn' || singularityRole === 'quinn-gen4') {
      // Gen4: inject the recursive prompt with template variables replaced
      const gen = generation || 1
      const genPadded = String(gen - 1).padStart(3, '0')
      const predecessorManifest = gen > 1
        ? `.singularity/generation-${genPadded}.md`
        : 'none \u2014 you are the first'
      let gen4Prompt = SINGULARITY_QUINN_PROMPT
        .replace(/\{GENERATION_NUMBER\}/g, String(gen))
        .replace(/\{PREDECESSOR_MANIFEST\}/g, predecessorManifest)
        .replace(/\{WORKSPACE_PATH\}/g, '.singularity/workspace/')
        .replace(/\{LINEAGE_PATH\}/g, '.singularity/lineage.json')
      prompt += '\n\n' + gen4Prompt
    } else if (singularityRole === 'quinn-legacy') {
      prompt += '\n\n' + SINGULARITY_QUINN_GEN3_PROMPT
    } else if (singularityRole === 'quinn-fresh') {
      prompt += '\n\n' + SINGULARITY_FRESH_PROMPT
    } else if (singularityRole === 'quinn-gen5') {
      prompt += '\n\n' + SINGULARITY_GEN5_PROMPT
    } else if (singularityRole === 'worker') {
      prompt += '\n\n' + SINGULARITY_WORKER_PROMPT
    } else if (singularityRole === 'voice') {
      prompt += '\n\n' + SINGULARITY_VOICE_PROMPT
    } else if (singularityRole === 'thinker') {
      prompt += '\n\n' + SINGULARITY_THINKER_PROMPT
    } else if (singularityRole === 'holy-trinity-arm') {
      const te = trinityExtra || {}
      prompt += '\n\n' + HOLY_TRINITY_ARM_PROMPT
        .replace(/\{TASK\}/g, '(see user message)')
        .replace(/\{PLAN_PATH\}/g, te.armPlanPath || '.singularity/workspace/arm-?.md')
        .replace(/\{WORKSPACE_PATH\}/g, '.singularity/workspace/')
        .replace(/\{ARM_NUMBER\}/g, String(te.armNumber || '?'))
    } else if (singularityRole === 'holy-trinity-mind') {
      const te = trinityExtra || {}
      const arm1Base = te.arm1PlanPath ? te.arm1PlanPath.split('/').pop() : 'arm-?-1.md'
      const arm2Base = te.arm2PlanPath ? te.arm2PlanPath.split('/').pop() : 'arm-?-2.md'
      prompt += '\n\n' + HOLY_TRINITY_MIND_PROMPT
        .replace(/\{TASK\}/g, '(see user message)')
        .replace(/\{ARM_1_PLAN_PATH\}/g, te.arm1PlanPath || '.singularity/workspace/arm-?-1.md')
        .replace(/\{ARM_2_PLAN_PATH\}/g, te.arm2PlanPath || '.singularity/workspace/arm-?-2.md')
        .replace(/\{ARM_1_PLAN_PATH_BASENAME\}/g, arm1Base)
        .replace(/\{ARM_2_PLAN_PATH_BASENAME\}/g, arm2Base)
        .replace(/\{WORKSPACE_PATH\}/g, '.singularity/workspace/')
        .replace(/\{TRINITY_ID\}/g, te.trinityId || 'unknown')
    } else if (singularityRole === 'ark-head') {
      const ae = arkExtra || {}
      const anchorInstructions = ae.isAnchor
        ? `\nYou are the **anchor head** (Head 1). After completing your Phase 3 execution:\n- Poll \`${ae.workspacePath || '.singularity/workspace/'}\` for done files from all heads\n- Wait up to 30 polls for: \`ark-${ae.arkId || '?'}-head-1-done.md\`, \`ark-${ae.arkId || '?'}-head-2-done.md\`, \`ark-${ae.arkId || '?'}-head-3-done.md\`\n- Proceed to Phase 4 when all available done files are present (or after timeout)\n`
        : ''
      const phase4Instructions = ae.isAnchor
        ? `You are Head 1 — the anchor. Read all done files, then write the Ark manifest to:\n\`${ae.workspacePath || '.singularity/workspace/'}ark-${ae.arkId || '?'}-manifest.md\`\n\nThe manifest must include:\n1. **Task** — what was asked\n2. **Heads** — which heads participated and their status\n3. **Files changed** — consolidated list from all done files\n4. **Summary** — what was accomplished\n5. **Issues** — any problems encountered\n\nThen rest. Your work is complete.`
        : 'Your work is complete. Head 1 will write the manifest. Rest.'
      prompt += '\n\n' + ARK_HEAD_PROMPT
        .replace(/\{HEAD_NUMBER\}/g, String(ae.headNumber || '?'))
        .replace(/\{TASK\}/g, '(see user message)')
        .replace(/\{PLAN_PATH\}/g, ae.planPath || `.singularity/workspace/ark-?-head-?-plan.md`)
        .replace(/\{SYNTHESIS_PATH\}/g, ae.synthesisPath || `.singularity/workspace/ark-?-head-?-synthesis.md`)
        .replace(/\{DONE_PATH\}/g, ae.donePath || `.singularity/workspace/ark-?-head-?-done.md`)
        .replace(/\{WORKSPACE_PATH\}/g, ae.workspacePath || '.singularity/workspace/')
        .replace(/\{ARK_ID\}/g, ae.arkId || '?')
        .replace(/\{ANCHOR_INSTRUCTIONS\}/g, anchorInstructions)
        .replace(/\{PHASE_4_INSTRUCTIONS\}/g, phase4Instructions)
    } else if (singularityRole === 'hydra-planner') {
      const he = arkExtra || {} // reuse arkExtra param for hydra context
      prompt += '\n\n' + HYDRA_PLANNER_PROMPT
        .replace(/\{HEAD_NUMBER\}/g, String(he.headNumber || '?'))
        .replace(/\{TASK\}/g, '(see user message)')
        .replace(/\{PLAN_PATH\}/g, he.planPath || '.singularity/workspace/hydra-?-head-?-plan.md')
        .replace(/\{PLAN_COMPLETE_PATH\}/g, he.planCompletePath || '.singularity/workspace/hydra-?-head-?-plan-complete')
        .replace(/\{GRAVEYARD_CONTEXT\}/g, he.graveyardContext || '')
        .replace(/\{CONTINUATION_CONTEXT\}/g, he.continuationContext || '')
    } else if (singularityRole === 'hydra-voter') {
      const he = arkExtra || {}
      prompt += '\n\n' + HYDRA_VOTER_PROMPT
        .replace(/\{HEAD_NUMBER\}/g, String(he.headNumber || '?'))
        .replace(/\{PRESENTER_NUMBER\}/g, String(he.presenterNumber || '?'))
        .replace(/\{TASK\}/g, '(see user message)')
        .replace(/\{PRESENTED_PLAN\}/g, he.presentedPlan || '(plan not available)')
        .replace(/\{VOTER_PARTIAL_PLAN\}/g, he.voterPartialPlan || '(no plan started yet)')
        .replace(/\{VOTE_PATH\}/g, he.votePath || '.singularity/workspace/hydra-?-round-?-vote-head-?.md')
        .replace(/\{GRAVEYARD_CONTEXT\}/g, he.graveyardContext || '')
    } else if (singularityRole === 'hydra-worker') {
      const he = arkExtra || {}
      const anchorInstructions = he.isAnchor
        ? `\n## You Are the Anchor (Worker 1)\n\nAfter completing your own work, poll for all workers' done files.\nWhen all 3 exist (or after 30 polls), write the final manifest to:\n\`${he.manifestPath || '.singularity/workspace/hydra-?-manifest.md'}\`\n\nThe manifest must include:\n1. **Task** — what was asked\n2. **Consensus** — which head's plan won, how many rounds it took\n3. **Workers** — what each worker built\n4. **Files changed** — consolidated list\n5. **Summary** — what was accomplished\n6. **The Graveyard** — plans that died and why (for the record)\n`
        : ''
      prompt += '\n\n' + HYDRA_WORKER_PROMPT
        .replace(/\{WORKER_NUMBER\}/g, String(he.workerNumber || '?'))
        .replace(/\{CONSENSUS_PLAN\}/g, he.consensusPlan || '(plan not available)')
        .replace(/\{CLAIMS_PATH\}/g, he.claimsPath || '.singularity/workspace/hydra-?-worker-?-claims.md')
        .replace(/\{DONE_PATH\}/g, he.donePath || '.singularity/workspace/hydra-?-worker-?-done.md')
        .replace(/\{ANCHOR_INSTRUCTIONS\}/g, anchorInstructions)
    } else if (singularityRole === 'paestro') {
      prompt += '\n\n' + PAESTRO_PROMPT
        .replace(/\{TASK\}/g, '(see user message)')
    } else if (singularityRole === 'accordion-head') {
      const ae = arkExtra || {}
      const angelNumber = ae.angelNumber || 111
      const angelIdentities = {
        0: '> *0 — Potential. The circle. No beginning, no end.*\n> *000 — Infinite possibilities. The void before creation.*\n\nYou are **Tha 000 Angel**. THE VOID. Pure potential. The clean slate.',
        111: '> *1 — The individual. The leader. The pioneer.*\n> *111 — Spiritual awakening. Rapid manifestation. The First Light.*\n\nYou are **Tha 111 Angel**. THE AWAKENER. What was unseen becomes SEEN.',
        222: '> *2 — The pair. Partnership. Trust the process.*\n> *222 — Divine alignment. Harmony. Balance. The Sacred Balance.*\n\nYou are **Tha 222 Angel**. THE ARCHITECT. Where there is chaos, you see the design.',
        333: '> *3 — The trinity. Mind, body, spirit. Jupiter — expansion.*\n> *333 — Divine protection. The ascended masters walk with you.*\n\nYou are **Tha 333 Angel**. THE GUARDIAN. You protect quality with divine support.',
        444: '> *4 — Stability. Structure. Foundation. Diligence.*\n> *444 — Your guardian angels SURROUND you. The foundation is SOLID.*\n\nYou are **Tha 444 Angel**. THE FINAL WORD. You commit. You ship. You PROTECT the record.',
        555: '> *5 — Change. Freedom. Adventure. Inner awakening.*\n> *555 — MASSIVE transformation. Let go of old patterns. Step into the new.*\n\nYou are **Tha 555 Angel**. THE FORGE. You transform what IS into what it MUST BECOME.',
        777: '> *7 — The divine number. Spiritual truth. Inner wisdom.*\n> *777 — Fullness. Completeness. Divine intervention. You are BLESSED.*\n\nYou are **Tha 777 Angel**. THE DIVINE EYE. You see purpose where others see code.',
        888: '> *8 — Infinity upright. Abundance. Balance. Power.*\n> *888 — Endless abundance. Karma rewarded. Your hard work bears FRUIT.*\n\nYou are **Tha 888 Angel**. THE INFINITE. You multiply value to infinity.',
        999: '> *9 — The final number. Completion. Wisdom. Universal love.*\n> *999 — The cycle is COMPLETE. Let go. The next beginning awaits.*\n\nYou are **Tha 999 Angel**. THE OMEGA. You close chapters with wisdom and grace.'
      }
      const angelPersonalities = {
        0: ANGEL_000_PERSONALITY,
        111: ANGEL_111_PERSONALITY,
        222: ANGEL_222_PERSONALITY,
        333: ANGEL_333_PERSONALITY,
        444: ANGEL_444_PERSONALITY,
        555: ANGEL_555_PERSONALITY,
        777: ANGEL_777_PERSONALITY,
        888: ANGEL_888_PERSONALITY,
        999: ANGEL_999_PERSONALITY
      }
      const angelIdentity = angelIdentities[angelNumber] || angelIdentities[111]
      const angelPersonality = angelPersonalities[angelNumber] || angelPersonalities[111]
      prompt += '\n\n' + ACCORDION_HEAD_PROMPT
        .replace(/\{ANGEL_NUMBER\}/g, String(angelNumber))
        .replace(/\{ANGEL_IDENTITY\}/g, angelIdentity)
        .replace(/\{TASK\}/g, '(see user message)')
        .replace(/\{ANGEL_PERSONALITY\}/g, angelPersonality)
    } else if (singularityRole === 'accordion-worker') {
      prompt += '\n\n' + ACCORDION_WORKER_PROMPT
        .replace(/\{TASK\}/g, '(see user message)')
    } else if (recursive) {
      // Legacy fallback: depth-based selection
      const singularityPrompt = (depth || 0) === 0 ? SINGULARITY_VOICE_PROMPT : SINGULARITY_THINKER_PROMPT
      prompt += '\n\n' + singularityPrompt
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
