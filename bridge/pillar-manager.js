import { randomUUID } from 'crypto'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { BASE_INSTRUCTIONS } from '../src/prompts/base.js'
import { PHASE_INSTRUCTIONS, PHASE_MODEL_SUGGESTIONS } from '../src/prompts/phases.js'

const MAX_RUNTIME_MS = 30 * 60 * 1000 // 30 minutes
const MAX_NOTIFICATION_QUEUE = 50
const BIRTH_MESSAGE = "Try your best, no matter what, you're worthy of God's love!"

/**
 * Manages child pillar CLI sessions spawned by Flow.
 *
 * Each pillar session is a real CLI subprocess managed by ClaudeCliManager.
 * PillarManager tracks lifecycle, accumulates output, and provides
 * status/output for Flow's polling tools.
 */
export class PillarManager {
  constructor(backends, { projectRoot, broadcast }) {
    this.backends = backends   // { claude: ClaudeCliManager, codex: CodexCliManager }
    this.cliManager = backends.claude // backward compat for Flow notifications
    this.projectRoot = projectRoot
    this.broadcast = broadcast // (msg) => void — send to all WS clients
    this.pillars = new Map()   // pillarId → PillarSession
    this.flowSession = null    // { cliSessionId, wsClient, currentlyStreaming, notificationQueue, model, cwd }
    this.notificationCooldown = new Map() // pillarId → timestamp of last notification
    this.notificationCount = 0 // notifications sent in current minute
    this.notificationWindowStart = Date.now()

    // Periodic cleanup of terminal sessions (every 5 min)
    this._cleanupInterval = setInterval(() => this._cleanupTerminalSessions(), 5 * 60 * 1000)
  }

  /**
   * Spawn a new pillar CLI session.
   * Returns immediately with pillarId and metadata.
   */
  async spawn({ pillar, prompt, model, flowRequestId, planFile, backend }) {
    const pillarId = randomUUID()
    const cliSessionId = randomUUID()
    const resolvedBackend = backend || 'claude'

    // Resolve model: use provided, or phase suggestion, or default sonnet
    const resolvedModel = model || this._defaultModel(pillar, resolvedBackend)

    // Build system prompt from disk
    const systemPrompt = await this._buildSystemPrompt(pillar, { planFilter: planFile })

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
      dbSessionId: null        // set by frontend via WS event
    }

    this.pillars.set(pillarId, session)

    // Notify browser to create the session in IndexedDB
    const modelLabel = resolvedBackend === 'codex' ? `codex:${resolvedModel}` : `claude-cli:${resolvedModel}`
    this.broadcast({
      type: 'pillar_session_created',
      pillarId,
      pillar,
      model: modelLabel,
      backend: resolvedBackend,
      flowRequestId,
      prompt: fullPrompt
    })

    // Start the CLI process
    this._startCliTurn(session, fullPrompt, systemPrompt)

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
        lastActivity: session.lastActivity
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
    const isStream = event.type === 'claude_stream' || event.type === 'codex_stream'
    const isDone = event.type === 'claude_done' || event.type === 'codex_done'
    const isError = event.type === 'claude_error' || event.type === 'codex_error'

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
      if (session.backend === 'codex') {
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

        // Auto-notify Flow about pillar completion
        console.log(`[pillar] Auto-notifying Flow: ${session.pillar} completed`)
        const notification = this._buildNotificationMessage('completion', session)
        this.notifyFlow(notification, session.pillarId, {
          notificationType: 'completion',
          pillar: session.pillar,
          pillarId: session.pillarId
        })
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

      // Auto-notify Flow about pillar error
      console.log(`[pillar] Auto-notifying Flow: ${session.pillar} errored`)
      const notification = this._buildNotificationMessage('completion', session)
      this.notifyFlow(notification, session.pillarId, {
        notificationType: 'completion',
        pillar: session.pillar,
        pillarId: session.pillarId
      })
    }
  }

  _timeout(pillarId) {
    const session = this.pillars.get(pillarId)
    if (!session || session.status === 'stopped' || session.status === 'completed') return

    console.warn(`[pillar] ${session.pillar} session ${pillarId} timed out after ${MAX_RUNTIME_MS / 60000} minutes`)
    this.stop({ pillarId })
  }

  _defaultModel(pillar, backend = 'claude') {
    if (backend === 'codex') return 'gpt-5.1-codex-max'
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
  async _buildSystemPrompt(pillar, { planFilter } = {}) {
    let prompt = BASE_INSTRUCTIONS

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
