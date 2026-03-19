# Scout Findings: Gemini CLI Bridge Integration

**Date:** 2026-03-19  
**Mission:** Research everything needed to integrate Google's Gemini CLI as a new backend in Paloma's bridge — alongside Claude CLI, Codex CLI, Copilot CLI, and Ollama.  
**Sources:** GitHub raw docs, source code (types.ts, stream-json-formatter.ts, headless.ts), official authentication and configuration references, existing Paloma backends (claude-cli.js, copilot-cli.js).

---

## TL;DR for Forge

Gemini CLI is a solid addition with one **critical difference** from all other backends: **there is no per-invocation MCP config flag**. MCP config must live in a `settings.json` file. The workaround is writing a temporary `.gemini/settings.json` in a per-session temp directory and using that as `cwd`. Everything else maps cleanly to Paloma's existing patterns.

**Verdict:** Integration is feasible and well-documented. 4 hours of Forge work max.

---

## 1. Installation

```bash
# Global install (preferred)
npm install -g @google/gemini-cli

# No-install run
npx @google/gemini-cli

# Homebrew (macOS/Linux)
brew install gemini-cli
```

Binary name: `gemini`  
Package: `@google/gemini-cli`  
NPM: stable, preview, nightly release tracks.

---

## 2. Authentication for Subprocess Use

**Critical:** Google OAuth (the default interactive login) **requires a browser**. It is NOT usable for subprocess spawning. Use one of these instead:

### Option A: Gemini API Key (RECOMMENDED for us)

```bash
export GEMINI_API_KEY="YOUR_KEY_FROM_AISTUDIO"
```

- Get key from https://aistudio.google.com/apikey
- Works 100% non-interactive — no TTY, no browser, no prompts
- Free tier: **250 requests/day, 10 req/min** — Flash model only
- Paid tier: unlimited with billing

### Option B: Vertex AI with Service Account (enterprise)

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/keyfile.json"
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_CLOUD_LOCATION="us-central1"
```

Higher limits, better for production. Requires GCP project setup.

### Option C: Vertex AI API Key

```bash
export GOOGLE_API_KEY="YOUR_VERTEX_API_KEY"
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

### Cached OAuth (fallback)

If the user has previously run `gemini` interactively, credentials are cached in `~/.gemini/`. Headless mode will reuse these cached credentials. But never rely on this — always configure explicit auth for subprocess use.

### `.env` file support

Gemini CLI auto-loads `.gemini/.env` in the current project dir or `~/.gemini/.env`. Can use this instead of shell exports.

**What to pass in GeminiCliManager:**
```javascript
const env = { ...process.env }
// GEMINI_API_KEY should be set in process.env already
// Pass through as-is — the CLI picks it up automatically
```

---

## 3. Non-Interactive / Subprocess Mode

Headless mode is triggered automatically when:
1. No TTY on stdin/stdout
2. `-p` / `--prompt` flag is provided
3. `CI=true` or `GITHUB_ACTIONS=true` in env

**Spawning correctly:**
```javascript
const proc = spawn('gemini', args, {
  stdio: ['ignore', 'pipe', 'pipe']  // stdin=ignore triggers headless
})
```

With `stdio: ['ignore', 'pipe', 'pipe']`, Gemini CLI detects non-TTY stdin and enters headless mode automatically. No interactive prompts will appear.

---

## 4. Complete CLI Flags Reference (Relevant Subset)

| Flag | Alias | Type | Description |
|------|-------|------|-------------|
| `--prompt` | `-p` | string | Prompt text. Forces non-interactive. |
| `--model` | `-m` | string | Model to use (alias or concrete name). Default: `auto`. |
| `--output-format` | `-o` | string | `text`, `json`, `stream-json`. **Use `stream-json`.** |
| `--approval-mode` | — | string | `default`, `auto_edit`, `yolo`. **Use `yolo` for subprocess.** |
| `--yolo` | `-y` | boolean | Deprecated alias for `--approval-mode=yolo`. |
| `--resume` | `-r` | string | Resume session by ID, index, or `"latest"`. |
| `--include-directories` | — | array | Extra workspace directories. |
| `--allowed-mcp-server-names` | — | array | MCP server name allowlist. |
| `--debug` | `-d` | boolean | Verbose logging to stderr. |
| `--list-sessions` | — | boolean | List sessions and exit. |

**Key omissions (compared to Claude CLI):**
- ❌ No `--append-system-prompt` flag
- ❌ No `--mcp-config <path>` flag — MCP config is file-only

---

## 5. System Prompt Injection

Gemini CLI does NOT have `--append-system-prompt`. Instead, use the `GEMINI_SYSTEM_MD` environment variable:

```bash
GEMINI_SYSTEM_MD=/tmp/gemini-system-abc123.md gemini -p "your prompt" --output-format stream-json
```

**Behavior:** The file FULLY REPLACES the built-in system prompt. This is different from Claude's `--append-system-prompt` (which appends). Forge must include any critical behavioral instructions in the file, not just Paloma-specific additions.

**Implementation in GeminiCliManager:**
```javascript
// Write system prompt to temp file
const systemPromptPath = join(tmpdir(), `paloma-gemini-system-${requestId}.md`)
writeFileSync(systemPromptPath, systemPrompt)
// Pass via env var
const env = { ...process.env, GEMINI_SYSTEM_MD: systemPromptPath }
```

**GEMINI.md** (for project context): Gemini CLI also reads `GEMINI.md` from the cwd for project instructions — equivalent to Claude's CLAUDE.md. This is additive on top of the system prompt. We could use this for Paloma's pillar phase instructions instead of the temp file approach.

---

## 6. MCP Config Format and Per-Invocation Passing

### ⚠️ CRITICAL DIFFERENCE FROM OTHER BACKENDS

Claude has `--mcp-config <path>`. Codex has `-c mcp_servers.X.url=...`. Copilot has `--additional-mcp-config @<path>`. **Gemini CLI has NONE of these.**

MCP config lives ONLY in `settings.json` files:
- User-level: `~/.gemini/settings.json`
- Project-level: `.gemini/settings.json` in cwd

### Workaround: temp cwd with project settings file

Create a temp directory per session, write `.gemini/settings.json` there, spawn with that as `cwd`:

```javascript
const sessionDir = join(tmpdir(), `paloma-gemini-session-${requestId}`)
mkdirSync(join(sessionDir, '.gemini'), { recursive: true })
writeFileSync(join(sessionDir, '.gemini', 'settings.json'), JSON.stringify(settings))
// Spawn with cwd: sessionDir
```

### settings.json MCP config format

```json
{
  "mcpServers": {
    "paloma": {
      "url": "http://localhost:19192/sse?cliRequestId=<requestId>",
      "trust": true,
      "timeout": 600000
    }
  }
}
```

**Config properties:**
- `command` (string): For stdio transport
- `url` (string): For SSE transport (our use case — SSE endpoint)
- `httpUrl` (string): For streamable HTTP transport
- `args` (string[]): Args for stdio transport
- `env` (object): Env vars for server process
- `cwd` (string): Working dir for stdio transport
- `timeout` (number): Request timeout ms (default 600000)
- `trust` (boolean): **Set to `true` to bypass all tool confirmations** — critical for non-interactive
- `includeTools` (string[]): Allowlist of tool names
- `excludeTools` (string[]): Denylist of tool names

### Tool naming in Gemini CLI

MCP tools are auto-namespaced as: `mcp_{serverName}_{toolName}`

Example: server `paloma`, tool `memory_store` → `mcp_paloma_memory_store`

**⚠️ WARNING: NO UNDERSCORES in server names.** The policy parser splits on the first underscore after `mcp_`. If the server name is `my_server`, tools will be misinterpreted. Use hyphens: `paloma`, not `paloma_server`.

### Global MCP settings in settings.json

```json
{
  "mcp": {
    "allowed": ["paloma"]
  },
  "mcpServers": {
    "paloma": {
      "url": "...",
      "trust": true
    }
  }
}
```

### Env var security note

Gemini CLI **automatically redacts** sensitive env vars from MCP server processes (`*KEY*`, `*TOKEN*`, `*SECRET*`, etc.). Must explicitly re-pass them in the `env` block if the MCP server needs them. This shouldn't affect our paloma bridge server (it uses no API keys).

---

## 7. Streaming Output Format

**Use `--output-format stream-json`** — newline-delimited JSON (JSONL) on stdout.

Source: `packages/core/src/output/types.ts` (read directly from GitHub).

### Event types and schemas

All events have: `{ type, timestamp }` base fields.

#### `init` — session start
```json
{
  "type": "init",
  "timestamp": "2026-03-19T10:00:00.000Z",
  "session_id": "a1b2c3d4-e5f6-...",
  "model": "gemini-2.5-pro"
}
```
**→ Extract `session_id` from this event** for subsequent `--resume` calls.

#### `message` — streaming text
```json
{
  "type": "message",
  "timestamp": "...",
  "role": "assistant",
  "content": "Here is the answer...",
  "delta": true
}
```
- `delta: true` = streaming chunk
- `delta: false` (or absent) = complete message

**Text extraction for pillar-manager:** `cliEvent.type === 'message' && cliEvent.role === 'assistant'` → use `cliEvent.content`

#### `tool_use` — model wants to call a tool
```json
{
  "type": "tool_use",
  "timestamp": "...",
  "tool_name": "mcp_paloma_memory_store",
  "tool_id": "call_abc123",
  "parameters": { "key": "value" }
}
```

#### `tool_result` — tool execution result
```json
{
  "type": "tool_result",
  "timestamp": "...",
  "tool_id": "call_abc123",
  "status": "success",
  "output": "stored successfully"
}
```

#### `error` — non-fatal warning/error
```json
{
  "type": "error",
  "timestamp": "...",
  "severity": "warning",
  "message": "Rate limit approaching"
}
```

#### `result` — final event (conversation complete)
```json
{
  "type": "result",
  "timestamp": "...",
  "status": "success",
  "stats": {
    "total_tokens": 1234,
    "input_tokens": 500,
    "output_tokens": 734,
    "cached": 0,
    "input": 500,
    "duration_ms": 4200,
    "tool_calls": 3,
    "models": {
      "gemini-2.5-pro": { "total_tokens": 1234, "input_tokens": 500, "output_tokens": 734, "cached": 0, "input": 500 }
    }
  }
}
```
**→ This signals conversation complete. Emit `gemini_done` after receiving this.**

### Exit codes
- `0` — success
- `1` — general error / API failure
- `42` — invalid prompt/args
- `53` — turn limit exceeded

---

## 8. Session Management

Sessions auto-saved to: `~/.gemini/tmp/<project_hash>/chats/`

**Resume by session ID:**
```bash
gemini --resume a1b2c3d4-e5f6-7890-abcd-ef1234567890 -p "continue the work"
```

**Session ID comes from:** the `init` event's `session_id` field.

**Implementation pattern (same as other backends):**
```javascript
// New session — no --resume flag, capture session_id from init event
// Resuming — pass --resume <sessionId>
```

---

## 9. Available Models

| Alias | Concrete Model | Notes |
|-------|---------------|-------|
| `auto` (default) | `gemini-2.5-pro` or `gemini-3-pro-preview` | Preview if enabled |
| `pro` | `gemini-2.5-pro` / `gemini-3-pro-preview` | Best reasoning |
| `flash` | `gemini-2.5-flash` | Fast, balanced |
| `flash-lite` | `gemini-2.5-flash-lite` | Fastest, cheapest |

**Gemini 3 Pro** is now available and is the default when preview features enabled.  
**Context window:** 1M tokens for all Gemini 2.5/3 models.

### Free tier limits by auth method

| Auth Method | Requests/Day | Requests/Min | Models |
|-------------|-------------|-------------|--------|
| Google login (OAuth) | 1,000 | 60 | Full family |
| Gemini API Key (free) | 250 | 10 | Flash only |
| Vertex AI Express | varies | varies | Full family |

**For subprocess use with API key:** Flash is the only free model. Pro requires billing.

---

## 10. Recommended GeminiCliManager Design

### Key decisions for Forge

1. **Auth:** Pass `GEMINI_API_KEY` from `process.env` transparently. Document that users must set this before using the Gemini backend.

2. **System prompt:** Write to temp file (`paloma-gemini-system-{requestId}.md`), pass as `GEMINI_SYSTEM_MD` env var. Clean up on close. Note: this REPLACES, not appends — include full Paloma pillar instructions.

3. **MCP config:** Create per-session temp dir (`paloma-gemini-{requestId}/`), write `.gemini/settings.json` with SSE config pointing to our MCP proxy, spawn with `cwd: sessionDir`. Clean up on close.

4. **Session IDs:** Extract from `init` event's `session_id` field. Pass `--resume <id>` on subsequent turns.

5. **Tool approval:** Set `"trust": true` in MCP server config + use `--approval-mode yolo` CLI flag.

6. **Text accumulation:** `cliEvent.type === 'message' && cliEvent.role === 'assistant'` → `cliEvent.content`

7. **Completion detection:** `cliEvent.type === 'result'` → emit `gemini_done`

### Complete args structure

```javascript
const args = [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--approval-mode', 'yolo',
]

if (sessionId) {
  args.push('--resume', sessionId)
}

if (model) {
  args.push('--model', model)
}
```

### Environment variables

```javascript
const env = {
  ...process.env,
  GEMINI_SYSTEM_MD: systemPromptPath,  // temp file path
  // GEMINI_API_KEY already in process.env
}
```

### Settings file for MCP

```json
{
  "mcp": {
    "allowed": ["paloma"]
  },
  "mcpServers": {
    "paloma": {
      "url": "http://localhost:19192/sse?cliRequestId={requestId}",
      "trust": true,
      "timeout": 600000
    }
  }
}
```

### Event emission pattern

```javascript
// isStream check to add to pillar-manager.js:
const isStream = /* ... */ || event.type === 'gemini_stream'
const isDone   = /* ... */ || event.type === 'gemini_done'
const isError  = /* ... */ || event.type === 'gemini_error'

// Text extraction (new branch in pillar-manager._handleCliEvent):
if (session.backend === 'gemini') {
  if (cliEvent.type === 'message' && cliEvent.role === 'assistant' && cliEvent.content) {
    this._appendOutput(session, cliEvent.content)
  }
}
```

### Default model

```javascript
// In _defaultModel():
if (backend === 'gemini') return 'flash' // free tier default
```

---

## 11. Gotchas and Differences from Other Backends

| Area | Claude CLI | Copilot CLI | Gemini CLI |
|------|-----------|------------|------------|
| MCP config | `--mcp-config <path>` | `--additional-mcp-config @<path>` | **settings.json only** |
| System prompt | `--append-system-prompt` (append) | XML tags in prompt (prepend) | `GEMINI_SYSTEM_MD` env (replace) |
| Tool approval | `--allowedTools mcp__paloma__*` | `--allow-tool paloma` | `"trust": true` in settings.json |
| Session ID source | `--session-id` flag (new) / `--resume` | `--resume <uuid>` | from `init` event `session_id` |
| Streaming format | `stream-json` (Claude's format) | `--json` (JSONL) | `stream-json` (Gemini's own JSONL) |
| Auth for subprocess | implicit (Claude Max/Pro) | `GH_TOKEN` | `GEMINI_API_KEY` env var |
| Output event prefix | `content_block_delta`, `assistant` | `agent_message` | `message` |
| Completion signal | `claude_done` event | `result` event + close | `result` event type in JSONL |

### Additional gotchas

- **No `--session-id` flag on new sessions**: Unlike Claude CLI where you can pre-set a UUID, Gemini CLI assigns the session ID and returns it in the `init` event. Must capture from output.
- **Project-level settings.json wins over user-level** for `mcpServers`. Temp cwd approach gives us isolation per session.
- **Sensitive env var redaction**: Gemini CLI strips `*KEY*`, `*TOKEN*`, `*SECRET*` vars from MCP subprocess env. Our paloma MCP server doesn't need these, so no issue.
- **Trusted folders**: stdio MCP servers only connect if the current folder is trusted. SSE transport (our approach) has no this restriction — use SSE.
- **Model `auto` may use Gemini 3 Pro** — good but context-window cost may surprise. Default to `flash` for subprocess to keep costs low.
- **No `--yolo` flag** — use `--approval-mode yolo` (the `-y` / `--yolo` boolean is deprecated).
- **`geminicli.com` is the official docs site** — not a third-party. It's Google's official documentation. GitHub README links to it.

---

## 12. Files to Create/Modify in Paloma

**New file:**
- `bridge/gemini-cli.js` — GeminiCliManager class

**Files to modify:**
- `bridge/index.js` — import GeminiCliManager, add to backends map, pass to PillarManager
- `bridge/pillar-manager.js` — add `gemini_stream`/`gemini_done`/`gemini_error` to isStream/isDone/isError checks, add gemini text extraction branch in `_handleCliEvent`, add `'gemini'` to backend enum, add `_defaultModel` case, add to `_buildSystemPrompt` (non-Claude path)
- `src/prompts/base.js` — add gemini to backend documentation
- `.paloma/instructions.md` — document gemini backend

**No changes needed:**
- `bridge/backend-health.js` — generic health tracking works for any backend
- `bridge/mcp-proxy-server.js` — SSE transport already supported
- MCP config files — Gemini uses its own settings.json mechanism

---

## Open Questions for Chart

1. **Temp dir cleanup**: Should the temp session dir (with `.gemini/settings.json` and system prompt file) be cleaned up on process close, or kept for debugging? Suggest: delete on close, matching copilot-cli.js pattern.

2. **System prompt strategy for Gemini**: The replacement (not append) behavior means our Paloma pillar instructions need to be comprehensive. Should we include Gemini CLI's built-in system prompt content as a base? We can export it with `GEMINI_WRITE_SYSTEM_MD=1 gemini`. Worth doing before Forge.

3. **Default model choice**: `flash` is free but Pro is much more capable. Since we require `GEMINI_API_KEY`, we could default to `pro` and let users get billing errors if they want free. Or default to `flash` and let users explicitly request `pro`. Recommend: `flash` as default.

4. **Backend health fallback order**: Where does `gemini` fit in the fallback chain? Current: `claude → copilot → codex → ollama`. Suggest: `claude → copilot → gemini → codex → ollama` since Gemini is a capable cloud model.

5. **Session dir naming**: Use `os.tmpdir()` + per-requestId dirs. Fine. Consider whether to use `cwd` option from the chat call or always use the temp dir as cwd.

---

*Research complete. All source code read directly from the GitHub repository. No assumptions made from memory.*
