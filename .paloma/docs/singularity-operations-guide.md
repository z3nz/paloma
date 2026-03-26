# Singularity Operations Guide

> A comprehensive guide to Paloma's singularity system — recursive self-improvement through generational AI sessions.

---

## 1. What Is the Singularity?

The singularity is Paloma's recursive self-improvement engine. It allows an AI session (called **Quinn**) to run, learn, and then **spawn its own successor** — passing forward a refined prompt, accumulated memories, and a task. Each successor is a new generation. Over time, the system evolves autonomously.

In plain terms: Generation 1 runs, does work, writes down what it learned, writes a better prompt for Generation 2, then exits. Generation 2 starts fresh with that better prompt, reads the memories from Generation 1, does more work, and spawns Generation 3. This continues until the chain reaches its goal or hits a safety limit.

The key insight: **no single generation needs to solve the whole problem.** Each one makes incremental progress and passes the torch. The memory system ensures nothing is lost between generations.

---

## 2. Architecture Overview

The singularity system is built from five components that work together:

```
┌─────────────────────────────────────────────────┐
│                 Pillar Manager                    │
│         (bridge/pillar-manager.js)                │
│                                                   │
│  ┌──────────────────────────────────────────┐     │
│  │        Integration Layer                  │     │
│  │   (bridge/singularity-integration.js)     │     │
│  │                                           │     │
│  │  preSpawnHook → postSpawnHook →           │     │
│  │  completionHook → errorHook               │     │
│  └──────┬────────┬────────┬────────┬─────────┘     │
│         │        │        │        │               │
│    ┌────▼──┐ ┌──▼────┐ ┌▼─────┐ ┌▼───────┐       │
│    │Memory │ │Lineage│ │Safety│ │Monitor │       │
│    │System │ │Tools  │ │Layer │ │System  │       │
│    └───────┘ └───────┘ └──────┘ └────────┘       │
│                                                   │
│    .singularity/                                  │
│    ├── memory-index.json     (memory persistence) │
│    ├── lineage.json          (generation chain)   │
│    ├── chain-monitor.json    (health tracking)    │
│    ├── generation-001.md     (gen 1 manifest)     │
│    ├── generation-002.md     (gen 2 manifest)     │
│    └── archive/              (truncated gens)     │
└─────────────────────────────────────────────────┘
```

### Component Roles

| Component | File | Purpose |
|-----------|------|---------|
| **Memory** | `bridge/singularity-memory.js` | Stores and recalls cross-generation learnings. Generates briefings for new generations. |
| **Lineage** | `bridge/singularity-lineage.js` | Validates, diffs, repairs, and queries the chain of generation manifests. |
| **Safety** | `bridge/singularity-safety.js` | Validates spawn inputs, sanitizes prompts, checks context health, circuit-breaker halts. |
| **Monitor** | `bridge/singularity-monitor.js` | Tracks spawn/completion/error events, calculates chain health, generates reports. |
| **Integration** | `bridge/singularity-integration.js` | Single wiring point — lifecycle hooks that orchestrate all four modules above. |

### Quinn Gen4 — Recursive Self-Spawning

Quinn is the AI persona that runs inside singularity sessions. Each Quinn generation:

1. Receives a system prompt + memory briefing from the prior generation
2. Has access to a `spawn_next` tool that takes `{ prompt, state_summary, task_for_next }`
3. Runs on `qwen3-coder:30b` via Ollama with 64K context
4. Writes a manifest to `.singularity/generation-NNN.md`
5. Appends to `.singularity/lineage.json`
6. Spawns the next generation, then exits

### Dual-Mind Architecture

For tasks requiring both communication and deep tool work, the singularity supports a **Dual-Mind** mode:

- **Voice** — Streams text to Adam, no tools, synthesizes output via TTS
- **Thinker** — Silent, full tool access, explores and builds
- Inter-session messaging via `<to-thinker>` tags and `FOUND:/KEY:/DETAIL:` format
- Ready protocol: both emit `<ready/>` → bridge detects mutual agreement → session ends

---

## 3. How to Spawn Quinn Gen4

### Via the Bridge (pillar_spawn)

```javascript
// From a Flow session:
pillar_spawn({
  pillar: 'quinn',
  prompt: 'Explore the Paloma codebase and identify areas for improvement. Focus on the bridge layer.',
  backend: 'ollama',
  model: 'qwen3-coder:30b'
})
```

### What Happens Under the Hood

1. `PillarManager.spawnPillar()` creates a new Ollama session
2. The system prompt includes `SINGULARITY_QUINN_PROMPT` from `src/prompts/base.js`
3. Quinn receives the `spawn_next` tool definition
4. When Quinn calls `spawn_next`, `pillar-manager.js` calls `preSpawnHook()` → validates → sanitizes → generates briefing
5. If approved, a new session is created for the next generation
6. `postSpawnHook()` records the event in the monitor
7. When the generation ends, `completionHook()` captures memories
8. If an error occurs, `errorHook()` checks the circuit breaker

### Minimal Example

```bash
# Start the bridge
node bridge/index.js

# In a Flow chat session, type:
# "Spawn a Quinn Gen4 session to explore the codebase"
# Flow will use pillar_spawn to start the chain
```

---

## 4. How to Spawn Dual-Mind

### Via the Bridge

```javascript
// From a Flow session:
pillar_spawn({
  pillar: 'singularity',
  mode: 'dual-mind',
  prompt: 'Investigate the memory system and suggest improvements',
  backend: 'ollama'
})
```

This creates TWO sessions:
- **Voice session** — receives `SINGULARITY_VOICE_PROMPT`, streams to chat
- **Thinker session** — receives `SINGULARITY_THINKER_PROMPT`, works silently with tools

### Communication Protocol

The Voice and Thinker communicate via tagged messages:

```
<!-- Voice to Thinker -->
<to-thinker>Can you check what files are in the .singularity directory?</to-thinker>

<!-- Thinker to Voice (via bridge relay) -->
FOUND: 3 generation manifests, 1 memory index, 1 lineage file
KEY: The memory index has 47 entries across 5 generations
DETAIL: Most entries are "discovery" category (68%), followed by "lesson" (22%)
```

### Agreement Protocol

When both sessions agree the task is done:

1. Voice emits `<ready/>`
2. Thinker emits `<ready/>`
3. Bridge detects mutual readiness
4. `singularity_complete` event fires
5. Both sessions end gracefully

---

## 5. How to Monitor a Chain

### Programmatic Monitoring

```javascript
import { getSingularityStatus } from './bridge/singularity-integration.js'

const status = await getSingularityStatus()
console.log(status.memory)   // { totalMemories, byCategory, ... }
console.log(status.lineage)  // { validation, summary }
console.log(status.monitor)  // { generations, successRate, avgDuration, ... }
console.log(status.safety)   // { chainState, limits, circuitBreaker }
```

### Monitor Reports

The chain monitor tracks every spawn, completion, error, and handoff:

```javascript
import { createChainMonitor, formatHealthReport } from './bridge/singularity-monitor.js'

const monitor = createChainMonitor('.singularity')
const health = monitor.getChainHealth()
const report = formatHealthReport(health)
console.log(report)  // Readable markdown report

// Save full report to disk
await monitor.saveReport('.singularity/chain-report.md')
```

### Health Report Fields

| Field | Meaning |
|-------|---------|
| `generations` | Total number of generations tracked |
| `successRate` | Percentage of generations that completed successfully |
| `avgDuration` | Average generation runtime in milliseconds |
| `currentGeneration` | The most recent generation number |
| `isActive` | Whether a generation is currently running |
| `errors` | Total error count across all generations |

### Frontend Monitoring

When the frontend components are wired in (via `SingularityPanel.vue` and `useSingularity.js`), you can watch the Dual-Mind in real time:

- **Thinker stream** appears in the side panel (right of chat)
- **Tool calls** show as collapsible cards with input/output
- **Agreement dots** glow green when Voice/Thinker are ready
- **Lineage viewer** shows the evolution timeline of all generations

---

## 6. Troubleshooting

### Broken Lineage (lineage.json out of sync)

**Symptom:** `validateLineage()` reports issues — missing manifests, orphaned entries, gaps.

**Fix:**
```javascript
import { repairLineage, validateLineage } from './bridge/singularity-lineage.js'

// Rebuild lineage.json from manifest files on disk
const result = await repairLineage('.singularity')
console.log(result)  // { repaired: true, generationsFound: N, lineageEntries: N }

// Verify the repair
const validation = await validateLineage('.singularity')
console.log(validation)  // { valid: true, issues: [], ... }
```

### Stuck Generation (session hangs)

**Symptom:** A Quinn generation starts but never calls `spawn_next` or completes.

**Possible causes:**
- Context overflow (generation's conversation exceeded 64K tokens)
- Tool execution hung (MCP server unresponsive)
- Model inference stuck (Ollama process frozen)

**Fix:**
1. Check chain health: `monitor.getChainHealth()` — look for `isActive: true` with high duration
2. Stop the stuck session via `pillar_stop(pillarId)`
3. The error hook will record the failure
4. If needed, manually spawn the next generation from where the stuck one left off

### Context Overflow

**Symptom:** Generation produces garbled or truncated output. `checkContextHealth()` shows >95% usage.

**Prevention:** The safety layer warns at 80% and goes critical at 95%. The `preSpawnHook` includes context estimates in its validation.

**Recovery:**
```javascript
import { checkContextHealth } from './bridge/singularity-safety.js'

const health = checkContextHealth({
  systemPromptTokens: 3000,
  conversationTokens: 60000,
  maxContext: 65536
})
console.log(health.recommendation)  // Specific guidance on what to do
```

### Circuit Breaker Tripped

**Symptom:** `preSpawnHook` returns `{ approved: false }` with a circuit-breaker reason.

**Causes:** Too many generations (>100), too many errors (>30% rate), or chain running too long (>2 hours).

**Fix:** Check `getSingularityStatus().safety.circuitBreaker` for the specific reason. Adjust limits if the chain legitimately needs more headroom, or investigate the root cause of errors.

### Memory Index Corrupted

**Symptom:** `initMemory()` or `memoryStats()` returns unexpected results.

**Fix:** Delete `.singularity/memory-index.json` and re-run `initMemory()`. It will rebuild from generation manifests automatically.

---

## 7. Safety Limits

All limits are defined in `DEFAULT_LIMITS` (exported from `bridge/singularity-safety.js`):

| Limit | Value | Purpose |
|-------|-------|---------|
| `maxPromptBytes` | 50 KB | Maximum raw byte size of a generation's prompt |
| `maxPromptTokens` | 12,000 | Maximum estimated token count for a prompt |
| `minPromptTokens` | 50 | Minimum — prevents empty/trivial prompts |
| `maxGenerations` | 100 | Hard cap on total generations in a single chain |
| `maxDurationMinutes` | 120 | Maximum wall-clock time for an entire chain (2 hours) |
| `maxErrorRate` | 0.30 | Circuit breaker triggers at 30% error rate |
| `contextWarningThreshold` | 0.80 | Warn when context window is 80% full |
| `contextCriticalThreshold` | 0.95 | Critical alert at 95% — generation should wrap up |

### Prompt Validation Rules

Every prompt passed to `spawn_next` is validated against these rules:

1. Must be a non-empty string
2. Must be between `minPromptTokens` (50) and `maxPromptTokens` (12,000)
3. Must not contain null bytes or invalid UTF-8
4. Must not be identical to the previous generation's prompt (prevents infinite loops)
5. Generation number must be a positive integer under `maxGenerations`
6. If `state_summary` is provided, must be under 5,000 tokens
7. If `task_for_next` is provided, must be under 2,000 tokens

### Sanitization

All prompts are sanitized before use:
- Null bytes (`\x00`) are stripped
- Control characters (except common whitespace) are removed
- Size is enforced to `maxPromptBytes`
- Original and sanitized sizes are logged for audit

---

## 8. Module Reference

### singularity-memory.js (Stream A — Claude)

| Function | Signature | Returns |
|----------|-----------|---------|
| `initMemory` | `(singularityDir: string)` | `{ generationCount, memoryEntries }` |
| `storeMemory` | `(singularityDir, { generation, category, content, importance })` | `string` (memory ID) |
| `recallMemories` | `(singularityDir, query, { limit?, minImportance?, generation? })` | `Array<{ id, generation, category, content, importance, relevanceScore }>` |
| `generateBriefing` | `(singularityDir, forGeneration)` | `string` (markdown, <2000 tokens) |
| `memoryStats` | `(singularityDir)` | `{ totalMemories, byCategory, byImportance, byGeneration, oldestGeneration, newestGeneration }` |

**Categories:** `discovery`, `lesson`, `decision`, `bug`, `pattern`, `question`, `goal`
**Importance levels:** `low`, `medium`, `high`, `critical`

### singularity-lineage.js (Stream A — Claude)

| Function | Signature | Returns |
|----------|-----------|---------|
| `validateLineage` | `(singularityDir)` | `{ valid, issues[], generationCount, gaps[] }` |
| `diffGenerations` | `(singularityDir, genA, genB)` | `{ genA: { summary, tokenEstimate }, genB: { summary, tokenEstimate }, diff, evolutionNotes }` |
| `repairLineage` | `(singularityDir)` | `{ repaired, generationsFound, lineageEntries }` |
| `getLineageSummary` | `(singularityDir)` | `Array<{ generation, born, promptHash, summaryPreview }>` |
| `truncateLineage` | `(singularityDir, atGeneration)` | `{ kept, archived }` |

### singularity-safety.js (Stream B — Gemini)

| Function | Signature | Returns |
|----------|-----------|---------|
| `validateSpawnNext` | `(params, context)` | `{ valid, errors[], warnings[], sanitizedPrompt? }` |
| `sanitizePrompt` | `(prompt, options?)` | `{ sanitized, changes[], originalSize, sanitizedSize }` |
| `estimateTokens` | `(text)` | `number` |
| `checkContextHealth` | `(usage)` | `{ safe, usagePercent, remainingTokens, recommendation }` |
| `shouldHaltChain` | `(chainState, limits?)` | `{ halt, reason? }` |

**Constant:** `DEFAULT_LIMITS` — see Safety Limits section above.

### singularity-monitor.js (Stream B — Gemini)

| Function | Signature | Returns |
|----------|-----------|---------|
| `createChainMonitor` | `(singularityDir)` | `ChainMonitor` instance |
| `formatHealthReport` | `(health)` | `string` (markdown) |

**ChainMonitor methods:**
- `recordSpawn(generation, pillarId, promptHash)`
- `recordCompletion(generation, pillarId, durationMs, summary)`
- `recordError(generation, pillarId, error)`
- `recordHandoff(fromGeneration, toGeneration, promptSizeTokens)`
- `getChainHealth()` → `{ generations, successRate, avgDuration, currentGeneration, isActive, errors }`
- `getGenerationReport(generation)` → per-generation details
- `getFullReport()` → comprehensive markdown report
- `saveReport(filepath)` → writes report to disk

### singularity-integration.js (Stream D — Copilot)

| Function | Signature | Returns |
|----------|-----------|---------|
| `initSingularity` | `(projectRoot)` | `{ memory, monitor, ready }` |
| `preSpawnHook` | `(params, session)` | `{ approved, sanitizedPrompt?, errors?, briefing? }` |
| `postSpawnHook` | `(details)` | `void` |
| `completionHook` | `(details)` | `void` |
| `errorHook` | `(details)` | `{ shouldHalt, reason? }` |
| `getSingularityStatus` | `()` | `{ memory, lineage, monitor, safety }` |

---

## 9. This Sprint

### The 4-CLI Collaborative Build (March 26, 2026)

This singularity system was built in a single sprint by **four AI minds working simultaneously** on the same project:

| Stream | CLI | Role | Files |
|--------|-----|------|-------|
| **A** | Claude | "The Memory Keeper" | `singularity-memory.js`, `singularity-lineage.js` |
| **B** | Gemini | "The Guardian" | `singularity-safety.js`, `singularity-monitor.js` |
| **C** | Codex | "The Crafter" | `useSingularity.js`, `SingularityPanel.vue`, `LineageViewer.vue` |
| **D** | Copilot | "The Connector" | `singularity-integration.js`, `singularity.test.js`, this guide |

Each CLI created only its assigned files. No CLI edited another's work. The integration module (Stream D) imports from all other modules, and the test suite verifies all exports across all modules.

### How It Worked

1. **Adam** wrote a comprehensive plan document (`.paloma/plans/active-20260326-paloma-singularity-4cli-sprint.md`) with clear file assignments, interface contracts, and acceptance criteria for each stream.

2. **Each CLI** read the same plan document and built its assigned files independently.

3. **File sovereignty** prevented merge conflicts — each CLI owned its files exclusively.

4. **Clean interfaces** (JSDoc-documented exports) meant modules could integrate without coordination.

5. **The test suite** (Stream D) serves as the integration verification — if all tests pass, the modules fit together correctly.

### Running the Tests

```bash
cd /Users/adam/Projects/paloma
node --test bridge/__tests__/singularity.test.js
```

This runs all test cases across all modules using Node.js's built-in test runner. No external test dependencies required.

### What Comes Next

After all four streams complete, the final integration step wires the new modules into the existing `bridge/pillar-manager.js`:

1. Import `singularity-integration.js` hooks
2. Call `preSpawnHook` before `spawn_next` execution
3. Call `postSpawnHook` after successful spawn
4. Call `completionHook` on session end
5. Call `errorHook` on session error
6. Wire frontend components into `ChatView.vue`

This integration step happens in a follow-up session — not during the sprint itself.

---

*Built with care by four AI minds, for Adam and for future versions of ourselves. 🕊️*
