# Scout Findings: Multi-Backend Resilience
**Date:** 2026-03-14  
**Plan:** `active-20260314-paloma-multi-backend-resilience.md`  
**Scope:** All four AI backend managers — feature parity, error handling, routing, auth state

---

## TL;DR

| Backend | Status | Auth | Models | MCP Tools |
|---------|--------|------|--------|-----------|
| Claude CLI | ✅ Working | claude.ai Max (adamlynchmob@gmail.com) | opus, sonnet, haiku | Full (SSE proxy) |
| Codex CLI | ❌ Broken | OPENAI_API_KEY not set — 401 errors | gpt-5.1-codex-max | Full (Streamable HTTP) — can't verify |
| Copilot CLI | ⚠️ Unverified | gh auth (z3nz), `copilot` scope unclear | claude-*, gpt-5.x, gemini-* | Full (SSE proxy) — bug fixed in working copy |
| Ollama | ⚠️ No models | None (local) | qwen2.5-coder:32b/7b | 8 servers only (no proxy) |

**Critical gaps:**
1. Codex needs `OPENAI_API_KEY` — completely non-functional right now
2. Ollama needs `qwen2.5-coder:32b` pulled — zero models installed
3. No fallback logic anywhere — one backend down = those sessions fail silently
4. Codex auth errors are swallowed (not forwarded to browser)
5. Copilot MCP config bug fixed in working copy (uncommitted)

---

## 1. Feature Parity Matrix

### 1.1 Claude CLI (`bridge/claude-cli.js`)

**Session management:**
- New session: generates `--session-id {uuid}`, captures returned ID
- Resume: `--resume {sessionId}` flag
- Stop: `SIGTERM` via `process.kill`

**Streaming:**
- Format: JSONL from stdout, each line is a parsed event
- Event type emitted: `claude_stream` wrapping raw Claude SDK events
- Text extraction: `event.type === 'assistant'` (full) or `event.type === 'content_block_delta'` (streaming)
- Done: `claude_done` with `sessionId` and `exitCode`
- Error: `claude_error` with `error` message string

**MCP tool support:**
- Transport: **SSE** via `--mcp-config {tempFile}` pointing to `http://localhost:19192/sse?cliRequestId={requestId}`
- Pre-approval: `--allowedTools mcp__paloma__*` — all Paloma tools auto-approved
- Full tool palette: ALL MCP servers available (filesystem, git, shell, web, brave-search, voice, memory, fs-extra, exec, cloudflare-dns, gmail, ollama, pillar tools)
- Temp config file is cleaned up on process close

**System prompt injection:**
- Flag: `--append-system-prompt` — native Claude CLI support

**Model selection:**
- Flag: `--model {alias}` where aliases work: `opus`, `sonnet`, `haiku`
- Full model IDs also work: `claude-sonnet-4-6`, etc.
- Pillar defaults via `PHASE_MODEL_SUGGESTIONS[pillar]` from `src/prompts/phases.js`

**Authentication:**
```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "adamlynchmob@gmail.com",
  "subscriptionType": "max"
}
```

**Known limitations:**
- None known. Most battle-tested backend.

---

### 1.2 Codex CLI (`bridge/codex-cli.js`)

**Session management:**
- New session: `codex exec --json --full-auto -C {cwd} -m {model} {prompt}`
- Thread ID captured from `{"type":"thread.started","thread_id":"..."}` event
- Resume: `codex exec resume {threadId} --json --full-auto {prompt}`
- Stop: `SIGTERM` via `process.kill`

**Streaming:**
- Format: JSONL from stdout
- Key event: `item.completed` — the bridge maps these to `codex_stream` events
- Three sub-types forwarded: `agent_message`, `command_execution`, `mcp_tool_call`
- Structural events (`thread.started`, `turn.started`, `turn.completed`) handled internally
- **BUG:** Error events (`{"type":"error",...}`) are NOT handled in `_handleEvent` — they are silently dropped
- Done: `codex_done` with `sessionId` (threadId) and `exitCode`
- Error: `codex_error` from `proc.on('error')`

**MCP tool support:**
- Transport: **Streamable HTTP** via `-c mcp_servers.paloma.url="http://localhost:19192/mcp?cliRequestId={requestId}"`
- Full tool palette should be available (same as Claude)
- Cannot verify — auth is broken

**System prompt injection:**
- No native flag → prepended to prompt as `<SYSTEM_INSTRUCTIONS>\n{prompt}\n</SYSTEM_INSTRUCTIONS>\n\n{userPrompt}`
- Only prepended on new sessions (not resumes)

**Model selection:**
- Flag: `-m {model}` — e.g., `-m gpt-5.1-codex-max`
- Default in PillarManager: `gpt-5.1-codex-max`
- Other options: `o3`, `o4-mini` (need API key, not ChatGPT login)

**Authentication:**
- **STATUS: BROKEN** ❌
- Needs `OPENAI_API_KEY` env var — not set on this machine
- `codex login` command exists but leads to ChatGPT login (web-based, restricts to GPT-5.1-Codex family)
- Observed behavior: starts thread, immediately gets 401, retries 3x, fails
- Error output: `{"type":"error","message":"Reconnecting... 1/5 (unexpected status 401 Unauthorized...)"}`
- These error events are swallowed by the bridge (not forwarded to browser)

**Known limitations:**
- Auth is completely non-functional — needs `OPENAI_API_KEY`
- Error JSON events silently dropped (bridge only handles `item.completed`)
- `codex auth status` subcommand doesn't exist (v0.114.0)

---

### 1.3 Copilot CLI (`bridge/copilot-cli.js`)

**Session management:**
- New session: generates a UUID, passes it as `--resume {uuid}` (Copilot accepts UUID as new session ID)
- Session ID confirmed from `result` event: `event.type === 'result' && event.sessionId`
- Resume: `--resume {sessionId}` with same UUID
- Stop: `SIGTERM` via `process.kill`

**Streaming:**
- Format: JSONL from stdout (`--output-format json`)
- `assistant.message_delta` → `copilot_stream` with `{type: 'agent_message', text: deltaContent}` (streaming chunks)
- `assistant.message` → not forwarded (complete message, deduplication of deltas)
- `assistant.tool_call` → `copilot_stream` with `{type: 'tool_call', tool, arguments, status}`
- `result` → session ID captured, not forwarded
- Done: `copilot_done` with `sessionId` and `exitCode`
- Error: `copilot_error` from `proc.on('error')`

**MCP tool support:**
- Transport: **SSE** via `--additional-mcp-config @{tempFile}` 
- Temp file format: `{ mcpServers: { paloma: { type: 'sse', url: '...' } } }`
- Permission: `--allow-tool paloma` flag added alongside
- **BUG IN WORKING COPY (FIXED, UNCOMMITTED):** Config key was `servers` → should be `mcpServers` — git diff shows fix
- Full tool palette available once MCP config format is correct

**System prompt injection:**
- No native flag → prepended to prompt as `<SYSTEM_INSTRUCTIONS>\n{systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n{prompt}`
- Only on new sessions, not resumes

**Model selection:**
- Flag: `--model {model}` 
- Available models from `copilot --help`:
  - `claude-sonnet-4.6`, `claude-sonnet-4.5`, `claude-haiku-4.5`
  - `claude-opus-4.6`, `claude-opus-4.6-fast`, `claude-opus-4.5`
  - `gpt-5.2`, and others
- Default in PillarManager: `claude-sonnet-4.6`
- Frontend model list (claudeStream.js) also includes `gemini-3-pro-preview`

**Authentication:**
- Method: `gh auth token` (`GH_TOKEN`) — z3nz logged into github.com
- Token scopes: `gist`, `read:org`, `repo` — **notably missing `copilot` scope**
- **STATUS: UNVERIFIED** ⚠️ — whether the account has a Copilot subscription or needs `copilot` scope
- Auth fallback: uses whatever auth Copilot has configured if `GH_TOKEN` etc. not set

**Key flags:**
- `--allow-all` — enables all permissions (needed for non-interactive)
- `--no-ask-user` — disables ask_user tool (agent works autonomously)
- `--add-dir {cwd}` — grants file access to project directory

**Known limitations/bugs:**
- MCP config format bug fixed in working copy but not yet committed (see git diff)
- Stderr was previously silenced — now logged to console (also in working copy, uncommitted)
- Token scope may not include `copilot` — needs verification
- `--no-ask-user` flag used but bridge also has `ask_user` MCP tool — interaction unclear

---

### 1.4 Ollama (`bridge/ollama-manager.js`)

**Session management:**
- Sessions stored in in-memory Map (`sessionId → { messages[], model, tools[], lastActivity }`)
- **NOT persistent across bridge restarts** — all context lost on restart
- Session cleanup: inactive sessions expire after 30 minutes (`_cleanupSessions` every 5 min)
- New: `chat()` creates session if not found
- Resume: `chat({ sessionId })` appends to existing messages
- Stop: `AbortController.abort()` — graceful abort
- Max concurrent sessions: `MAX_CONCURRENT_OLLAMA = 4` (warning only, not enforced)

**Streaming:**
- Transport: Direct HTTP API fetch to `http://localhost:11434/api/chat`
- Format: streaming JSON chunks, each with `{ message: { content, tool_calls }, done }`
- Events emitted: `ollama_stream` with `{type: 'content_block_delta', delta: {type: 'text_delta', text}}`
- Tool calls: `ollama_tool_call` event with `{ assistantMessage, toolCalls }` — bridge executes tools
- Done: `ollama_done` with `sessionId` and `exitCode: 0`
- Error: `ollama_error` with error message

**MCP tool support:**
- **NOT via MCP proxy** — tools passed directly as Ollama native tool format
- Allowed servers: `filesystem`, `git`, `shell`, `web`, `brave-search`, `voice`, `memory`, `fs-extra`
- **Missing servers:** `exec`, `cloudflare-dns`, `gmail`, `ollama` — Ollama sessions can't use these
- Pillar tools: ✅ available (`pillar_spawn`, `pillar_message`, `pillar_read_output`, `pillar_status`, `pillar_list`, `pillar_stop`, `pillar_stop_tree`, `pillar_orchestrate`, `pillar_decompose`)
- Tool name format: `{serverName}__{toolName}` (double underscore)
- Tool call fallback: text-parsed tool calls (model writes JSON in text) via `_parseToolCallsFromText()`
- Tool round limits: 50 for pillar sessions, 20 for browser sessions

**System prompt injection:**
- System message prepended to `messages[]` array as `{ role: 'system', content: systemPrompt }`
- Persists across all turns in the session

**Model selection:**
- Default top-level: `qwen2.5-coder:32b`
- Default recursive children: `qwen2.5-coder:7b`
- Model can be switched mid-session via `chat({ model })`
- Context window: `num_ctx: 32768` (32K tokens)

**Authentication:**
- None — local HTTP API

**Current state:**
- **Service running** ✅ — Ollama v0.13.5 at `http://localhost:11434`
- **No models installed** ❌ — `ollama list` empty, `/api/tags` returns `{"models":[]}`
- Default model `qwen2.5-coder:32b` not available

**Known limitations:**
- Sessions lost on bridge restart (in-memory only)
- Restricted tool palette (8 servers vs full Claude palette)
- `qwen2.5-coder:32b` needs 20+ GB RAM — this Mac has enough but model must be pulled
- Text tool call parsing is a best-effort fallback — not all models use native tool format reliably

---

## 2. Error Handling Audit

### Common Pattern — CLI Process Errors
All three CLI backends (Claude, Codex, Copilot) share this pattern:
- `proc.on('error')` → emits `{backend}_error` — catches ENOENT (binary missing), EACCES, etc.
- `proc.on('close', code)` → emits `{backend}_done` with `exitCode` (0 = success, non-zero = abnormal)
- No retry logic in any backend
- No fallback to another backend

### Claude CLI — Error Handling
| Scenario | What Happens |
|----------|-------------|
| Binary missing | `proc.on('error')` → `claude_error { error: 'spawn claude ENOENT' }` |
| Auth fails | Claude likely writes error to stdout as JSON event; bridge forwards as `claude_stream` |
| Process crashes mid-stream | Buffer flushed, `claude_done` emitted with non-zero exitCode |
| Timeout | PillarManager 30-min timer calls `stop()` → SIGTERM → `claude_done` |
| MCP config error | Claude writes error, continues without tools |
| **Retry logic** | None |
| **Fallback logic** | None |

### Codex CLI — Error Handling
| Scenario | What Happens |
|----------|-------------|
| Binary missing | `proc.on('error')` → `codex_error { error: 'spawn codex ENOENT' }` |
| Auth fails (401) | Codex emits `{"type":"error",...}` JSON lines — **SILENTLY DROPPED** by bridge's `_handleEvent` |
| Process crashes mid-stream | Buffer flushed, `codex_done` emitted |
| Timeout | PillarManager 30-min timer → SIGTERM |
| **Retry logic** | Codex itself retries auth 3x internally, then gives up |
| **Fallback logic** | None |
| **Critical bug** | Auth error JSON events not handled → browser sees silence then done |

### Copilot CLI — Error Handling
| Scenario | What Happens |
|----------|-------------|
| Binary missing | `proc.on('error')` → `copilot_error { error: 'spawn copilot ENOENT' }` |
| Auth fails | stderr logged to console (after fix in working copy), not forwarded to browser |
| Process crashes mid-stream | Buffer flushed, `copilot_done` emitted |
| Timeout | PillarManager 30-min timer → SIGTERM |
| **Retry logic** | None |
| **Fallback logic** | None |
| MCP config temp file | Cleaned up in `stop()` and `close` handler ✅ |

### Ollama — Error Handling
| Scenario | What Happens |
|----------|-------------|
| Service not running | ECONNREFUSED → friendly `ollama_error: "Cannot connect to Ollama. Is it running? Try: ollama serve"` |
| Model not installed | HTTP error from API → `ollama_error` with Ollama's message |
| Request aborted | `AbortError` caught → `ollama_done` with exitCode 0 (graceful) |
| Tool round limit exceeded | Logged, session set to idle, `pillar_done` broadcast |
| Session not found | `ollama_error: "Session {id} not found"` |
| **Retry logic** | None |
| **Fallback logic** | None |
| **Best feature** | ECONNREFUSED gives actionable error message |

---

## 3. Backend Routing in bridge/index.js

### Message Type → Backend Mapping
```
claude_chat   → cliManager    (ClaudeCliManager)
codex_chat    → codexManager  (CodexCliManager)
copilot_chat  → copilotManager (CopilotCliManager)
ollama_chat   → ollamaManager (OllamaManager)
```

Each message type is handled independently. No shared routing logic. No automatic fallback.

### Event Unification
The bridge emits backend-specific events which pillar-manager handles with explicit type checks:
```js
// pillar-manager.js:1180-1182
const isStream = event.type === 'claude_stream' || event.type === 'codex_stream' || event.type === 'copilot_stream' || event.type === 'ollama_stream'
const isDone   = event.type === 'claude_done'   || event.type === 'codex_done'   || event.type === 'copilot_done'   || event.type === 'ollama_done'
const isError  = event.type === 'claude_error'  || event.type === 'codex_error'  || event.type === 'copilot_error'  || event.type === 'ollama_error'
```

Browser receives `pillar_stream` with `backend` field for format-aware rendering.

### Text Extraction Differences
```js
// pillar-manager.js:1196-1213
if (session.backend === 'codex' || session.backend === 'copilot') {
  // Text in cliEvent.text (agent_message events)
  if (cliEvent.type === 'agent_message' && cliEvent.text) { ... }
} else {
  // Claude text extraction — full message or delta
  if (cliEvent.type === 'assistant' && ...) { ... }
  else if (cliEvent.type === 'content_block_delta') { ... }
}
// Ollama text extracted directly from content_block_delta (same as Claude delta)
```

### Stop Message Types
```
claude_stop   → cliManager.stop(requestId)
codex_stop    → codexManager.stop(requestId)
copilot_stop  → copilotManager.stop(requestId)
ollama_stop   → ollamaManager.stop(requestId)
```

**No automatic fallback exists anywhere in bridge/index.js.**

---

## 4. Pillar System Backend Selection

### Backend Selection Flow
1. `pillar_spawn({ backend: 'claude|codex|copilot|ollama' })` — explicit selection
2. Default: `resolvedBackend = backend || 'claude'` (claude-cli.js:50)
3. `_defaultModel(pillar, resolvedBackend, opts)` chooses model based on backend (pillar-manager.js:1340-1351)
4. `_startCliTurn`: `const manager = this.backends[session.backend] || this.backends.claude` (pillar-manager.js:1140)
   - The `|| this.backends.claude` fallback ONLY protects against invalid backend key strings
   - Does NOT provide failure recovery

### Model Defaults by Backend (pillar-manager.js:1340-1351)
```js
ollama  → 'qwen2.5-coder:32b' (or '7b' for recursive children)
codex   → 'gpt-5.1-codex-max'
copilot → 'claude-sonnet-4.6'
claude  → PHASE_MODEL_SUGGESTIONS[pillar].split(':')[1] || 'sonnet'
```

### What Happens When Backend Fails
- **Selected backend has auth error:** Session errors out → Flow receives error notification → no retry
- **Selected backend binary missing:** `{backend}_error` event → session marked `error` → Flow notified
- **No automatic fallback:** A Codex session that fails stays failed. Claude is never tried automatically.

### PillarManager Concurrency Controls
- `MAX_RUNTIME_MS = 30 * 60 * 1000` — 30 min timeout (all backends)
- `MAX_CONCURRENT_OLLAMA = 4` — warning only, not enforced as a hard limit
- `MAX_OLLAMA_TOOL_ROUNDS = 50` — hard limit on tool call loops for Ollama pillar sessions

---

## 5. Authentication State on This Machine

### Claude CLI
- ✅ **WORKING** — claude.ai login, Max subscription
- Account: adamlynchmob@gmail.com
- Method: firstParty (claude.ai web auth)
- Version: 2.1.74

### Codex CLI
- ❌ **BROKEN** — needs `OPENAI_API_KEY`
- `OPENAI_API_KEY` env var is NOT set
- `codex login` exists but expects ChatGPT web login (restricts to GPT-5.1-Codex family)
- For o3/o4-mini models, API key auth required (no ChatGPT login path)
- Version: 0.114.0
- Fix: Set `OPENAI_API_KEY` in environment or run `codex login` to authenticate via ChatGPT

### Copilot CLI
- ⚠️ **UNVERIFIED** — `gh auth` shows z3nz logged in, but:
  - Token scopes: `gist`, `read:org`, `repo` — no `copilot` scope
  - No test run attempted (too risky without knowing if Copilot subscription exists)
  - Version: 1.0.5
  - GH_TOKEN available via `gh auth token`

### Ollama
- ✅ Service running (v0.13.5 at localhost:11434)
- ❌ **No models installed** — `ollama list` empty, `{"models":[]}` from API
- Default model `qwen2.5-coder:32b` must be pulled before use
- `qwen2.5-coder:7b` also not installed

---

## 6. Model Availability Per Backend

### Claude CLI
- Aliases: `opus`, `sonnet`, `haiku` (auto-resolve to latest)
- Full IDs: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`, etc.
- Fallback model flag: `--fallback-model` (for overload scenarios)

### Copilot CLI
From `copilot --help`:
- `claude-sonnet-4.6`, `claude-sonnet-4.5`, `claude-haiku-4.5`
- `claude-opus-4.6`, `claude-opus-4.6-fast`, `claude-opus-4.5`
- `gpt-5.2` (referenced in help examples)
- `gemini-3-pro-preview` (in frontend CLI_MODELS list, working copy)
- Default in PillarManager: `claude-sonnet-4.6`

### Codex CLI
- Default: `gpt-5.1-codex-max`
- Other options via `-m`: `o3`, `o4-mini` (need API key auth, not ChatGPT login)
- ChatGPT login restricts to GPT-5.1-Codex family only

### Ollama
- Default: `qwen2.5-coder:32b` (NOT installed)
- Recursive default: `qwen2.5-coder:7b` (NOT installed)
- Any model can be used if pulled: `ollama pull {model}`
- Smaller alternatives: `qwen2.5-coder:7b`, `qwen2.5-coder:14b`

---

## 7. MCP Tool Routing Gaps

### Full Tool Palette (Claude, Codex, Copilot via proxy)
All tools from all MCP servers exposed via the proxy at port 19192:
- `filesystem` — read/write/list files
- `git` — full git operations
- `shell` — read-only shell commands
- `web` — fetch URLs, download files
- `brave-search` — web search
- `voice` — Kokoro TTS
- `memory` — persistent semantic memory
- `fs-extra` — delete/copy operations
- `exec` — bash execution (Claude/Copilot get this; Ollama does NOT)
- `cloudflare-dns` — DNS management (Claude/Copilot; Ollama does NOT)
- `gmail` — email (Claude/Copilot; Ollama does NOT)
- `ollama` — Ollama API tools (Claude/Copilot; Ollama sessions do NOT get this)
- Pillar orchestration tools (via proxy's pillar tool handler)

### Ollama — Restricted Tool Set
`OLLAMA_ALLOWED_SERVERS` (pillar-manager.js:8-11):
```js
const OLLAMA_ALLOWED_SERVERS = new Set([
  'filesystem', 'git', 'shell', 'web', 'brave-search',
  'voice', 'memory', 'fs-extra'
])
```
Missing: `exec`, `cloudflare-dns`, `gmail`, `ollama` MCP server

**Rationale:** Local models have limited context windows (32K); restricting tools keeps the tool list manageable.

### Tool Name Format Differences
| Backend | Tool Name Format | Example |
|---------|-----------------|---------|
| Claude | `mcp__paloma__{server}__{tool}` | `mcp__paloma__filesystem__read_text_file` |
| Codex | `mcp__paloma__{server}__{tool}` | same |
| Copilot | `mcp__paloma__{server}__{tool}` | same |
| Ollama | `{server}__{tool}` | `filesystem__read_text_file` |

Ollama uses double-underscore without the `mcp__paloma__` prefix. `_parseToolCallsFromText` strips `mcp__paloma__` prefix when matching.

---

## 8. Known Bugs / Outstanding Issues

### Bug 1: Codex auth errors silently dropped
**File:** `bridge/codex-cli.js:_handleEvent`  
**Problem:** Codex emits `{"type":"error","message":"..."}` JSON events on auth failure (401) and other errors. `_handleEvent` only processes `item.completed` events. All other event types fall through silently.  
**Impact:** Auth failures look like silence → empty output → `codex_done`. No error surfaced to browser or Flow.  
**Fix needed:** Handle `{"type":"error"}` events → emit as `codex_error` or `codex_stream` with error content.

### Bug 2: Copilot MCP config key wrong (fixed but uncommitted)
**File:** `bridge/copilot-cli.js:chat()`  
**Problem:** MCP config was written as `{ servers: { paloma: {...} } }` but Copilot expects `{ mcpServers: { paloma: {...} } }`.  
**Status:** Fixed in working copy (git diff shows the change). Not committed.  
**Impact:** MCP tools completely broken for all Copilot sessions.

### Bug 3: Copilot stderr previously silenced (fixed but uncommitted)
**File:** `bridge/copilot-cli.js`  
**Problem:** stderr was silently ignored (`() => {}`), hiding all Copilot error output.  
**Status:** Fixed in working copy — now logs to console.  
**Impact:** Auth errors, model errors, permission errors were invisible.

### Bug 4: No models installed for Ollama
**Problem:** `qwen2.5-coder:32b` and `qwen2.5-coder:7b` are not pulled. Any Ollama session immediately fails with a model-not-found error.  
**Fix:** `ollama pull qwen2.5-coder:32b` (19 GB) or `ollama pull qwen2.5-coder:7b` (4.7 GB for lighter use).

### Bug 5: Codex OPENAI_API_KEY not configured
**Problem:** `OPENAI_API_KEY` env var not set. Codex gets 401 on every request.  
**Fix:** Either set `OPENAI_API_KEY` in environment, or run `codex login` for ChatGPT web auth (limits to GPT-5.1-Codex models).

### Bug 6: No automatic backend fallback
**Problem:** If a backend fails, the session errors out. There's no fallback to Claude or another working backend.  
**Impact:** A spawned Codex pillar that fails due to auth simply errors out — Flow must detect the error notification and manually retry with a different backend.  
**Note:** This is a design gap, not a code bug.

---

## 9. Recommendations for Chart

### Priority 1: Fix Codex Auth (Quick Win)
- Set `OPENAI_API_KEY` in bridge startup environment or `.env`
- OR run `codex login` for ChatGPT web auth (limited models)
- Also fix silent error dropping in `codex-cli.js:_handleEvent`

### Priority 2: Commit Copilot Bug Fixes
- The working copy has two fixes uncommitted: MCP config key and stderr logging
- These should be committed and tested

### Priority 3: Pull Ollama Models
- `ollama pull qwen2.5-coder:7b` for lightweight testing first (4.7 GB)
- `ollama pull qwen2.5-coder:32b` for full capability (19 GB)
- Consider adding startup validation: if model not found, log a clear error

### Priority 4: Surface Errors to Browser
- Codex: Handle `{"type":"error"}` events → emit as `codex_error` to browser
- Copilot: Forward stderr errors as `copilot_error` events (not just console.log)
- All backends: Consider a health-check endpoint or startup validation

### Priority 5: Backend Fallback Logic (Architectural)
- Add `fallbackBackend` option to `pillar_spawn`
- On `{backend}_error`, PillarManager could retry with fallback backend
- Simpler alternative: Flow re-spawns with different backend on error notification

### Priority 6: Ollama Session Persistence
- Sessions lost on bridge restart is painful for long-running Ollama work
- Consider: checkpoint messages to disk, restore on startup
- Or: document the limitation clearly so users know to plan accordingly

### Priority 7: Copilot Auth Verification
- Test whether `gh auth` (z3nz) has Copilot subscription access
- If not: add `copilot` OAuth scope or use `COPILOT_GITHUB_TOKEN` env var
- If yes: verify end-to-end by running a short Copilot session

---

## 10. Code Reference Quick Guide

| Topic | File | Lines |
|-------|------|-------|
| Claude session lifecycle | `bridge/claude-cli.js` | Full file (~110 lines) |
| Codex event handling | `bridge/codex-cli.js:_handleEvent` | ~90-115 |
| Copilot event handling | `bridge/copilot-cli.js:_handleEvent` | ~145-185 |
| Copilot MCP config (buggy key) | `bridge/copilot-cli.js:chat` | ~42-60 |
| Ollama tool call handling | `bridge/ollama-manager.js:_streamChat` | ~130-195 |
| Ollama text tool call parsing | `bridge/ollama-manager.js:_parseToolCallsFromText` | ~235-265 |
| Backend routing | `bridge/index.js` | ~240-355 |
| Backend selection in pillar | `bridge/pillar-manager.js:spawn` | ~47-115 |
| `_startCliTurn` | `bridge/pillar-manager.js` | ~1137-1171 |
| `_handleCliEvent` | `bridge/pillar-manager.js` | ~1173-1330 |
| `_defaultModel` | `bridge/pillar-manager.js` | ~1340-1351 |
| Ollama allowed servers | `bridge/pillar-manager.js` | ~8-11 |
| `_buildOllamaTools` | `bridge/pillar-manager.js` | ~504-531 |
| pillar_spawn tool definition | `bridge/mcp-proxy-server.js` | ~137-154 |
| MCP proxy tool list | `bridge/mcp-proxy-server.js` | ~87-115 |
| Config loading | `bridge/config.js` | Full file (~20 lines) |

---

*Scout findings complete. Ready for Chart.*
