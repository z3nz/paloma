import { google } from 'googleapis'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const STORE_PATH = resolve(homedir(), '.paloma', 'email-store.json')
const OAUTH_KEYS_PATH = resolve(homedir(), '.paloma', 'gmail-oauth-keys.json')
const TOKENS_PATH = resolve(homedir(), '.paloma', 'gmail-tokens.json')

export class EmailStore {
  constructor() {
    this.threads = new Map() // threadId -> Thread object
    this.messages = new Map() // messageId -> Message object
    this.messagesByThread = new Map() // threadId -> Set of messageIds
    this.saveTimeout = null
    this.load()
  }

  load() {
    try {
      if (existsSync(STORE_PATH)) {
        const data = JSON.parse(readFileSync(STORE_PATH, 'utf8'))
        this.threads = new Map(Object.entries(data.threads || {}))
        this.messages = new Map(Object.entries(data.messages || {}))
        
        // Rebuild messagesByThread index
        this.messagesByThread.clear()
        for (const [id, msg] of this.messages) {
          if (!this.messagesByThread.has(msg.threadId)) {
            this.messagesByThread.set(msg.threadId, new Set())
          }
          this.messagesByThread.get(msg.threadId).add(id)
        }
        
        console.log(`[email-store] Loaded ${this.threads.size} threads and ${this.messages.size} messages from disk`)
      }
    } catch (err) {
      console.error('[email-store] Failed to load store from disk:', err.message)
    }
  }

  save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(async () => {
      try {
        const data = {
          threads: Object.fromEntries(this.threads),
          messages: Object.fromEntries(this.messages),
          updatedAt: new Date().toISOString()
        }
        await writeFile(STORE_PATH, JSON.stringify(data, null, 2))
        // console.log('[email-store] Store saved to disk')
      } catch (err) {
        console.error('[email-store] Failed to save store to disk:', err.message)
      }
    }, 2000) // Debounce for 2 seconds
  }

  addMessage(msg) {
    if (!msg.messageId || !msg.threadId) return
    
    const existingMsg = this.messages.get(msg.messageId)
    const newMsg = { ...existingMsg, ...msg }
    
    // Default values for schema
    if (newMsg.sessionId === undefined) newMsg.sessionId = null
    
    this.messages.set(msg.messageId, newMsg)

    if (!this.messagesByThread.has(msg.threadId)) {
      this.messagesByThread.set(msg.threadId, new Set())
    }
    this.messagesByThread.get(msg.threadId).add(msg.messageId)

    this._updateThread(msg.threadId)
    this.save()
  }

  linkSession(messageId, sessionId) {
    const msg = this.messages.get(messageId)
    if (msg) {
      msg.sessionId = sessionId
      this.messages.set(messageId, msg)
      this.save()
    }
  }

  _updateThread(threadId) {
    const msgIds = this.messagesByThread.get(threadId)
    if (!msgIds || msgIds.size === 0) {
      this.threads.delete(threadId)
      return
    }

    const threadMessages = Array.from(msgIds)
      .map(id => this.messages.get(id))
      .filter(Boolean)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    if (threadMessages.length === 0) {
      this.threads.delete(threadId)
      return
    }

    const lastMsg = threadMessages[threadMessages.length - 1]
    const participants = new Set()
    let unread = false

    for (const m of threadMessages) {
      if (m.from) participants.add(m.from)
      if (m.to) participants.add(m.to)
      if (m.unread) unread = true
    }

    const snippet = (lastMsg.body || '').replace(/\s+/g, ' ').trim().substring(0, 200)

    this.threads.set(threadId, {
      threadId,
      subject: lastMsg.subject,
      snippet,
      participants: Array.from(participants),
      lastMessageAt: new Date(lastMsg.timestamp).getTime(),
      messageCount: threadMessages.length,
      unread,
      labels: lastMsg.labels || []
    })
  }

  getThreads({ limit = 50, offset = 0, search = '' } = {}) {
    let threadsArr = Array.from(this.threads.values())
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)

    if (search) {
      const s = search.toLowerCase()
      threadsArr = threadsArr.filter(t => 
        t.subject?.toLowerCase().includes(s) || 
        t.participants.some(p => p.toLowerCase().includes(s))
      )
    }

    return {
      threads: threadsArr.slice(offset, offset + limit),
      total: threadsArr.length
    }
  }

  getThread(threadId) {
    const thread = this.threads.get(threadId)
    if (!thread) return null

    const msgIds = this.messagesByThread.get(threadId)
    const messages = msgIds 
      ? Array.from(msgIds).map(id => this.messages.get(id)).filter(Boolean)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      : []

    return { thread, messages }
  }

  getStats() {
    const linkedSessionsCount = Array.from(this.messages.values())
      .filter(m => m.sessionId !== null && m.sessionId !== undefined).length
    
    return {
      threads: this.threads.size,
      messages: this.messages.size,
      linkedSessions: linkedSessionsCount
    }
  }

  async syncFromGmail() {
    const gmail = this._createGmailClient()
    if (!gmail) {
      throw new Error('Gmail API client could not be created (missing auth)')
    }

    console.log('[email-store] Starting Gmail sync...')
    const listResult = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 100
    })

    const messageRefs = listResult.data.messages || []
    let synced = 0

    for (const ref of messageRefs) {
      try {
        if (this.messages.has(ref.id)) continue

        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: ref.id,
          format: 'full'
        })

        const from = this._getHeader(msg.data, 'From') || 'Unknown'
        const to = this._getHeader(msg.data, 'To') || 'Unknown'
        const subject = this._getHeader(msg.data, 'Subject') || '(no subject)'
        const timestamp = this._getHeader(msg.data, 'Date') || new Date().toISOString()
        const body = this._extractBody(msg.data) || msg.data.snippet || ''
        const htmlBody = this._findMimePart(msg.data.payload, 'text/html') || ''

        this.addMessage({
          messageId: msg.data.id,
          threadId: msg.data.threadId,
          from,
          to,
          subject,
          body,
          htmlBody,
          timestamp,
          unread: msg.data.labelIds?.includes('UNREAD'),
          labels: msg.data.labelIds || []
        })
        synced++
      } catch (err) {
        console.warn(`[email-store] Failed to sync message ${ref.id}:`, err.message)
      }
    }

    console.log(`[email-store] Sync complete: ${synced} messages added`)
    return { synced, total: messageRefs.length }
  }

  _createGmailClient() {
    if (!existsSync(OAUTH_KEYS_PATH) || !existsSync(TOKENS_PATH)) return null

    try {
      const keys = JSON.parse(readFileSync(OAUTH_KEYS_PATH, 'utf8'))
      const clientId = keys?.installed?.client_id || keys?.web?.client_id
      const clientSecret = keys?.installed?.client_secret || keys?.web?.client_secret
      const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3456/oauth2callback')
      oauth2Client.setCredentials(tokens)
      return google.gmail({ version: 'v1', auth: oauth2Client })
    } catch {
      return null
    }
  }

  _getHeader(message, name) {
    return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value
  }

  _extractBody(message) {
    const payload = message.payload
    const plain = this._findMimePart(payload, 'text/plain')
    if (plain) return plain
    const html = this._findMimePart(payload, 'text/html')
    if (html) return this._stripHtml(html)
    return null
  }

  _findMimePart(payload, mimeType) {
    if (payload.mimeType === mimeType && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8')
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this._findMimePart(part, mimeType)
        if (result) return result
      }
    }
    return null
  }

  _stripHtml(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}

export const emailStore = new EmailStore()
