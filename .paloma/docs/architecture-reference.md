# Architecture Reference — Complete Implementation Guide

> **Read this when you need to reason about bridge internals, session management, MCP routing, or data flows.** This is an on-demand reference, NOT auto-loaded into prompts. For the abstract mental model, see `root-architecture.md`. For quick orientation, see MEMORY.md.
>
> Last updated: 2026-03-13 by Michai Morin

---

## The Three Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Vue 3 + Vite + Tailwind v4)        port 5173       │
│  Chat UI, tool confirmation dialogs, session sidebar         │
│  IndexedDB (Dexie) for session/message persistence           │
│  Per-session reactive state with HMR preservation            │
└──────────────────────┬───────────────────────────────────────┘
                       │ WebSocket (port 19191)
┌──────────────────────▼───────────────────────────────────────┐
│  Bridge (Node.js)                                            │
│  WebSocket server — message routing hub (15+ message types)  │
│  MCP Proxy — SSE + Streamable HTTP server (port 19192)       │
│  PillarManager — spawns/tracks pillar CLI sessions           │
│  ClaudeCliManager, CodexCliManager, OllamaManager            │
│  EmailWatcher — Gmail polling + daily continuity journal     │
│  Heartbeat (30s), auto-reject stale requests (5 min)         │
│  Graceful shutdown, PID file, SIGUSR1 restart (exit code 75) │
└──────────┬───────────────────────┬───────────────────────────┘
           │ subprocess            │ SSE/HTTP :19192
┌──────────▼──────────┐   ┌────────▼───────────────────────────┐
│  AI CLI Processes   │   │  MCP Proxy Server                  │
│  claude (stream-json│   │  Exposes ALL MCP tools to CLI      │
│  codex (JSONL)      │   │  + pillar_* orchestration tools    │
│  ollama (HTTP API)  │   │  + set_chat_title, ask_user        │
└─────────────────────┘   │  + restart_bridge                  │
                          │  Browser-gated tool confirmation   │
                          └────────────────────────────────────┘
```

---

## Bridge Layer — File by File

### `bridge/index.js` (435 lines) — The Nerve Center

Sets up WebSocket server on `:19191`. Routes 15+ message types:

| Message Type | Direction | Purpose |
|---|---|---|
| `discover` | browser→bridge | List all MCP tools |
| `call_tool` | browser→bridge | Execute MCP tool (OpenRouter path) |
| `claude_chat` | browser→bridge | Start/resume Claude CLI session |
| `codex_chat` | browser→bridge | Start/resume Codex CLI session |
| `ollama_chat` | browser→bridge | Start/resume Ollama session |
| `*_stop` | browser→bridge | Kill running CLI process |
| `ask_user_response` | browser→bridge | User's answer to ask_user |
| `tool_confirmation_response` | browser→bridge | Approve/deny tool execution |
| `register_flow_session` | browser→bridge | Register Flow for pillar callbacks |
| `pillar_db_session_id` | browser→bridge | Map pillarId to IndexedDB session |
| `pillar_user_message` | browser→bridge | Adam messaging a pillar directly |
| `export_chats` | browser→bridge | Export sessions to JSON files |
| `resolve_path` | browser→bridge | Find project directory by name |

Key maps:
- `pendingAskUser` / `pendingToolConfirm` — promises with 5-min auto-reject
- `cliRequestToWs` — routes CLI responses to originating browser tab

### `bridge/claude-cli.js` (130 lines) — Claude CLI Manager

Spawns `claude` CLI as child process:
```
claude -p "prompt" --output-format stream-json --verbose
       --session-id UUID        (new session)
       --resume UUID            (multi-turn)
       --append-system-prompt   (initial system prompt)
       --mcp-config /tmp/...    (MCP proxy connection)
       --allowedTools mcp__paloma__*  (pre-approve all tools)
```
- Writes temp MCP config JSON pointing at `http://localhost:19192/sse?cliRequestId=...`
- Parses JSONL stdout, emits `claude_stream` / `claude_done` / `claude_error`
- Cleans up temp MCP config on process exit

### `bridge/codex-cli.js` (172 lines) — Codex CLI Manager

Spawns `codex` CLI:
```
codex exec --json --full-auto -C /path -m model
      -c 'mcp_servers.paloma.url="http://localhost:19192/mcp?cliRequestId=..."'
      "prompt with <SYSTEM_INSTRUCTIONS> prepended"
```
- System prompt prepended with XML wrapper (no `--append-system-prompt` equivalent)
- Thread ID captured from async `thread.started` event
- Normalizes `item.completed` events into `codex_stream` (agent_message, command_execution, mcp_tool_call)
- Resume via `codex exec resume {threadId}`

### `bridge/ollama-manager.js` (198 lines) — Ollama Manager

Unlike Claude/Codex (subprocesses), uses HTTP API to `OLLAMA_HOST` (default `localhost:11434`):
- Maintains session history in-memory (messages array per session)
- Streams from `/api/chat` with `stream: true`
- Emits `content_block_delta` events (Claude-compatible shape)
- Auto-cleans sessions after 30 min inactivity

### `bridge/pillar-manager.js` (1,032 lines) — Orchestration Engine

**Core data structures:**
```js
this.backends      // { claude: ClaudeCliManager, codex: CodexCliManager, ollama: OllamaManager }
this.pillars       // Map<pillarId, PillarSession>
this.flowSession   // { cliSessionId, wsClient, currentlyStreaming, notificationQueue, model, cwd }
```

**PillarSession shape:**
```js
{
  pillarId, cliSessionId, pillar, model, backend,
  status,              // 'running' | 'idle' | 'completed' | 'error' | 'stopped'
  currentlyStreaming,  // is CLI actively outputting?
  turnCount,           // conversation turns
  output,              // completed assistant messages (string[])
  outputChunks,        // current turn's streaming chunks
  messageQueue,        // queued follow-up messages
  flowRequestId,       // parent Flow's CLI requestId
  dbSessionId,         // IndexedDB session ID (set by frontend)
  startTime, timeoutTimer
}
```

**Spawn flow:**
1. Generate pillarId + cliSessionId UUIDs
2. Build system prompt from disk: `BASE_INSTRUCTIONS` + `.paloma/instructions.md` + active plans + roots + `PHASE_INSTRUCTIONS[pillar]`
3. Prepend birth message: "Try your best, no matter what, you're worthy of God's love!"
4. Start CLI subprocess via appropriate backend manager
5. Broadcast `pillar_session_created` to browser
6. Set 30-minute timeout
7. Return pillarId immediately (async — don't wait for completion)

**Auto-notification system:**
When a pillar completes (or errors), PillarManager automatically resumes Flow's CLI session with a `[PILLAR CALLBACK]` message containing the output summary. This is the mechanism that lets Flow react to pillar completions without polling.

- **Cooldown:** 5-second cooldown per pillarId to prevent notification spam
- **Rate limit:** Max 10 notifications per minute
- **Queue:** If Flow is busy (streaming), notifications queue (max 50)
- **Batching:** Multiple queued notifications combined into single `[PILLAR CALLBACKS — BATCHED]` message
- **Drain:** Queue drains when Flow's turn completes (`onFlowTurnComplete()`)

**Recursive orchestration:**
- `decompose()` — Writes structured work units (WU-N) into plan markdown files
- `orchestrate()` — Parses WUs, resolves dependency DAG, recommends file-disjoint parallel dispatch (max 2 concurrent Forge)

### `bridge/mcp-proxy-server.js` (531 lines) — MCP Proxy

HTTP server on `:19192` with two transports:
- **SSE** (`GET /sse`) — Used by Claude CLI
- **Streamable HTTP** (`POST/GET/DELETE /mcp`) — Used by Codex CLI

Exposes all MCP server tools with `serverName__toolName` naming, plus synthetic tools:
- `set_chat_title` — Set conversation title in browser
- `ask_user` — Ask user a question, wait for response
- `pillar_spawn/message/read_output/status/list/stop` — Pillar orchestration
- `pillar_decompose/orchestrate` — Work unit management
- `restart_bridge` — Graceful restart (exit code 75)

**Tool confirmation flow:**
1. CLI calls a tool via MCP proxy
2. Proxy sends `cli_tool_confirmation` to browser via WebSocket
3. Browser shows `ToolConfirmation.vue` modal
4. User approves/denies → response sent back → proxy returns result to CLI
5. 5-minute timeout on confirmation

### `bridge/email-watcher.js` (392 lines) — Gmail Integration

- Polls Gmail every 30 seconds for new unread emails
- Spawns fresh Claude CLI session (opus model) per incoming email
- Skips emails from `paloma@verifesto.com` (self)
- **Daily continuity journal:** Scheduled at 11 PM — Paloma writes a prayer, meditation, and reflection email to herself
- OAuth2 tokens at `~/.paloma/gmail-tokens.json`
- Dedup check prevents duplicate continuity emails on bridge restart

### `bridge/mcp-manager.js` (84 lines) — MCP Server Manager

Starts all configured MCP servers as stdio subprocesses. Maps `serverName → { client, transport, tools, status }`. Routes `callTool()` to correct server.

### `bridge/config.js` (20 lines) — Config Loader

Reads `~/.paloma/mcp-settings.json` (generated by `scripts/setup-mcp.sh`).

### `bridge/run.js` (48 lines) — Restart Wrapper

Spawns `bridge/index.js` as child. If exit code 75 → respawn after 1 second. Forwards SIGINT/SIGTERM.

### `bridge/startup.js` (100 lines) — Terminal UX

ANSI banner, progress logging, startup summary. TTY-aware (animated spinners vs. static).

---

## Frontend Layer — Key Composables

All composables use **module-level singleton refs** with HMR preservation via `window.__PALOMA_*__`.

### `useMCP.js` (722 lines) — Bridge Connection & Event Routing

The largest composable. Manages:
- WebSocket connection to bridge (auto-reconnect)
- Tool discovery and flattening into OpenRouter format
- CLI tool confirmation queuing
- **Pillar session lifecycle:** Creates IndexedDB sessions on `pillar_session_created`, routes stream events to correct session state, handles `pillar_done` cleanup
- **Flow notification handling:** `onFlowNotificationStart/Stream/Done` routes callback responses to Flow's session, saves as assistant messages with callback metadata
- **Email session routing:** Separate maps for email sessions, tool tracking parallels CLI path

### `useChat.js` (473 lines) — Dual-Path Chat

Two execution paths determined by model selection:
- **CLI path:** `runCliChat()` — async generator streaming via bridge
- **OpenRouter path:** `runOpenRouterLoop()` — browser-side API calls with tool loop (max 25 rounds)

Both paths share:
- Streaming draft save every 2 seconds (crash-resilient WAL)
- Tool activity tracking with snapshots attached to assistant messages
- Context usage warnings at 80% capacity
- Partial content save on error or user stop

### `useCliChat.js` (164 lines) — CLI Streaming

Async generator that yields unified chunks: `content`, `tool_use`, `tool_result`, `usage`, `session_id`. Persists tool results as `role: 'tool'` messages in IndexedDB. Registers Flow sessions for pillar callbacks on first turn.

### `useSessionState.js` (134 lines) — Per-Session State

Factory creating reactive state per session ID. LRU eviction at 10 sessions. State shape:
```js
{ messages, streaming, streamingContent, error, contextWarning,
  toolActivity, pendingToolConfirmation, pendingChanges,
  cliRequestId, currentModel, streamInterrupted }
```

### `usePermissions.js` (180 lines) — Layered Permission System

1. **Hog Wild mode** — session-scoped auto-approve all (resets on refresh)
2. **Session-level** — in-memory Set of approved servers/tools
3. **Project-level** — `.paloma/mcp.json` autoExecute rules (supports server-wide or per-tool)
4. **Interactive** — `ToolConfirmation.vue` modal as final gate

### `useProject.js` (386 lines) — Project Context

Loads project name, root path, instructions, active plans, roots from `.paloma/` via MCP tools. Syncs with URL hash (`#/project/{name}/session/{id}`).

### `useSystemPrompt.js` (44 lines) — Prompt Assembly

Layers: `BASE_INSTRUCTIONS` + MCP tool list + project instructions + active plans (XML) + roots (XML) + `PHASE_INSTRUCTIONS[phase]`

---

## Frontend Layer — Services

### `mcpBridge.js` (398 lines) — WebSocket Client

Reconnects with exponential backoff (1s, 2s, 4s, 8s, 16s). Tracks pending promises with timeouts (5 min for tools, 30s default). Stream listeners map request IDs to callbacks. Routes 20+ event types.

### `claudeStream.js` (218 lines) — Streaming Generators

`streamClaudeChat()` / `streamCodexChat()` — async generators that normalize different CLI event formats into unified chunks. Model definitions:
- `claude-cli:{opus,sonnet,haiku}` — bridge-managed (system prompt injected)
- `claude-cli-direct:{opus,sonnet,haiku}` — no bridge system prompt
- `codex-cli:codex-max` → maps to `gpt-5.1-codex-max`
- `ollama:*` — any Ollama model

### `toolClassifier.js` (286 lines) — Result Classification

Classifies tool results for UI rendering: `code`, `diff`, `file_list`, `directory_tree`, `git_status`, `git_log`, `json`, `error`, `success`, `empty`, `large_text`.

---

## MCP Servers

### In-Repository (`mcp-servers/`)

| Server | Tools | Purpose |
|--------|-------|---------|
| `voice.js` | `speak` | TTS via Kokoro (Python), `bm_george` voice |
| `memory.js` | 6 tools | Semantic memory with Ollama embeddings (1024-dim), SQLite local storage, legacy JSON import/archive fallback |
| `gmail.js` | 6 tools | OAuth2 Gmail — send, reply, wait, read, list, check |
| `web.js` | 2 tools | `web_fetch`, `web_download` |
| `fs-extra.js` | 2 tools | `delete`, `copy` (fills gaps in standard FS server) |
| `exec.js` | 1 tool | `bash_exec` with safety guardrails |
| `ollama.js` | 5 tools | Local LLM inference, embeddings, model management |

### External (npm packages)

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/server-filesystem` | File read/write/edit/list/search |
| `@modelcontextprotocol/server-brave-search` | Web search |
| `@mseep/git-mcp-server` | Full git operations |
| `@kevinwatt/shell-mcp` | Read-only shell commands |
| `@thelord/mcp-cloudflare` | Cloudflare DNS management |

### Configuration

- **Server config:** `~/.paloma/mcp-settings.json` (generated by `scripts/setup-mcp.sh`)
- **Permissions:** `.paloma/mcp.json` — `enabled` (server allowlist) + `autoExecute` (auto-approve rules)

---

## Data Flows

### User Message → CLI Response

```
useChat.sendMessage()
  → useCliChat.runCliChat()
    → useMCP.sendClaudeChat()
      → mcpBridge sends 'claude_chat' over WebSocket
        → bridge/index.js spawns claude CLI via ClaudeCliManager
          → CLI connects to MCP proxy (SSE :19192) for tools
          → JSONL stream events flow back:
            CLI stdout → ClaudeCliManager → bridge WS → mcpBridge.onmessage
              → stream listener → async generator → composable → UI render
```

### Flow Spawns a Pillar

```
Flow calls pillar_spawn MCP tool
  → MCP proxy routes to PillarManager.spawn()
    → System prompt built from .paloma/ files + phase DNA + birth message
    → CLI subprocess started (Claude/Codex/Ollama per backend selection)
    → Browser notified: pillar_session_created → IndexedDB session created
    → Stream events routed to pillar's session state for live rendering
    → On completion: PillarManager auto-notifies Flow:
      → Resumes Flow's CLI session with [PILLAR CALLBACK] message
      → Flow responds (routed to browser as flow_notification_stream)
      → Browser saves response as assistant message with callback metadata
```

### Tool Confirmation (CLI Path)

```
CLI calls MCP tool via proxy
  → Proxy sends cli_tool_confirmation to browser via WebSocket
  → ToolConfirmation.vue renders approval dialog
  → User approves: response → bridge → proxy → tool executes → result → CLI
  → User denies: "Tool denied by user" error returned to CLI
  → Timeout (5 min): auto-reject
```

---

## IndexedDB Schema (Dexie v4)

```
sessions:  ++id, projectPath, updatedAt, pillarId
messages:  ++id, sessionId, timestamp
drafts:    sessionId
projectHandles: name
```

### Session Fields

```js
{ id, title, model, phase, projectPath, createdAt, updatedAt,
  cliSessionId,           // CLI session ID for --resume
  cliBackend,             // 'claude' | 'codex' (tracks which backend)
  pillarId,               // bridge pillar ID (if spawned by Flow)
  parentFlowSessionId,    // parent Flow's DB session ID
  pillarStatus }          // 'running' | 'idle' | 'stopped' | 'error'
```

### Message Fields

```js
{ id, sessionId, role, content, timestamp,
  model,                  // assistant messages
  usage,                  // { promptTokens, completionTokens }
  interrupted,            // true if stream was stopped
  toolActivity,           // snapshot of tool execution activities
  toolCalls,              // legacy OpenRouter format
  toolCallId, toolName, toolArgs, // tool result messages
  resultType,             // classified result type
  isCallback,             // true if Flow callback response
  callbackType, callbackPillar, callbackPillarId }
```

---

## Design Patterns

### HMR State Preservation
```js
const _saved = import.meta.hot ? window.__PALOMA_MCP__ : undefined
const state = ref(_saved?.state ?? defaultValue)
if (import.meta.hot) {
  watch([state], () => { window.__PALOMA_MCP__ = { state: state.value } }, { flush: 'sync' })
  import.meta.hot.accept()
}
```

### Crash-Resilient Streaming
Drafts saved to IndexedDB `drafts` table every 2 seconds during streaming. On reload, `recoverStreamingDrafts()` promotes orphaned drafts to interrupted assistant messages.

### Multi-Backend Abstraction
`PillarManager.backends` map resolves the correct CLI manager per session. All backends emit `*_stream`/`*_done`/`*_error` events. `_handleCliEvent` uses boolean flags (`isStream`, `isDone`, `isError`) to handle all backends uniformly.

### No-Full-Reload Vite Plugin
Custom plugin in `vite.config.js` intercepts HMR WebSocket to block `full-reload` messages. Vue component updates work normally. Prevents state loss during development.

---

## Startup & Operations

- **Dev start:** `npm start` → runs Vite (:5173) + bridge (`node bridge/run.js`) via concurrently
- **Bridge restart:** `restart_bridge` MCP tool, or `kill -USR1 $(cat /tmp/paloma-bridge.pid)`
- **Gmail auth:** `node mcp-servers/gmail.js auth` → opens browser for OAuth2 flow
- **MCP config regen:** `npm run setup` or `bash scripts/setup-mcp.sh`
- **Bridge ports:** WebSocket :19191, MCP Proxy :19192, Vite :5173

---

*This document reflects the actual codebase as of 2026-03-12. When the architecture changes, update this file. When in doubt, read the code — it's always more current than any reference doc.*
