import { randomUUID } from 'crypto'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { BASE_INSTRUCTIONS } from '../src/prompts/base.js'
import { PHASE_INSTRUCTIONS, PHASE_MODEL_SUGGESTIONS } from '../src/prompts/phases.js'

const MAX_RUNTIME_MS = 30 * 60 * 1000 // 30 minutes
const BIRTH_MESSAGE = "Try your best, no matter what, you're worthy of God's love!"

/**
 * Manages child pillar CLI sessions spawned by Flow.
 *
 * Each pillar session is a real CLI subprocess managed by ClaudeCliManager.
 * PillarManager tracks lifecycle, accumulates output, and provides
 * status/output for Flow's polling tools.
 */
export class PillarManager {
  constructor(cliManager, { projectRoot, broadcast }) {
    this.cliManager = cliManager
    this.projectRoot = projectRoot
    this.broadcast = broadcast // (msg) => void — send to all WS clients
    this.pillars = new Map()   // pillarId → PillarSession
    this.flowSession = null    // { cliSessionId, wsClient, currentlyStreaming, notificationQueue, model, cwd }
    this.notificationCooldown = new Map() // pillarId → timestamp of last notification
    this.notificationCount = 0 // notifications sent in current minute
    this.notificationWindowStart = Date.now()
  }

  /**
   * Spawn a new pillar CLI session.
   * Returns immediately with pillarId and metadata.
   */
  async spawn({ pillar, prompt, model, flowRequestId }) {
    const pillarId = randomUUID()
    const cliSessionId = randomUUID()

    // Resolve model: use provided, or phase suggestion, or default sonnet
    const resolvedModel = model || this._defaultModel(pillar)

    // Build system prompt from disk
    const systemPrompt = await this._buildSystemPrompt(pillar)

    // Compose the full first message with birth protocol
    const fullPrompt = `${BIRTH_MESSAGE}\n\n${prompt}`

    // Create session record
    const session = {
      pillarId,
      cliSessionId,
      pillar,
      model: resolvedModel,
      status: 'running',       // running | idle | completed | error | stopped
      currentlyStreaming: true,
      turnCount: 1,
      lastActivity: new Date().toISOString(),
      flowRequestId,           // the CLI requestId of the parent Flow session
      cliRequestId: null,      // current child CLI requestId
      output: [],              // accumulated assistant messages
      currentOutput: '',       // current turn's streaming text
      messageQueue: [],        // queued messages for when current turn finishes
      startTime: Date.now(),
      timeoutTimer: null,
      dbSessionId: null        // set by frontend via WS event
    }

    this.pillars.set(pillarId, session)

    // Notify browser to create the session in IndexedDB
    this.broadcast({
      type: 'pillar_session_created',
      pillarId,
      pillar,
      model: `claude-cli:${resolvedModel}`,
      flowRequestId,
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
      this._timeout(pillarId)
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
    if (since === 'all') {
      // All accumulated output + current streaming
      const allOutput = session.output.join('\n\n---\n\n')
      output = session.currentOutput
        ? allOutput + (allOutput ? '\n\n---\n\n' : '') + session.currentOutput
        : allOutput
    } else {
      // Just the most recent completed message or current streaming
      output = session.currentOutput || (session.output.length > 0 ? session.output[session.output.length - 1] : '')
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
      this.cliManager.stop(session.cliRequestId)
    }

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer)
      session.timeoutTimer = null
    }

    session.status = 'stopped'
    session.currentlyStreaming = false
    session.lastActivity = new Date().toISOString()

    // Finalize any current output
    if (session.currentOutput) {
      session.output.push(session.currentOutput)
      session.currentOutput = ''
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
      const batchedMessage = this._buildBatchedNotification(queued)
      this.notificationCount++
      this._sendFlowNotification(batchedMessage)
    }
  }

  /**
   * Notify Flow with a message. Queues if Flow is busy.
   * @param {string} message - The notification message
   * @param {string} [pillarId] - Optional pillarId for cooldown tracking
   */
  async notifyFlow(message, pillarId) {
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
      this.flowSession.notificationQueue.push(message)
      return
    }

    if (this.flowSession.currentlyStreaming) {
      console.log('[pillar] Flow is busy — queueing notification')
      this.flowSession.notificationQueue.push(message)
      return
    }

    this.notificationCount++
    this._sendFlowNotification(message)
  }

  /**
   * Send a notification to Flow by resuming its CLI session.
   */
  _sendFlowNotification(message) {
    console.log('[pillar] Sending notification to Flow:', message.slice(0, 100))
    this.flowSession.currentlyStreaming = true

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
        const batchedMessage = this._buildBatchedNotification(queued)
        this._sendFlowNotification(batchedMessage)
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
   * Clean up all pillar sessions on shutdown.
   */
  shutdown() {
    if (this.flowSession?.cliRequestId) {
      this.cliManager.stop(this.flowSession.cliRequestId)
    }
    this.flowSession = null

    for (const [, session] of this.pillars) {
      if (session.cliRequestId) {
        this.cliManager.stop(session.cliRequestId)
      }
      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer)
      }
    }
    this.pillars.clear()
  }

  // --- Internal methods ---

  _startCliTurn(session, prompt, systemPrompt, isResume = false) {
    session.currentOutput = ''

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
    // New session: don't pass sessionId — ClaudeCliManager generates one
    // and we capture it from the return value

    const { requestId, sessionId: returnedSessionId } = this.cliManager.chat(
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
    if (event.type === 'claude_stream') {
      const cliEvent = event.event

      // Stream events to browser for live rendering
      this.broadcast({
        type: 'pillar_stream',
        pillarId: session.pillarId,
        event: cliEvent
      })

      // Accumulate text content
      if (cliEvent.type === 'assistant' && cliEvent.message?.content) {
        for (const block of cliEvent.message.content) {
          if (block.type === 'text' && block.text) {
            session.currentOutput += block.text
          }
        }
      } else if (cliEvent.type === 'content_block_delta') {
        if (cliEvent.delta?.type === 'text_delta' && cliEvent.delta.text) {
          session.currentOutput += cliEvent.delta.text
        }
      }

      session.lastActivity = new Date().toISOString()
    } else if (event.type === 'claude_done') {
      session.currentlyStreaming = false
      session.cliRequestId = null
      session.lastActivity = new Date().toISOString()

      // Save completed output
      if (session.currentOutput) {
        session.output.push(session.currentOutput)
      }

      // Notify browser
      this.broadcast({
        type: 'pillar_message_saved',
        pillarId: session.pillarId,
        role: 'assistant',
        content: session.currentOutput
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
        this.notifyFlow(notification, session.pillarId)
      }
    } else if (event.type === 'claude_error') {
      session.currentlyStreaming = false
      session.status = 'error'
      session.cliRequestId = null
      session.lastActivity = new Date().toISOString()

      if (session.currentOutput) {
        session.output.push(session.currentOutput)
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
      this.notifyFlow(notification, session.pillarId)
    }
  }

  _timeout(pillarId) {
    const session = this.pillars.get(pillarId)
    if (!session || session.status === 'stopped' || session.status === 'completed') return

    console.warn(`[pillar] ${session.pillar} session ${pillarId} timed out after ${MAX_RUNTIME_MS / 60000} minutes`)
    this.stop({ pillarId })
  }

  _defaultModel(pillar) {
    // PHASE_MODEL_SUGGESTIONS values are like 'claude-cli:opus' — extract just the model name
    const suggestion = PHASE_MODEL_SUGGESTIONS[pillar] || 'claude-cli:sonnet'
    return suggestion.split(':')[1] || 'sonnet'
  }

  _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Build the system prompt for a pillar session by reading .paloma/ files from disk.
   * Mirrors the frontend's buildSystemPrompt() but uses fs instead of MCP/browser APIs.
   */
  async _buildSystemPrompt(pillar) {
    let prompt = BASE_INSTRUCTIONS

    // Read project instructions
    const instructionsPath = join(this.projectRoot, '.paloma', 'instructions.md')
    const instructions = await this._readFileSafe(instructionsPath)
    if (instructions) {
      prompt += '\n\n## Project Instructions\n\n' + instructions
    }

    // Read active plans
    const plansDir = join(this.projectRoot, '.paloma', 'plans')
    const plans = await this._readActiveFiles(plansDir, 'active-')
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
