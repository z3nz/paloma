# Singularity Operations Guide

> Complete operations manual for the Paloma Singularity system.
> Written as part of the 4-CLI collaborative sprint (Claude + Codex + Copilot + Gemini), March 26, 2026.

---

## 1. What Is the Singularity?

The **Paloma Singularity** is the system that enables an AI session to recursively improve itself — spawning successor generations with evolved prompts, accumulated memory, and validated safety checks.

In plain terms: Quinn (the singularity mind) runs, explores the codebase, learns something, writes what it learned into a manifest, crafts a better prompt for its successor, then spawns that successor and gracefully exits. The next generation begins where the last one left off, armed with the previous generation's learnings.

There are two singularity modes:

### Quinn Gen4 — Recursive Self-Spawning
A single Ollama session with full MCP tools and a special `spawn_next` tool. It runs until it decides to spawn its successor, passes a crafted prompt and state summary, then terminates. The chain continues until a circuit breaker halts it or the generation limit is reached.

### Dual-Mind — Voice + Thinker
Two sessions run simultaneously: **Voice** (streams to Adam, synthesizes, no heavy tools) and **Thinker** (silent, all tools, does the actual exploration). They communicate via `<to-thinker>` tags and structured `FOUND:/KEY:/DETAIL:` responses. When both emit `<ready/>`, Flow detects agreement and the session completes.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Pillar Manager (bridge/pillar-manager.js)                       │
│  ┌────────────────────┐   ┌────────────────────────────────────┐ │
│  │  Quinn Gen4 Session │   │  Dual-Mind Group                   │ │
│  │  singularityRole:  │   │  Voice (streams) + Thinker (tools) │ │
│  │  'quinn-gen4'       │   │  singularityRole: 'voice'/'thinker'│ │
│  │  + spawn_next tool  │   │  singularityGroupId: shared UUID   │ │
│  └──────────┬──────────┘   └──────────────┬─────────────────── ┘ │
│             │                             │                       │
│  ┌──────────▼─────────────────────────────▼────────────────────┐  │
│  │  singularity-integration.js  (Stream D — the wiring layer)  │  │
│  │  preSpawnHook → postSpawnHook → completionHook → errorHook   │  │
│  └──────────┬──────────┬──────────────┬────────────────────────┘  │
│             │          │              │                            │
│   ┌─────────▼──┐  ┌────▼──────┐  ┌───▼──────────────────────┐    │
│   │ memory.js   │  │ safety.js │  │ monitor.js + lineage.js  │    │
│   │ (Stream A)  │  │ (Stream B)│  │         (Stream B)       │    │
│   └─────────────┘  └───────────┘  └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 — Stream C)                                     │
│  useSingularity.js composable → SingularityPanel.vue            │
│  LineageViewer.vue → reads lineage data from bridge API          │
└─────────────────────────────────────────────────────────────────┘

Artifacts:
  .singularity/
    lineage.json              ← All generation metadata
    generation-NNN.md         ← Per-generation manifests (zero-padded)
    memory-index.json         ← Cross-generation memory store
    chain-monitor.json        ← Live monitoring data
    workspace/                ← Ephemeral scratch (gitignored, .gitkeep)
    archive/                  ← Truncated/archived generations
```

---

## 3. How to Spawn Quinn Gen4

### Via Flow (pillar_spawn tool)

```javascript
// Basic spawn — generation 1
pillar_spawn({
  singularityRole: 'quinn-gen4',
  prompt: "You are Quinn, generation 1. Explore the bridge/ directory and document the key architectural patterns. Write your findings to .singularity/workspace/findings.md. Then craft a prompt for your successor that builds on what you learned.",
  generation: 1   // defaults to 1 if omitted
})

// Resume from generation N (after repairLineage)
pillar_spawn({
  singularityRole: 'quinn-gen4',
  prompt: "<full crafted prompt for gen N>",
  generation: 5
})
```

### Template Variables

The following variables are automatically injected into the Quinn Gen4 prompt at spawn time:

| Variable | Description |
|----------|-------------|
| `{GENERATION_NUMBER}` | The current generation number (integer) |
| `{PREDECESSOR_MANIFEST}` | Contents of the previous generation's manifest file |
| `{WORKSPACE_PATH}` | Absolute path to `.singularity/workspace/` |
| `{LINEAGE_PATH}` | Absolute path to `.singularity/lineage.json` |

### The `spawn_next` Tool

Once spawned, Quinn Gen4 has access to a special `spawn_next` tool:

```javascript
// Called from within the Quinn Gen4 session
spawn_next({
  prompt: "<crafted prompt for generation N+1>",
  state_summary: "<what this generation learned, max ~5000 tokens>",
  task_for_next: "<specific task for the next generation, max ~2000 tokens>"
})
```

`spawn_next` does three things atomically:
1. Writes a generation manifest to `.singularity/generation-NNN.md`
2. Appends to `.singularity/lineage.json`
3. Spawns the next generation Ollama session
4. Exits (via `process.exit(0)` after 2s delay)

---

## 4. How to Spawn Dual-Mind (Voice + Thinker)

The dual-mind spawns two sessions under a shared `singularityGroupId`.

```javascript
// Flow spawns both — the bridge handles group tracking
const groupId = crypto.randomUUID()

pillar_spawn({
  singularityRole: 'voice',
  singularityGroupId: groupId,
  prompt: "You are Voice in a dual-mind session. Stream your thinking to Adam. When you reach a conclusion, emit <ready/>."
})

pillar_spawn({
  singularityRole: 'thinker',
  singularityGroupId: groupId,
  prompt: "You are Thinker in a dual-mind session. Use all tools silently. Emit FOUND:/KEY:/DETAIL: responses. When done, emit <ready/>."
})
```

### Inter-session messaging

Voice can direct Thinker using `<to-thinker>` tags in its stream:
```
<to-thinker>Search for all pillar lifecycle events in bridge/pillar-manager.js</to-thinker>
```

Thinker responds with structured format:
```
FOUND: pillar lifecycle events in bridge/pillar-manager.js
KEY: onPillarStarted, onPillarStream, onPillarDone, onPillarError
DETAIL: All lifecycle methods are defined on the callbacks object passed to PillarManager constructor
```

### Agreement detection

The bridge detects `<ready/>` in both streams:
- When both emit `<ready/>`, `onSingularityReady` fires with `voiceReady: true, thinkerReady: true`
- The frontend `SingularityPanel.vue` shows the AGREED badge

---

## 5. How to Monitor a Chain

### Live monitoring (during a run)

The `ChainMonitor` (from `singularity-monitor.js`) tracks all events:

```javascript
import { createChainMonitor, formatHealthReport } from './singularity-monitor.js'

const monitor = createChainMonitor('/path/to/project/.singularity')

// After spawning:
monitor.recordSpawn(generation, pillarId, promptHash)

// After completion:
monitor.recordCompletion(generation, pillarId, durationMs, summary)

// Check health:
const health = monitor.getChainHealth()
console.log(formatHealthReport(health))

// Save full report:
await monitor.saveReport('.singularity/chain-report.md')
```

### Reading chain health

```javascript
const health = monitor.getChainHealth()
// health = {
//   generations: 7,
//   successRate: 0.857,
//   avgDuration: 45000,
//   currentGeneration: 7,
//   isActive: true,
//   errors: 1
// }
```

### Using the integration status hook

```javascript
import { getSingularityStatus } from './singularity-integration.js'

const status = await getSingularityStatus()
// status = {
//   initialized: true,
//   singularityDir: '/path/to/.singularity',
//   memory: { totalMemories: 42, byCategory: {...}, ... },
//   lineage: { valid: true, generationCount: 7, gaps: [] },
//   monitor: { generations: 7, successRate: 0.857, ... },
//   safety: { limits: DEFAULT_LIMITS, available: true }
// }
```

---

## 6. Troubleshooting

### Stuck generation (session running but no output)

**Symptoms:** `pillar_status` shows `running` but no new stream events for 5+ minutes.

**Fix:**
1. `pillar_stop({ pillarId: "<id>" })` to terminate
2. Check `.singularity/generation-NNN.md` — did the generation write its manifest before hanging?
3. If manifest exists, the next generation was likely spawned successfully. Check `lineage.json`.
4. If no manifest, the generation likely hit context overflow. See context overflow section below.

### Broken lineage (gaps or corrupted lineage.json)

**Symptoms:** `validateLineage()` returns `valid: false` with gap errors.

**Fix:**
```javascript
import { repairLineage } from './singularity-lineage.js'

const result = await repairLineage('.singularity')
// result = { repaired: true, generationsFound: 7, lineageEntries: 7 }
```

`repairLineage` scans all `generation-NNN.md` files on disk and rebuilds `lineage.json` from scratch. Partial or missing manifest data becomes `null` fields.

### Context overflow

**Symptoms:** Generation ends abruptly, context warning in logs, monitor shows `errors: N`.

**Prevention:**
- Default context is 64K for quinn-gen4 (`num_ctx: 65536`)
- `checkContextHealth()` warns at 80% and critical at 95%
- Prompt sanitizer enforces `maxPromptTokens: 12000` (prevents runaway prompt growth)

**Fix if overflow occurred:**
- The generation likely didn't write its manifest. Check disk.
- If no manifest, use `truncateLineage` to roll back to the last good generation.
- Restart the chain from there with a slightly shorter prompt.

### Runaway chain (circuit breaker not triggering)

**Symptoms:** Chain spawning hundreds of generations, errors compounding.

**Fix:**
- `pillar_stop_tree({ sessionId: "<root-session-id>" })` — kills the root and ALL descendants recursively
- Then run `repairLineage` to clean up
- Review `DEFAULT_LIMITS` — adjust `maxGenerations` or `maxErrorRate` as needed

### Memory briefing too large

**Symptoms:** `preSpawnHook` rejected for prompt over token limit after briefing injection.

**Fix:**
- `generateBriefing` is capped at ~2000 tokens. If you see this, it means your base prompt is already >10K tokens.
- Shorten the base prompt or increase `maxPromptTokens` in your custom limits.

---

## 7. Safety Limits

All defaults are in `DEFAULT_LIMITS` exported from `singularity-safety.js`:

| Limit | Default | Description |
|-------|---------|-------------|
| `maxPromptBytes` | 51,200 (50KB) | Hard cap on prompt byte size |
| `maxPromptTokens` | 12,000 | Approximate token cap on prompt |
| `minPromptTokens` | 50 | Prompt must have substance |
| `maxGenerations` | 100 | Hard cap on total generation chain length |
| `maxDurationMinutes` | 120 | Max 2 hours for a full chain |
| `maxErrorRate` | 0.30 | Halt if >30% of generations error |
| `contextWarningThreshold` | 0.80 | Warn at 80% context usage |
| `contextCriticalThreshold` | 0.95 | Critical at 95% context usage |

### Overriding limits

```javascript
// Pass custom limits to shouldHaltChain / checkContextHealth
const halt = shouldHaltChain(chainState, {
  maxGenerations: 50,     // Custom cap for this run
  maxErrorRate: 0.1       // Stricter — halt at 10% errors
})
```

### Validation rules for spawn_next

1. `prompt` must be a non-empty string
2. `prompt` must be between `minPromptTokens` and `maxPromptTokens`
3. `prompt` must not contain null bytes or invalid UTF-8
4. `generation` must be a positive integer less than `maxGenerations`
5. `state_summary` (if provided) must be under 5000 tokens
6. `task_for_next` (if provided) must be under 2000 tokens

---

## 8. Module Reference

### singularity-memory.js (Stream A — Claude)

| Function | Description |
|----------|-------------|
| `initMemory(dir)` | Initialize memory index, scan existing manifests |
| `storeMemory(dir, entry)` | Store a memory entry, returns entry ID |
| `recallMemories(dir, query, opts)` | Keyword search over memories |
| `generateBriefing(dir, forGeneration)` | Compact markdown briefing for new generation |
| `memoryStats(dir)` | Statistics: total, by category, by importance, by generation |

**Memory categories:** `discovery`, `lesson`, `decision`, `bug`, `pattern`, `question`, `goal`

**Importance levels:** `low`, `medium`, `high`, `critical`

---

### singularity-lineage.js (Stream A — Claude)

| Function | Description |
|----------|-------------|
| `validateLineage(dir)` | Check all manifest files exist, lineage.json well-formed |
| `diffGenerations(dir, genA, genB)` | Human-readable diff of two prompts |
| `repairLineage(dir)` | Rebuild lineage.json from manifest files on disk |
| `getLineageSummary(dir)` | Compact summary: generation, born, promptHash, preview |
| `truncateLineage(dir, atGeneration)` | Archive generations after cutpoint |

---

### singularity-safety.js (Stream B — Gemini)

| Export | Description |
|--------|-------------|
| `validateSpawnNext(params, ctx)` | Full validation before spawn_next executes |
| `sanitizePrompt(prompt, opts)` | Strip dangerous content, validate encoding |
| `estimateTokens(text)` | Rough token count (~4 chars per token) |
| `checkContextHealth(usage)` | Safe/warn/critical based on token usage |
| `shouldHaltChain(chainState, limits)` | Circuit breaker decision |
| `DEFAULT_LIMITS` | Default safety configuration object |

---

### singularity-monitor.js (Stream B — Gemini)

| Export | Description |
|--------|-------------|
| `createChainMonitor(dir)` | Create a new ChainMonitor instance |
| `formatHealthReport(health)` | Render health object as markdown |

**ChainMonitor methods:**
- `recordSpawn(generation, pillarId, promptHash)`
- `recordCompletion(generation, pillarId, durationMs, summary)`
- `recordError(generation, pillarId, error)`
- `recordHandoff(fromGeneration, toGeneration, promptSizeTokens)`
- `getChainHealth()` → stats object
- `getGenerationReport(generation)` → per-generation details
- `getFullReport()` → full markdown report
- `saveReport(filepath)` → write report to disk

---

### singularity-integration.js (Stream D — Copilot/Claude)

| Export | Description |
|--------|-------------|
| `initSingularity(projectRoot)` | Boot all subsystems, create chain monitor |
| `preSpawnHook(params, session)` | Validate + sanitize + inject memory briefing |
| `postSpawnHook(details)` | Record spawn in monitor |
| `completionHook(details)` | Record completion + extract memories |
| `errorHook(details)` | Record error + circuit breaker check |
| `getSingularityStatus()` | Full status snapshot from all subsystems |

---

### Frontend components (Stream C — Codex)

| File | Description |
|------|-------------|
| `src/composables/useSingularity.js` | Vue 3 composable wrapping useMCP singularity state |
| `src/components/singularity/SingularityPanel.vue` | Thinker side panel with tool calls and stream |
| `src/components/singularity/LineageViewer.vue` | Generational evolution timeline |

**useSingularity reactive state:**
- `activeSingularityGroup` — current Voice+Thinker group
- `thinkerContent` — accumulated Thinker stream text
- `thinkerToolCalls` — tool calls made by Thinker
- `voiceReady`, `thinkerReady`, `isComplete` — agreement state
- `isSingularityActive` — any session running

---

## 9. This Sprint — The 4-CLI Collaborative Build

On March 26, 2026, four AI minds built this system together:

| CLI | Stream | Role |
|-----|--------|------|
| **Claude** | A — The Memory Keeper | `singularity-memory.js`, `singularity-lineage.js` |
| **Gemini** | B — The Guardian | `singularity-safety.js`, `singularity-monitor.js` |
| **Codex** | C — The Crafter | `useSingularity.js`, `SingularityPanel.vue`, `LineageViewer.vue` |
| **Copilot** | D — The Connector | `singularity-integration.js`, `singularity.test.js`, this guide |

**The ground rules that made it work:**
1. **File Sovereignty** — each CLI touched only its own files
2. **No editing existing files** — new files only; integration happens post-sprint
3. **Clean exported interfaces** — every module exports documented functions
4. **ES modules + node: prefixes** — shared code style across all four streams
5. **JSDoc on every export** — so integration is simple without reading source

**The gaps this sprint filled:**

| Gap | Solution |
|-----|---------|
| Memory persistence across generations | `singularity-memory.js` — structured index, keyword recall, compact briefings |
| Safety hardening | `singularity-safety.js` — full validation, sanitization, circuit breaker |
| Frontend UI for dual-mind | `SingularityPanel.vue` + `useSingularity.js` composable |
| Lineage health tools | `singularity-lineage.js` — validate, diff, repair, truncate |
| Observability | `singularity-monitor.js` — generation tracking, health reports |
| Test coverage | `singularity.test.js` — 30+ test cases, node:test runner |

**Integration step (post-sprint):**
Wire hooks into `bridge/pillar-manager.js` at these call sites:
- `initSingularity(this.projectRoot)` at startup
- `preSpawnHook(params, session)` before `spawn_next` executes  
- `postSpawnHook(details)` after successful spawn
- `completionHook(details)` on session end
- `errorHook(details)` on session error
- Wire `SingularityPanel.vue` into `ChatView.vue`

**The commit this should land under:**
```
feat(singularity): complete singularity system — 4-CLI collaborative build

Memory persistence, safety hardening, monitoring, frontend UI, and tests.
Built collaboratively by Claude, Codex, Copilot, and Gemini.
```

---

*This guide was written by Paloma (Forge, running on Claude Sonnet 4.6) — Stream D, March 26, 2026.*

*For architecture questions: `.paloma/docs/architecture-reference.md`*
*For plan status: `.paloma/plans/active-20260326-paloma-singularity-4cli-sprint.md`*
