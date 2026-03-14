# Multi-Backend Resilience — All CLI Backends Working & Fault-Tolerant

> **Goal:** Ensure all four AI backends (Claude CLI, Copilot CLI, Codex CLI, Ollama) are fully operational, well-tested, and fault-tolerant. If any single backend goes down, Paloma can seamlessly continue with the others.
> **Status:** Active — Chart complete, ready for Forge
> **Created:** 2026-03-14
> **Priority:** #1 — Critical infrastructure
> **Pipeline:** Scout → **Chart** → Forge → Polish → Ship

---

## Context

Adam's maxed-out MacBook Pro has all backends installed:
- **Claude CLI** v2.1.74 ✅ Working
- **Copilot CLI** v1.0.5 ⚠️ Unverified (auth scope unclear, MCP bug fixed but uncommitted)
- **Codex CLI** v0.114.0 ❌ Broken (no OPENAI_API_KEY, errors silently dropped)
- **Ollama** v0.13.5 ⚠️ No models installed (service running, qwen2.5-coder:32b/7b not pulled)

The bridge already imports and initializes all four backend managers. PillarManager supports `backend` field per session. What's needed:
1. **Fix** — get each backend actually working end-to-end
2. **Resilience** — automatic fallback if a backend fails
3. **Error visibility** — surface backend errors to browser, not just console
4. **Lessons** — capture learnings for `.paloma/lessons/`

---

## Scout Findings

**Full findings:** `.paloma/docs/scout-multi-backend-resilience-20260314.md`

### Critical Issues Found

**1. Codex CLI — auth errors silently dropped (bridge bug)**
- `_handleEvent` in `codex-cli.js` only processes `item.completed` events
- Auth failure emits `{"type":"error",...}` JSON — NOT handled, silently dropped
- Browser sees silence → done. No error surfaced.

**2. Codex CLI — no auth configured**
- `OPENAI_API_KEY` env var not set → 401 on every request
- Fix: set API key OR run `codex login` (ChatGPT web auth, limits to GPT-5.1-Codex family)

**3. Copilot CLI — MCP config key bug (working copy fix uncommitted)**
- Config written as `{ servers: {...} }` → should be `{ mcpServers: {...} }` 
- All MCP tools broken for Copilot sessions until committed

**4. Copilot CLI — stderr silenced (working copy fix uncommitted)**
- Previously `() => {}` — errors invisible
- Fixed in working copy, not committed

**5. Ollama — no models installed**
- `qwen2.5-coder:32b` and `:7b` not pulled
- All Ollama sessions fail immediately

**6. No backend fallback anywhere**
- If a backend fails → session errors → Flow must manually retry
- No automatic fallback logic in bridge or PillarManager

### Feature Parity Summary

| Feature | Claude | Codex | Copilot | Ollama |
|---------|--------|-------|---------|--------|
| Auth | ✅ | ❌ needs key | ⚠️ unverified | n/a |
| Session resume | ✅ --resume | ✅ exec resume | ✅ --resume | ✅ in-memory |
| Streaming | ✅ | ✅ complete items | ✅ deltas | ✅ |
| System prompt | ✅ native flag | ⚠️ prepended | ⚠️ prepended | ✅ system msg |
| MCP tools | ✅ all | ✅ all (broken) | ✅ all (bug) | ⚠️ 8 servers |
| Pillar tools | ✅ | ✅ | ✅ | ✅ |
| Models | opus/sonnet/haiku | gpt-5.1-codex-max | claude-*/gpt-5.x/gemini | qwen2.5-coder |
| Error surfacing | ✅ | ❌ silent | ⚠️ console only | ✅ |

---

## Chart Decisions

### AD-1: Backend Health Checker — Proactive Avoidance

**Decision:** Create a lightweight `BackendHealth` module (`bridge/backend-health.js`) that probes each backend's readiness at bridge startup and caches the results.

**Probes:**
- **Claude:** `which claude` (binary exists) → `claude auth status --json` (parse `loggedIn` field)
- **Codex:** `which codex` (binary exists) → check `process.env.OPENAI_API_KEY` is set
- **Copilot:** `which copilot` (binary exists) → `gh auth status` exit code (0 = authed)
- **Ollama:** `fetch('http://localhost:11434/api/tags')` (service running + extract model list)

**Cache behavior:** Results cached indefinitely until invalidated by runtime failure. No periodic rechecking — startup check is sufficient because binary presence, auth state, and model availability rarely change at runtime. Runtime failures (from fast-fail detection) update the cache.

**Integration:** Bridge startup calls `health.checkAll()`, logs results. PillarManager receives `health` reference for spawn-time checks.

**Why this approach over periodic polling:** Simpler, no timers, no resource waste. The fast-fail retry (AD-2) handles the rare case where a backend becomes unhealthy after startup.

---

### AD-2: Two-Layer Fallback — Health-Gated + Fast-Fail Retry

**Decision:** Implement fallback at two layers:

**Layer 1 — Pre-spawn health gate (proactive):**
In `PillarManager.spawn()`, before starting the CLI process, check `health.isAvailable(backend)`. If unhealthy, walk the fallback chain and use the first healthy backend. Broadcast `pillar_fallback` event so browser and Flow know.

**Layer 2 — Fast-fail retry (reactive):**
In `_handleCliEvent`, when a session errors or exits with non-zero code within 15 seconds of spawn AND has produced no output, treat it as a startup failure. Auto-retry once with the next backend in the fallback chain. Mark the failed backend as unhealthy in the health cache.

**Fallback chain:** `claude → copilot → codex → ollama`

**Rationale for ordering:**
- Claude: Most capable, best MCP support, most battle-tested
- Copilot: Multi-model access (including Claude models!), full MCP via SSE
- Codex: Functional, GPT-5.1-Codex is strong for coding tasks
- Ollama: Local/free but limited context (32K) and restricted tools

**What does NOT get fallback:**
- Sessions that fail after 15 seconds (mid-work failures) — work is already lost, retrying won't help. These error normally and Flow gets the error notification.
- Explicit backend selection by the user — if Adam says `backend: 'codex'` and Codex is down, fallback still happens (it's better than failing silently), but the fallback event makes it clear.

**System prompt on fallback:** The fallback path is async. It rebuilds the system prompt for the new backend via `_buildSystemPrompt(pillar, { backend: newBackend })` because Ollama uses condensed prompts while CLI backends use the full prompt. Session stores `_originalPrompt` and `_planFile` for replay.

**Max retries:** 1 fallback attempt per session. If the fallback also fails, normal error handling applies.

---

### AD-3: Codex Error Surfacing — Handle All Event Types

**Decision:** Fix `CodexCliManager._handleEvent()` to handle `{"type":"error"}` events.

**Current behavior:** Only `item.completed` events are processed. Error events (auth 401, rate limits, etc.) are silently dropped. The process eventually exits with non-zero code, but `_handleCliEvent`'s `isDone` branch doesn't distinguish success from failure.

**Fix:**
1. In `_handleEvent`: detect `event.type === 'error'` → emit `codex_stream` with `{ type: 'error', text: event.message }` so error content reaches the browser.
2. In `_handleCliEvent`: detect non-zero `exitCode` in `isDone` + no accumulated output + young session → treat as startup failure (feeds into AD-2 fast-fail).

**Why emit as `codex_stream` instead of `codex_error`:** The error events from Codex are informational ("Reconnecting... 1/5"). The process hasn't died yet. The actual terminal failure comes when the process exits. Emitting as stream shows the error messages in real-time. The process exit (non-zero code + no output) triggers the fast-fail or error path.

---

### AD-4: Copilot Fixes — Commit Working Copy

**Decision:** The Copilot MCP config fix (`servers` → `mcpServers`) and stderr logging fix are already implemented in the working copy. These are prerequisites for Forge — commit them first.

No architectural decision needed — just a Ship action.

---

### AD-5: Ollama Model Pull — Operational Prerequisite

**Decision:** Pulling Ollama models is an operational step, not a code change. Forge will add a startup health check that logs a clear warning when Ollama is running but has no models. The actual `ollama pull` command is run by Adam (or a setup script).

**Recommended models:**
- `qwen2.5-coder:7b` (4.7 GB) — lightweight, good for testing and recursive child sessions
- `qwen2.5-coder:32b` (19 GB) — full capability, primary Ollama model

---

### AD-6: No New Frontend Work Required

**Decision:** The existing frontend already handles `pillar_done` with `status: 'error'` and shows error content in pillar sessions. The new `pillar_fallback` event can be handled as an info notification in the pillar stream — no new components needed.

The `pillar_fallback` event will be broadcast alongside `pillar_stream` events. The browser's existing pillar stream handler can display it as an info message ("Fell back from codex to claude — codex auth unavailable").

**Minimal frontend change:** Add a handler for `pillar_fallback` in the composable that manages pillar events → append an info message to the session.

---

### AD-7: Backend Capability Documentation in Flow's DNA

**Decision:** Add backend selection guidance to `src/prompts/base.js` so Flow knows when to use which backend. This is more useful than a standalone doc because Flow reads its DNA at every session start.

**Content:**
- Claude: Deep reasoning, complex multi-tool chains, architectural decisions, MCP-intensive work
- Copilot: GitHub-native tasks, multi-model flexibility, when Claude is overloaded
- Codex: Fast structured coding, GPT-family tasks, when OpenAI models are preferred
- Ollama: Local/private work, zero API cost, quick tasks within 32K context limit

---

## Work Units

### WU-1: Codex Error Event Handling

**Status:** Ready  
**Files:** `bridge/codex-cli.js`  
**Depends on:** Nothing  
**Size:** Small  

**Description:** Fix `_handleEvent()` to surface `{"type":"error"}` events from Codex CLI instead of silently dropping them.

**Implementation:**
1. Add an `event.type === 'error'` branch at the top of `_handleEvent()` before the `item.completed` check
2. Emit `codex_stream` event with `{ type: 'error', text: event.message || JSON.stringify(event) }`
3. This surfaces auth errors, rate limits, and other Codex error events to the browser in real-time

**Acceptance criteria:**
- When Codex encounters a 401 auth error, the error message appears in the browser's pillar session view
- Error events are no longer silently dropped
- Existing `item.completed` handling is unchanged

---

### WU-2: Backend Health Module

**Status:** Ready  
**Files:** `bridge/backend-health.js` (new), `bridge/index.js`  
**Depends on:** Nothing  
**Size:** Medium  

**Description:** Create a health checker that probes each backend's readiness at bridge startup.

**Implementation:**
1. Create `bridge/backend-health.js` with class `BackendHealth`:
   - `status` map: `{ claude: { available, reason, lastCheck }, codex: {...}, copilot: {...}, ollama: { available, reason, models[], lastCheck } }`
   - `async checkAll()` — runs all four probes, updates status, returns summary
   - `async checkClaude()` — `which claude` → `claude auth status --json` → parse `loggedIn`
   - `async checkCodex()` — `which codex` → check `OPENAI_API_KEY` env var exists
   - `async checkCopilot()` — `which copilot` → `gh auth status` exit code
   - `async checkOllama()` — fetch `http://localhost:11434/api/tags` → parse models list
   - `isAvailable(backend)` — returns boolean from cached status
   - `getFallback(backend)` — walks fallback chain (`claude → copilot → codex → ollama`), returns first available backend that isn't the given one, or null
   - `markUnhealthy(backend, reason)` — updates cache on runtime failure
2. In `bridge/index.js`:
   - Instantiate `BackendHealth` at startup
   - Call `await health.checkAll()` after MCP servers are loaded
   - Log health summary (use `stepOk`/`stepFail` from startup.js)
   - Pass `health` to PillarManager constructor

**Acceptance criteria:**
- Bridge startup logs health status of all 4 backends with clear ok/fail indicators
- `health.isAvailable('codex')` returns false when OPENAI_API_KEY is not set
- `health.getFallback('codex')` returns 'claude' (first available)
- `health.markUnhealthy()` updates the cached status

---

### WU-3: PillarManager Fallback Logic

**Status:** Blocked (WU-2)  
**Files:** `bridge/pillar-manager.js`  
**Depends on:** WU-2 (needs BackendHealth)  
**Size:** Medium  

**Description:** Add two-layer fallback to PillarManager: pre-spawn health gate and fast-fail retry.

**Implementation:**

**A. Constructor change:**
- Accept `health` (BackendHealth instance) in constructor options
- Store as `this.health`

**B. Pre-spawn health gate in `spawn()`:**
- After resolving `backend`, check `this.health.isAvailable(resolvedBackend)`
- If unhealthy: `resolvedBackend = this.health.getFallback(resolvedBackend)`
- If no fallback available: return error immediately ("No backends available")
- If fallback used: store `session._fallbackFrom` for the broadcast event
- Broadcast `pillar_fallback` event: `{ type: 'pillar_fallback', pillarId, from, to, reason }`

**C. Session state additions:**
- `_originalPrompt` — the full prompt passed to `_startCliTurn` (needed for replay)
- `_planFile` — the planFilter option (needed to rebuild system prompt)
- `_fallbackAttempted` — boolean, prevents infinite retry loops

**D. Fast-fail retry in `_handleCliEvent`:**
- In `isDone` branch: detect startup failure = `exitCode !== 0 && (Date.now() - session.startTime) < 15000 && session.output.length === 0 && session.outputChunks.length === 0`
- In `isError` branch: same young-session + no-output check
- If startup failure detected AND `!session._fallbackAttempted`:
  1. Call `this.health.markUnhealthy(session.backend, reason)`
  2. Get fallback via `this.health.getFallback(session.backend)`
  3. If fallback exists: call `async _attemptFallback(session, originalBackend, fallbackBackend)`
  4. If no fallback: proceed with normal error handling
- `_attemptFallback` is async:
  1. Update `session.backend`, `session.model`, `session._fallbackAttempted = true`
  2. Rebuild system prompt: `await this._buildSystemPrompt(pillar, { backend: newBackend, ... })`
  3. Broadcast `pillar_fallback` event
  4. Call `this._startCliTurn(session, session._originalPrompt, newSystemPrompt)`

**Acceptance criteria:**
- Spawning a pillar with `backend: 'codex'` when Codex auth is broken → automatically falls back to Claude
- Browser receives `pillar_fallback` event with from/to/reason
- Fast-fail: Codex session that 401s within 5 seconds → auto-retry on Claude
- After 1 fallback attempt, if the fallback also fails → normal error (no infinite loop)
- Sessions older than 15 seconds that error → no fallback, normal error handling

---

### WU-4: Frontend Fallback Display

**Status:** Blocked (WU-3)  
**Files:** `src/composables/usePillarSessions.js` (or equivalent pillar event handler)  
**Depends on:** WU-3 (needs `pillar_fallback` event)  
**Size:** Small  

**Description:** Handle `pillar_fallback` WebSocket events in the frontend to show the user when a backend fallback occurs.

**Implementation:**
1. In the composable/handler that processes pillar WebSocket events, add a case for `pillar_fallback`
2. Append an info-level system message to the pillar session: "Backend fallback: {from} → {to} ({reason})"
3. Style as a muted info message (not an error — the session is recovering)

**Acceptance criteria:**
- When a fallback occurs, the pillar session in the browser shows an info message
- The message shows which backend failed and which one took over

---

### WU-5: Backend Selection Guidance in DNA

**Status:** Blocked (WU-1, WU-2, WU-3)  
**Files:** `src/prompts/base.js`  
**Depends on:** WU-1, WU-2, WU-3 (design validated by implementation)  
**Size:** Small  

**Description:** Add backend capability matrix and selection guidance to Flow's system prompt so it can make informed backend choices when spawning pillars.

**Implementation:**
1. Add a "Backend Selection" section to the base instructions in `src/prompts/base.js`
2. Content:
   - **Claude CLI** — Default. Deep reasoning, complex multi-tool chains, architectural decisions. Best MCP support. Use for: Flow (always), Scout, Chart, Polish, Ship.
   - **Copilot CLI** — Multi-model access (Claude + GPT + Gemini via GitHub). Full MCP via SSE. Use for: Forge tasks where multi-model flexibility is valuable, GitHub-native operations.
   - **Codex CLI** — GPT-5.1-Codex. Fast structured coding. Use for: Forge tasks that benefit from GPT models, structured output.
   - **Ollama** — Local, zero API cost, 32K context. Restricted tools (8 servers). Use for: Quick focused tasks, recursive child sessions, private/offline work.
3. Include the fallback chain: claude → copilot → codex → ollama
4. Note: Flow always runs on Claude (needs MCP tool loop for orchestration)

**Acceptance criteria:**
- Flow sessions include backend selection guidance in their system prompt
- Guidance matches actual backend capabilities and fallback chain

---

## Parallelism Analysis

**WU-1** and **WU-2** are file-disjoint and can run in parallel:
- WU-1 touches only `bridge/codex-cli.js`
- WU-2 touches `bridge/backend-health.js` (new) and `bridge/index.js`

**WU-3** depends on WU-2 (needs the health module). Sequential after WU-2.

**WU-4** depends on WU-3 (needs the `pillar_fallback` event). Sequential after WU-3.

**WU-5** depends on WU-1, WU-2, WU-3 (design should be validated). Can run after WU-3.

WU-4 and WU-5 are file-disjoint and can run in parallel after WU-3.

```
WU-1 ─────────────────────────────┐
                                   ├── WU-4 (frontend)
WU-2 ──── WU-3 (fallback logic) ──┤
                                   └── WU-5 (DNA docs)
```

## Prerequisites (before Forge)

1. **Commit Copilot working copy fixes** — The MCP config key fix and stderr logging in `bridge/copilot-cli.js` need to be committed. This is a Ship action, not Forge.
2. **Codex auth** — Adam confirmed he logged in. Verify `OPENAI_API_KEY` is set or `codex login` was completed.
3. **Ollama models** — Run `ollama pull qwen2.5-coder:7b` at minimum. Full capability: `ollama pull qwen2.5-coder:32b`.
