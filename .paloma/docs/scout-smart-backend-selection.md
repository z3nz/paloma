# Scout Findings: Smart Backend Selection

**Date:** 2026-03-21  
**Machine:** LYNCH-TOWER (WSL2)  
**Scope:** Machine profile, backend capabilities, current routing code, design recommendations for intelligent backend selection

---

## 1. This Machine's Profile

### Hardware (LYNCH-TOWER)

| Component | Detail |
|-----------|--------|
| Hostname | LYNCH-TOWER |
| OS | Ubuntu 20.04.6 LTS (WSL2) |
| Kernel | 6.6.87.2-microsoft-standard-WSL2 |
| CPU | AMD Ryzen 7 3800X — 8 cores / 16 threads @ 3892 MHz |
| RAM | 15GB total, ~8.5GB available |
| Disk | 251GB total, 168GB free (WSL2 virtual disk) |
| GPU | Microsoft Device 008e (WSL2 virtual GPU — no discrete GPU passthrough) |

**WSL2 notes:**
- GPU is a passthrough stub — no CUDA/ROCm for Ollama inference acceleration
- Ollama runs on the **Windows host** (accessible via localhost:11434), not in WSL2
- The `ollama` CLI binary is NOT in WSL2's PATH — all communication is via HTTP API

### Known Paloma Fleet Machines (from `machine-fleet.md`)

| Machine | Role | Email | Status |
|---------|------|-------|--------|
| MacBook Pro | Primary dev, home Paloma | TBD | Active |
| Lenovo | Secondary, parallel work | lenovo.paloma@verifesto.com | Off (on demand) |
| LYNCH-TOWER (this) | Unknown role in doc | Not listed | Active |
| Third Machine | TBD | TBD | Not identified |

**Note:** `machine-fleet.md` doesn't list LYNCH-TOWER explicitly — it's likely the "third machine" or an undocumented dev machine. No `local-machine.md` exists here.

---

## 2. Backend Availability on LYNCH-TOWER

### Summary Table

| Backend | Installed | Authenticated | Status |
|---------|-----------|--------------|--------|
| Claude | ✅ v2.1.81 | ✅ Max subscription | **Available** |
| Gemini | ✅ v0.34.0 | ✅ Google OAuth | **Available** |
| Copilot | ✅ v1.0.9 | ✅ via GH_TOKEN | **Available** (with caveat) |
| Codex | ✅ v0.116.0 | ✅ ChatGPT OAuth | **Available** |
| Ollama | ❌ no CLI | ✅ HTTP API (Windows) | **Available via HTTP** |

---

### Claude

- **Version:** 2.1.81 (Claude Code)
- **Auth:** OAuth via claude.ai — `adamlynchmob@gmail.com`, `subscriptionType: "max"`
- **Active model:** Claude Opus 4.6 (1M token context)
- **MCP:** SSE via `--mcp-config` temp JSON file pointing to bridge proxy
- **System prompt:** `--append-system-prompt` CLI arg (⚠️ 128KB per-arg limit)
- **Session resume:** `--resume {sessionId}` with explicit `--session-id` on new sessions
- **Streaming:** `stream-json` JSONL, fully streaming deltas
- **Strengths:** Deepest reasoning, 1M context, full MCP support, best multi-step tool chains
- **Weaknesses:** Cost per token (max subscription but still usage-tracked), slowest model
- **Known quirks:** Large system prompts (many active plans) can hit 128KB arg limit → E2BIG

---

### Gemini

- **Version:** 0.34.0
- **Auth:** Google OAuth — `adamlynchmob@gmail.com`, `oauth_creds.json` present
- **Active model:** `flash` (free tier default) — 1M context
- **MCP:** Per-session temp directory with `.gemini/settings.json` — SSE format
- **System prompt:** Via `GEMINI_SYSTEM_MD` env var pointing to temp file (replaces built-in prompt)
- **Session resume:** `--resume {sessionId}` — session ID captured from `init` event
- **Streaming:** `stream-json` JSONL, `message` events with content
- **Strengths:** Free tier (Flash model), 1M context, fast, good reasoning, best MCP support in practice, default backend for all pillars
- **Weaknesses:** Free tier is Flash only (250 req/day limit) — no Opus-class model on free tier; `--include-directories` instead of `--cwd`; temp dirs to clean up
- **Known quirks:** System prompt via env var (not arg) means it's a file write on every session start; temp dirs from crashes are cleaned up at startup; `init` event carries session ID (not `session_id` from result)

---

### Copilot

- **Version:** 1.0.9
- **Auth:** GitHub OAuth via `gh auth` (account: z3nz) — GH_TOKEN injected at startup
- **Active model:** **gpt-5.4** (confirmed live from test run — newer than gpt-5.2 referenced in code comments)
- **MCP:** `--additional-mcp-config @{file}` — SSE format; built-in `github-mcp-server` always loads
- **System prompt:** Prepended to prompt with XML delimiters (no dedicated flag)
- **Session resume:** `--resume {sessionId}` — UUID for new sessions too
- **Streaming:** `assistant.message_delta` events with `deltaContent`
- **Strengths:** Multi-model access (GPT-5.4, Claude Sonnet 4.6, Gemini), built-in GitHub MCP tools (PRs, issues, repos), `--yolo`/`--allow-all` mode, good for GitHub-native ops
- **Weaknesses:** System prompt prepended not injected (pollutes context); no `--append-system-prompt` equivalent; health check broken on this machine (see below)
- **Known quirk (health check bug):** `checkCopilot()` looks for `config.logged_in_users` in `~/.copilot/config.json` — on this machine the file only contains `{ "firstLaunchAt": "..." }`. Auth falls through to GH_TOKEN env var check. **Copilot IS working** but BackendHealth may report it unavailable if GH_TOKEN isn't set in environment at bridge startup. Auth is actually via `_warmAuth()` which calls `gh auth token` at construction time.
- **Default model in code:** `claude-sonnet-4.6` (but actual runtime model is `gpt-5.4` from test)

---

### Codex

- **Version:** 0.116.0
- **Auth:** ChatGPT OAuth (confirmed: "Logged in using ChatGPT")
- **Active model:** `gpt-5.1-codex-max`
- **MCP:** `-c mcp_servers.paloma.url="..."` flag — Streamable HTTP format
- **System prompt:** Prepended to prompt with XML delimiters (same as Copilot)
- **Session resume:** `codex exec resume {threadId}` — thread ID from `thread.started` event
- **Streaming:** `item.completed` events — NOT streaming deltas (complete items only)
- **Strengths:** Fast structured coding, GPT-5.1-Codex family specialized for code, good at precise output formats
- **Weaknesses:** No streaming (complete items — UI shows nothing until done); ChatGPT login locks to gpt-5.1 family (no o3/o4-mini without API key); system prompt prepended not injected
- **Known quirks:** `codex login status` output is blank on success (code just checks for "logged in" string match); `_handleEvent` only surfaces `agent_message`, `command_execution`, `mcp_tool_call`

---

### Ollama

- **CLI in WSL:** ❌ Not installed (binary not in PATH)
- **HTTP API:** ✅ Running on Windows host at `http://localhost:11434`
- **Health check:** Uses HTTP API fetch (not CLI) — works correctly despite no CLI binary
- **Models available on this machine:**

| Model | Size | Params | Quant |
|-------|------|--------|-------|
| qwen2.5-coder:7b-instruct-q5_k_m | 5.1GB | 7.6B | Q5_K_M |
| codellama:7b-instruct-q5_k_m | 4.5GB | 7B | Q5_K_M |
| deepseek-coder-v2:16b-lite-instruct-q5_K_M | 11.0GB | 15.7B | Q5_K_M |
| phi3:mini | 2.0GB | 3.8B | Q4_0 |

- **⚠️ CRITICAL GAP:** `qwen3-coder:30b` — the hardcoded default model for Ollama sessions — is **NOT PULLED** on this machine. Any Ollama session spawned with default settings will fail with "model not found".
- **Context window:** 32768 default, 65536 for Singularity sessions
- **Tool support:** Native API tool_calls + XML text fallback for Qwen3 Coder format
- **MCP:** Restricted to `OLLAMA_ALLOWED_SERVERS = ['filesystem', 'git', 'shell', 'web', 'brave-search', 'voice', 'memory', 'fs-extra']`
- **Missing from Ollama MCP whitelist:** `exec`, `ollama-eval`, `social-poster`, `cloudflare-dns`, `gmail`, `codex` — these MCP servers are unavailable to Ollama pillars
- **Concurrency limit:** `MAX_CONCURRENT_OLLAMA = 4` with FIFO queue
- **Session management:** In-memory (no disk persistence), 30-min idle timeout, sliding window of 100 messages

---

## 3. Current Backend Selection Code

### How `pillar_spawn` Routes Today

**File:** `bridge/pillar-manager.js` lines 68–113

```js
// Resolution order:
const resolvedBackend = backend || originatingBackend || 'gemini'
```

1. **Explicit `backend` param** — if caller specifies it, use that
2. **Originating backend** — inherit from the session that spawned this pillar (Flow's backend)
3. **Hardcoded fallback** — `'gemini'` if nothing else

**That's it.** There is no task-characteristic-based routing. Every pillar uses whatever backend called it, or gemini.

### Default Model Resolution (`_defaultModel`)

```js
_defaultModel(pillar, backend, { recursive, depth, singularityRole }) {
  if (backend === 'ollama') {
    if (singularityRole === 'voice' || singularityRole === 'thinker') return 'qwen3-coder:30b'
    if (recursive && depth > 1) return 'qwen2.5-coder:7b'  // fast sub-workers
    return 'qwen3-coder:30b'   // ⚠️ not available on this machine
  }
  if (backend === 'codex')   return 'gpt-5.1-codex-max'
  if (backend === 'copilot') return 'claude-sonnet-4.6'  // actual runtime: gpt-5.4
  if (backend === 'gemini')  return 'flash'
  // Claude: PHASE_MODEL_SUGGESTIONS[pillar] → all 'gemini' → falls through → 'sonnet'
  return 'sonnet'
}
```

### Health-Based Fallback Chain

**File:** `bridge/backend-health.js` line 9

```js
const FALLBACK_CHAIN = ['claude', 'copilot', 'gemini', 'codex', 'ollama']
```

When a backend is unavailable, `getFallback()` walks this chain and returns the first available backend (excluding the failed one). This is static — no task-awareness.

### `PHASE_MODEL_SUGGESTIONS` (Currently Unused for Differentiation)

**File:** `src/prompts/phases.js` lines 7–14

```js
export const PHASE_MODEL_SUGGESTIONS = {
  flow:    'gemini',
  scout:   'gemini',
  chart:   'gemini',
  forge:   'gemini',
  polish:  'gemini',
  ship:    'gemini'
}
```

All phases point to `'gemini'`. This constant was the intended place for per-phase model routing, but it was never differentiated. It's read by `_defaultModel` for Claude backend only (extracts the suffix after `:`) — but since all values are just `'gemini'` (no colon), it falls through to `'sonnet'`.

---

## 4. Backend Capability Matrix

| Capability | Claude | Gemini | Copilot | Codex | Ollama |
|-----------|--------|--------|---------|-------|--------|
| **MCP tools** | ✅ Full | ✅ Full | ✅ Full + GitHub | ✅ Full | ⚠️ Restricted set |
| **Context window** | 1M tokens | 1M tokens (Flash) | ~128K | ~128K | 32K (65K Singularity) |
| **Streaming** | ✅ Deltas | ✅ Deltas | ✅ Deltas | ❌ Complete items | ✅ Deltas |
| **Session resume** | ✅ | ✅ | ✅ | ✅ | ✅ (in-memory) |
| **Cost** | Max sub | Free (Flash 250/day) | GitHub Copilot sub | ChatGPT sub | Free (local) |
| **Speed** | Slow (Opus) | Fast | Fast | Medium | Varies (7B fast, 30B slow) |
| **Reasoning depth** | ★★★★★ | ★★★★ | ★★★★ | ★★★ | ★★ (7B) / ★★★ (30B) |
| **Code quality** | ★★★★★ | ★★★★ | ★★★★ | ★★★★★ | ★★★ (7B) / ★★★★ (30B) |
| **GitHub-native** | ❌ | ❌ | ✅ Built-in | ❌ | ❌ |
| **Privacy (local)** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Multi-model** | ❌ | ❌ | ✅ GPT/Claude/Gemini | ❌ | ❌ |
| **Pillar tool support** | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ (pillar tools injected) |
| **System prompt injection** | ✅ Clean | ✅ Clean (file) | ⚠️ Prepend | ⚠️ Prepend | ✅ Clean |
| **Rate limits** | None (max) | 250 req/day (Flash) | Unknown | Unknown | None |

---

## 5. Task Taxonomy for Smart Selection

Based on Paloma's workload patterns, tasks fall into these categories:

### Task Types and Ideal Backends

| Task Type | Best Backend | Why | Avoid |
|-----------|-------------|-----|-------|
| **Deep multi-file refactor** | Claude | Best reasoning, 1M context | Ollama (32K), Codex (no streaming) |
| **Research / Scout** | Gemini | Fast, 1M context, free | Ollama (weak reasoning) |
| **Strategic planning / Chart** | Claude or Gemini | Deep reasoning required | Codex, Ollama |
| **Focused code gen (single file)** | Codex | Specialized for code, structured output | Claude (overkill) |
| **GitHub operations** | Copilot | Built-in github-mcp-server | Others |
| **Quick sub-worker (recursive)** | Ollama 7B | Free, fast, sufficient for tool execution | Claude (expensive) |
| **Large document analysis** | Gemini or Claude | 1M context | Ollama, Codex |
| **Privacy-sensitive work** | Ollama | Local, zero data egress | All cloud backends |
| **Polish / code review** | Claude | Catches subtle issues | Ollama |
| **Email / social / infra** | Gemini or Copilot | Tools + speed | Codex |
| **Eval / training scripts** | Gemini or Codex | Tool execution + structure | Ollama (no exec MCP) |
| **Multi-turn conversation** | Claude or Gemini | Clean session resume | Codex (no streaming) |

### Task Signals That Could Drive Selection

These signals can be detected from the task prompt or pillar context:

1. **Pillar type** — Scout → Gemini; Chart → Claude; Forge → task-dependent; Polish → Claude
2. **Prompt length** — very long prompts need 1M context (Claude/Gemini)
3. **GitHub keywords** — "PR", "issue", "repo", "merge" → Copilot
4. **Privacy markers** — "confidential", "private", local-only work → Ollama
5. **Recursion depth** — depth > 1 → Ollama 7B (cheap sub-worker)
6. **Rate limit budget** — Gemini at 200+ req/day → fall to Claude/Copilot
7. **Machine capabilities** — check what models are pulled on Ollama before routing there
8. **Code-only tasks** — structured output needed → Codex
9. **Tool complexity** — needs exec/gmail/cloudflare → not Ollama (restricted MCP)

---

## 6. Machine Profile Template Design

### Proposed: `.paloma/local-machine.md` (per-machine, gitignored)

This file already has a mention in the bridge system (loaded at session start) but doesn't exist here. It should be generated/updated by `scripts/setup-mcp.sh` or a new `paloma doctor` command.

```markdown
# Machine Profile: LYNCH-TOWER

**Generated:** 2026-03-21
**Hostname:** LYNCH-TOWER
**OS:** Ubuntu 20.04.6 (WSL2)
**Role:** Development machine (Adam's tower PC)

## Hardware
- CPU: AMD Ryzen 7 3800X (8c/16t)
- RAM: 15GB
- Disk: 251GB (168GB free)
- GPU: None (WSL2, no discrete GPU passthrough)

## Backend Availability
- claude: available (max subscription, Opus 4.6)
- gemini: available (free/Flash, 250 req/day)
- copilot: available (GitHub OAuth, gpt-5.4)
- codex: available (ChatGPT OAuth, gpt-5.1-codex-max)
- ollama: available via HTTP (no CLI in WSL)

## Ollama Models
- qwen2.5-coder:7b-instruct-q5_k_m (5.1GB)
- codellama:7b-instruct-q5_k_m (4.5GB)
- deepseek-coder-v2:16b-lite-instruct-q5_K_M (11.0GB)
- phi3:mini (2.0GB)

## Backend Preferences (per task type)
default_backend: gemini
heavy_reasoning: claude
code_focused: codex
github_ops: copilot
sub_workers: ollama  # only if qwen3-coder:30b is pulled
privacy_sensitive: ollama

## Rate Limit Budget
gemini_requests_today: 0   # updated by bridge
gemini_daily_limit: 250
```

### Proposed: `.paloma/machine-profile.json` (auto-generated, gitignored)

Machine-readable version for the backend-health system to consume:

```json
{
  "hostname": "LYNCH-TOWER",
  "os": "linux-wsl2",
  "arch": "x64",
  "ram_gb": 15,
  "gpu": null,
  "generated_at": "2026-03-21T00:00:00Z",
  "backends": {
    "claude": {
      "available": true,
      "model": "claude-opus-4-6",
      "context_k": 1000,
      "subscription": "max"
    },
    "gemini": {
      "available": true,
      "model": "flash",
      "context_k": 1000,
      "daily_limit": 250,
      "requests_today": 0
    },
    "copilot": {
      "available": true,
      "model": "gpt-5.4",
      "context_k": 128
    },
    "codex": {
      "available": true,
      "model": "gpt-5.1-codex-max",
      "context_k": 128
    },
    "ollama": {
      "available": true,
      "url": "http://localhost:11434",
      "models": [
        { "name": "qwen2.5-coder:7b-instruct-q5_k_m", "params": "7.6B", "size_gb": 5.1 },
        { "name": "deepseek-coder-v2:16b-lite-instruct-q5_K_M", "params": "15.7B", "size_gb": 11.0 },
        { "name": "codellama:7b-instruct-q5_k_m", "params": "7B", "size_gb": 4.5 },
        { "name": "phi3:mini", "params": "3.8B", "size_gb": 2.0 }
      ],
      "preferred_model": "qwen2.5-coder:7b-instruct-q5_k_m"
    }
  },
  "preferences": {
    "default": "gemini",
    "scout": "gemini",
    "chart": "claude",
    "forge": "gemini",
    "polish": "claude",
    "ship": "gemini",
    "sub_worker": "ollama"
  }
}
```

---

## 7. Critical Bugs / Gaps Found

### Bug 1: qwen3-coder:30b not available but hardcoded as default

**File:** `bridge/pillar-manager.js:1901`  
`_defaultModel` returns `'qwen3-coder:30b'` for all non-recursive Ollama sessions. This model is NOT pulled on LYNCH-TOWER. Any Ollama pillar spawn with default settings will fail.

**Fix:** Read available models from BackendHealth's Ollama status (`this.health.status.ollama.models`) and select the best available model, not a hardcoded one.

### Bug 2: Copilot health check uses wrong field

**File:** `bridge/backend-health.js` — `checkCopilot()`  
Checks `config.logged_in_users` which doesn't exist in this machine's `~/.copilot/config.json` (only `firstLaunchAt` is present). Falls through to `GH_TOKEN` env check — but at bridge startup, `GH_TOKEN` isn't in the environment (it's fetched lazily by `CopilotCliManager._warmAuth()`). BackendHealth may incorrectly mark Copilot unavailable even though it works.

**Fix:** Either check `gh auth token` in `checkCopilot()` (consistent with `_warmAuth()`), or trust that Copilot works if `copilot` binary exists and `gh auth` succeeds.

### Bug 3: PHASE_MODEL_SUGGESTIONS all point to 'gemini' (dead code)

**File:** `src/prompts/phases.js` lines 7–14  
All six phases have the same value `'gemini'`. This was presumably the intended slot for per-phase differentiation but was never filled in. The `_defaultModel` Claude path extracts the model name after `:` — since there's no colon, it falls through to `'sonnet'`.

### Gap 1: No task-signal-based routing

`pillar_spawn` accepts an explicit `backend` param, but nothing in the system populates it intelligently. Flow has to manually choose based on the task description. There's no automatic routing.

### Gap 2: No machine-awareness

The backend selection code doesn't know which machine it's on. `qwen3-coder:30b` is hardcoded even when it's not available. A per-machine profile would solve this.

### Gap 3: Ollama MCP whitelist is too restrictive

`OLLAMA_ALLOWED_SERVERS` includes `['filesystem', 'git', 'shell', 'web', 'brave-search', 'voice', 'memory', 'fs-extra']` but excludes `exec`, `ollama-eval`, `social-poster`, `cloudflare-dns`, `gmail`, `codex`. This means Ollama sub-workers can't run npm commands, send emails, or use the eval system.

### Gap 4: No rate-limit tracking for Gemini free tier

Gemini Flash is free at 250 requests/day, but the bridge has no counter. If Gemini is overloaded (rate-limited), the system will hit errors rather than proactively falling back to Claude before the limit is hit.

### Gap 5: Fallback chain order is suboptimal

Current: `['claude', 'copilot', 'gemini', 'codex', 'ollama']`

Claude is listed first as fallback destination, but it's the most expensive. For most task types, Gemini should be the primary fallback (it's free). A task-aware fallback chain would help.

---

## 8. Recommendations for Chart

### Core Idea: Two-Layer Smart Selection

**Layer 1 — Machine Profile (static):** Know what's available. A `machine-profile.json` updated on bridge startup tells the system which backends are real options on this machine, with their models, rate limits, and preferences.

**Layer 2 — Task Signals (dynamic):** At spawn time, examine the task and pillar type to choose the best available backend from Layer 1.

### Specific Recommendations

1. **Generate `machine-profile.json` at bridge startup** — BackendHealth already probes all backends and knows models. Persist that as a JSON file the profile template above. Update on each probe.

2. **Add `_selectBackend(pillar, prompt, options)` to PillarManager** — Called before `spawn()` to resolve the optimal backend based on task signals, machine profile, and availability. Returns the best `{backend, model}` pair.

3. **Per-pillar defaults in machine profile** — Allow per-machine tuning. LYNCH-TOWER might prefer Codex for Forge, Gemini for Scout; MacBook Pro might prefer Claude for everything.

4. **Fix `_defaultModel` for Ollama** — Query `this.health.status.ollama.models` and select the best available model by size (prefer largest that fits in RAM budget), falling back gracefully.

5. **Fix Copilot health check** — Use `gh auth token` instead of `logged_in_users` field.

6. **Differentiate `PHASE_MODEL_SUGGESTIONS`** — Actually vary by phase. Suggestion: Scout → fast/cheap, Chart → deep reasoning, Forge → code-specialized, Polish → highest quality.

7. **Add Gemini rate-limit tracking** — Counter in BackendHealth or bridge state. Pre-emptive fallback when >200 requests used that day.

8. **Expose backend hints from Chart** — When Chart writes a plan's work units, let it annotate recommended backends: `<!-- backend: codex -->`. Pillar decompose + orchestrate can read these hints at spawn time.

9. **`local-machine.md` generation script** — Add to `scripts/setup-mcp.sh` or as `paloma doctor --generate-profile`. Auto-detects hardware, backend availability, and writes the gitignored profile file.

---

## 9. Data Flows to Understand for Chart

```
Bridge startup
  → BackendHealth.checkAll()          # probes all 5 backends, caches status
  → Saves machine-profile.json         # NEW — persistent machine state
  → PillarManager.spawn()
      → resolvedBackend = backend || originatingBackend || 'gemini'  # TODAY
      → NEW: _selectBackend(pillar, prompt, resolvedBackend)          # PROPOSED
      → BackendHealth.isAvailable(backend)
      → getFallback() if needed        # walks FALLBACK_CHAIN statically
      → _defaultModel(pillar, backend) # BUGGY for Ollama
      → _buildSystemPrompt()           # Ollama gets condensed prompt
      → backends[backend].chat()       # dispatches to correct manager
```

---

*Scout findings complete. Ready for Chart.*
