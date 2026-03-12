/**
 * Email Watcher — Persistent Gmail polling service for the bridge.
 *
 * Polls Gmail for new unread emails and spawns a fresh Claude CLI session
 * for each one. The session appears as a new chat in the browser UI.
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
    console.log('[email-watcher] Stopped')
  }
}
