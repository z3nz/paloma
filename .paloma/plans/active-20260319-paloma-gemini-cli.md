# Gemini CLI — Fifth Backend Integration

> **Goal:** Add Google's Gemini CLI as a fifth backend in Paloma's bridge, matching the exact patterns of Claude/Codex/Copilot CLI managers. Gemini becomes available for pillar spawning (`backend: 'gemini'`) and browser-direct chat (`gemini-cli:flash`).
> **Status:** Active — Charted, ready for Forge
> **Created:** 2026-03-19
> **Pipeline:** ~~Scout~~ → ~~Chart~~ → ~~Forge~~ → **Polish** → Ship

---

## Research References

- **Scout findings:** `.paloma/docs/scout-gemini-cli-integration-20260319.md`
- **Reference implementation:** `bridge/claude-cli.js` (closest pattern match)
- **Copilot CLI manager:** `bridge/copilot-cli.js` (shares MCP config file + temp cleanup pattern)
- **Pillar manager:** `bridge/pillar-manager.js` (event routing, text extraction, model defaults)
- **Bridge entrypoint:** `bridge/index.js` (backend wiring, WS message handlers)
- **Frontend stream service:** `src/services/claudeStream.js` (model detection, stream generators)
- **Frontend bridge:** `src/services/mcpBridge.js` (WS event routing, send/stop functions)
- **Frontend composable:** `src/composables/useMCP.js` (sendGeminiChat wrapper)
- **Frontend chat runner:** `src/composables/useCliChat.js` (backend selection logic)

---

## Architectural Decisions

### AD-1: Per-session temp directory for MCP config AND system prompt

Gemini CLI has two unique constraints compared to other backends:
1. **No `--mcp-config` flag** — MCP config must live in `.gemini/settings.json` in the cwd
2. **`GEMINI_SYSTEM_MD` replaces** the built-in system prompt (not appends like Claude's `--append-system-prompt`)

**Solution:** Create a single per-session temp directory that holds both:
- `.gemini/settings.json` — MCP proxy config with `trust: true`
- `system-prompt.md` — Full Paloma pillar instructions

The temp dir is used as `cwd` for the Gemini CLI process. To preserve project context, we use `--include-directories` to point to the actual project root.

**Why a single temp dir:** Keeps both temp files together for easy cleanup. One `rm -rf` on close. Matches the overall cleanup pattern from copilot-cli.js but bundles both files.

**Why `--include-directories` instead of symlinks:** Simpler, no filesystem tricks, officially supported by the CLI. The flag tells Gemini to include the specified directory as workspace context alongside its cwd.

**Cleanup:** `rmSync(sessionDir, { recursive: true, force: true })` in close/stop/error handlers. Same pattern as copilot-cli.js MCP config cleanup but covering the full directory.

### AD-2: System prompt includes Paloma instructions only (no Gemini base prompt)

Since `GEMINI_SYSTEM_MD` fully replaces Gemini's built-in system prompt, we could try to include Gemini's default instructions as a base. But we won't.

**Why:** Gemini's default system prompt is designed for interactive terminal use with its own tool calling conventions. We don't want those — we want Paloma's pillar behavior. The model is capable of tool calling and code generation without its default prompt. Our `_buildSystemPrompt()` already handles non-Claude backends by including project instructions, roots, plans, and phase instructions. This is sufficient.

**Risk:** If Gemini behaves poorly without its base prompt (e.g., formatting issues), we can revisit and prepend extracted base instructions. But start simple.

### AD-3: Fallback chain position — after Copilot, before Codex

**New chain:** `claude → copilot → gemini → codex → ollama`

**Why:** Gemini is a capable cloud model with 1M token context. It slots above Codex (which requires an OpenAI API key) and below Copilot (which has multi-model flexibility including Gemini itself). This matches Scout's recommendation.

**Implementation:** Single change to `FALLBACK_CHAIN` array in `backend-health.js`.

### AD-4: Default model is `flash` (free tier safe)

Default to `gemini-2.5-flash` for all pillar types. Users can explicitly request `pro` or `auto`.

**Why:** The `GEMINI_API_KEY` auth path (our only option for subprocess use) limits the free tier to Flash only. Defaulting to `pro` would cause silent failures for users without billing. Better to default safe and let users opt in.

**Exception:** No per-pillar model differentiation (unlike Claude's opus/sonnet split). Gemini's model family doesn't have the same cost/capability spread that justifies per-pillar defaults.

### AD-5: Session ID captured from `init` event (not pre-generated)

Unlike Claude CLI where we generate a UUID and pass `--session-id`, Gemini CLI assigns its own session ID and returns it in the `init` event's `session_id` field. We capture it on first `init` and use `--resume <id>` for subsequent turns.

**Why:** Gemini CLI doesn't accept a `--session-id` flag for new sessions. The CLI controls session identity.

**Implementation:** In the stdout JSONL parser, watch for `event.type === 'init' && event.session_id` and store it on the session entry. Same pattern as Codex's `thread.started` capture.

### AD-6: Event type prefix is `gemini_`

Events: `gemini_stream`, `gemini_done`, `gemini_error`. Inner stream events forward the parsed JSONL object as `event.event` (same wrapper pattern as all other backends).

**Text extraction in pillar-manager:** Gemini emits `message` events with `role: 'assistant'` and `content` field. This is different from Claude's `content_block_delta`/`assistant` and Codex/Copilot's `agent_message`. New extraction branch needed.

### AD-7: Frontend model prefix is `gemini-cli:`

Model IDs: `gemini-cli:flash`, `gemini-cli:pro`, `gemini-cli:auto`. Follows the `{backend}-cli:{model}` naming convention.

Detection: `isGeminiModel(modelId)` checks `modelId?.startsWith('gemini-cli:')`.

### AD-8: Health check probes `gemini --version`

Simple binary existence check + `GEMINI_API_KEY` env var check (same pattern as Codex's OPENAI_API_KEY check). No API call needed at startup.

**Why:** Gemini CLI's free tier has rate limits (10 req/min). Wasting a request on health check is wasteful. Binary + API key is sufficient to know it's configured.

---

## Work Units

### WU-1: GeminiCliManager — Bridge Backend
**Description:** Create `bridge/gemini-cli.js` — the core CLI manager class that spawns Gemini CLI subprocesses, handles streaming JSONL output, manages per-session temp directories, and emits normalized events.

**Dependencies:** None

**Files to create:**
- `bridge/gemini-cli.js` — GeminiCliManager class

**Design details:**

The class follows the exact structure of `claude-cli.js` with these Gemini-specific adaptations:

```javascript
// Process map entry includes sessionDir for cleanup
this.processes = new Map() // requestId → { process, sessionId, sessionDir }

// chat() flow:
// 1. Create temp dir: /tmp/paloma-gemini-{requestId}/
// 2. Write .gemini/settings.json with MCP SSE config
// 3. Write system-prompt.md with Paloma pillar instructions
// 4. Build args: -p, --output-format stream-json, --approval-mode yolo
// 5. If resuming: --resume <sessionId>
// 6. If new: --model <model>, --include-directories <projectRoot>
// 7. Spawn with cwd: sessionDir, env: { ...process.env, GEMINI_SYSTEM_MD: systemPromptPath }
// 8. Parse JSONL stdout, emit gemini_stream/gemini_done/gemini_error
```

**JSONL event mapping:**

| Gemini Event | Emitted As | Notes |
|---|---|---|
| `init` | (captured internally) | Extract `session_id`, don't forward |
| `message` (assistant) | `gemini_stream` → `{ type: 'agent_message', text }` | Normalize to match Codex/Copilot pattern for simpler pillar-manager extraction |
| `message` (delta) | `gemini_stream` → `{ type: 'agent_message', text }` | Same normalization |
| `tool_use` | `gemini_stream` → `{ type: 'tool_use', tool_use: { id, name, input } }` | Match Claude's tool_use format for frontend rendering |
| `tool_result` | `gemini_stream` → `{ type: 'tool_result', toolUseId, content }` | Match Claude's tool_result format |
| `error` | `gemini_stream` → `{ type: 'error', text }` | Non-fatal, forward as stream event |
| `result` | (triggers done) | Extract stats if available, then emit `gemini_done` |
| process close | `gemini_done` | With exitCode and sessionId |
| process error | `gemini_error` | With error message |

**Key decision — normalize `message` events to `agent_message` format:**
Rather than introducing a new text extraction path in pillar-manager, normalize Gemini's `message` events to the same `{ type: 'agent_message', text }` format that Codex and Copilot use. This way, the existing `session.backend === 'codex' || session.backend === 'copilot'` branch in `_handleCliEvent` just needs `|| session.backend === 'gemini'` added.

**Settings.json content:**
```json
{
  "mcp": {
    "allowed": ["paloma"]
  },
  "mcpServers": {
    "paloma": {
      "url": "http://localhost:{proxyPort}/sse?cliRequestId={requestId}",
      "trust": true,
      "timeout": 600000
    }
  }
}
```

**Cleanup:** On close/stop/error, recursively remove the session temp directory (`rmSync` with `{ recursive: true, force: true }`). Import `mkdirSync`, `writeFileSync`, `rmSync` from `fs`.

**Acceptance criteria:**
- [x] GeminiCliManager class exports with same interface as ClaudeCliManager (chat, stop, shutdown, mcpProxyPort)
- [x] `chat()` creates temp dir with `.gemini/settings.json` and `system-prompt.md`
- [x] `chat()` spawns `gemini` with correct args and env vars
- [x] JSONL stdout parsed into `gemini_stream` events with normalized inner format
- [x] Session ID captured from `init` event, used for `--resume` on subsequent turns
- [x] `--include-directories` passes project root so Gemini has workspace context
- [x] Temp directory cleaned up on close, stop, and error
- [x] `stop()` kills process and cleans up
- [x] `shutdown()` kills all processes and cleans up

---

### WU-2: Bridge Wiring — index.js + pillar-manager.js + backend-health.js
**Description:** Wire GeminiCliManager into the bridge entrypoint, pillar manager event routing, and backend health system.

**Dependencies:** WU-1

**Files to modify:**
- `bridge/index.js` — Import GeminiCliManager, create instance, set mcpProxyPort, add to backends map, add `gemini_chat`/`gemini_stop` WS message handlers, add to shutdown
- `bridge/pillar-manager.js` — Add `gemini_stream`/`gemini_done`/`gemini_error` to event type checks, add `'gemini'` to text extraction branch, add `_defaultModel` case, update `_buildSystemPrompt` non-Claude check
- `bridge/backend-health.js` — Add `checkGemini()` method, add `gemini` to `FALLBACK_CHAIN`, add `gemini` to initial `this.status`

**Design details for each file:**

**bridge/index.js changes:**
```javascript
// Import
import { GeminiCliManager } from './gemini-cli.js'

// Create instance
const geminiManager = new GeminiCliManager()

// Set proxy port (after mcpProxy starts)
geminiManager.mcpProxyPort = proxyPort

// Add to backends map
const backends = { claude: cliManager, codex: codexManager, copilot: copilotManager, gemini: geminiManager, ollama: ollamaManager }

// WS message handler for gemini_chat (copy pattern from copilot_chat handler)
// WS message handler for gemini_stop (copy pattern from copilot_stop handler)

// Shutdown
geminiManager.shutdown()
```

**bridge/pillar-manager.js changes:**
```javascript
// Line 1362-1364: Add gemini event types
const isStream = ... || event.type === 'gemini_stream'
const isDone = ... || event.type === 'gemini_done'
const isError = ... || event.type === 'gemini_error'

// Line 1378: Add gemini to Codex/Copilot text extraction branch
if (session.backend === 'codex' || session.backend === 'copilot' || session.backend === 'gemini') {

// Line 1616-1627: Add gemini default model
if (backend === 'gemini') return 'flash'

// Line 1668: Add gemini to non-Claude backend check
const claudeBackend = !backend || backend === 'claude'
// (gemini is already covered by this — it's not 'claude', so it gets the full prompt)
```

**bridge/backend-health.js changes:**
```javascript
// FALLBACK_CHAIN: insert gemini between copilot and codex
const FALLBACK_CHAIN = ['claude', 'copilot', 'gemini', 'codex', 'ollama']

// Add gemini to initial status
this.status.gemini = { available: false, reason: 'not checked', lastCheck: null }

// Add checkGemini() method
async checkGemini() {
  // Check binary exists: which gemini
  // Check GEMINI_API_KEY env var is set
  // Mark available/unavailable accordingly
}

// Add to checkAll()
await Promise.all([...existing..., this.checkGemini()])
```

**Acceptance criteria:**
- [x] GeminiCliManager imported and instantiated in index.js
- [x] `gemini_chat` WS message type handled (spawns Gemini CLI, streams events to browser)
- [x] `gemini_stop` WS message type handled (stops Gemini CLI process)
- [x] Gemini backend included in PillarManager backends map
- [x] `gemini_stream`/`gemini_done`/`gemini_error` events handled in `_handleCliEvent`
- [x] Text extraction works for Gemini stream events (via `agent_message` normalization)
- [x] `_defaultModel` returns `'flash'` for gemini backend
- [x] Backend health check probes for `gemini` binary and `GEMINI_API_KEY`
- [x] Fallback chain is `claude → copilot → gemini → codex → ollama`
- [x] Gemini manager shutdown called on bridge shutdown

---

### WU-3: Frontend Integration — Model Selector, Stream Generator, Bridge Wiring
**Description:** Add Gemini CLI models to the frontend model selector, create the stream generator, and wire up the WebSocket send/stop functions.

**Dependencies:** WU-2 (needs bridge to handle `gemini_chat`/`gemini_stop` messages)

**Files to modify:**
- `src/services/claudeStream.js` — Add `isGeminiModel()`, `getGeminiModelName()`, Gemini model entries to `CLI_MODELS`, `streamGeminiChat()` generator, update `isCliModel()`
- `src/services/mcpBridge.js` — Add `sendGeminiChat()`, `stopGeminiChat()`, WS event handlers for `gemini_ack`/`gemini_stream`/`gemini_done`/`gemini_error`, update return object
- `src/composables/useMCP.js` — Add `sendGeminiChat` wrapper, export it
- `src/composables/useCliChat.js` — Add Gemini backend detection, route to correct send/stream functions
- `src/components/chat/MessageItem.vue` — Add `gemini-cli:` to `shortModelName` computed

**Design details:**

**claudeStream.js additions:**
```javascript
// Model entries
{ id: 'gemini-cli:flash', name: 'Gemini Flash (CLI)', context_length: 1000000, gemini: true, pricing: FREE_PRICING },
{ id: 'gemini-cli:pro', name: 'Gemini Pro (CLI)', context_length: 1000000, gemini: true, pricing: FREE_PRICING },

// Detection
export function isGeminiModel(modelId) {
  return modelId?.startsWith('gemini-cli:')
}

export function getGeminiModelName(modelId) {
  return modelId?.split(':')[1] || 'flash'
}

// Update isCliModel to include gemini-cli:
export function isCliModel(modelId) {
  return ... || modelId?.startsWith('gemini-cli:')
}

// streamGeminiChat — same pattern as streamCopilotChat
// Maps gemini_stream events with agent_message to content chunks
// Maps gemini_done to completion
```

**mcpBridge.js additions:**
```javascript
// Event handlers (in ws.onmessage):
// gemini_ack → resolve pending, store requestId/sessionId
// gemini_stream → forward to callbacks.onEvent
// gemini_done → resolve pending, call callbacks.onDone
// gemini_error → reject pending, call callbacks.onError

// Send/stop functions
function sendGeminiChat(options, callbacks) {
  return _sendChatWithTimeout('gemini_chat', crypto.randomUUID(), options, callbacks)
}
function stopGeminiChat(requestId) {
  _send({ type: 'gemini_stop', requestId })
}
```

**useCliChat.js additions:**
```javascript
const useGemini = isGeminiModel(model)
const currentBackend = useGemini ? 'gemini' : useOllama ? 'ollama' : ...

// Route to sendGeminiChat and streamGeminiChat
```

**MessageItem.vue addition:**
```javascript
if (m.startsWith('gemini-cli:')) return m.replace('gemini-cli:', '').charAt(0).toUpperCase() + m.replace('gemini-cli:', '').slice(1)
```

**Acceptance criteria:**
- [x] `gemini-cli:flash` and `gemini-cli:pro` appear in model selector
- [x] Selecting a Gemini model routes through `sendGeminiChat` → `gemini_chat` WS message
- [x] Streaming text renders live in the chat UI
- [x] Tool use/result events render in the activity panel
- [x] Session ID persisted for multi-turn conversations
- [x] Model badge shows "Gemini Flash" or "Gemini Pro" on Gemini messages
- [x] Stop button kills the Gemini CLI process

---

### WU-4: DNA + Documentation Updates
**Description:** Update Paloma's DNA files and project documentation to include Gemini as a backend option.

**Dependencies:** WU-1, WU-2, WU-3 (needs implementation complete for accurate docs)

**Files to modify:**
- `src/prompts/base.js` — Add Gemini to backend selection docs, update fallback chain description
- `.paloma/instructions.md` — Add Gemini backend section to project instructions

**Design details:**

**base.js — Backend Selection section:**
```
- **Gemini CLI** — Google's Gemini models. 1M token context. Free Flash tier (250 req/day). Use for: Large-context tasks, alternative perspective, free-tier work.
```

**Fallback chain update:**
```
**Fallback chain:** claude → copilot → gemini → codex → ollama.
```

**instructions.md — Multi-Backend Architecture section:**
Add: `Gemini emits gemini_stream/gemini_done/gemini_error; system prompt via GEMINI_SYSTEM_MD env var (replaces, not appends); MCP config via per-session temp dir .gemini/settings.json`

**Acceptance criteria:**
- [x] base.js documents Gemini in Backend Selection
- [x] Fallback chain updated in both base.js and instructions.md
- [x] instructions.md has Gemini-specific notes

---

## Dependency Graph

```
WU-1 (GeminiCliManager) ──→ WU-2 (Bridge Wiring) ──→ WU-3 (Frontend)
                                                    ──→ WU-4 (DNA + Docs)
```

**No parallel dispatch opportunities** — this is a linear chain. Each WU builds on the previous.

**However**, WU-3 and WU-4 are file-disjoint and can run in parallel after WU-2 completes:
- **Round 1:** WU-1
- **Round 2:** WU-2
- **Round 3:** WU-3 + WU-4 (parallel)

**Estimated Forge sessions:** 1-2. The total scope is ~6 files to create/modify with well-defined patterns to follow.

---

## Success Criteria

1. **Parity:** Gemini CLI works for both browser-direct chat and pillar spawning, just like the other backends
2. **MCP tools:** Gemini sessions can call Paloma's MCP tools through the bridge proxy
3. **Multi-turn:** Session resume works via `--resume` with captured session ID
4. **Fallback:** Gemini participates in the health check and fallback chain
5. **Minimal:** No Gemini-specific features — just parity with existing backends
6. **Clean:** Temp directories cleaned up on session end (no temp file leaks)

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| `GEMINI_SYSTEM_MD` replacement breaks model behavior | Start with Paloma instructions only (AD-2). If model misbehaves, we can prepend Gemini's default system prompt (extractable via `GEMINI_WRITE_SYSTEM_MD=1 gemini`) |
| Free tier rate limits (10 req/min, 250/day) | Default to `flash` (AD-4). Document limits. Users can set up billing for unlimited. |
| Temp dir not cleaned up on crash | Use `rmSync` with `{ force: true }` — tolerates already-deleted. Worst case: small files in `/tmp/` get cleaned by OS. |
| `--include-directories` doesn't give full project context | If Gemini can't find files, we can fall back to symlinking key files into the temp dir. But the flag is designed exactly for this use case. |
| Gemini CLI not installed on WSL | Health check detects missing binary, falls back to next available backend. No crash. |
| MCP tool naming collisions (underscores in server name) | Our server is named `paloma` (no underscores) — no issue per Scout findings. |
| Session ID not available until `init` event | Return `null` sessionId from `chat()`, update it when `init` arrives. Copilot/Codex already handle this pattern (delayed session ID). |

---

---

## Implementation Notes (Forge — 2026-03-19)

All 4 work units completed in a single Forge session.

### Files Created
- `bridge/gemini-cli.js` — GeminiCliManager class (208 lines)

### Files Modified
- `bridge/index.js` — Import + instantiate GeminiCliManager, add `gemini_chat`/`gemini_stop` WS handlers, wire into backends map and shutdown
- `bridge/pillar-manager.js` — Add `gemini_stream`/`gemini_done`/`gemini_error` to event type checks, add `'gemini'` to text extraction branch (agent_message normalization), add `_defaultModel` case returning `'flash'`
- `bridge/backend-health.js` — Add `checkGemini()` (binary + GEMINI_API_KEY check), add `gemini` to FALLBACK_CHAIN and initial status
- `src/services/claudeStream.js` — Add `gemini-cli:flash` and `gemini-cli:pro` to CLI_MODELS, add `isGeminiModel()`, `getGeminiModelName()`, `streamGeminiChat()` generator, update `isCliModel()`
- `src/services/mcpBridge.js` — Add `gemini_ack`/`gemini_stream`/`gemini_done`/`gemini_error` handlers, add `sendGeminiChat()`/`stopGeminiChat()`, export in return object
- `src/composables/useMCP.js` — Add `sendGeminiChat`/`stopGeminiChat` wrappers, export them, update `_accumulatePillarStream` to include `'gemini'`
- `src/composables/useCliChat.js` — Add Gemini detection + routing throughout (backend selection, model resolution, send/stop, stream generator)
- `src/components/chat/MessageItem.vue` — Add `gemini-cli:` to `shortModelName` computed (shows "Gemini Flash"/"Gemini Pro")
- `src/prompts/base.js` — Add Gemini to Backend Selection section, update fallback chain
- `.paloma/instructions.md` — Add Gemini CLI documentation to Architecture and Multi-Backend Architecture sections

### Key Design Decisions
1. **Per-session temp directory:** Single temp dir (`/tmp/paloma-gemini-{requestId}/`) contains both `.gemini/settings.json` (MCP config) and `system-prompt.md`. Cleaned up with `rmSync({ recursive: true, force: true })` on close/stop/error.
2. **Event normalization:** Gemini's `message` events normalized to `{ type: 'agent_message', text }` format matching Codex/Copilot. This means pillar-manager text extraction reuses the existing `codex || copilot` branch with just `|| 'gemini'` added.
3. **Session ID from init event:** Unlike Claude (pre-generated UUID) and Codex (from thread.started), Gemini assigns its own session ID in the `init` event. Captured and stored on the process map entry.
4. **`--include-directories`:** Used instead of symlinks to give Gemini workspace context while using the temp dir as cwd.
5. **No system prompt prepending:** Unlike Copilot/Codex which prepend system prompt as XML in the prompt text, Gemini uses `GEMINI_SYSTEM_MD` env var pointing to a temp file. This fully replaces (not appends) the built-in prompt.

### Verified
- `node --check` passes on all 4 modified bridge files
- `vite build` succeeds with no errors
- All patterns match existing backends exactly

### Not Yet Tested (needs `gemini` binary + `GEMINI_API_KEY`)
- End-to-end chat flow
- MCP tool calling through the bridge proxy
- Session resume via `--resume`
- Health check detection

Ready for Polish.
