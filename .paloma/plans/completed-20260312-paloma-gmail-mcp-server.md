# Plan: Gmail MCP Server for Paloma

**Status:** Completed — Shipped 2026-03-12  
**Date:** 2026-03-12  
**Scope:** paloma  
**Pipeline:** Scout ✅ → Chart ✅ → Forge ✅ → Polish ✅ → Ship ✅  

**Research:** `.paloma/docs/scout-gmail-email-integration-20260312.md`

---

## Goal

Build `mcp-servers/gmail.js` — an MCP server that enables two-way email communication between Paloma and Adam via the Gmail API. Paloma can send emails, reply in threads, and block-wait for Adam's responses.

---

## Architecture Overview

```
Paloma (AI session)
  │
  ├── email_send(to, subject, body)  → { messageId, threadId }
  ├── email_reply(threadId, body)    → { messageId, threadId }
  ├── email_wait(threadId, ...)      → { body, from, ... } or { timeout: true }
  ├── email_read(messageId)          → { from, subject, body, ... }
  ├── email_list(query)              → { messages: [...] }
  └── email_check_thread(threadId)   → { hasReply, messages: [...] }
        │
        ▼
  mcp-servers/gmail.js (MCP stdio server)
        │
        ▼
  Gmail API (googleapis npm, OAuth2)
        │
        ▼
  Adam's Gmail inbox
```

**Single file:** `mcp-servers/gmail.js` (~400 lines), following the pattern of `memory.js`.  
**One new dependency:** `googleapis` (includes `google-auth-library` transitively).  
**Auth:** OAuth2 Desktop App via `node mcp-servers/gmail.js auth` CLI subcommand.

---

## Design Decisions

### 1. Tool Interface — 6 Tools, 3 MVP

| Tool | Priority | Purpose |
|------|----------|---------|
| `email_send` | MVP | Send a new email, start a thread |
| `email_reply` | MVP | Reply in an existing thread |
| `email_wait` | MVP | Block-poll until Adam replies to a thread |
| `email_read` | Phase 2 | Read a specific message by ID |
| `email_list` | Phase 2 | Search/list recent messages |
| `email_check_thread` | Phase 2 | Non-blocking check for new replies |

**Why separate `email_send` and `email_reply`?** Different intent, different required params, less error-prone for the AI. `email_send` starts a new conversation; `email_reply` continues one with proper threading headers (In-Reply-To, References, threadId). Merging them into one tool with optional params would make the interface ambiguous.

### 2. Auth — OAuth2 Desktop App

- **Credentials:** `~/.paloma/gmail-oauth-keys.json` (client_id + client_secret from Google Cloud Console)
- **Tokens:** `~/.paloma/gmail-tokens.json` (refresh_token + access_token + expiry)
- **Scopes:** `gmail.send` + `gmail.readonly` (minimum necessary)
- **Redirect:** `http://localhost:3456/oauth2callback` (ephemeral local server during auth)
- **Auto-refresh:** `googleapis` handles token refresh transparently via refresh_token
- **Token persistence:** `oauth2Client.on('tokens', ...)` callback saves refreshed tokens to disk
- **CLI subcommand:** `node mcp-servers/gmail.js auth` — opens browser, completes OAuth flow, saves tokens, exits

**Why `prompt: 'consent'`?** Forces Google to always return a refresh_token. Without it, refresh_token is only provided on first authorization — if tokens are lost, re-auth fails silently.

### 3. Address Handling — `to` Parameter with ENV Default

- `email_send` accepts an optional `to` parameter
- Defaults to `GMAIL_RECIPIENT` environment variable (set in MCP settings)
- If neither is provided, returns a clear error
- `email_reply` defaults `to` to the sender of the last message in the thread (extracted from `From` header), falling back to `GMAIL_RECIPIENT`

**Why ENV var over profile discovery?** The authenticated Gmail account is Paloma's sending identity. The recipient (Adam) could use a different address. ENV var is explicit and easy to change.

### 4. Thread Tracking — Gmail-Native

Gmail's `threadId` is the primary conversation tracker. Thread continuity requires:
1. `threadId` in the API request body (groups messages in Gmail UI)
2. `In-Reply-To` header matching the previous message's `Message-ID`
3. `References` header building the chain of Message-IDs

The AI receives `{ messageId, threadId }` from every send/reply call and passes `threadId` back to continue the conversation. No external state store needed — Gmail API is the source of truth.

### 5. Wait Pattern — Poll with Known-ID Tracking

`email_wait` polls `threads.get` at a configurable interval:

```
1. First poll: snapshot all message IDs in thread → knownIds Set
2. Each subsequent poll: get message IDs → find any NOT in knownIds
3. New message found → fetch full content → return to caller
4. Timeout reached → return { found: false, timeout: true }
```

- **Default interval:** 20 seconds (3 API calls/min × 5 quota units = 15 units/min)
- **Default timeout:** 10 minutes (600 seconds)
- **Both configurable** via tool parameters
- **Quota impact:** ~21,600 units/day at max — negligible vs 1B daily quota

**Why not Push/Pub/Sub?** Requires public HTTPS webhook, Cloud Pub/Sub setup, IAM config. Massive overkill for personal use in a local WSL2 dev environment. Polling is simpler, more reliable, and adequate for human response times.

### 6. Subject Convention — Caller's Choice, `[Paloma]` Recommended

No enforced prefix. The AI decides the subject line. Document the convention that `[Paloma]` prefix enables easy Gmail filtering and `email_list` queries like `subject:[Paloma]`.

### 7. Error Handling

| Condition | Behavior |
|-----------|----------|
| No tokens file | Error: `"Gmail not authenticated. Run: node mcp-servers/gmail.js auth"` |
| Expired token, no refresh_token | Same auth prompt error |
| Token auto-refresh fails | Error with details, suggest re-auth |
| Network failure | Return error with message (no auto-retry — let the AI decide) |
| Invalid recipient | Pass through Gmail API error message |
| API quota exceeded | Return error with details (extremely unlikely) |
| `email_wait` timeout | Return `{ found: false, timeout: true, elapsedSeconds }` (not an error — normal flow) |

### 8. MCP autoExecute Policy

Recommend `email_send` and `email_reply` require confirmation (they send real emails). `email_read`, `email_list`, `email_check_thread`, `email_wait` can auto-execute (read-only operations). Adam can adjust in `.paloma/mcp.json`.

---

## Tool Schemas (Exact MCP Definitions)

### email_send

```javascript
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
        description: 'Email body in plain text.'
      }
    },
    required: ['subject', 'body']
  }
}
```

**Returns:** `{ messageId: string, threadId: string, to: string }`

### email_reply

```javascript
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
        description: 'Reply body in plain text.'
      },
      to: {
        type: 'string',
        description: 'Recipient email address. Defaults to the sender of the last message in the thread.'
      }
    },
    required: ['threadId', 'body']
  }
}
```

**Returns:** `{ messageId: string, threadId: string, to: string }`

### email_wait

```javascript
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
        description: 'Maximum time to wait in seconds. Default: 600 (10 minutes).'
      },
      intervalSeconds: {
        type: 'number',
        description: 'Polling interval in seconds. Default: 20.'
      }
    },
    required: ['threadId']
  }
}
```

**Returns (found):**
```json
{
  "found": true,
  "body": "Adam's reply text...",
  "from": "adam@example.com",
  "subject": "Re: [Paloma] Question",
  "messageId": "msg-id-123",
  "threadId": "thread-id-456",
  "timestamp": "2026-03-12T15:30:00Z"
}
```

**Returns (timeout):**
```json
{
  "found": false,
  "timeout": true,
  "elapsedSeconds": 600
}
```

### email_read

```javascript
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
}
```

**Returns:** `{ from, to, subject, body, timestamp, messageId, threadId }`

### email_list

```javascript
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
}
```

**Returns:** `{ count, messages: [{ messageId, threadId, subject, from, snippet, timestamp }] }`

### email_check_thread

```javascript
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
```

**Returns:**
```json
{
  "hasReply": true,
  "messages": [{ "messageId": "...", "body": "...", "from": "...", "timestamp": "..." }]
}
```

---

## Internal Code Structure

`mcp-servers/gmail.js` is organized into these sections:

```
#!/usr/bin/env node
│
├── Imports (googleapis, MCP SDK, node:fs, node:http, node:os)
│
├── ── Config ──
│   OAUTH_KEYS_PATH = ~/.paloma/gmail-oauth-keys.json
│   TOKENS_PATH = ~/.paloma/gmail-tokens.json
│   REDIRECT_URI = http://localhost:3456/oauth2callback
│   SCOPES = [gmail.send, gmail.readonly]
│   DEFAULT_RECIPIENT = process.env.GMAIL_RECIPIENT
│
├── ── Auth Module ──
│   createGmailClient()     → gmail API client (reads tokens, sets up auto-refresh)
│   runAuthFlow()            → one-time OAuth2 browser flow (CLI subcommand)
│   ensureAuth()             → validate tokens exist, return client or throw helpful error
│
├── ── CLI Entrypoint ──
│   if (process.argv[2] === 'auth') → runAuthFlow() then exit
│
├── ── Email Utilities ──
│   buildRawEmail({ to, subject, body })                          → base64url RFC 2822
│   buildReplyRaw({ to, subject, body, inReplyTo, references })   → base64url RFC 2822 reply
│   extractBody(message)                                          → plain text from Gmail message
│   extractHeader(message, name)                                  → header value from Gmail message
│   getLastMessageInThread(gmail, threadId)                        → full message object
│
├── ── Tool Handlers ──
│   handleSend({ to, subject, body })
│   handleReply({ threadId, body, to })
│   handleWait({ threadId, timeoutSeconds, intervalSeconds })
│   handleRead({ messageId })
│   handleList({ query, maxResults })
│   handleCheckThread({ threadId, sinceMessageId })
│
├── ── MCP Server ──
│   ListToolsRequestSchema handler (6 tool definitions)
│   CallToolRequestSchema handler (routes to handlers)
│
└── ── Start ──
    StdioServerTransport connection
```

### Key Implementation Details

**`createGmailClient()`**
```javascript
// Reads ~/.paloma/gmail-oauth-keys.json for client_id/client_secret
// Reads ~/.paloma/gmail-tokens.json for refresh_token/access_token
// Creates OAuth2Client, sets credentials
// Registers 'tokens' event handler to persist refreshed tokens
// Returns google.gmail({ version: 'v1', auth: oauth2Client })
```

**`handleReply()`** — Thread reply logic:
```javascript
// 1. Fetch last message in thread via threads.get (format: metadata)
// 2. Extract Message-ID, Subject, References headers from last message
// 3. Extract From header to determine reply-to address (default if 'to' not provided)
// 4. Build reply with In-Reply-To + References headers
// 5. Send with threadId in requestBody to maintain Gmail thread grouping
```

**`handleWait()`** — Polling logic:
```javascript
// 1. First poll: threads.get → snapshot knownIds = Set of all message IDs
// 2. Loop until timeout:
//    a. Wait intervalSeconds
//    b. threads.get → get current message IDs
//    c. Find newIds = current IDs not in knownIds
//    d. If newIds found: fetch full message for newest → return body/from/etc
// 3. Timeout: return { found: false, timeout: true, elapsedSeconds }
```

---

## Dependencies

**Add to `package.json`:**
```json
{
  "googleapis": "^144.0.0"
}
```

- `googleapis` includes `google-auth-library` transitively — no need to install separately
- `open` package is NOT needed — for the auth CLI, we'll print the URL to console and use `child_process.exec` with platform detection (`wslview` on WSL2, `xdg-open` on Linux, `open` on macOS) to attempt browser open. This avoids adding a dependency for a one-time operation.

---

## Registration

### MCP Settings (Claude CLI)

Add to `~/.claude/settings.json` (or project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/home/adam/paloma/mcp-servers/gmail.js"],
      "env": {
        "GMAIL_RECIPIENT": "adam@example.com"
      }
    }
  }
}
```

**No bridge changes needed.** The existing `McpProxyServer` in `bridge/mcp-proxy-server.js` auto-discovers tools from all registered MCP servers and namespaces them as `gmail__email_send`, `gmail__email_reply`, etc. The confirmation dialog works automatically.

### Paloma Bridge MCP Settings

Also add to `bridge/mcp-settings.json` (or wherever the bridge loads MCP server configs) following the same pattern as existing servers (web, voice, memory, fs-extra).

---

## Work Units

### WU-1: Auth & Server Skeleton

**Scope:** Create `mcp-servers/gmail.js` with OAuth2 auth module, CLI auth subcommand, and MCP server boilerplate. Add `googleapis` dependency.

**Files:**
- `mcp-servers/gmail.js` (create — auth module + server skeleton + empty tool list)
- `package.json` (modify — add `googleapis`)

**Depends on:** None

**Acceptance:**
- `npm install` succeeds with `googleapis` added
- `node mcp-servers/gmail.js auth` opens browser, completes OAuth flow, saves tokens to `~/.paloma/gmail-tokens.json`
- `node mcp-servers/gmail.js` starts MCP server on stdio without errors (empty tool list OK)
- Tokens file has `refresh_token`, `access_token`, `expiry_date`

### WU-2: MVP Tools (send + reply + wait)

**Scope:** Add the three core tools (`email_send`, `email_reply`, `email_wait`) with email utility functions. This is the heart of the server.

**Files:**
- `mcp-servers/gmail.js` (modify — add utilities + 3 tool definitions + 3 handlers)

**Depends on:** WU-1

**Acceptance:**
- `email_send` sends an email and returns `{ messageId, threadId }`
- `email_reply` replies in a thread with proper In-Reply-To/References headers
- `email_wait` polls a thread and returns the reply body when a new message appears
- `email_wait` returns `{ found: false, timeout: true }` after timeout expires
- Full send → wait → reply cycle works end-to-end

### WU-3: Extended Tools + Registration

**Scope:** Add the three read-only tools (`email_read`, `email_list`, `email_check_thread`) and register the server in MCP settings.

**Files:**
- `mcp-servers/gmail.js` (modify — add 3 tool definitions + 3 handlers)
- MCP settings file (modify — add gmail server config)

**Depends on:** WU-1

**Acceptance:**
- `email_read` returns full message content by ID
- `email_list` returns messages matching a Gmail search query
- `email_check_thread` returns new messages in a thread since a given message ID
- Server appears in Paloma's MCP tool list after registration
- All 6 tools callable through bridge proxy

**Parallelism note:** WU-2 and WU-3 both modify `mcp-servers/gmail.js` — they MUST run sequentially. Order: WU-1 → WU-2 → WU-3.

---

## Test Strategy

### Manual Testing (during Forge)

1. **Auth flow:** Run `node mcp-servers/gmail.js auth`, complete OAuth in browser, verify `~/.paloma/gmail-tokens.json` contains refresh_token
2. **Send test:** Call `email_send` with a test subject/body, verify email arrives in Gmail
3. **Reply test:** Reply to the test email from Gmail, call `email_check_thread` to verify detection
4. **Wait test:** Call `email_wait` on a thread, reply from Gmail mobile, verify the tool returns the reply
5. **Thread test:** Call `email_reply` on a thread, verify the reply appears in the same Gmail conversation
6. **List test:** Call `email_list` with `subject:[Paloma]` query, verify results

### Error Case Testing

1. **No tokens:** Delete `~/.paloma/gmail-tokens.json`, call any tool, verify helpful error message
2. **Bad recipient:** Call `email_send` with invalid email, verify error propagation
3. **Wait timeout:** Call `email_wait` with `timeoutSeconds: 5`, don't reply, verify timeout response
4. **Empty thread:** Call `email_check_thread` on a thread with no replies, verify `{ hasReply: false }`

### Polish Checklist

- No tokens or secrets logged to stdout/stderr
- All error paths return `isError: true` with helpful messages
- Tool descriptions are clear and unambiguous for AI consumption
- Code follows existing MCP server patterns (web.js, memory.js)
- No unnecessary dependencies

---

## Security Notes

- Token files (`~/.paloma/gmail-*.json`) are outside the repo in `~/.paloma/` — already gitignored by location
- Scopes are minimized: `gmail.send` + `gmail.readonly` only
- Server only accesses Adam's authenticated account (single-user Desktop App)
- OAuth client credentials are NOT secrets in the Google security model for Desktop Apps (they're considered public), but we still store them privately
- Never log token values to stderr (the bridge captures stderr)

---

## Open Items (for Adam to decide)

1. **`GMAIL_RECIPIENT` value** — What email address should be the default recipient? (Set in MCP settings env)
2. **Google Cloud project** — Adam needs to create the OAuth2 credentials in Google Cloud Console before the auth flow works (one-time setup, ~5 min)
3. **autoExecute policy** — Should `email_send`/`email_reply` auto-execute or require confirmation? Recommendation: require confirmation for sends, auto-execute for reads.

---

## Implementation Notes (Forge)

**Date:** 2026-03-12

### Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `mcp-servers/gmail.js` | Created | Complete Gmail MCP server — all 6 tools, OAuth2 auth, CLI auth subcommand |
| `package.json` | Modified | Added `googleapis ^144.0.0` dependency |
| `scripts/setup-mcp.sh` | Modified | Added gmail server block to generated `~/.paloma/mcp-settings.json`, preserves `GMAIL_RECIPIENT` env var across re-runs |
| `.paloma/mcp.json` | Modified | Added `gmail` to enabled list; auto-execute for read-only tools (`email_read`, `email_list`, `email_check_thread`, `email_wait`); `email_send`/`email_reply` require confirmation |

### Architecture Decisions

- **Single file, ~400 lines** — follows `memory.js` pattern with all tools, handlers, and auth in one file
- **No `open` package** — browser opening uses `exec()` with platform detection (`wslview` on WSL2, `xdg-open` on Linux, `open` on macOS), best-effort with no error if it fails. URL is always printed to console as fallback.
- **No `google-auth-library` direct dep** — it's included transitively via `googleapis`
- **`ensureAuth()` creates a fresh client per call** — simple, no stale state. Token refresh is handled automatically by googleapis.
- **`email_wait` snapshot pattern** — first poll captures known message IDs into a Set, subsequent polls detect new IDs not in the Set. This is more reliable than tracking a single `sentMessageId` since the thread may already have multiple messages.
- **`extractBody()` handles nested multipart** — walks up to 2 levels of parts to find `text/plain`, covers standard email and multipart/alternative formats.

### Deviations from Plan

- None. Implementation follows the plan exactly.

### Verification

- `node --check gmail.js` passes (syntax OK)
- Server starts and prints `[gmail] Gmail MCP Server running` on stderr
- Punycode deprecation warning from googleapis internals — harmless, no action needed
- Full end-to-end testing requires OAuth2 credentials (Google Cloud Console setup by Adam)
