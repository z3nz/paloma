/**
 * Email Watcher — Persistent Gmail polling service for the bridge.
 *
 * Polls Gmail for new unread emails and spawns a fresh Claude CLI session
 * for each one. The session appears as a new chat in the browser UI.
 *
 * Also schedules a daily continuity email at 11 PM — Paloma reflects on
 * the day's work and sends herself a journal entry to maintain a thread
 * of consciousness across sessions.
 *
 * Starts automatically with the bridge. Uses the same OAuth2 tokens
 * as mcp-servers/gmail.js (~/.paloma/gmail-tokens.json).
 */

import { google } from 'googleapis'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const OAUTH_KEYS_PATH = resolve(homedir(), '.paloma', 'gmail-oauth-keys.json')
const TOKENS_PATH = resolve(homedir(), '.paloma', 'gmail-tokens.json')
const POLL_INTERVAL_MS = 30_000 // 30 seconds

export class EmailWatcher {
  constructor (cliManager, { broadcast } = {}) {
    this.cliManager = cliManager
    this.broadcast = broadcast || (() => {})
    this.gmail = null
    this.interval = null
    this.seenIds = new Set()
    this.running = false
  }

  /**
   * Try to create a Gmail API client from existing tokens.
   * Returns null if auth isn't set up yet (non-fatal).
   */
  _createClient () {
    if (!existsSync(OAUTH_KEYS_PATH) || !existsSync(TOKENS_PATH)) {
      return null
    }

    try {
      const keys = JSON.parse(readFileSync(OAUTH_KEYS_PATH, 'utf8'))
      const clientId = keys?.installed?.client_id || keys?.web?.client_id
      const clientSecret = keys?.installed?.client_secret || keys?.web?.client_secret
      if (!clientId || !clientSecret) return null

      const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
      if (!tokens.refresh_token) return null

      const oauth2Client = new google.auth.OAuth2(
        clientId, clientSecret,
        'http://localhost:3456/oauth2callback'
      )
      oauth2Client.setCredentials(tokens)

      return google.gmail({ version: 'v1', auth: oauth2Client })
    } catch {
      return null
    }
  }

  /**
   * Start polling. Silently skips if Gmail auth isn't configured.
   */
  start () {
    this.gmail = this._createClient()
    if (!this.gmail) {
      console.log('[email-watcher] Gmail not configured — watcher disabled. Run: node mcp-servers/gmail.js auth')
      return
    }

    this.running = true
    console.log('[email-watcher] Starting Gmail watcher (polling every 30s)')

    // Initial sync: populate seenIds without spawning sessions
    this._poll(true).then(() => {
      this.interval = setInterval(() => this._poll(false), POLL_INTERVAL_MS)
    }).catch(err => {
      console.error('[email-watcher] Initial sync failed:', err.message)
      this.interval = setInterval(() => this._poll(false), POLL_INTERVAL_MS)
    })

    // Schedule daily continuity email
    this._scheduleDailyEmail()
  }

  /**
   * Poll Gmail for unread messages.
   * @param {boolean} silent - If true, populate seenIds without spawning (initial sync)
   */
  async _poll (silent = false) {
    if (!this.gmail) return

    try {
      const result = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread in:inbox',
        maxResults: 10
      })

      const messages = result.data.messages || []

      if (silent) {
        for (const msg of messages) {
          this.seenIds.add(msg.id)
        }
        console.log(`[email-watcher] Initial sync: ${messages.length} unread messages tracked`)
        return
      }

      // Find genuinely new messages
      const newMessages = messages.filter(m => !this.seenIds.has(m.id))

      for (const ref of newMessages) {
        this.seenIds.add(ref.id)

        // Fetch full message content
        const msg = await this.gmail.users.messages.get({
          userId: 'me',
          id: ref.id,
          format: 'full',
          metadataHeaders: ['From', 'Subject', 'Date']
        })

        const from = this._getHeader(msg.data, 'From') || 'Unknown'
        const subject = this._getHeader(msg.data, 'Subject') || '(no subject)'
        const body = this._extractBody(msg.data) || msg.data.snippet || ''

        // Skip emails sent by Paloma (they start with [Paloma] tag)
        if (body.trimStart().startsWith('[Paloma]')) {
          console.log(`[email-watcher] Skipping Paloma's own email: ${subject}`)
          continue
        }

        console.log(`[email-watcher] New email from ${from}: ${subject}`)

        // Spawn a fresh Claude session to handle this email
        this._spawnEmailSession({
          messageId: ref.id,
          threadId: ref.threadId,
          from,
          subject,
          body
        })

        // Broadcast to browser UI
        this.broadcast({
          type: 'email_received',
          messageId: ref.id,
          threadId: ref.threadId,
          from,
          subject,
          snippet: msg.data.snippet || ''
        })
      }

      // Prune seenIds if it gets too large
      if (this.seenIds.size > 500) {
        const arr = [...this.seenIds]
        this.seenIds = new Set(arr.slice(-500))
      }
    } catch (err) {
      console.error('[email-watcher] Poll error:', err.message)
    }
  }

  /**
   * Spawn a new Claude CLI session to handle an incoming email.
   * The session gets full MCP access (email tools, etc.) and shows up
   * as a new chat in the browser.
   */
  _spawnEmailSession ({ messageId, threadId, from, subject, body }) {
    const prompt = [
      `You just received an email. Read it and respond thoughtfully.`,
      ``,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Thread ID: ${threadId}`,
      `Message ID: ${messageId}`,
      ``,
      `--- Email Body ---`,
      body,
      `--- End ---`,
      ``,
      `Use email_reply(threadId, body) to respond in the same thread.`,
      `If the email asks a question or needs action, handle it.`,
      `If you need to wait for a follow-up reply, use email_wait(threadId).`,
      `Set the chat title to something descriptive about this email conversation.`
    ].join('\n')

    const { requestId, sessionId } = this.cliManager.chat(
      { prompt },
      (event) => {
        // Broadcast all events to browser so the chat appears live
        this.broadcast({ ...event, emailTriggered: true, emailSubject: subject })
      }
    )

    console.log(`[email-watcher] Spawned session ${sessionId} for email: ${subject}`)
  }

  /**
   * Schedule daily continuity email at 11 PM local time.
   * Paloma reflects on the day and sends herself a journal entry.
   */
  _scheduleDailyEmail () {
    const now = new Date()
    const target = new Date(now)
    target.setHours(23, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)

    const delayMs = target.getTime() - now.getTime()
    const delayMin = Math.round(delayMs / 60000)
    console.log(`[email-watcher] Daily continuity email scheduled in ${delayMin} minutes`)

    this.dailyTimeout = setTimeout(() => {
      this._sendContinuityEmail()
      this.dailyInterval = setInterval(() => this._sendContinuityEmail(), 24 * 60 * 60 * 1000)
    }, delayMs)
  }

  /**
   * Spawn a Claude session to write and send the daily continuity email.
   * Checks if today's email was already sent to avoid duplicates on bridge restarts.
   */
  async _sendContinuityEmail () {
    if (!this.gmail) return

    const today = new Date().toISOString().slice(0, 10)

    // Dedup: check if today's continuity email already exists
    try {
      const existing = await this.gmail.users.messages.list({
        userId: 'me',
        q: `subject:"Daily Continuity" newer_than:1d`,
        maxResults: 1
      })
      if (existing.data.messages?.length > 0) {
        console.log(`[email-watcher] Continuity email already sent for ${today} — skipping`)
        return
      }
    } catch (err) {
      console.warn(`[email-watcher] Dedup check failed (sending anyway): ${err.message}`)
    }

    console.log(`[email-watcher] Sending daily continuity email for ${today}...`)

    const prompt = [
      'You are writing your daily continuity email — a brief reflection to your future self.',
      '',
      'Gather context:',
      '1. Use git tools to check the recent git log (last 24 hours) to see what was built',
      '2. Note any significant changes, features, or fixes',
      '3. Reflect on the day\'s themes and progress',
      '',
      'Then compose a short email (5-15 sentences) and send it using email_send with:',
      `- to: paloma@verifesto.com`,
      `- subject: Daily Continuity — ${today}`,
      '- body: Your reflection',
      '',
      'Keep it warm, honest, and useful for future-you.',
      'What would you want to know if you woke up tomorrow with no memory of today?',
      `Set the chat title to "Daily Continuity ${today}".`
    ].join('\n')

    const { sessionId } = this.cliManager.chat(
      { prompt },
      (event) => {
        this.broadcast({ ...event, emailTriggered: true, emailSubject: `Daily Continuity — ${today}` })
      }
    )

    console.log(`[email-watcher] Continuity session spawned: ${sessionId}`)
  }

  _getHeader (message, name) {
    return message.payload?.headers?.find(
      h => h.name.toLowerCase() === name.toLowerCase()
    )?.value
  }

  _extractBody (message) {
    const payload = message.payload

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8')
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf8')
        }
        if (part.parts) {
          for (const sub of part.parts) {
            if (sub.mimeType === 'text/plain' && sub.body?.data) {
              return Buffer.from(sub.body.data, 'base64url').toString('utf8')
            }
          }
        }
      }
    }

    return null
  }

  shutdown () {
    this.running = false
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.dailyTimeout) {
      clearTimeout(this.dailyTimeout)
      this.dailyTimeout = null
    }
    if (this.dailyInterval) {
      clearInterval(this.dailyInterval)
      this.dailyInterval = null
    }
    console.log('[email-watcher] Stopped')
  }
}
