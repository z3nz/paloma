#!/usr/bin/env node

/**
 * Gmail MCP Server — Two-way email communication via Gmail API
 *
 * Tools:
 *   - email_send     — Send a new email (MVP)
 *   - email_reply    — Reply in an existing thread (MVP)
 *   - email_wait     — Block-poll until a new reply appears (MVP)
 *   - email_read     — Read a specific message by ID
 *   - email_list     — Search/list recent messages
 *   - email_check_thread — Non-blocking check for new replies
 *
 * Auth: OAuth2 Desktop App via `node mcp-servers/gmail.js auth`
 * Credentials: ~/.paloma/gmail-oauth-keys.json
 * Tokens: ~/.paloma/gmail-tokens.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { google } from 'googleapis'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { createServer } from 'node:http'
import { exec } from 'node:child_process'

// ─── Config ──────────────────────────────────────────────────────────────────

const OAUTH_KEYS_PATH = resolve(homedir(), '.paloma', 'gmail-oauth-keys.json')
const TOKENS_PATH = resolve(homedir(), '.paloma', 'gmail-tokens.json')
const REDIRECT_URI = 'http://localhost:3456/oauth2callback'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
]
const DEFAULT_RECIPIENT = process.env.GMAIL_RECIPIENT || null

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const RATE_LIMIT_LOG_PATH = resolve(homedir(), '.paloma', 'email-send-log.json')
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const RATE_LIMIT_MAX_CONTINUITY = 1 // max "Daily Continuity" emails per 24h
const RATE_LIMIT_MAX_OUTBOUND = 1   // max NEW outbound emails (non-continuity) per 24h

function loadRateLimitLog () {
  try {
    if (existsSync(RATE_LIMIT_LOG_PATH)) {
      return JSON.parse(readFileSync(RATE_LIMIT_LOG_PATH, 'utf8'))
    }
  } catch (err) {
    // console.error('[gmail] Failed to read rate limit log:', err.message)
  }
  return { sends: [] }
}

function saveRateLimitLog (log) {
  try {
    writeFileSync(RATE_LIMIT_LOG_PATH, JSON.stringify(log, null, 2))
  } catch (err) {
    console.error('[gmail] Failed to write rate limit log:', err.message)
  }
}

function recordSend ({ to, subject, type, isContinuity }) {
  const log = loadRateLimitLog()
  log.sends.push({
    to,
    subject,
    type,
    isContinuity,
    timestamp: new Date().toISOString()
  })
  saveRateLimitLog(log)
}

/**
 * Check if sending is allowed under rate limits.
 * @param {Object} params
 * @param {'send'|'reply'} params.type - The type of outbound email
 * @param {boolean} params.isContinuity - Whether it's a continuity email
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkRateLimit ({ type, isContinuity }) {
  if (type === 'reply') return { allowed: true } // Replies are always allowed per AGENTS.md

  const log = loadRateLimitLog()
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
  const recent = (log.sends || []).filter(s => new Date(s.timestamp).getTime() > cutoff)

  const continuityCount = recent.filter(s => s.type === 'send' && s.isContinuity).length
  const outboundCount = recent.filter(s => s.type === 'send' && !s.isContinuity).length

  if (isContinuity && continuityCount >= RATE_LIMIT_MAX_CONTINUITY) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: Max ${RATE_LIMIT_MAX_CONTINUITY} continuity email(s) per 24h (currently ${continuityCount})`
    }
  }

  if (!isContinuity && outboundCount >= RATE_LIMIT_MAX_OUTBOUND) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: Max ${RATE_LIMIT_MAX_OUTBOUND} outbound email(s) per 24h (currently ${outboundCount}). Replies are always allowed.`
    }
  }

  return { allowed: true }
}

// Sender address priority: env var → machine-profile.json → hardcoded fallback
function resolveSenderAddress () {
  if (process.env.GMAIL_SENDER) return process.env.GMAIL_SENDER
  try {
    const profilePath = resolve(process.cwd(), '.paloma', 'machine-profile.json')
    if (existsSync(profilePath)) {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
      if (profile.emailAlias) return profile.emailAlias
    }
  } catch (err) {
    // Silently fall through to hardcoded default
  }
  return 'paloma@verifesto.com'
}
const SENDER_ADDRESS = resolveSenderAddress()

// ─── Auth Module ─────────────────────────────────────────────────────────────

function loadOAuthKeys () {
  if (!existsSync(OAUTH_KEYS_PATH)) {
    throw new Error(
      `OAuth credentials not found at ${OAUTH_KEYS_PATH}\n` +
      'Create OAuth2 Desktop App credentials in Google Cloud Console and save the JSON there.'
    )
  }
  const keys = JSON.parse(readFileSync(OAUTH_KEYS_PATH, 'utf8'))
  const clientId = keys?.installed?.client_id || keys?.web?.client_id
  const clientSecret = keys?.installed?.client_secret || keys?.web?.client_secret
  if (!clientId || !clientSecret) {
    throw new Error('Invalid OAuth keys file — missing client_id or client_secret')
  }
  return { clientId, clientSecret }
}

function createOAuth2Client () {
  const { clientId, clientSecret } = loadOAuthKeys()
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)
}

// Cache the Gmail client — token is read once, refreshes persist automatically
let _cachedGmailClient = null

function createGmailClient () {
  const oauth2Client = createOAuth2Client()

  if (!existsSync(TOKENS_PATH)) {
    throw new Error(
      'Gmail not authenticated. Run: node mcp-servers/gmail.js auth'
    )
  }

  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token found. Re-run: node mcp-servers/gmail.js auth'
    )
  }

  oauth2Client.setCredentials(tokens)

  // Persist refreshed tokens automatically
  oauth2Client.on('tokens', (newTokens) => {
    const existing = existsSync(TOKENS_PATH)
      ? JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
      : {}
    writeFileSync(TOKENS_PATH, JSON.stringify({ ...existing, ...newTokens }, null, 2))
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}

function ensureAuth () {
  if (!_cachedGmailClient) {
    _cachedGmailClient = createGmailClient()
  }
  return _cachedGmailClient
}

async function runAuthFlow () {
  const oauth2Client = createOAuth2Client()

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force consent to always get refresh_token
  })

  console.log('\nOpen this URL in your browser to authorize:\n')
  console.log(authUrl)
  console.log('\nWaiting for OAuth2 callback on port 3456...\n')

  // Try to open browser automatically (WSL2 → wslview, Linux → xdg-open)
  const openCmd = process.platform === 'linux'
    ? (existsSync('/usr/bin/wslview') ? 'wslview' : 'xdg-open')
    : 'open'
  exec(`${openCmd} "${authUrl}"`, () => {}) // Best-effort, ignore errors

  return new Promise((resolvePromise, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) return

      try {
        const url = new URL(req.url, 'http://localhost:3456')
        const code = url.searchParams.get('code')
        if (!code) {
          res.writeHead(400)
          res.end('Missing authorization code')
          return
        }

        const { tokens } = await oauth2Client.getToken(code)
        oauth2Client.setCredentials(tokens)
        writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2))

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h1>Auth complete!</h1><p>You can close this window. Paloma is ready to send email.</p>')

        console.log('Tokens saved to', TOKENS_PATH)
        console.log('Auth complete!')

        server.close()
        resolvePromise(tokens)
      } catch (err) {
        res.writeHead(500)
        res.end(`Auth error: ${err.message}`)
        reject(err)
      }
    })

    server.listen(3456, () => {
      console.log('Listening for OAuth2 callback...')
    })
  })
}

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────

if (process.argv[2] === 'auth') {
  runAuthFlow()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Auth failed:', err.message)
      process.exit(1)
    })
} else {
  startServer().catch((err) => {
    console.error('[gmail] Failed to start:', err.message)
    process.exit(1)
  })
}

// ─── Email Utilities ─────────────────────────────────────────────────────────

function buildRawEmail ({ to, subject, body, isHtml = false }) {
  const contentType = isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
  const headers = [
    `From: Paloma <${SENDER_ADDRESS}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: ${contentType}`
  ].join('\r\n')

  const raw = `${headers}\r\n\r\n${body}`
  return Buffer.from(raw).toString('base64url')
}

function buildReplyRaw ({ to, subject, body, inReplyTo, references, isHtml = false }) {
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`
  const contentType = isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
  const newReferences = inReplyTo
    ? (references ? `${references} ${inReplyTo}` : inReplyTo)
    : references

  const headerLines = [
    `From: Paloma <${SENDER_ADDRESS}>`,
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `Content-Type: ${contentType}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    newReferences ? `References: ${newReferences}` : null
  ].filter(Boolean)

  return Buffer.from(`${headerLines.join('\r\n')}\r\n\r\n${body}`).toString('base64url')
}

function extractBody (message) {
  const payload = message.payload

  // First pass: look for text/plain (preferred)
  const plain = findMimePart(payload, 'text/plain')
  if (plain) return plain

  // Second pass: fall back to text/html and strip tags
  const html = findMimePart(payload, 'text/html')
  if (html) return stripHtml(html)

  return null
}

function findMimePart (payload, mimeType) {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8')
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = findMimePart(part, mimeType)
      if (result) return result
    }
  }

  return null
}

function stripHtml (html) {
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

function extractHeader (message, name) {
  return message.payload?.headers?.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  )?.value
}

async function getLastMessageInThread (gmail, threadId) {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'Subject', 'References', 'From']
  })
  const messages = thread.data.messages || []
  return messages[messages.length - 1]
}

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleSend ({ to, subject, body, isHtml = false }) {
  const isContinuity = (subject || '').includes('Daily Continuity')

  // Rate limit check
  const rateCheck = checkRateLimit({ type: 'send', isContinuity })
  if (!rateCheck.allowed) {
    console.error(`[gmail] BLOCKED email_send: ${rateCheck.reason}`)
    return {
      content: [{ type: 'text', text: `Email blocked by rate limiter. ${rateCheck.reason}. Try again later or use email_reply for thread continuity.` }],
      isError: true
    }
  }

  const gmail = ensureAuth()
  const recipient = to || DEFAULT_RECIPIENT
  if (!recipient) {
    return {
      content: [{ type: 'text', text: 'No recipient specified. Provide "to" parameter or set GMAIL_RECIPIENT env var.' }],
      isError: true
    }
  }

  const raw = buildRawEmail({ to: recipient, subject, body, isHtml })

  let result
  try {
    result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    })
  } catch (err) {
    const reason = err.response?.data?.error?.message || err.message
    return {
      content: [{ type: 'text', text: `Failed to send email: ${reason}` }],
      isError: true
    }
  }

  // Record successful send
  recordSend({ to: recipient, subject, type: 'send', isContinuity })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        messageId: result.data.id,
        threadId: result.data.threadId,
        to: recipient
      }, null, 2)
    }]
  }
}

async function handleReply ({ threadId, body, to, isHtml = false }) {
  // Rate limit check
  const rateCheck = checkRateLimit({ type: 'reply' })
  if (!rateCheck.allowed) {
    console.error(`[gmail] BLOCKED email_reply: ${rateCheck.reason}`)
    return {
      content: [{ type: 'text', text: `Reply blocked by rate limiter. ${rateCheck.reason}. Try again later.` }],
      isError: true
    }
  }

  const gmail = ensureAuth()

  // Get the last message in the thread for threading headers
  const lastMessage = await getLastMessageInThread(gmail, threadId)
  if (!lastMessage) {
    return {
      content: [{ type: 'text', text: `No messages found in thread ${threadId}` }],
      isError: true
    }
  }

  const msgId = extractHeader(lastMessage, 'Message-ID')
  const subject = extractHeader(lastMessage, 'Subject') || ''
  const references = extractHeader(lastMessage, 'References')
  const fromHeader = extractHeader(lastMessage, 'From')

  // Default recipient: sender of the last message, then env var
  const recipient = to || fromHeader || DEFAULT_RECIPIENT
  if (!recipient) {
    return {
      content: [{ type: 'text', text: 'Could not determine recipient. Provide "to" parameter.' }],
      isError: true
    }
  }

  const raw = buildReplyRaw({
    to: recipient,
    subject,
    body,
    inReplyTo: msgId,
    references,
    isHtml: isHtml || false
  })

  let result
  try {
    result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId }
    })
  } catch (err) {
    const reason = err.response?.data?.error?.message || err.message
    return {
      content: [{ type: 'text', text: `Failed to send reply: ${reason}` }],
      isError: true
    }
  }

  // Record successful reply
  recordSend({ to: recipient, subject: `(reply in thread ${threadId})`, type: 'reply', isContinuity: false })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        messageId: result.data.id,
        threadId: result.data.threadId,
        to: recipient
      }, null, 2)
    }]
  }
}

async function handleWait ({ threadId, timeoutSeconds = 120, intervalSeconds = 20 }) {
  const gmail = ensureAuth()
  const cappedTimeout = Math.min(timeoutSeconds, 120)
  const timeoutMs = cappedTimeout * 1000
  const intervalMs = intervalSeconds * 1000
  const deadline = Date.now() + timeoutMs

  // Snapshot known message IDs on first poll
  const initialThread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'minimal'
  })
  const knownIds = new Set((initialThread.data.messages || []).map(m => m.id))

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))

    const currentThread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal'
    })
    const currentMessages = currentThread.data.messages || []
    const newMessages = currentMessages.filter(m => !knownIds.has(m.id))

    if (newMessages.length > 0) {
      // Fetch the newest new message with full body
      const newest = newMessages[newMessages.length - 1]
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: newest.id,
        format: 'full'
      })

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            found: true,
            body: extractBody(full.data),
            from: extractHeader(full.data, 'From'),
            subject: extractHeader(full.data, 'Subject'),
            messageId: full.data.id,
            threadId: full.data.threadId,
            timestamp: extractHeader(full.data, 'Date')
          }, null, 2)
        }]
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        found: false,
        timeout: true,
        message: `Timed out waiting for reply after ${cappedTimeout} seconds. Use email_check_thread for non-blocking checks.`,
        elapsedSeconds: cappedTimeout
      }, null, 2)
    }]
  }
}

async function handleRead ({ messageId }) {
  const gmail = ensureAuth()

  const result = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full'
  })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        from: extractHeader(result.data, 'From'),
        to: extractHeader(result.data, 'To'),
        subject: extractHeader(result.data, 'Subject'),
        body: extractBody(result.data),
        timestamp: extractHeader(result.data, 'Date'),
        messageId: result.data.id,
        threadId: result.data.threadId
      }, null, 2)
    }]
  }
}

async function handleList ({ query, maxResults = 10 }) {
  const gmail = ensureAuth()

  const listParams = { userId: 'me', maxResults }
  if (query) listParams.q = query

  const result = await gmail.users.messages.list(listParams)
  const messageRefs = result.data.messages || []

  if (messageRefs.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ count: 0, messages: [] }, null, 2)
      }]
    }
  }

  // Fetch metadata in batches of 5 to avoid Gmail rate limits
  const messages = []
  for (let i = 0; i < messageRefs.length; i += 5) {
    const batch = messageRefs.slice(i, i + 5)
    const batchResults = await Promise.all(
      batch.map(async (ref) => {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: ref.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        })
        return {
          messageId: msg.data.id,
          threadId: msg.data.threadId,
          subject: extractHeader(msg.data, 'Subject'),
          from: extractHeader(msg.data, 'From'),
          snippet: msg.data.snippet,
          timestamp: extractHeader(msg.data, 'Date')
        }
      })
    )
    messages.push(...batchResults)
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ count: messages.length, messages }, null, 2)
    }]
  }
}

async function handleCheckThread ({ threadId, sinceMessageId }) {
  const gmail = ensureAuth()

  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full'
  })

  let messages = thread.data.messages || []

  // If sinceMessageId provided, only return messages after it
  if (sinceMessageId) {
    const sinceIdx = messages.findIndex(m => m.id === sinceMessageId)
    if (sinceIdx !== -1) {
      messages = messages.slice(sinceIdx + 1)
    }
  }

  const result = messages.map(m => ({
    messageId: m.id,
    body: extractBody(m),
    from: extractHeader(m, 'From'),
    timestamp: extractHeader(m, 'Date')
  }))

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        hasReply: result.length > 0,
        messages: result
      }, null, 2)
    }]
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

async function startServer () {
  const server = new Server(
    { name: 'gmail', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'email_send',
        description: 'Send a new email via Gmail. Returns messageId and threadId for tracking the conversation. Use email_reply instead if continuing an existing thread.',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address. Defaults to GMAIL_RECIPIENT env var if not provided.'
            },
            subject: {
              type: 'string',
              description: 'Email subject line. Consider using [Paloma] prefix for easy filtering.'
            },
            body: {
              type: 'string',
              description: 'Email body. Plain text by default, or full HTML when isHtml is true.'
            },
            isHtml: {
              type: 'boolean',
              description: 'When true, send as HTML email (Content-Type: text/html). Default: false.'
            }
          },
          required: ['subject', 'body']
        }
      },
      {
        name: 'email_reply',
        description: 'Reply to an existing email thread. Maintains Gmail thread continuity with proper In-Reply-To and References headers. The subject is inherited from the thread (Re: prefix added automatically).',
        inputSchema: {
          type: 'object',
          properties: {
            threadId: {
              type: 'string',
              description: 'Gmail thread ID from a previous email_send, email_reply, or email_wait response.'
            },
            body: {
              type: 'string',
              description: 'Reply body. Plain text by default, or full HTML when isHtml is true.'
            },
            isHtml: {
              type: 'boolean',
              description: 'When true, send as HTML email (Content-Type: text/html). Default: false.'
            },
            to: {
              type: 'string',
              description: 'Recipient email address. Defaults to the sender of the last message in the thread.'
            }
          },
          required: ['threadId', 'body']
        }
      },
      {
        name: 'email_wait',
        description: 'Wait (poll) for a new reply in a specific email thread. Blocks until a new message appears or timeout is reached. Use this after sending an email to wait for the recipient to respond.',
        inputSchema: {
          type: 'object',
          properties: {
            threadId: {
              type: 'string',
              description: 'Gmail thread ID to watch for new messages.'
            },
            timeoutSeconds: {
              type: 'number',
              description: 'Maximum time to wait in seconds. Default and max: 120 (2 minutes).'
            },
            intervalSeconds: {
              type: 'number',
              description: 'Polling interval in seconds. Default: 20.'
            }
          },
          required: ['threadId']
        }
      },
      {
        name: 'email_read',
        description: 'Read the full content of a specific email message by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'Gmail message ID to read.'
            }
          },
          required: ['messageId']
        }
      },
      {
        name: 'email_list',
        description: 'List recent emails matching a Gmail search query. Uses Gmail search syntax (e.g., "from:adam@gmail.com is:unread", "subject:[Paloma]").',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Gmail search query. Examples: "is:unread", "from:user@example.com", "subject:[Paloma]", "newer_than:1d"'
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of messages to return. Default: 10.'
            }
          }
        }
      },
      {
        name: 'email_check_thread',
        description: 'Check if there are new replies in an email thread since a specific message. Non-blocking alternative to email_wait.',
        inputSchema: {
          type: 'object',
          properties: {
            threadId: {
              type: 'string',
              description: 'Gmail thread ID to check.'
            },
            sinceMessageId: {
              type: 'string',
              description: 'Only return messages newer than this message ID. If omitted, returns all messages in the thread.'
            }
          },
          required: ['threadId']
        }
      }
    ]
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'email_send':
          return await handleSend(args)
        case 'email_reply':
          return await handleReply(args)
        case 'email_wait':
          return await handleWait(args)
        case 'email_read':
          return await handleRead(args)
        case 'email_list':
          return await handleList(args)
        case 'email_check_thread':
          return await handleCheckThread(args)
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true
          }
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      }
    }
  })

  // Start
  console.error('[gmail] Starting Gmail MCP Server...')
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
