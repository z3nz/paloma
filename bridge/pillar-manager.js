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
   * Clean up all pillar sessions on shutdown.
   */
  shutdown() {
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
