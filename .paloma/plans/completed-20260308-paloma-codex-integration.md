# Codex CLI Integration — Multi-Backend Architecture

> **Goal:** Make Codex CLI a first-class citizen in Paloma's architecture alongside Claude CLI, enabling per-pillar backend selection, concurrent multi-model execution, and leveraging each model's strengths.
> **Status:** MCP tool injection for Codex implemented (2026-03-11), needs testing
> **Created:** 2026-03-08

---

## Status

- [x] Scout: Complete — `.paloma/docs/scout-codex-cli-integration-20260308.md`
- [x] Chart: Complete — this document
- [x] Forge: Phase 2+3 Complete (subprocess backend + per-pillar config)
- [x] Forge: MCP tool injection for Codex via Streamable HTTP transport (2026-03-11)
- [ ] Polish: Pending — test full integration with bridge restart
- [ ] Ship: Pending

## Research References

- **Full system analysis:** `.paloma/docs/scout-codex-cli-integration-20260308.md`
- **CLI subprocess manager:** `bridge/claude-cli.js` (125 lines — template for `codex-cli.js`)
- **Pillar lifecycle:** `bridge/pillar-manager.js` (708 lines — needs backend abstraction)
- **MCP routing:** `bridge/mcp-proxy-server.js` (375 lines — pillar tool definitions)
- **Bridge entry point:** `bridge/index.js` (270 lines — wires everything together)
- **MCP server config:** `~/.paloma/mcp-settings.json`
- **System prompt DNA:** `src/prompts/base.js`, `src/prompts/phases.js`
- **Existing Codex binary:** `~/.local/share/nvm/v21.6.1/bin/codex` (v0.111.0)

---

## Executive Summary

Paloma currently has one brain — Claude CLI. This plan adds a second brain — Codex CLI — through a phased approach that starts with zero-code-change integration and builds toward deep multi-backend orchestration.

**Key design decisions:**

1. **Normalized event interface.** Both CLI managers emit the same event types (`assistant_text`, `tool_use`, `done`, `error`) so PillarManager doesn't branch on backend type. The normalization happens inside each CLI manager.
2. **MCP tool injection for Codex.** Codex sessions get Paloma's MCP proxy config just like Claude sessions, so the same permission system and tool routing applies. Codex's native tools (shell, apply_patch) are secondary.
3. **Backend is a session-level property.** Each pillar session has a `backend` field. PillarManager routes to the correct CLI manager based on this field.
4. **Backward compatible.** Every change defaults to Claude. Existing workflows are untouched until someone explicitly selects `codex` as a backend.
5. **AGENTS.md for interactive Codex use.** When using Codex interactively in the Paloma repo, `AGENTS.md` provides orientation. It's not used by the subprocess integration (which injects system prompts via config).

---

## Architecture Overview

### Current State

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Browser    │────▶│  Bridge WS   │────▶│ ClaudeCliMgr   │──▶ claude CLI
│   (Vue SPA)  │     │  (index.js)  │     │ (claude-cli.js)│
└─────────────┘     └──────┬───────┘     └────────────────┘
                           │
                    ┌──────▼───────┐     ┌────────────────┐
                    │ PillarManager│────▶│ ClaudeCliMgr   │──▶ claude CLI (pillar)
                    │              │     │ (same instance) │
                    └──────────────┘     └────────────────┘
```

PillarManager holds a reference to `cliManager` (a single `ClaudeCliManager` instance). All sessions — Flow and pillars — go through the same manager.

### Target State

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Bridge WS   │────▶│ ClaudeCliMgr    │──▶ claude CLI
│   (Vue SPA)  │     │  (index.js)  │     └─────────────────┘
└─────────────┘     └──────┬───────┘     ┌─────────────────┐
                           │         ┌──▶│ CodexCliMgr     │──▶ codex exec
                    ┌──────▼───────┐ │   └─────────────────┘
                    │ PillarManager│─┤
                    │              │ │   ┌─────────────────┐
                    │ backends:    │ └──▶│ ClaudeCliMgr    │──▶ claude CLI
                    │  { claude,   │     └─────────────────┘
                    │    codex }   │
                    └──────────────┘
```

PillarManager holds a map of backend managers: `{ claude: ClaudeCliManager, codex: CodexCliManager }`. Each pillar session specifies which backend to use.

### Normalized Event Interface

Both CLI managers emit the same event types to their `onEvent` callback:

| Event Type | Fields | Description |
|---|---|---|
| `cli_text` | `requestId`, `text`, `isPartial` | Text content. Claude: incremental deltas (`isPartial: true`). Codex: complete items (`isPartial: false`). |
| `cli_tool_use` | `requestId`, `tool`, `input` | Tool call. |
| `cli_result` | `requestId`, `result` | Tool result. |
| `cli_done` | `requestId`, `sessionId`, `exitCode`, `usage` | Turn complete. |
| `cli_error` | `requestId`, `error` | Error. |

PillarManager's `_handleCliEvent` switches on these normalized types, not on raw Claude/Codex event formats. The browser receives the raw events tagged with a `backend` field for rendering.

**Why normalize?** PillarManager is the integration point — it manages lifecycle, accumulates output, triggers callbacks. If it branches on backend type, every future backend adds more branching. Normalization keeps PillarManager clean and makes adding a third backend (e.g., Gemini CLI) trivial.

**Why preserve raw events for browser?** The rendering behavior is inherently different — Claude streams character-by-character, Codex emits complete blocks. The browser composable needs the raw events to render appropriately. The `pillar_stream` broadcast includes both the normalized data and the raw event.

---

## Phase 1: Codex as MCP Tool (Zero Code Changes)

### What Changes

Add `codex mcp-server` to Paloma's MCP server configuration. This makes two tools available to all Claude CLI sessions through the existing MCP proxy:

- **`codex`** — Start a new Codex session (prompt, model, sandbox, cwd, instructions)
- **`codex-reply`** — Continue an existing session (threadId, prompt)

### Config Change

```json:~/.paloma/mcp-settings.json
{
  "servers": {
    "codex": {
      "command": "codex",
      "args": ["mcp-server"]
    }
  }
}
```

### What Becomes Possible

1. **Claude pillars call Codex as a tool.** A Claude Forge session could delegate a subtask to Codex:
   ```
   Use the codex tool to scaffold the project:
   codex({ prompt: "Create a Django project with...", sandbox: "workspace-write", cwd: "/home/adam/projects/verifesto" })
   ```

2. **Polish uses Codex for code review.** Claude Polish can call:
   ```
   codex({ prompt: "Review the changes in the last commit for bugs, security issues, and style problems", sandbox: "read-only", cwd: "/home/adam/paloma" })
   ```

3. **Structured data extraction.** Codex's `--output-schema` support (via the tool's config parameter) enables schema-enforced JSON output — useful for extracting structured information from code.

4. **Multi-turn Codex conversations within a Claude session.** Chain `codex` → `codex-reply` using the returned `threadId`.

### Limitations

- **Synchronous blocking** — Each Codex tool call blocks the Claude session until Codex finishes. No parallel execution.
- **No streaming** — Only the final output appears. No real-time progress in browser during Codex execution.
- **Double reasoning overhead** — Claude reasons about what to send Codex, Codex reasons about the task. Not ideal for large tasks.
- **No browser UI for Codex tool activity** — Codex's internal tool calls (shell, apply_patch) are invisible to Paloma's browser.

### When to Use

Phase 1 is best for **small, focused tasks** where Codex's strengths add value:
- Code review (read-only, structured feedback)
- Quick scaffolding tasks
- Structured data extraction
- Tasks where GPT-5's reasoning complements Claude's

### Files Modified

None — config only.

### Estimated Effort

5 minutes. Add the config entry, restart the bridge.

---

## Phase 2: Subprocess Backend (Deep Integration)

### Overview

Build `codex-cli.js` — a subprocess manager that mirrors `claude-cli.js` but drives `codex exec --json`. Then abstract PillarManager to support multiple backends.

### 2.1 CodexCliManager (`bridge/codex-cli.js`)

New file, ~130 lines. Same interface as `ClaudeCliManager`:

```javascript
export class CodexCliManager {
  constructor() {
    this.processes = new Map() // requestId → { process, threadId, configPath }
    this.mcpProxyPort = null
  }

  // Same signature as ClaudeCliManager.chat()
  chat({ prompt, model, sessionId, systemPrompt, cwd }, onEvent) { ... }
  stop(requestId) { ... }
  shutdown() { ... }
}
```

**Invocation:**
```bash
codex exec --json --ephemeral --full-auto -C <cwd> "<prompt>"
```

Key flags:
- `--json` — JSONL event output
- `--ephemeral` — no session persistence (pillar sessions are tracked by PillarManager, not Codex's SQLite)
- `--full-auto` — sandboxed, no approval prompts (equivalent to `-a on-request -s workspace-write`)
- `-C <cwd>` — working directory

**System prompt injection:**
Codex doesn't have `--append-system-prompt`. Two options:

| Approach | Mechanism | Pros | Cons |
|---|---|---|---|
| **A) Config file** | Write temp TOML with `instructions = """..."""`, pass via config mechanism | Clean separation, handles multi-KB prompts | Need to verify config file injection in exec mode |
| **B) Developer instructions** | `-c 'developer_instructions="..."'` | Simple CLI flag | String escaping nightmare for multi-KB prompts |
| **C) Prefix prompt** | Prepend system prompt to user prompt: `"[SYSTEM]\n{prompt}\n[USER]\n{message}"` | No config needed | Messy, model may not respect boundary |

**Recommended: Approach A.** Write a temp TOML config file per session. Contents:

```toml
instructions = """
{full Paloma system prompt here}
"""
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

Pass via: `codex exec --json --ephemeral --config-path /tmp/paloma-codex-<id>.toml -C <cwd> "<prompt>"`

> **Prototyping needed:** Verify that `--config-path` (or equivalent) works in `codex exec` mode. If not, fall back to approach B with careful escaping, or explore writing a temporary `.codex/config.toml` in the working directory.

**MCP tool injection (same as Claude):**
If Codex supports MCP servers in exec mode (via config), inject Paloma's MCP proxy:

```toml
[mcp_servers.paloma]
url = "http://localhost:19192/sse?cliRequestId=<id>"
```

This gives Codex sessions access to all of Paloma's tools — filesystem, git, web, search — through the same permission and confirmation system. Falls back to Codex's native tools if MCP injection isn't supported in exec mode.

**JSONL event parsing:**

```javascript
// Codex JSONL → normalized events
switch (event.type) {
  case 'thread.started':
    // Capture threadId for session resume
    threadId = event.thread_id
    break
  case 'item.completed':
    if (event.item.type === 'agent_message') {
      onEvent({ type: 'cli_text', requestId, text: event.item.text, isPartial: false })
    } else if (event.item.type === 'command_execution') {
      onEvent({ type: 'cli_tool_use', requestId, tool: 'shell', input: event.item.command })
      onEvent({ type: 'cli_result', requestId, result: event.item.aggregated_output })
    }
    break
  case 'turn.completed':
    onEvent({ type: 'cli_done', requestId, sessionId: threadId, exitCode: 0, usage: event.usage })
    break
}
```

**Session resume:**
For multi-turn pillar sessions, Codex uses `codex exec resume <threadId>`. The `threadId` comes from the `thread.started` event and maps to `session.cliSessionId` in PillarManager.

### 2.2 PillarManager Backend Abstraction

**Constructor change:**
```javascript
constructor(backends, { projectRoot, broadcast }) {
  // backends: { claude: ClaudeCliManager, codex: CodexCliManager }
  this.backends = backends
  this.defaultBackend = 'claude'
  // ... rest unchanged
}
```

**`spawn()` — add `backend` parameter:**
```javascript
async spawn({ pillar, prompt, model, flowRequestId, planFile, backend }) {
  const resolvedBackend = backend || this.defaultBackend
  const session = {
    // ... existing fields
    backend: resolvedBackend,
    // ...
  }
  // ...
}
```

**`_startCliTurn()` — route to correct manager:**
```javascript
_startCliTurn(session, prompt, systemPrompt, isResume = false) {
  const manager = this.backends[session.backend]
  // ... build chatOptions (same as today)
  const { requestId, sessionId } = manager.chat(chatOptions, (event) => this._handleCliEvent(session, event))
  // ...
}
```

**`_handleCliEvent()` — adapt to normalized events:**

Currently this method handles `claude_stream`, `claude_done`, `claude_error` events, where `claude_stream` wraps a raw Claude event that gets broadcast to the browser. With normalization:

```javascript
_handleCliEvent(session, event) {
  if (event.type === 'cli_text') {
    // Accumulate text
    session.currentOutput += event.text
    session.lastActivity = new Date().toISOString()
    // Broadcast to browser with backend tag
    this.broadcast({
      type: 'pillar_stream',
      pillarId: session.pillarId,
      backend: session.backend,
      event // normalized event
    })
  } else if (event.type === 'cli_done') {
    // ... same completion logic as today
  } else if (event.type === 'cli_error') {
    // ... same error logic as today
  }
}
```

**Important:** This changes the `pillar_stream` event format sent to the browser. The browser's pillar rendering composable must be updated to handle the new normalized format instead of raw Claude events.

**`_defaultModel()` — backend-aware:**
```javascript
_defaultModel(pillar, backend) {
  const suggestion = PHASE_MODEL_SUGGESTIONS[pillar] || `${backend}:sonnet`
  const [suggestedBackend, model] = suggestion.split(':')
  // Only use the suggestion if it matches the backend
  if (suggestedBackend === backend || suggestedBackend === `${backend}-cli`) {
    return model
  }
  // Fallback defaults per backend
  return backend === 'codex' ? 'gpt-5.1-codex-max' : 'sonnet'
}
```

**`_buildSystemPrompt()` — backend-aware prompt building:**

The system prompt structure differs by backend:
- **Claude:** Full Paloma DNA + plans + roots + phase instructions. Injected via `--append-system-prompt`.
- **Codex:** Same content, but injected via `instructions` config. Also needs Codex-specific tool guidance (use `apply_patch` for file edits, sandbox awareness).

For Phase 2, keep the same prompt content but add a backend-specific addendum:

```javascript
async _buildSystemPrompt(pillar, { planFilter, backend } = {}) {
  let prompt = BASE_INSTRUCTIONS
  // ... existing plan/roots/phase injection (unchanged) ...
  
  // Backend-specific addendum
  if (backend === 'codex') {
    prompt += '\n\n## Backend: Codex CLI\n\n'
    prompt += 'You are running on OpenAI Codex CLI (GPT-5.1-Codex). '
    prompt += 'You have Paloma\'s full MCP tool suite available. '
    prompt += 'Prefer MCP tools over native shell/apply_patch for consistency with the permission system.\n'
  }
  
  return prompt
}
```

### 2.3 Bridge Wiring (`bridge/index.js`)

```javascript
import { CodexCliManager } from './codex-cli.js'

// ... existing setup ...
const codexManager = new CodexCliManager()
codexManager.mcpProxyPort = proxyPort

const backends = {
  claude: cliManager,
  codex: codexManager
}

pillarManager = new PillarManager(backends, { projectRoot: process.cwd(), broadcast })
```

The `claude_chat` WebSocket message type continues to use `cliManager` (Claude) for Flow sessions. Only pillar sessions can use Codex — Flow always runs on Claude (the orchestrator needs Claude's MCP tool loop for pillar management).

### 2.4 MCP Proxy Tool Update (`bridge/mcp-proxy-server.js`)

Add `backend` parameter to `pillar_spawn`:

```javascript
{
  name: 'pillar_spawn',
  inputSchema: {
    type: 'object',
    properties: {
      pillar: { type: 'string', enum: ['scout', 'chart', 'forge', 'polish', 'ship'] },
      prompt: { type: 'string' },
      model: { type: 'string', description: 'Model name (backend-specific: "opus"/"sonnet" for Claude, "gpt-5.1-codex-max" for Codex)' },
      planFile: { type: 'string', description: 'Optional: only load this specific plan file' },
      backend: { type: 'string', enum: ['claude', 'codex'], description: 'AI backend for this pillar session (default: claude)' }
    },
    required: ['pillar', 'prompt']
  }
}
```

### 2.5 Browser-Side Changes

The `pillar_stream` event format changes. The browser composable that renders pillar output needs to handle:

1. **Normalized events** instead of raw Claude events
2. **Backend tag** — render Claude streams as incremental text, Codex items as complete blocks
3. **Model display** — show `claude:opus` or `codex:gpt-5.1-codex-max` in the session header

Key frontend files to update:
- The composable handling `pillar_stream` events (need to identify exact file)
- Session header/metadata display

### 2.6 ClaudeCliManager Normalization

`claude-cli.js` must also emit normalized events. This is a refactor of the existing manager:

```javascript
// Current: onEvent({ type: 'claude_stream', requestId, event: rawEvent })
// New:     onEvent({ type: 'cli_text', requestId, text: '...', isPartial: true, raw: rawEvent })
```

The `raw` field preserves the original event for browser rendering if needed.

### Files to Create / Modify

| File | Action | Description |
|---|---|---|
| `bridge/codex-cli.js` | **Create** | ~130 lines. Codex subprocess manager. |
| `bridge/claude-cli.js` | **Modify** | ~30 lines changed. Normalize event output. |
| `bridge/pillar-manager.js` | **Modify** | ~40 lines changed. Constructor takes backends map, route to correct manager, handle normalized events. |
| `bridge/mcp-proxy-server.js` | **Modify** | ~5 lines. Add `backend` to `pillar_spawn` schema. |
| `bridge/index.js` | **Modify** | ~10 lines. Create CodexCliManager, pass backends map. |
| `src/composables/useClaudeSession.js` (or equivalent) | **Modify** | Adapt pillar stream rendering for normalized events. |

### Estimated Effort

Medium — 2-3 Forge sessions. First session for the backend abstraction + normalization (claude-cli.js refactor + pillar-manager.js). Second session for codex-cli.js + bridge wiring. Third (if needed) for browser-side rendering updates.

---

## Phase 3: Per-Pillar Backend Configuration

### Overview

Enable intelligent backend selection — different pillars can default to different backends based on their strengths.

### 3.1 Model Suggestion Updates (`src/prompts/phases.js`)

Extend `PHASE_MODEL_SUGGESTIONS` to support backend-aware defaults:

```javascript
export const PHASE_MODEL_SUGGESTIONS = {
  flow:   'claude:opus',     // orchestrator — always Claude (needs MCP tool loop)
  scout:  'claude:sonnet',   // research — Claude's web tools + reasoning
  chart:  'claude:opus',     // planning — deep reasoning
  forge:  'claude:opus',     // building — complex coding
  polish: 'claude:sonnet',   // review — balanced work
  ship:   'claude:sonnet'    // commit — lessons + evolution
}
```

Note: Flow is **always Claude** — it needs the MCP tool loop for pillar orchestration (`pillar_spawn`, `pillar_status`, etc.). This is a hard constraint.

Adam can override per-pillar defaults via the `backend` parameter on `pillar_spawn`. The suggestion is just the default when no backend is specified.

### 3.2 DNA Updates

**`src/prompts/base.js`** — Add multi-backend awareness to the Tools section:

```
## Multi-Backend Architecture

Paloma supports multiple AI backends. Each pillar session runs on one backend:

- **Claude CLI** — Deep reasoning, long context, MCP tool integration. Default for most pillars.
- **Codex CLI** — Built-in sandbox, structured output, code review. Available for focused coding tasks.

Flow always runs on Claude. Other pillars can be spawned on either backend via the `backend` parameter on `pillar_spawn`.
```

**`src/prompts/phases.js`** — Update Flow's pillar tools section:

```
- `pillar_spawn({ pillar, prompt, model?, planFile?, backend? })` — Spawn a new session. 
  `backend`: "claude" (default) or "codex". 
  Use Codex for focused coding, code review, or tasks benefiting from GPT-5's reasoning.
  Use Claude for research-heavy work, MCP-intensive tasks, or deep architectural reasoning.
```

### 3.3 Pillar Session UI

Add backend indicator to the browser's pillar session display:
- Session header shows `[Claude Opus]` or `[Codex GPT-5]`
- Pillar tree in sidebar shows backend icon per session

### Files to Modify

| File | Action | Lines Changed |
|---|---|---|
| `src/prompts/phases.js` | Modify | ~15 lines (model suggestions + Flow instructions) |
| `src/prompts/base.js` | Modify | ~15 lines (multi-backend section) |
| Frontend components (session header, sidebar) | Modify | ~20 lines |

### Estimated Effort

Small — single Forge session, ~20 min.

---

## Phase 4: Concurrent Multi-Backend Execution

### Overview

Run Claude and Codex pillar sessions simultaneously on file-disjoint work. This is the payoff — Paloma becomes genuinely multi-brained.

### 4.1 How It Works

This builds on the Recursive Flow Architecture plan. When Flow decomposes a project into work units:

```
WU-1: Backend models (files: backend/models/*.py)     → Codex Forge
WU-2: Frontend components (files: frontend/src/*.vue)  → Claude Forge
```

File-disjoint work units can run in parallel, each on a different backend. PillarManager already supports multiple concurrent pillar sessions — Phase 2's backend abstraction makes this work across backends.

### 4.2 Concurrent Limits

- **Max 2 concurrent Forge sessions** (same as Recursive Flow plan)
- One Claude + one Codex is the sweet spot
- Both running on different file sets, same branch, same working directory

### 4.3 Flow's Dispatch

Flow selects backend per work unit based on task characteristics:

| Task Type | Recommended Backend | Why |
|---|---|---|
| Complex architecture, multi-file refactor | Claude | Deep reasoning, long context |
| Focused coding, single-domain build | Codex | Fast, sandboxed, structured |
| Code review | Codex | Native `codex review` capability |
| Research + web search | Claude | MCP tools, Brave search |
| Documentation + lessons | Claude | Nuanced writing |

Flow's dispatch prompt includes the backend choice:
```
pillar_spawn({ pillar: 'forge', prompt: '...', backend: 'codex', planFile: '...' })
```

### 4.4 No Additional Code Changes

Phase 4 is purely a usage pattern — the infrastructure from Phases 2-3 supports it. The only additions are:
1. Flow's prompt instructions for when to choose each backend
2. Documentation of the concurrent execution pattern

### Files to Modify

| File | Action | Lines Changed |
|---|---|---|
| `src/prompts/phases.js` | Modify | ~20 lines (Flow's concurrent dispatch guidance) |

### Estimated Effort

Small — prompt updates only, ~15 min.

---

## Phase 5: App Server Integration (Future)

### When to Consider

Only pursue this if we need capabilities that subprocess mode can't provide:

1. **Streaming text deltas** — Codex exec only emits complete items. If the UX of "blocks appearing all at once" is unacceptable, the app server provides true streaming.
2. **Dynamic tool calls** — The app server can call back to Paloma for tool execution, enabling richer integration than one-shot exec mode.
3. **Thread lifecycle management** — Start, resume, fork, archive threads via JSON-RPC instead of subprocess flags.
4. **Concurrent threads in one process** — Instead of spawning a new Codex process per pillar, a single app server handles multiple threads.

### Architecture

```
codex app-server --listen ws://127.0.0.1:19193
                        ↕
            ┌───────────────────────┐
            │  CodexAppClient       │
            │  (bridge/codex-app.js)│
            │                       │
            │  JSON-RPC 2.0:        │
            │  - thread/start       │
            │  - turn/start         │
            │  - turn/cancel        │
            │  - item notifications │
            └───────────────────────┘
```

### Why Not Now

- **Complexity:** Full JSON-RPC 2.0 protocol with many event types, approval routing, dynamic tool calls.
- **Experimental API:** The app server protocol is evolving. Building against it now risks breakage on Codex updates.
- **Phase 2 covers 90%:** Subprocess mode handles all core use cases. The app server is optimization, not enablement.
- **Effort:** Estimated 3-5 Forge sessions vs. 2-3 for Phase 2.

### Decision Point

Revisit after 4-6 weeks of Phase 2 usage. If the lack of streaming or dynamic tools becomes a real pain point, proceed with Phase 5.

---

## AGENTS.md Design

### Purpose

`AGENTS.md` is Codex's equivalent of `CLAUDE.md`. It's read automatically when Codex runs interactively in the repo. It's **not** used by the subprocess integration (which injects the full system prompt via config), but it's essential for times when Adam runs `codex` directly in the Paloma repo.

### Content Strategy

Keep it short and focused — Codex's context window is smaller than Claude's. Point to existing docs rather than duplicating them.

### Proposed Content

```markdown
# Paloma — AI Development Partner

## What This Is

Paloma is a Vue 3 + Vite SPA with a Node.js WebSocket bridge that connects to AI CLI tools (Claude, Codex) and MCP tool servers.

## Architecture

- **Frontend:** `src/` — Vue 3 + Vite + Tailwind CSS
- **Bridge:** `bridge/` — Node.js WebSocket server (port 19191)
- **MCP Proxy:** `bridge/mcp-proxy-server.js` (port 19192)
- **Custom MCP Servers:** `mcp-servers/`
- **AI DNA:** `src/prompts/base.js` (shared identity), `src/prompts/phases.js` (per-pillar)

## Key Files

- `bridge/index.js` — Bridge entry point, wires everything together
- `bridge/pillar-manager.js` — Pillar session lifecycle management
- `bridge/claude-cli.js` — Claude CLI subprocess manager
- `bridge/codex-cli.js` — Codex CLI subprocess manager
- `bridge/mcp-proxy-server.js` — MCP tool routing for CLI sessions

## Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- MCP-first tool strategy — prefer MCP tools over native alternatives
- Project knowledge lives in `.paloma/` (plans, docs, roots, instructions)
- No over-engineering — only build what's needed

## Self-Evolution Rule

When changing Paloma's own codebase, check if `src/prompts/base.js` and `src/prompts/phases.js` need updating — they define Paloma's identity.
```

### File Location

`/home/adam/paloma/AGENTS.md` — Codex reads from repo root, same as CLAUDE.md.

---

## Config Changes

### `~/.codex/config.toml` (Create)

Basic configuration for interactive Codex use:

```toml
model = "gpt-5.1-codex-max"
sandbox_mode = "workspace-write"
approval_policy = "on-request"

# Paloma's MCP tools (for interactive use)
[mcp_servers.paloma]
url = "http://localhost:19192/sse"
```

> **Note:** The `mcp_servers.paloma` entry only works when the bridge is running. For standalone Codex use, remove or comment out this section.

### `~/.paloma/mcp-settings.json` (Phase 1 Addition)

```json
"codex": {
  "command": "codex",
  "args": ["mcp-server"]
}
```

---

## Risk Assessment

### Low Risk

- **Phase 1 (MCP tool)** — Config-only change. If `codex mcp-server` fails, it just shows as a disconnected MCP server. No impact on existing functionality.
- **AGENTS.md** — Read by Codex only when used interactively. Never conflicts with CLAUDE.md.
- **Phase 3 (DNA updates)** — Text-only changes to prompt files. Default behavior unchanged.

### Medium Risk

- **Event normalization (Phase 2)** — Changing `claude-cli.js` event format affects the browser rendering pipeline. Must update the browser composable simultaneously.
  - **Mitigation:** Ship the normalization change as a single atomic commit that updates both backend and frontend. Test with existing Claude workflows before adding Codex.
  
- **System prompt injection for Codex** — Codex lacks `--append-system-prompt`. The temp config file approach needs prototyping.
  - **Mitigation:** Start Phase 2 with a spike/prototype session to validate the config injection mechanism. If it doesn't work, fall back to prompt prefixing (approach C), which is less clean but functional.

- **No streaming deltas from Codex exec** — Browser UX will differ between Claude (smooth streaming) and Codex (blocks appearing at once).
  - **Mitigation:** Browser composable detects `isPartial: false` and renders Codex output as appearing blocks with a subtle animation. Not perfect but acceptable.

### Higher Risk

- **MCP tool injection for Codex** — Unclear if Codex exec mode supports MCP server connections. If not, Codex sessions would use native tools (shell, apply_patch) instead of Paloma's MCP tools, bypassing the permission system.
  - **Mitigation:** Test MCP injection early in Phase 2. If unsupported, Codex sessions run in `workspace-write` sandbox with native tools — still safe, just less integrated. Document which tools are available per backend.

- **ChatGPT login model restrictions** — Only GPT-5.1-Codex family with ChatGPT login. No model diversity without API key auth.
  - **Mitigation:** Acceptable for Phase 1-3. If model diversity matters, configure API key auth via `config.toml`. Note: API key billing is per-token, ChatGPT login uses plan credits.

---

## Implementation Sequence

| Phase | Scope | Dependencies | Effort | Key Deliverable |
|---|---|---|---|---|
| **1** | MCP tool config | None | 5 min | Codex available as Claude's tool |
| **2** | Subprocess backend | Phase 1 (for validation) | 2-3 sessions | `codex-cli.js` + backend abstraction |
| **3** | Per-pillar config | Phase 2 | 1 session | DNA updates + UI indicators |
| **4** | Concurrent execution | Phase 3 | 1 session (prompts only) | Flow dispatch guidance |
| **5** | App server | Phase 2 (optional) | 3-5 sessions | `codex-app.js` WebSocket client |

**Recommended start:** Phase 1 immediately (5 min), then Phase 2 with a prototyping spike for system prompt injection.

---

## Open Questions for Adam

1. **API key auth:** Should we set up an OpenAI API key for Codex, or is ChatGPT login (GPT-5.1-Codex only) sufficient for now?

2. **Phase 2 priority:** Do you want to start Phase 2 immediately after Phase 1, or use Phase 1 for a while first to evaluate Codex's capabilities through the MCP tool interface?

3. **Browser UX priority:** How important is real-time streaming for Codex sessions? If it's critical, we should plan for Phase 5 (app server) sooner. If "blocks appearing at once" is acceptable, Phase 2 is sufficient.

4. **Default backend per pillar:** Any preferences for which pillars should default to Codex? The Scout findings suggest Polish (code review) is the strongest use case for Codex. Any others?

---

## Implementation Notes (Phase 2+3 Forge)

### Files Created

| File | Lines | Description |
|---|---|---|
| `bridge/codex-cli.js` | 147 | CodexCliManager — subprocess manager mirroring ClaudeCliManager interface |

### Files Modified

| File | Changes | Description |
|---|---|---|
| `bridge/pillar-manager.js` | Constructor, spawn, _startCliTurn, _handleCliEvent, stop, shutdown, _defaultModel | Multi-backend abstraction: accepts `backends` map, routes to correct manager, handles both event type sets |
| `bridge/index.js` | +10 lines | Import CodexCliManager, create instance, build backends map, add to shutdown |
| `bridge/mcp-proxy-server.js` | +2 lines | Added `backend` param to `pillar_spawn` tool schema, updated model description |
| `src/services/mcpBridge.js` | +1 line | Pass `backend` field through in `onPillarStream` callback |
| `src/composables/useMCP.js` | ~20 lines changed | Handle Codex events (`agent_message`) alongside Claude events in `onPillarStream` |
| `src/prompts/phases.js` | 1 line | Updated Flow's `pillar_spawn` tool docs with `backend` parameter |

### Design Decisions

1. **No event normalization.** Instead of changing Claude's event format (which would break Flow's direct chat and notification system), Codex emits `codex_stream`/`codex_done`/`codex_error` — same shape, different prefix. `_handleCliEvent` uses boolean flags (`isStream`, `isDone`, `isError`) to handle both.

2. **System prompt via prompt prepending.** Codex lacks `--append-system-prompt`. Rather than fighting with `-c` flag escaping for multi-KB prompts, we prepend system instructions to the user prompt with `<SYSTEM_INSTRUCTIONS>` XML delimiters. This is reliable with Node's `spawn()` (no shell escaping) and GPT models follow XML-delimited instructions well.

3. **No MCP injection for Codex sessions (yet).** Codex uses its native tools (shell, apply_patch) in `--full-auto` sandbox mode. MCP proxy injection can be added later if needed — the `mcpProxyPort` property is already set on CodexCliManager.

4. **Thread ID captured asynchronously.** Codex generates thread IDs server-side (unlike Claude where we generate UUIDs upfront). The thread ID is captured from the `thread.started` JSONL event, then stored on the `codex_done` event. PillarManager updates `session.cliSessionId` from the done event to enable resume.

5. **Backward compatible.** Every change defaults to `claude`. Existing workflows are completely untouched. The `backend` parameter is optional on `pillar_spawn` — omitting it uses Claude.

6. **Phase 3 (per-pillar config) shipped with Phase 2.** The `_defaultModel(pillar, backend)` method returns `gpt-5.1-codex-max` for Codex backend. Flow's DNA was updated with `backend` parameter docs. No separate Forge session needed.

### What Was NOT Built (Intentional)

- **Phase 1 (MCP tool config)** — Not code, just config. Adam can add `codex mcp-server` to `~/.paloma/mcp-settings.json` anytime.
- **Phase 4 (concurrent execution)** — Purely a usage pattern; the infrastructure supports it already.
- **Phase 5 (app server)** — Future work, deferred per plan.
- **AGENTS.md** — Already exists in the repo (untracked), no changes needed.
- **`~/.codex/config.toml`** — User-level config, not code.

### Testing Guidance

1. Start the bridge (`node bridge/`) — verify boot without errors
2. Verify existing Claude pillar sessions work (backward compat)
3. Test Codex spawn: `pillar_spawn({ pillar: 'scout', prompt: 'What project is this?', backend: 'codex' })`
4. Verify Codex output streams to browser
5. Test resume: send `pillar_message` to an idle Codex session

---

## Implementation Notes (MCP Tool Injection — 2026-03-11)

### Problem
Codex pillar sessions had no access to Paloma's MCP tools (filesystem, git, web, brave-search, memory, voice). Only Claude sessions had MCP proxy injection. This was a gap in the multi-backend architecture — all pillars should have equal tool access regardless of backend.

### Root Cause
Codex CLI uses the **Streamable HTTP** MCP transport (newer MCP spec), while Paloma's MCP proxy only supported **SSE** transport (older spec, used by Claude CLI). The transport protocols are incompatible.

### Solution
1. **Added Streamable HTTP transport to MCP proxy** (`bridge/mcp-proxy-server.js`):
   - New route `/mcp` handles POST/GET/DELETE for Streamable HTTP protocol
   - Runs alongside existing `/sse` endpoint (Claude compatibility preserved)
   - Same tool list, same confirmation system, same routing — just different transport
   - Session management: `mcp-session-id` header tracks transport instances

2. **Codex CLI MCP injection** (`bridge/codex-cli.js`):
   - Uses `-c 'mcp_servers.paloma.url="http://localhost:19192/mcp?cliRequestId=<id>"'`
   - Dynamic per-session `cliRequestId` for tool confirmation routing
   - No temp files needed (unlike Claude's `--mcp-config` approach)

3. **MCP tool call event handling** (`bridge/codex-cli.js`):
   - Added `mcp_tool_call` item type parsing in `_handleEvent()`
   - Forwards tool call details (server, tool, arguments, result) to browser

### Files Modified
| File | Changes |
|---|---|
| `bridge/mcp-proxy-server.js` | +import StreamableHTTPServerTransport, +crypto; +`/mcp` route; +`_handleStreamableHTTP()` method; +streamableTransports Map; +shutdown cleanup |
| `bridge/codex-cli.js` | +MCP proxy injection via `-c` flag; +`mcp_tool_call` event handling |

### Verified
- Standalone test: Codex CLI successfully called MCP tools via Streamable HTTP transport
- `-c` flag correctly injects MCP server config for dynamic per-session URLs

### Pending
- Full integration test with bridge restart (Codex pillar → MCP proxy → tool execution → browser confirmation)

---

**Phase 2+3 + MCP injection complete. Ready for Polish + integration testing.**
