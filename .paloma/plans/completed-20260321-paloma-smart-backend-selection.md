# Smart Backend Selection

> **Goal:** Make Paloma intelligently choose which AI backend (Claude, Gemini, Copilot, Codex, Ollama) to use for each pillar spawn based on task characteristics, machine capabilities, and backend health — rather than always falling through to `'gemini'`.
> **Status:** Active — Charted, ready for Forge
> **Created:** 2026-03-21
> **Pipeline:** ~~Scout~~ → ~~Chart~~ → **Forge** → Polish → Ship
> **Scope:** paloma

---

## Research References

- **Scout findings:** `.paloma/docs/scout-smart-backend-selection.md`
- **Backend health:** `bridge/backend-health.js` (Copilot bug confirmed, Gemini rate untracked)
- **Spawn routing today:** `bridge/pillar-manager.js:68-113` — `backend || originatingBackend || 'gemini'`
- **Model defaults:** `bridge/pillar-manager.js:1896` — `_defaultModel()` (Ollama hardcodes `qwen3-coder:30b`)
- **Phase suggestions:** `src/prompts/phases.js:7-14` — all `'gemini'`, undifferentiated

---

## Architectural Decisions

### AD-1: Machine profile lives in BackendHealth, written to `.paloma/machine-profile.json`

BackendHealth already probes all backends and caches their status at startup. It's the natural home for machine profile generation. After `checkAll()` runs, it writes a JSON profile to `.paloma/machine-profile.json` (gitignored) and caches the parsed object as `this.machineProfile`. PillarManager reads it via `this.health.machineProfile`.

**Why not a separate module:** BackendHealth already has all the data. A separate module would either duplicate the probe logic or import from BackendHealth — adding indirection without benefit. Keeping it in BackendHealth is the simplest correct approach.

**The profile is editable by humans.** Generated with sensible defaults; Adam can tune per-machine preferences (e.g., set `chart: "gemini"` on LYNCH-TOWER where Claude is slow). Regenerated on reprobe only if the JSON file doesn't exist yet or its structure is stale — never overwrites user customizations to the `preferences` block.

**Regeneration strategy:** `_generateMachineProfile()` reads the existing file first. It always updates the `backends` block (freshest availability data) but only writes the `preferences` block if the file is new. This preserves any manual edits Adam makes.

### AD-2: `_selectBackend` replaces the `|| originatingBackend` inheritance pattern

Today's logic: `backend || originatingBackend || 'gemini'`. The `originatingBackend` part means "inherit the backend of whatever spawned you." This was a pragmatic default before smart routing existed. It causes Flow (Gemini) to spawn all children on Gemini regardless of task fit.

With `_selectBackend`, the `originatingBackend` inheritance is dropped. When no explicit `backend` is given, `_selectBackend` uses machine profile preferences + task signals to pick the best available backend. Explicit `backend` overrides still work exactly as before.

**Why drop originatingBackend:** It was a fallback for when we had no better signal. We now have better signals (pillar type, task content, machine profile). Keeping originatingBackend inheritance would prevent Claude from spawning a better-suited Codex child.

### AD-3: Task signal detection is keyword-based — simple and transparent

Two signal categories:
- **GitHub signals:** `['pull request', ' pr #', 'github issue', 'open issue', 'merge branch', 'git blame', 'close issue']` → route to Copilot (built-in GitHub MCP server)
- **Privacy signals:** `['confidential', 'private key', 'secret key', 'api secret', 'password', 'credentials']` → route to Ollama (local, zero egress)

Keyword matching is case-insensitive, applied to the prompt text. This is intentionally simple — no ML, no embeddings, no scoring. If a keyword appears, route accordingly. If the routing proves wrong in practice, we add exclusions rather than building a classifier.

Both signal routes are **gated on availability** — if Copilot is down, GitHub signals fall through to normal routing. If Ollama has no models, privacy signals fall through.

### AD-4: Pillar-type defaults are the primary routing signal (no keywords matched)

When no task signals fire, routing uses the pillar type from the machine profile `preferences` block:

| Pillar | Default Backend | Reasoning |
|--------|----------------|-----------|
| flow | gemini | Needs full MCP tool loop; Gemini has best MCP support |
| scout | gemini | Fast + free + 1M context; research doesn't need Opus depth |
| chart | claude | Architecture decisions need deepest reasoning |
| forge | gemini | Good balance of speed/quality for coding; free tier preserves Claude for review |
| polish | claude | Code review catches subtle issues; highest quality matters here |
| ship | gemini | Commit + doc work is straightforward; no deep reasoning needed |

These defaults are the starting point in the generated profile. Adam can override any of them per-machine.

### AD-5: Gemini rate limit tracking is a soft pre-emptive fallback, not a hard block

BackendHealth tracks `_geminiRequestsToday` (incremented each time a session is spawned with Gemini backend) and `_geminiResetDate` (today's date in YYYY-MM-DD). On each increment, if the date has changed, the counter resets.

`isGeminiApproachingLimit(threshold = 220)` returns `true` when `_geminiRequestsToday >= threshold` (88% of 250 limit). When approaching, `_selectBackend` routes to Claude (if available) or Copilot instead.

**Why 220 not 250:** Pre-emptive. Prevents hitting the actual limit mid-task. The 30-request buffer gives room for a few more spawns to complete before the API starts rejecting.

**Why not proactively reset:** The bridge doesn't run across midnight in practice (it gets restarted). Daily reset via date check on increment is sufficient.

### AD-6: Ollama model selection queries the health status

`_defaultModel()` currently hardcodes `qwen3-coder:30b` for all non-recursive Ollama sessions. That model isn't on LYNCH-TOWER. The fix: query `this.health.status.ollama.models` and select the best available model using a preference order.

Preference order (highest to lowest capability):
1. Any `qwen3-coder` variant
2. Any `qwen2.5-coder` variant (not 7b unless it's the only option)
3. Any `deepseek-coder` variant
4. Any `codellama` variant
5. Largest remaining model (by name, as proxy for size)

Sub-workers (recursive, depth > 1) always prefer 7B models to keep them fast and cheap.

### AD-7: `PHASE_MODEL_SUGGESTIONS` maps to backend names, not model names

The current format (`'gemini'`) is already backend-shaped, but the `_defaultModel` Claude branch incorrectly tries to split it on `:`. This is dead code — the values should simply be backend names that `_selectBackend` consults as the "phase preference" baseline.

New values:
```js
export const PHASE_MODEL_SUGGESTIONS = {
  flow:    'gemini',   // orchestrator — best MCP support
  scout:   'gemini',   // fast + free research
  chart:   'claude',   // deepest reasoning for architecture
  forge:   'gemini',   // balanced speed/quality for code
  polish:  'claude',   // highest quality review
  ship:    'gemini'    // straightforward commit work
}
```

`_defaultModel` (for Claude backend) currently reads these to extract a model name after `:`. Since we're changing them to plain backend names (no colon), we need to fix `_defaultModel`'s Claude branch to not use `PHASE_MODEL_SUGGESTIONS` for model selection — it should just return `'sonnet'` always for Claude. The phase preferences are for backend selection, not model selection within a backend.

### AD-8: Chart phase annotations use `<!-- backend: X -->` comments in WU specs

Chart's phase prompt gets an additional instruction: when writing work units in plan documents, annotate each WU with a `<!-- backend: gemini -->` comment after the `**Status:**` line. Flow's pillar_orchestrate and pillar_spawn can read these annotations to pre-populate the backend param.

This is an ergonomic improvement, not an enforcement mechanism. Flow still decides the final backend — the annotation is a suggestion from Chart that knows the task characteristics.

---

## Work Units

### WU-1: Fix BackendHealth bugs + add Gemini rate tracking
**Status:** completed
**Backend:** gemini
**Files:** `bridge/backend-health.js`

**Description:** Three targeted fixes to BackendHealth:

1. **Fix Copilot health check:** `checkCopilot()` reads `config.logged_in_users` which doesn't exist on LYNCH-TOWER's `~/.copilot/config.json`. Replace with `gh auth token` call (consistent with CopilotCliManager's `_warmAuth()`):
   ```js
   // Replace the config.logged_in_users check with:
   const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 })
   if (stdout.trim()) {
     this.status.copilot = { available: true, reason: 'gh auth token valid', lastCheck: now }
   }
   ```
   Keep the `COPILOT_GITHUB_TOKEN || GH_TOKEN || GITHUB_TOKEN` env var fallback path as-is.

2. **Add Gemini request counter:**
   - Add to constructor: `this._geminiRequestsToday = 0` and `this._geminiResetDate = ''`
   - Add `incrementGeminiRequests()` method: checks if date changed (reset counter if new day), then increments
   - Add `isGeminiApproachingLimit(threshold = 220)` method: returns `_geminiRequestsToday >= threshold`
   - Add `getGeminiUsage()` method: returns `{ today: N, limit: 250, date: '...' }` for health summaries

3. **Include Gemini usage in `getSummary()`:** Add `usage: this.getGeminiUsage()` to the gemini entry in the summary object.

**Acceptance criteria:**
- [x] Copilot check: `checkCopilot()` calls `gh auth token`; falls through to env vars if it fails; binary not found → unavailable
- [x] Gemini counter: `incrementGeminiRequests()` resets on new day; `isGeminiApproachingLimit()` returns true at/above threshold
- [x] `getSummary()` includes `usage` for gemini entry
- [x] No other behavior changed

---

### WU-2: Machine profile generation in BackendHealth
**Status:** completed
**Backend:** gemini
**Files:** `bridge/backend-health.js`, `.gitignore`
**Depends:** WU-1 (same Forge session — these are file-adjacent)

**Description:** After `checkAll()` completes, generate/update `.paloma/machine-profile.json`.

Add `async _generateMachineProfile()` method:
1. Read existing profile file (if exists) — parse `preferences` block to preserve user edits
2. Build `backends` block from `this.status` (always fresh — availability, models, etc.)
3. Build `hardware` block from `os.hostname()`, `os.totalmem()`, `os.cpus()[0].model`, `os.platform()`
4. Merge: keep existing `preferences` if file already had them; use defaults if new file
5. Write to `{projectRoot}/.paloma/machine-profile.json`
6. Cache parsed result as `this.machineProfile`

Default `preferences` block (written only for new files):
```json
{
  "default": "gemini",
  "flow": "gemini",
  "scout": "gemini",
  "chart": "claude",
  "forge": "gemini",
  "polish": "claude",
  "ship": "gemini",
  "subWorker": "ollama"
}
```

`checkAll()` calls `_generateMachineProfile()` at the end (after all probes complete). Also call it from `_startReprobeTimer`'s interval when backends recover (so the profile stays current).

**BackendHealth constructor needs `projectRoot`:**
- BackendHealth constructor currently takes no args. Add optional `{ projectRoot }` param.
- In `bridge/index.js`, pass `{ projectRoot: process.cwd() }` when constructing BackendHealth.
- Or use a setter: `health.setProjectRoot(projectRoot)` called from index.js after construction.

**The setter approach is less disruptive** — don't change the constructor signature (BackendHealth is instantiated in multiple places). Add `setProjectRoot(root)` method and call it from index.js after the fact.

**Add to `.gitignore`:**
```
# Per-machine backend profile (auto-generated, per-machine)
.paloma/machine-profile.json
```

**Acceptance criteria:**
- [x] `.paloma/machine-profile.json` is written after bridge startup
- [x] `backends` block reflects real health status (not hardcoded)
- [x] `preferences` block is written with defaults for new files; preserved for existing files
- [x] `this.machineProfile` is set on BackendHealth and readable by PillarManager
- [x] `.paloma/machine-profile.json` is in `.gitignore`
- [x] Reprobe interval updates the profile when backends recover

---

## Implementation Notes

- Implemented `gh auth token` check in `BackendHealth.checkCopilot()`.
- Added Gemini request counting with daily reset and approaching-limit detection.
- Added `machine-profile.json` generation in `BackendHealth`, including hardware info and backend status.
- Preserved user preferences when updating the profile.
- Integrated `setProjectRoot` in `bridge/index.js` to enable path resolution.
- Updated `.gitignore`.

---

### WU-3: `_selectBackend` method in PillarManager
**Status:** ready (depends on WU-1+WU-2 for API surface)
**Backend:** claude
**Files:** `bridge/pillar-manager.js`

**Description:** New `_selectBackend(pillar, prompt, options)` method and updated `spawn()` wiring.

**Signal constants** (top of file, near other constants):
```js
const GITHUB_TASK_SIGNALS = [
  'pull request', ' pr #', 'github issue', 'open issue',
  'merge branch', 'git blame', 'close issue', 'github repo'
]
const PRIVACY_TASK_SIGNALS = [
  'confidential', 'private key', 'secret key', 'api secret',
  'password', 'credentials', 'private and confidential'
]
```

**The method:**
```js
_selectBackend(pillar, prompt = '', { backend, recursive, depth, singularityRole } = {}) {
  // 1. Explicit override — always honored, no intelligence needed
  if (backend) return { backend, reason: 'explicit override' }

  // 2. Singularity roles always use ollama
  if (singularityRole) return { backend: 'ollama', reason: `singularity ${singularityRole}` }

  // 3. Recursive sub-workers → small local model (fast, free)
  if (recursive && (depth || 0) > 1) {
    if (this.health?.isAvailable('ollama')) {
      return { backend: 'ollama', reason: `recursive sub-worker (depth ${depth})` }
    }
    // No ollama → fall through to normal routing
  }

  // 4. Task signal detection
  const promptLower = (prompt || '').toLowerCase()
  if (GITHUB_TASK_SIGNALS.some(s => promptLower.includes(s))) {
    if (this.health?.isAvailable('copilot')) {
      return { backend: 'copilot', reason: 'GitHub task signal detected' }
    }
  }
  if (PRIVACY_TASK_SIGNALS.some(s => promptLower.includes(s))) {
    if (this.health?.isAvailable('ollama')) {
      return { backend: 'ollama', reason: 'privacy-sensitive task signal detected' }
    }
  }

  // 5. Per-pillar preference from machine profile
  const preferences = this.health?.machineProfile?.preferences || {}
  let preferred = preferences[pillar] || preferences.default || 'gemini'

  // 6. Gemini rate limit pre-emption
  if (preferred === 'gemini' && this.health?.isGeminiApproachingLimit?.()) {
    const usage = this.health.getGeminiUsage?.()
    const altBackend = this.health?.isAvailable('claude') ? 'claude'
      : this.health?.isAvailable('copilot') ? 'copilot'
      : null
    if (altBackend) {
      return { backend: altBackend, reason: `Gemini rate limit approached (${usage?.today}/${usage?.limit})` }
    }
  }

  // 7. Availability check — fall back if preferred is down
  if (this.health && !this.health.isAvailable(preferred)) {
    const fallback = this.health.getFallback(preferred)
    if (fallback) {
      return { backend: fallback, reason: `${preferred} unavailable — falling back` }
    }
  }

  return { backend: preferred, reason: `pillar preference: ${pillar} → ${preferred}` }
}
```

**Update `spawn()` to use it:**

Replace:
```js
const resolvedBackend = backend || originatingBackend || 'gemini'
```

With:
```js
const selection = this._selectBackend(pillar, prompt, { backend, recursive, depth, singularityRole })
const resolvedBackend = selection.backend
console.log(`[pillar] Backend selection for ${pillar}: ${selection.backend} (${selection.reason})`)
```

**After confirming `finalBackend`** (post health-gate), increment Gemini counter if applicable:
```js
if (finalBackend === 'gemini') {
  this.health?.incrementGeminiRequests?.()
}
```

**Also remove `originatingBackend` from the backend resolution logic** — it's no longer needed since `_selectBackend` makes a smarter choice. Keep `originatingBackend` as a local variable (it's still logged for debugging) but don't use it in backend selection.

**Acceptance criteria:**
- [ ] `_selectBackend` returns `{ backend, reason }` for all inputs
- [ ] Explicit `backend` param is always honored (never overridden)
- [ ] Recursion depth > 1 routes to Ollama when available
- [ ] GitHub keywords route to Copilot when available
- [ ] Privacy keywords route to Ollama when available
- [ ] Per-pillar preferences from machine profile are respected
- [ ] Gemini rate limit pre-emption triggers at 220/250
- [ ] Fallback fires when preferred backend is unavailable
- [ ] Backend selection reason is logged on every spawn
- [ ] Gemini request count incremented on each Gemini spawn
- [ ] Existing `backend` param behavior is fully backwards-compatible

---

### WU-4: Fix `_defaultModel` for Ollama
**Status:** ready
**Backend:** gemini
**Files:** `bridge/pillar-manager.js`
**Depends:** WU-3 (same Forge session — file-adjacent)

**Description:** Replace the hardcoded `qwen3-coder:30b` in `_defaultModel` with dynamic model selection from `this.health.status.ollama.models`.

**New Ollama model selection logic:**
```js
_pickBestOllamaModel(preferSmall = false) {
  const models = this.health?.status?.ollama?.models || []
  if (models.length === 0) return 'qwen2.5-coder:7b'  // safe default even if not available

  // Sub-workers prefer small/fast models
  if (preferSmall) {
    const small = models.find(m => m.includes('7b') || m.includes('3b') || m.includes('mini'))
    if (small) return small
  }

  // Preference order for main sessions (highest capability first)
  const PREFERENCES = [
    m => m.includes('qwen3-coder') && !m.includes('7b'),
    m => m.includes('qwen3-coder'),
    m => m.includes('qwen2.5-coder') && !m.includes('7b'),
    m => m.includes('deepseek-coder'),
    m => m.includes('qwen2.5-coder'),
    m => m.includes('codellama'),
    () => true   // fallback: first available model
  ]
  for (const test of PREFERENCES) {
    const match = models.find(test)
    if (match) return match
  }
  return models[0]
}
```

**Update `_defaultModel` Ollama branch:**
```js
if (backend === 'ollama') {
  if (singularityRole === 'voice' || singularityRole === 'thinker') return this._pickBestOllamaModel(false)
  if (recursive && depth > 1) return this._pickBestOllamaModel(true)
  return this._pickBestOllamaModel(false)
}
```

**Also fix `_defaultModel` Claude branch** — currently reads `PHASE_MODEL_SUGGESTIONS[pillar]` and tries to split on `:` to extract a model name. Since `PHASE_MODEL_SUGGESTIONS` values are now plain backend names (no colon), this produces `undefined` and falls through to `'sonnet'`. The fix: remove the `PHASE_MODEL_SUGGESTIONS` read from the Claude branch entirely. For Claude, just return `'sonnet'` (the only model path). The phase routing is now done by `_selectBackend`, not `_defaultModel`.

**Acceptance criteria:**
- [ ] `_defaultModel('flow', 'ollama')` returns a model that actually exists in `this.health.status.ollama.models`
- [ ] Sub-worker path (`recursive && depth > 1`) returns a 7B or smaller model when available
- [ ] Voice/Thinker get the largest available model (not hardcoded to 30b)
- [ ] When no Ollama models are available, returns a safe default string (doesn't crash)
- [ ] Claude branch no longer reads `PHASE_MODEL_SUGGESTIONS` — returns `'sonnet'` directly
- [ ] Codex, Copilot, Gemini branches unchanged

---

### WU-5: Differentiate PHASE_MODEL_SUGGESTIONS + Chart annotation prompt
**Status:** completed
**Backend:** gemini
**Files:** `src/prompts/phases.js`

**Description:** Two targeted changes to `phases.js`:

**1. Update PHASE_MODEL_SUGGESTIONS values:**
Change all `'gemini'` values to the per-pillar backend recommendations from AD-7:
```js
export const PHASE_MODEL_SUGGESTIONS = {
  flow:    'gemini',   // orchestrator — needs full MCP tool loop; Gemini is best
  scout:   'gemini',   // fast + free + 1M context; ideal for research
  chart:   'claude',   // deepest reasoning for architecture decisions
  forge:   'gemini',   // balanced speed/quality; free tier preserves Claude for review
  polish:  'claude',   // highest quality for code review; catches subtle issues
  ship:    'gemini'    // commit/doc work; no deep reasoning needed
}
```

Update the JSDoc comment:
```js
/**
 * Recommended backend per phase.
 * Used by PillarManager._selectBackend() as the per-pillar preference baseline.
 * Machine profile (.paloma/machine-profile.json) can override these per-machine.
 * Not enforced — just the starting point for smart routing.
 */
```

**2. Add backend annotation instruction to Chart phase prompt:**
In the Chart phase prompt (`PHASE_INSTRUCTIONS.chart`), add to the "Plan Output" section:

```
## Backend Annotations

When writing work units in plan documents, add a `**Backend:**` line after `**Status:**`:

\`\`\`
### WU-N: Feature Name
**Status:** ready
**Backend:** gemini
**Files:** ...
\`\`\`

Recommend the backend that fits the task:
- `claude` — deep reasoning, code review, architecture decisions
- `gemini` — research, fast coding, doc work, default for most tasks
- `codex` — focused code generation with structured output
- `copilot` — GitHub operations (PRs, issues, repos)
- `ollama` — sub-workers, privacy-sensitive, offline tasks

Flow reads these annotations when dispatching pillars. Your recommendation informs but doesn't override Flow's final decision.
```

**Acceptance criteria:**
- [ ] `PHASE_MODEL_SUGGESTIONS` has distinct values for chart (`'claude'`) and polish (`'claude'`), not all `'gemini'`
- [ ] JSDoc reflects new purpose (backend selection, not model names)
- [ ] Chart phase prompt includes `**Backend:**` annotation instruction with examples
- [ ] Recommended backends in the Chart prompt match AD-7 defaults
- [ ] No other phase prompts changed

---

## Implementation Notes (Forge — 2026-03-21)

### WU-5: Differentiate PHASE_MODEL_SUGGESTIONS + Chart annotation prompt
- Updated `PHASE_MODEL_SUGGESTIONS` in `src/prompts/phases.js` with differentiated backends (Gemini for Flow/Scout/Forge/Ship, Claude for Chart/Polish).
- Updated JSDoc for `PHASE_MODEL_SUGGESTIONS` to reflect its new purpose in `_selectBackend`.
- Added `## Backend Annotations` section to `PHASE_INSTRUCTIONS.chart` with instructions and examples for annotating work units in plan documents.
- All changes are consistent with AD-7 and AD-8.

---

## Dependency Graph

```
WU-1 (BackendHealth fixes + Gemini counter)  ─┐
WU-2 (Machine profile generation)             ─┴─ One Forge session (backend-health.js)
                                                │
WU-5 (PHASE_MODEL_SUGGESTIONS + Chart prompt) ─┤ Parallel with WU-1+2 (phases.js)
                                                │
WU-3 (_selectBackend)                         ─┐  Wait for WU-1+2 (needs rate limit API)
WU-4 (_defaultModel Ollama fix)               ─┴─ One Forge session (pillar-manager.js)
```

**Parallel dispatch:**
- **Round 1:** Forge session A (WU-1+WU-2, `backend-health.js`) + Forge session B (WU-5, `phases.js`) — file-disjoint, parallel
- **Round 2:** Forge session C (WU-3+WU-4, `pillar-manager.js`) — after Round 1 completes

---

## Files Changed Summary

| File | WUs | Change Type |
|------|-----|-------------|
| `bridge/backend-health.js` | 1, 2 | Fix Copilot check; add Gemini counter; add machine profile generation; add `setProjectRoot()` |
| `.gitignore` | 2 | Add `.paloma/machine-profile.json` |
| `bridge/pillar-manager.js` | 3, 4 | Add `_selectBackend()` + `_pickBestOllamaModel()`; update `spawn()`; fix `_defaultModel()` |
| `src/prompts/phases.js` | 5 | Differentiate `PHASE_MODEL_SUGGESTIONS`; add Chart annotation instruction |
| `bridge/index.js` | 2 | Call `health.setProjectRoot(projectRoot)` after BackendHealth construction |

---

## Testing Strategy

1. **Copilot health:** Restart bridge on LYNCH-TOWER — verify `paloma doctor` shows Copilot as available (was incorrectly marking unavailable)
2. **Machine profile:** After restart, verify `.paloma/machine-profile.json` exists with correct backends block; `chart` preference is `claude`
3. **Backend selection logging:** Spawn a Chart pillar — log should show `[pillar] Backend selection for chart: claude (pillar preference: chart → claude)`
4. **Ollama model:** Spawn an Ollama pillar on LYNCH-TOWER — should get `qwen2.5-coder:7b-instruct-q5_k_m`, not `qwen3-coder:30b` (which would fail with model not found)
5. **Rate limit:** Manually set `this.health._geminiRequestsToday = 225`, spawn a Gemini pillar — should route to Claude with "Gemini rate limit approached" reason
6. **Explicit override:** `pillar_spawn({ backend: 'codex', ... })` should still route to Codex regardless of pillar type
7. **Regression:** Normal Flow usage unchanged — Gemini still the default for scout/forge/ship

---

## Success Criteria

1. No more "model not found" errors when Ollama spawns on LYNCH-TOWER
2. Copilot correctly detected as available on startup
3. Chart and Polish pillars default to Claude (deep reasoning where it matters)
4. Gemini rate limit doesn't cause hard failures — pre-empted with graceful fallback
5. Every spawn logs its backend selection reason (observable, debuggable)
6. Machine profile is human-readable and editable per-machine
7. All existing explicit `backend` overrides continue to work unchanged
