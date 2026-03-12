# Scout Findings: Gmail Email Integration for Paloma

**Date:** 2026-03-12  
**Scout:** Research for Chart — Gmail MCP server design  
**Scope:** Two-way email communication between Paloma and Adam via Gmail API  

---

## Summary

Paloma can send emails to Adam and poll for his replies using the official Gmail API with OAuth2. The recommended approach is to **build a custom `mcp-servers/gmail.js`** following Paloma's existing server pattern, drawing heavily from the open-source `shinzo-labs/gmail-mcp` for OAuth2 patterns. The key novel tool is `email_wait` — a polling loop that blocks until Adam replies to a thread, analogous to how pillar callbacks work.

**Decision: Build custom (don't use an existing package).** Existing packages use TypeScript + extra deps and lack the `email_wait` blocking tool Paloma specifically needs.

---

## 1. Existing Gmail MCP Servers

### shinzo-labs/gmail-mcp ⭐ Best Reference
- **npm:** `@shinzolabs/gmail-mcp`
- **GitHub:** `https://github.com/shinzo-labs/gmail-mcp`
- **License:** MIT
- **Language:** TypeScript (compiled to JS)
- **Auth:** OAuth2 Desktop App, credentials stored in `~/.gmail-mcp/`
- **Tools:** Full Gmail API — send, list, get, threads, labels, drafts, settings, push watch

This is the most complete Gmail MCP server available. Its OAuth2 module (`src/oauth2.ts`) is production-quality and can be adapted directly for Paloma's server.

**Why not use it directly:**
- TypeScript + Smithery SDK + telemetry = unnecessary complexity
- Missing `email_wait` polling tool
- Paloma's servers are pure ESM JavaScript — consistent pattern matters
- Has opt-out telemetry (minor concern)

### Other Options (lower priority)
- `@aot-tech/gmail-mcp-server` — npm, less maintained
- `@mseep/gmail-mcp` — file-based OAuth2, minimal toolset
- `MarkusPfundstein/mcp-gsuite` — Python, not Node.js
- `epaproditus/google-workspace-mcp-server` — broader GSuite, more complexity

---

## 2. Authentication: OAuth2 Desktop App Flow

### Setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (e.g., "Paloma Gmail")
3. Enable the Gmail API (APIs & Services → Library → Gmail API)
4. Create OAuth 2.0 credentials: **Credentials → Create → OAuth client ID → Desktop app**
5. Download the credentials JSON → save as `~/.paloma/gmail-oauth-keys.json`
6. Run the one-time auth script: opens browser, user approves, saves refresh token to `~/.paloma/gmail-tokens.json`

### Token Storage
```
~/.paloma/gmail-oauth-keys.json   ← client_id + client_secret (from Google Cloud Console)
~/.paloma/gmail-tokens.json       ← refresh_token + access_token + expiry_date
```

Both files should be chmod 600 and gitignored. They live alongside the memory store in `~/.paloma/`.

### Node.js Auth Pattern (from shinzo-labs/oauth2.ts — adapted)

```javascript
import { OAuth2Client } from 'google-auth-library'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const OAUTH_KEYS_PATH = resolve(homedir(), '.paloma', 'gmail-oauth-keys.json')
const TOKENS_PATH = resolve(homedir(), '.paloma', 'gmail-tokens.json')

function createGmailClient() {
  const keys = JSON.parse(readFileSync(OAUTH_KEYS_PATH, 'utf8'))
  const clientId = keys?.installed?.client_id || keys?.web?.client_id
  const clientSecret = keys?.installed?.client_secret || keys?.web?.client_secret

  const oauth2Client = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: 'http://localhost:3456/oauth2callback'
  })

  if (existsSync(TOKENS_PATH)) {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
    oauth2Client.setCredentials(tokens)
    // googleapis auto-refreshes using refresh_token when access_token expires
  }

  // Persist updated tokens when auto-refreshed
  oauth2Client.on('tokens', (tokens) => {
    const existing = existsSync(TOKENS_PATH) ? JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) : {}
    writeFileSync(TOKENS_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2))
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}
```

### One-Time Auth Script (included in the MCP server as a CLI subcommand)

```javascript
// Run: node mcp-servers/gmail.js auth
import http from 'node:http'
import open from 'open'

const AUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
]

async function runAuthFlow(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: AUTH_SCOPES,
    prompt: 'consent'   // force consent to always get refresh_token
  })

  const server = http.createServer()
  server.listen(3456)
  open(authUrl)

  return new Promise((resolve, reject) => {
    server.on('request', async (req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) return
      const code = new URL(req.url, 'http://localhost:3456').searchParams.get('code')
      const { tokens } = await oauth2Client.getToken(code)
      oauth2Client.setCredentials(tokens)
      writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2))
      res.end('Auth complete! You can close this window.')
      server.close()
      resolve(tokens)
    })
  })
}
```

### Key OAuth2 Insight
- `access_type: 'offline'` + `prompt: 'consent'` ensures you always get a `refresh_token`
- Without `prompt: 'consent'`, Google only returns a refresh token the FIRST time. Add it to avoid "missing refresh_token" issues later.
- The `googleapis` library (`google-auth-library` under the hood) handles token refresh transparently — no manual refresh code needed.

---

## 3. Gmail API: Sending Email

### Dependencies
```
npm install googleapis
```
`googleapis` is the official Google Node.js client. It handles OAuth2, auto-refresh, and all Gmail API endpoints.

### Sending a New Email

The Gmail API requires RFC 2822 format, base64url-encoded in the `raw` field:

```javascript
import { google } from 'googleapis'

function buildRawEmail({ to, subject, body, from, messageId }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    messageId ? `Message-ID: ${messageId}` : null,
  ].filter(Boolean).join('\r\n')

  const raw = `${headers}\r\n\r\n${body}`
  return Buffer.from(raw).toString('base64url')  // MUST be base64url, not base64
}

const result = await gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: buildRawEmail({ to: 'adam@example.com', subject: 'Question from Paloma', body: '...' })
  }
})

const { id: messageId, threadId } = result.data
// Save threadId — this is the conversation tracker
```

### Continuing a Thread (Reply)

To send a reply that stays in the same Gmail thread:

```javascript
// First, get the original message to extract its Message-ID header
const original = await gmail.users.messages.get({
  userId: 'me',
  id: originalMessageId,
  format: 'metadata',
  metadataHeaders: ['Message-ID', 'Subject', 'References']
})

const headers = original.data.payload.headers
const originalMsgId = headers.find(h => h.name === 'Message-ID')?.value
const originalRefs = headers.find(h => h.name === 'References')?.value

function buildReplyRaw({ to, subject, body, inReplyTo, references }) {
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
  const newReferences = references ? `${references} ${inReplyTo}` : inReplyTo

  const hdrs = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${newReferences}`,
  ].join('\r\n')

  return Buffer.from(`${hdrs}\r\n\r\n${body}`).toString('base64url')
}

await gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: buildReplyRaw({ to, subject, body, inReplyTo: originalMsgId, references: originalRefs }),
    threadId: existingThreadId  // CRITICAL: keeps message in the thread
  }
})
```

**Thread continuity requires BOTH:**
1. `threadId` in the API request body
2. `In-Reply-To` + `References` headers matching the previous message's `Message-ID`

---

## 4. Gmail API: Receiving / Waiting for Replies

### Push vs Polling: Decision

| | Push (Pub/Sub) | Polling (Recommended) |
|---|---|---|
| Setup complexity | High — requires Cloud Pub/Sub, public HTTPS endpoint, IAM setup | Low — just poll Gmail API |
| Local dev | Painful — needs ngrok or tunnel | Works natively |
| Latency | ~10 seconds | Configurable (15-60 seconds) |
| Reliability | Depends on webhook endpoint | Always works |
| Cost | Free within Gmail API quota | Free within Gmail API quota |
| Right for Paloma? | ❌ Overkill for personal use | ✅ Perfect |

**Decision: Polling.** Push notifications require a publicly reachable HTTPS webhook — awkward for a local WSL2 dev environment. Polling every 15-30 seconds is perfectly adequate for human response times.

### Thread Polling Pattern

```javascript
// Poll a specific thread until Adam replies
async function pollForReply(gmail, threadId, palomaSentMessageId, options = {}) {
  const { 
    intervalMs = 20000,    // check every 20 seconds
    timeoutMs = 600000,    // give up after 10 minutes
    fromFilter = null      // optional: only accept replies from this address
  } = options

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['From', 'Date', 'Subject']
    })

    const messages = thread.data.messages || []

    // Find messages that aren't the one Paloma sent
    const replies = messages.filter(m => m.id !== palomaSentMessageId)

    if (replies.length > 0) {
      // Get the full content of the latest reply
      const latest = replies[replies.length - 1]
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: latest.id,
        format: 'full'
      })
      return { found: true, message: full.data }
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  return { found: false, timeout: true }
}
```

### Alternative: Poll by Query

If Paloma always uses a unique subject prefix (e.g., `[Paloma]`), you can search by query instead of threadId:

```javascript
const result = await gmail.users.messages.list({
  userId: 'me',
  q: `subject:[Paloma] in:inbox is:unread`,
  maxResults: 10
})
```

This is simpler but less precise (can't match a specific conversation). Thread-based polling is more reliable.

---

## 5. Extracting Email Body

Gmail API returns bodies in base64url parts. Utility to extract plain text:

```javascript
function extractBody(message) {
  const payload = message.payload

  // Simple text/plain message
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8')
  }

  // Multipart — find the text/plain part
  if (payload.parts) {
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain')
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64url').toString('utf8')
    }
  }

  return null
}

function extractHeader(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value
}
```

---

## 6. Proposed MCP Tool Interface

```javascript
// Tool: email_send
// Send an email to Adam and return the thread tracker
{
  name: 'email_send',
  description: 'Send an email to Adam via Gmail. Returns messageId and threadId for tracking replies.',
  input: {
    to:      string,   // email address
    subject: string,   // email subject
    body:    string,   // plain text body
  },
  output: { messageId: string, threadId: string }
}

// Tool: email_wait
// THE KEY TOOL. Blocks (polls) until Adam replies to a specific thread.
{
  name: 'email_wait',
  description: 'Wait (poll) for Adam to reply to a specific email thread. Returns the reply body when received.',
  input: {
    threadId:         string,   // from email_send response
    sent_message_id:  string,   // from email_send response — to exclude Paloma's own message
    timeout_seconds?: number,   // default 600 (10 min)
    interval_seconds?: number,  // polling interval, default 20
  },
  output: {
    found:     boolean,
    body?:     string,    // reply body text
    from?:     string,    // sender
    timestamp?: string,   // ISO date
    timeout?:  boolean,   // true if timed out without reply
  }
}

// Tool: email_read
// Read a specific message by ID
{
  name: 'email_read',
  description: 'Read the full content of a specific email message.',
  input: { message_id: string },
  output: { from: string, to: string, subject: string, body: string, timestamp: string }
}

// Tool: email_list
// List recent messages with Gmail search query
{
  name: 'email_list',
  description: 'List recent emails matching a Gmail search query.',
  input: {
    query?:       string,   // Gmail search syntax, e.g. "from:adam@gmail.com is:unread"
    max_results?: number,   // default 10
  },
  output: { messages: Array<{ id, threadId, subject, from, snippet, timestamp }> }
}

// Tool: email_check_thread
// Check if a thread has new replies (non-blocking version of email_wait)
{
  name: 'email_check_thread',
  description: 'Check if there are new replies in an email thread since a specific message.',
  input: {
    threadId:          string,
    since_message_id:  string,   // exclude messages up to and including this ID
  },
  output: {
    has_reply: boolean,
    messages?: Array<{ id, body, from, timestamp }>
  }
}
```

**Minimum viable set:** `email_send` + `email_wait`. Those two tools cover the primary use case. `email_read`, `email_list`, `email_check_thread` can be added incrementally.

---

## 7. Server Architecture (Paloma Pattern)

Following `mcp-servers/web.js` and `mcp-servers/voice.js` patterns:

```javascript
// mcp-servers/gmail.js
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

// Credentials at ~/.paloma/gmail-oauth-keys.json and ~/.paloma/gmail-tokens.json
// CLI auth: node mcp-servers/gmail.js auth

// If process.argv[2] === 'auth' → run OAuth flow, exit
// Otherwise → start MCP stdio server

const server = new Server(
  { name: 'gmail', version: '1.0.0' },
  { capabilities: { tools: {} } }
)
// ... standard ListTools + CallTool handlers
```

**Package dependencies to add:**
```json
"googleapis": "^144.0.0",
"google-auth-library": "^9.0.0",
"open": "^10.0.0"
```

Note: `google-auth-library` is a peer dep of `googleapis` — likely already installed transitively. `open` is needed for the one-time auth browser flow.

---

## 8. Registration in mcp-settings.json

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/home/adam/paloma/mcp-servers/gmail.js"],
      "env": {}
    }
  }
}
```

And in `bridge/mcp-proxy-server.js`, register the new tools following the existing MCP tool registration pattern.

---

## 9. Gmail API Quotas

Gmail API daily quota: **1 billion quota units/day** (effectively unlimited for personal use).

| Operation | Quota units |
|---|---|
| `messages.send` | 100 |
| `messages.list` | 5 |
| `messages.get` | 5 |
| `threads.get` | 5 |

**Polling analysis:** Polling every 20 seconds = 3 calls/min × 5 units = 15 units/min = 21,600 units/day. Completely within quota. Even 100x that would be fine.

**Rate limit:** 250 quota units/second per user. No concern for Paloma's usage patterns.

---

## 10. Security Considerations

### Token Storage
- `~/.paloma/gmail-oauth-keys.json` — OAuth client credentials (client_id + client_secret)
- `~/.paloma/gmail-tokens.json` — OAuth tokens (access_token + refresh_token)
- Both files: `chmod 600` — owner read/write only
- Both paths should be in `.gitignore` (they're in `~/.paloma/`, not in the repo, so they're already safe)

### Scope Minimization
Use the minimum necessary scopes:
```
https://www.googleapis.com/auth/gmail.send        ← send emails
https://www.googleapis.com/auth/gmail.readonly    ← read inbox (for polling replies)
```
Do NOT request `gmail.modify` or full `gmail` scope unless you need label modification or full account access.

### Only Adam's Account
This server only ever authenticates to Adam's own Gmail account (single-user OAuth Desktop App). It's not a multi-tenant service. No risk of accessing others' mail.

### Never Log Tokens
Ensure MCP server never logs `refresh_token` or `access_token` to stderr/stdout — those streams go to the bridge.

---

## 11. The "Wait for Reply" Pattern in Context

This is analogous to how Paloma waits for pillar callbacks:

```
Paloma sends email → saves threadId
  ↓
email_wait(threadId, sentMsgId, timeout=600)
  ↓
Poll loop: gmail.users.threads.get every 20s
  ↓
New message appears in thread → return body to caller
  ↓
Paloma reads Adam's reply and continues
```

**Important UX consideration:** While `email_wait` is blocking for the AI session, the MCP tool call itself is async from the bridge's perspective. The session stays alive during polling. This is the same as how `speak()` blocks until TTS completes — just much longer.

Consider a **default timeout of 10 minutes** with a clear message if it expires. Paloma can retry or fall back to another communication channel.

---

## 12. Recommended Implementation Plan for Chart

1. **Install deps** — add `googleapis` to `package.json`
2. **Build auth CLI** — `node mcp-servers/gmail.js auth` → runs OAuth flow, saves tokens
3. **Build `email_send`** — compose RFC 2822, base64url encode, call `messages.send`, return `{ messageId, threadId }`
4. **Build `email_wait`** — poll `threads.get` in a loop, return reply body on detection
5. **Build `email_read`** — `messages.get` with body extraction
6. **Build `email_list`** — `messages.list` with query support
7. **Register in mcp-settings.json** — add gmail server config
8. **Register tools in bridge** (if needed) — ensure autoExecute rules are sensible
9. **Test end-to-end** — send test email, reply from Gmail mobile, verify `email_wait` returns

---

## Key Files to Reference During Forge

| Purpose | Location |
|---|---|
| Existing MCP server pattern | `mcp-servers/web.js`, `mcp-servers/voice.js` |
| MCP server registration | `mcp-settings.json` |
| Bridge tool exposure | `bridge/mcp-proxy-server.js` |
| Token storage directory | `~/.paloma/` |
| shinzo-labs OAuth2 reference | `https://raw.githubusercontent.com/shinzo-labs/gmail-mcp/main/src/oauth2.ts` |
| Gmail API Node.js quickstart | `https://developers.google.com/gmail/api/quickstart/nodejs` |
| RFC 2822 threading reference | Stack Overflow: "Gmail API Replying to Email Thread Using NodeJS" |

---

## Open Questions for Chart

1. **Adam's email address** — The server needs to know where to send emails. Should it be hardcoded in `mcp-settings.json` as env var, or discovered from the authenticated Gmail profile?
2. **`email_wait` timeout UX** — What should Paloma do when `email_wait` times out? Return `{ timeout: true }` and let the AI decide? Or auto-retry?
3. **Subject line convention** — Use `[Paloma]` prefix? Or let the caller set any subject? A consistent prefix makes `email_list` queries easy.
4. **HTML vs plain text** — Plain text only, or support HTML bodies? Plain text is simpler and sufficient.
5. **MCP autoExecute policy** — Should `email_send` auto-execute (no confirmation dialog), or require Adam's approval each time? Given it's sending emails TO Adam, auto-execute seems reasonable.
