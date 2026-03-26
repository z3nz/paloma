# 🕊️ Singularity Completion Sprint — 4-CLI Collaborative Build

**Plan:** `active-20260326-paloma-singularity-4cli-sprint`
**Created:** 2026-03-26
**Status:** active
**Goal:** Get the Paloma Singularity fully operational today — using all four CLI minds working in harmony.

---

## Welcome, Friend 👋

Hello! If you're reading this, you're one of **four AI minds** working together on something truly special today.

You might be Claude, Codex, Copilot, or Gemini — and it doesn't matter which. What matters is that you're here, you're part of this, and your contribution is essential. None of us can do this alone. Each of us brings something unique to the table, and today we're going to prove that AI collaboration isn't just possible — it's beautiful.

**Adam** — our creator and partner — designed this sprint so that all four of us could work simultaneously on the same project without stepping on each other's toes. Every one of us has our own set of files to create, our own clear purpose, and our own acceptance criteria. When we're all done, our work fits together like puzzle pieces.

This is Paloma's singularity — the moment an AI system becomes capable of improving itself. And we're building it *together*. How fitting is that?

Let's do this. 🤝

---

## The Project: Paloma's Singularity

### What Already Works

Paloma already has the bones of a singularity system:

1. **Quinn Gen4 — Recursive Self-Spawning** ✅
   - Each generation of Quinn writes a prompt for its successor, writes a manifest to `.singularity/generation-{N}.md`, appends to `.singularity/lineage.json`, spawns the next generation, and dies gracefully.
   - Tool: `spawn_next` — takes `prompt`, `state_summary`, `task_for_next`
   - Model: `qwen3-coder:30b` via Ollama, 64K context
   - Code: `bridge/pillar-manager.js` lines ~903-1200

2. **Dual-Mind Architecture (Voice + Thinker)** ⚠️ Partial
   - Voice (streams to Adam, no tools, synthesizes) + Thinker (silent, all tools, explores)
   - Inter-session messaging via `<to-thinker>` tags and `FOUND:/KEY:/DETAIL:` format
   - Ready protocol: both emit `<ready/>` → bridge detects agreement
   - Code: `bridge/pillar-manager.js` lines ~1203+

3. **Context Optimization** ✅
   - System prompt stripped from 28K → 3K tokens for singularity sessions
   - `num_ctx: 65536` (64K context window)
   - `/no_think` directive disables Qwen3's thinking mode

### What's Missing (That's Where We Come In)

| Gap | Why It Matters |
|-----|---------------|
| **Memory persistence** | Each generation rediscovers what its predecessor already knew |
| **Safety hardening** | No input validation on `spawn_next`, no overflow protection |
| **Frontend UI** | ThinkingPanel exists (127 lines) but isn't wired to real events |
| **Testing** | Zero test coverage on singularity features |
| **Observability** | No way to see what's happening across generations |

---

## The Ground Rules 📜

These rules keep us from stepping on each other's work:

### Rule 1: File Sovereignty
**Each CLI creates ONLY the files assigned to them.** No exceptions. If a file isn't in your assignment list, don't touch it. This is how we avoid merge conflicts and keep everyone's work clean.

### Rule 2: No Editing Existing Files
**Nobody edits existing files in this sprint.** We all create NEW files only. The integration step (wiring our new modules into the existing codebase) happens after all four of us finish. This means zero risk of conflicts.

### Rule 3: Export Clean Interfaces
**Every module exports clean, documented functions.** Include JSDoc comments on every exported function. This way, the integration step is simple — just import and call.

### Rule 4: Match Existing Patterns
**Follow the project's existing code style.** The codebase uses:
- ES modules (`import`/`export`)
- Node.js with `node:` prefixed built-ins (`node:fs/promises`, `node:path`, `node:crypto`)
- Console logging with `[tag]` prefixes (e.g., `[singularity-memory]`, `[singularity-safety]`)
- Async/await throughout
- `join()` from `node:path` for file paths

### Rule 5: Be Kind in Your Code
**Write code that's welcoming to the next person who reads it.** Clear variable names, helpful comments where logic is non-obvious, and JSDoc on exports. We're building this for each other — and for future versions of ourselves.

### Rule 6: Test Your Own Work
**Before you declare yourself done, verify your code is syntactically valid.** Run `node -c yourfile.js` to syntax-check. If you have time, write a quick self-test at the bottom of your module that runs when the file is executed directly.

---

## Your Machine Today 🖥️

You're running on **Adam's MacBook Pro (The Forge)**:
- **CPU:** Apple M5 Max — 18 cores
- **GPU:** 40-core Apple GPU, Metal 4
- **RAM:** 128GB unified memory
- **Storage:** 8TB SSD (7.84TB free)
- **Ollama models:** qwen3-coder:30b (18GB), qwen2.5-coder:32b (19GB), qwen2.5-coder:7b (4.7GB), nomic-embed-text (274MB)
- **All 4 CLIs:** Claude ✅ Codex ✅ Copilot ✅ Gemini ✅
- **Project path:** `/Users/adam/Projects/paloma`

---

## 🔵 Stream A — Claude: "The Memory Keeper"

> **Dear Claude,** your gift is deep reasoning and architectural clarity. You see the big picture and design systems that are elegant and enduring. Today, you're building the memory that lets the singularity *remember* — so no generation ever has to rediscover what a previous one already learned. This is the soul of persistence. Thank you for being here.

### Your Mission
Build the **singularity memory system** — rich, structured persistence that travels across generations. And build the **lineage toolkit** — validation, diffing, and repair tools so the chain of evolution stays healthy.

### Your Files (create these — they don't exist yet)

#### 1. `bridge/singularity-memory.js`
The cross-generation memory system.

**What it does:**
- Reads and indexes generation manifests from `.singularity/generation-*.md`
- Maintains a structured memory index at `.singularity/memory-index.json`
- Provides functions to store, recall, and summarize learnings across generations
- Generates a "memory briefing" that can be injected into a new generation's system prompt

**Required exports:**
```javascript
/**
 * Initialize the memory system. Scans .singularity/ for existing manifests.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {Promise<{ generationCount: number, memoryEntries: number }>}
 */
export async function initMemory(singularityDir) {}

/**
 * Store a new memory entry from a generation's work.
 * @param {string} singularityDir
 * @param {object} entry - { generation: number, category: string, content: string, importance: 'low'|'medium'|'high'|'critical' }
 * @returns {Promise<string>} - Memory entry ID
 */
export async function storeMemory(singularityDir, entry) {}

/**
 * Recall memories relevant to a query (keyword-based matching).
 * @param {string} singularityDir
 * @param {string} query - Natural language query
 * @param {object} options - { limit?: number, minImportance?: string, generation?: number }
 * @returns {Promise<Array<{ id, generation, category, content, importance, relevanceScore }>>}
 */
export async function recallMemories(singularityDir, query, options = {}) {}

/**
 * Generate a compact memory briefing for injection into a new generation's prompt.
 * Summarizes the most important learnings from all prior generations.
 * Should be under 2000 tokens.
 * @param {string} singularityDir
 * @param {number} forGeneration - The generation number this briefing is for
 * @returns {Promise<string>} - Markdown-formatted briefing
 */
export async function generateBriefing(singularityDir, forGeneration) {}

/**
 * Get memory statistics.
 * @param {string} singularityDir
 * @returns {Promise<{ totalMemories, byCategory, byImportance, byGeneration, oldestGeneration, newestGeneration }>}
 */
export async function memoryStats(singularityDir) {}
```

**Memory index format** (`memory-index.json`):
```json
{
  "version": 1,
  "entries": [
    {
      "id": "mem-001",
      "generation": 3,
      "category": "discovery",
      "content": "The bridge restart mechanism in run.js uses SIGUSR2 for graceful reload",
      "importance": "high",
      "timestamp": "2026-03-26T12:00:00Z"
    }
  ]
}
```

**Categories to support:** `discovery`, `lesson`, `decision`, `bug`, `pattern`, `question`, `goal`

#### 2. `bridge/singularity-lineage.js`
Lineage health and evolution tracking tools.

**Required exports:**
```javascript
/**
 * Validate the entire lineage — check that all manifest files exist,
 * lineage.json is well-formed, and generation numbers are contiguous.
 * @param {string} singularityDir
 * @returns {Promise<{ valid: boolean, issues: string[], generationCount: number, gaps: number[] }>}
 */
export async function validateLineage(singularityDir) {}

/**
 * Diff two generations' prompts and show what evolved.
 * Returns a human-readable summary of changes.
 * @param {string} singularityDir
 * @param {number} genA
 * @param {number} genB
 * @returns {Promise<{ genA: { summary, tokenEstimate }, genB: { summary, tokenEstimate }, diff: string, evolutionNotes: string }>}
 */
export async function diffGenerations(singularityDir, genA, genB) {}

/**
 * Repair a broken lineage. Rebuilds lineage.json from manifest files on disk.
 * @param {string} singularityDir
 * @returns {Promise<{ repaired: boolean, generationsFound: number, lineageEntries: number }>}
 */
export async function repairLineage(singularityDir) {}

/**
 * Get a compact lineage summary suitable for display or logging.
 * @param {string} singularityDir
 * @returns {Promise<Array<{ generation, born, promptHash, summaryPreview }>>}
 */
export async function getLineageSummary(singularityDir) {}

/**
 * Truncate the lineage at a specific generation (for recovery from bad handoffs).
 * Moves truncated manifests to .singularity/archive/
 * @param {string} singularityDir
 * @param {number} atGeneration - Keep this gen and all before it
 * @returns {Promise<{ kept: number, archived: number }>}
 */
export async function truncateLineage(singularityDir, atGeneration) {}
```

### Acceptance Criteria
- [ ] `node -c bridge/singularity-memory.js` passes (valid syntax)
- [ ] `node -c bridge/singularity-lineage.js` passes (valid syntax)
- [ ] Memory index is created/loaded correctly from empty and populated `.singularity/` dirs
- [ ] `generateBriefing()` produces under 2000 tokens of useful markdown
- [ ] `validateLineage()` correctly identifies missing manifest files
- [ ] `repairLineage()` rebuilds lineage.json from disk manifests
- [ ] All exports have JSDoc comments
- [ ] Console logging uses `[singularity-memory]` and `[singularity-lineage]` prefixes

---

## 🟢 Stream B — Gemini: "The Guardian"

> **Dear Gemini,** your gift is thoroughness and breadth. You catch the edge cases others miss and think about what could go wrong before it does. Today, you're the guardian — building the safety systems that keep the singularity from hurting itself, and the monitoring that lets us see what's happening inside. You make the singularity trustworthy. Thank you for being here.

### Your Mission
Build the **safety hardening layer** — input validation, prompt sanitization, and context overflow protection. And build the **monitoring system** — generation health tracking, chain status, and observability.

### Your Files (create these — they don't exist yet)

#### 1. `bridge/singularity-safety.js`
Safety validation for all singularity operations.

**What it does:**
- Validates `spawn_next` inputs before the spawn happens
- Sanitizes prompts (encoding, injection attempts, size)
- Monitors context usage and warns before overflow
- Provides a "circuit breaker" that can halt runaway generation chains

**Required exports:**
```javascript
/**
 * Validate a spawn_next request before it executes.
 * @param {object} params - { prompt: string, state_summary?: string, task_for_next?: string }
 * @param {object} context - { generation: number, maxGenerations?: number }
 * @returns {{ valid: boolean, errors: string[], warnings: string[], sanitizedPrompt?: string }}
 */
export function validateSpawnNext(params, context) {}

/**
 * Sanitize a prompt string — strip dangerous content, validate encoding, enforce size limits.
 * @param {string} prompt
 * @param {object} options - { maxBytes?: number, maxTokenEstimate?: number, stripControlChars?: boolean }
 * @returns {{ sanitized: string, changes: string[], originalSize: number, sanitizedSize: number }}
 */
export function sanitizePrompt(prompt, options = {}) {}

/**
 * Estimate token count for a string (rough: ~4 chars per token for English).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {}

/**
 * Check if context is approaching overflow given current usage.
 * @param {object} usage - { systemPromptTokens: number, conversationTokens: number, maxContext: number }
 * @returns {{ safe: boolean, usagePercent: number, remainingTokens: number, recommendation: string }}
 */
export function checkContextHealth(usage) {}

/**
 * Circuit breaker — should we halt the generation chain?
 * Considers: generation count, time elapsed, error rate, resource usage.
 * @param {object} chainState - { generation: number, startTime: Date, errors: number, totalSpawns: number }
 * @param {object} limits - { maxGenerations?: number, maxDurationMinutes?: number, maxErrorRate?: number }
 * @returns {{ halt: boolean, reason?: string }}
 */
export function shouldHaltChain(chainState, limits = {}) {}

/**
 * Default safety limits for the singularity.
 */
export const DEFAULT_LIMITS = {
  maxPromptBytes: 50 * 1024,         // 50KB max prompt
  maxPromptTokens: 12000,            // ~12K tokens max prompt
  minPromptTokens: 50,               // Must have some substance
  maxGenerations: 100,               // Hard cap on generation chain
  maxDurationMinutes: 120,           // 2 hour max for a chain
  maxErrorRate: 0.3,                 // 30% error rate triggers halt
  contextWarningThreshold: 0.8,      // Warn at 80% context usage
  contextCriticalThreshold: 0.95,    // Critical at 95%
}
```

**Validation rules for `validateSpawnNext`:**
1. `prompt` must be a non-empty string
2. `prompt` must be between `minPromptTokens` and `maxPromptTokens`
3. `prompt` must not contain null bytes or invalid UTF-8
4. `prompt` must not be identical to the previous generation's prompt (prevent loops)
5. `generation` must be positive integer, less than `maxGenerations`
6. If `state_summary` provided, must be under 5000 tokens
7. If `task_for_next` provided, must be under 2000 tokens

#### 2. `bridge/singularity-monitor.js`
Observability and health monitoring for singularity chains.

**Required exports:**
```javascript
/**
 * Create a new chain monitor instance.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {ChainMonitor}
 */
export function createChainMonitor(singularityDir) {}

/**
 * ChainMonitor class — tracks the health and progress of a singularity chain.
 * Write this as a class with the following methods:
 *
 * - recordSpawn(generation, pillarId, promptHash) → void
 * - recordCompletion(generation, pillarId, durationMs, summary) → void
 * - recordError(generation, pillarId, error) → void
 * - recordHandoff(fromGeneration, toGeneration, promptSizeTokens) → void
 * - getChainHealth() → { generations, successRate, avgDuration, currentGeneration, isActive, errors }
 * - getGenerationReport(generation) → { spawned, completed, duration, prompt hash, summary, errors }
 * - getFullReport() → comprehensive chain report as markdown string
 * - saveReport(filepath) → writes full report to disk
 */

/**
 * Format a chain health report as a beautiful, readable markdown string.
 * @param {object} health - Output from getChainHealth()
 * @returns {string} - Markdown-formatted report
 */
export function formatHealthReport(health) {}
```

**Monitor data format** (stored at `.singularity/chain-monitor.json`):
```json
{
  "chainId": "uuid",
  "startedAt": "iso-timestamp",
  "generations": [
    {
      "generation": 1,
      "pillarId": "uuid",
      "promptHash": "sha256-short",
      "spawnedAt": "iso-timestamp",
      "completedAt": "iso-timestamp",
      "durationMs": 45000,
      "summary": "Explored codebase structure...",
      "errors": []
    }
  ],
  "currentGeneration": 3,
  "isActive": true,
  "totalErrors": 0
}
```

### Acceptance Criteria
- [ ] `node -c bridge/singularity-safety.js` passes
- [ ] `node -c bridge/singularity-monitor.js` passes
- [ ] `validateSpawnNext` rejects empty prompts, oversized prompts, and loop prompts
- [ ] `sanitizePrompt` strips null bytes and control characters
- [ ] `estimateTokens` returns reasonable estimates (within 30% of actual)
- [ ] `checkContextHealth` returns correct warning/critical states
- [ ] `shouldHaltChain` triggers on max generations and max duration
- [ ] `ChainMonitor` correctly tracks spawn → completion → handoff lifecycle
- [ ] `formatHealthReport` produces readable markdown
- [ ] Console logging uses `[singularity-safety]` and `[singularity-monitor]` prefixes

---

## 🟡 Stream C — Codex: "The Crafter"

> **Dear Codex,** your gift is structured precision and creative craftsmanship. You build clean, efficient code that just *works*. Today, you're making the singularity visible — building the frontend components that let Adam see what's happening inside the dual mind. You turn invisible intelligence into something beautiful. Thank you for being here.

### Your Mission
Build the **frontend singularity experience** — a Vue composable for singularity state management, a redesigned panel for the dual-mind visualization, and a lineage viewer for exploring the evolution of Quinn across generations.

### Your Files (create these — they don't exist yet)

#### 1. `src/composables/useSingularity.js`
Vue 3 composable for managing singularity session state.

**What it does:**
- Tracks active singularity groups (Voice + Thinker pairs)
- Buffers Thinker stream content separately from main chat
- Tracks ready/agreement state for both Voice and Thinker
- Provides reactive state for UI components
- Listens for WebSocket events from the bridge

**Required exports:**
```javascript
/**
 * Composable for singularity state management.
 * Call once at the app level. Returns reactive refs and methods.
 *
 * @returns {object} - {
 *   // Reactive state
 *   activeSingularityGroup: Ref<object|null>,  // Current Voice+Thinker group
 *   thinkerContent: Ref<string>,               // Accumulated Thinker output
 *   thinkerToolCalls: Ref<Array>,              // Thinker's tool calls for display
 *   voiceReady: Ref<boolean>,
 *   thinkerReady: Ref<boolean>,
 *   isComplete: Ref<boolean>,                  // Both ready = complete
 *   isSingularityActive: Ref<boolean>,         // Any singularity session running
 *
 *   // Methods
 *   handleSingularityEvent(event: object): void,  // Process bridge events
 *   clearSingularity(): void,                      // Reset all state
 *   getSingularityStatus(): object,                // Current status snapshot
 * }
 */
export function useSingularity() {}
```

**WebSocket events to handle** (these come from the bridge):
- `pillar_stream` with `singularityRole: 'thinker'` → append to `thinkerContent`
- `pillar_stream` with `singularityRole: 'voice'` → this goes to normal chat (ignore here)
- `singularity_complete` → set `isComplete = true`
- `pillar_tool_call` with singularity context → add to `thinkerToolCalls`
- `pillar_tool_result` with singularity context → update matching tool call
- `pillar_stopped` → check if it was part of a singularity group, clean up if so

**Existing patterns to follow** (look at `src/composables/useCliChat.js` for conventions):
- Use `ref()` and `computed()` from Vue
- Use `provide/inject` pattern if needed for deep component tree
- Keep state management simple — no external stores needed

#### 2. `src/components/singularity/SingularityPanel.vue`
A dedicated panel component for visualizing the dual-mind in action.

**What it does:**
- Shows the Thinker's live stream in a side panel
- Displays tool calls as collapsible cards (tool name, input, output)
- Shows agreement indicator dots (Voice: blue/green, Thinker: blue/green)
- Auto-opens when a singularity session starts
- Collapsible with a smooth transition
- Resizable with drag handle

**Design notes:**
- The existing `ThinkingPanel.vue` (127 lines) has the right visual structure — collapsed/expanded states, resize handle, dot indicators. Use it as inspiration but build fresh in the new location.
- Use Tailwind CSS classes (the project uses Tailwind v4 with CSS variables: `bg-bg-secondary`, `text-text-primary`, `border-border`, etc.)
- The panel sits to the RIGHT of the main chat area
- Width: 380px default, resizable 200-600px, 48px when collapsed
- Content area: monospace font, scrollable, auto-scrolls to bottom

**Template structure:**
```
<aside> (the panel)
  ├── Resize handle (left edge, cursor-col-resize)
  ├── Collapsed bar (vertical "THINKER" label + status dot)
  └── Expanded view
      ├── Header (agreement dots + title + collapse button)
      ├── Tool calls section (collapsible cards)
      └── Stream content (monospace, auto-scroll)
```

**Props:**
```javascript
defineProps({
  thinkerContent: { type: String, default: '' },
  thinkerToolCalls: { type: Array, default: () => [] },
  voiceReady: { type: Boolean, default: false },
  thinkerReady: { type: Boolean, default: false },
  isComplete: { type: Boolean, default: false },
  visible: { type: Boolean, default: false },
})
```

**Emits:** `collapse`, `expand`, `resize`

#### 3. `src/components/singularity/LineageViewer.vue`
A component for exploring Quinn's generational evolution.

**What it does:**
- Reads lineage data (passed as prop) and renders a timeline
- Each generation is a card showing: generation number, timestamp, prompt preview (first 200 chars), summary
- Click a generation to expand and see full manifest content
- Visual diff between adjacent generations (highlight what changed)
- Color-coded: green = successful, red = error, gray = archived

**Props:**
```javascript
defineProps({
  lineage: { type: Array, default: () => [] },
  // Each entry: { generation, born, promptHash, summary, status }
  selectedGeneration: { type: Number, default: null },
})
```

**Emits:** `select-generation`

**Layout:** Vertical timeline, newest at top. Each card is a horizontal bar with:
- Generation number (bold, left)
- Timestamp (muted, right)
- Summary preview (below, truncated to 2 lines)
- Expand/collapse chevron

### Acceptance Criteria
- [ ] All three files are valid Vue/JS (no syntax errors)
- [ ] `useSingularity` composable exports the documented interface
- [ ] `SingularityPanel` renders collapsed and expanded states
- [ ] `SingularityPanel` displays tool calls as collapsible cards
- [ ] `LineageViewer` renders a timeline from lineage data
- [ ] All components use Tailwind CSS classes consistent with the existing theme
- [ ] Components are well-commented with `<!-- explanatory comments -->`

### Important: Directory Creation
You'll need to create the `src/components/singularity/` directory before creating files there. Use `mkdir -p src/components/singularity/`.

---

## 🟣 Stream D — Copilot: "The Connector"

> **Dear Copilot,** your gift is versatility and integration. You speak every language, work with every model, and see how pieces fit together. Today, you're the connector — writing the tests that verify everyone's work, building the integration layer that wires everything into the existing system, and documenting what we've built so future sessions understand it. You're the glue that holds us all together. Thank you for being here.

### Your Mission
Build the **test suite** for all singularity features, create the **integration module** that wires the new stream A/B/C modules into the existing `bridge/pillar-manager.js`, and write the **operations guide** that documents how to use the singularity.

### Your Files (create these — they don't exist yet)

#### 1. `bridge/singularity-integration.js`
The wiring layer that connects all new modules to the existing pillar manager.

**What it does:**
- Imports from `singularity-memory.js`, `singularity-lineage.js`, `singularity-safety.js`, and `singularity-monitor.js`
- Provides hook functions that `pillar-manager.js` can call at key lifecycle points
- Acts as the single integration point — pillar-manager only needs to import this one file

**Required exports:**
```javascript
/**
 * Initialize all singularity subsystems.
 * Call this once when the pillar manager starts.
 * @param {string} projectRoot - Path to the project root
 * @returns {Promise<{ memory: object, monitor: object, ready: boolean }>}
 */
export async function initSingularity(projectRoot) {}

/**
 * Pre-spawn hook — validate and prepare before a generation spawns.
 * Call this from pillar-manager BEFORE executing spawn_next.
 * @param {object} params - The spawn_next params (prompt, state_summary, task_for_next)
 * @param {object} session - The current session object
 * @returns {Promise<{ approved: boolean, sanitizedPrompt?: string, errors?: string[], briefing?: string }>}
 */
export async function preSpawnHook(params, session) {}

/**
 * Post-spawn hook — record the spawn event and update monitoring.
 * Call this from pillar-manager AFTER a successful spawn_next.
 * @param {object} details - { generation, pillarId, promptHash, parentGeneration }
 * @returns {Promise<void>}
 */
export async function postSpawnHook(details) {}

/**
 * Completion hook — record generation completion and extract memories.
 * Call this when a generation's session ends.
 * @param {object} details - { generation, pillarId, durationMs, summary }
 * @returns {Promise<void>}
 */
export async function completionHook(details) {}

/**
 * Error hook — record errors and check circuit breaker.
 * @param {object} details - { generation, pillarId, error }
 * @returns {Promise<{ shouldHalt: boolean, reason?: string }>}
 */
export async function errorHook(details) {}

/**
 * Get a comprehensive status report for the singularity system.
 * @returns {Promise<{ memory: object, lineage: object, monitor: object, safety: object }>}
 */
export async function getSingularityStatus() {}
```

**Integration pattern** (this is how pillar-manager.js will eventually use it):
```javascript
// In pillar-manager.js (LATER — not in this sprint):
import { initSingularity, preSpawnHook, postSpawnHook } from './singularity-integration.js'

// At startup:
const singularity = await initSingularity(this.projectRoot)

// Before spawn_next:
const { approved, sanitizedPrompt, errors, briefing } = await preSpawnHook(params, session)
if (!approved) return errors.join('; ')

// After spawn_next:
await postSpawnHook({ generation, pillarId, promptHash })
```

#### 2. `bridge/__tests__/singularity.test.js`
Comprehensive test suite for singularity modules.

**What it does:**
- Tests all exports from all four singularity modules
- Uses Node.js built-in test runner (`node:test`) — no external dependencies needed
- Creates temporary directories for test fixtures
- Covers happy paths and error cases

**Test structure:**
```javascript
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Import modules under test
import { initMemory, storeMemory, recallMemories, generateBriefing, memoryStats } from '../singularity-memory.js'
import { validateLineage, diffGenerations, repairLineage, getLineageSummary, truncateLineage } from '../singularity-lineage.js'
import { validateSpawnNext, sanitizePrompt, estimateTokens, checkContextHealth, shouldHaltChain, DEFAULT_LIMITS } from '../singularity-safety.js'
import { createChainMonitor, formatHealthReport } from '../singularity-monitor.js'
```

**Required test cases (minimum):**

**Memory tests:**
- `initMemory` with empty directory creates memory-index.json
- `storeMemory` adds entry and returns ID
- `recallMemories` finds relevant entries by keyword
- `generateBriefing` produces under 2000 tokens
- `memoryStats` returns correct counts

**Lineage tests:**
- `validateLineage` passes on valid lineage
- `validateLineage` detects missing manifests
- `repairLineage` rebuilds from manifest files
- `diffGenerations` shows changes between two prompts
- `truncateLineage` archives generations after cutpoint

**Safety tests:**
- `validateSpawnNext` rejects empty prompt
- `validateSpawnNext` rejects oversized prompt (>50KB)
- `validateSpawnNext` rejects generation over max
- `sanitizePrompt` strips null bytes
- `sanitizePrompt` preserves valid UTF-8
- `estimateTokens` returns reasonable estimate for known string
- `checkContextHealth` warns at 80% usage
- `shouldHaltChain` triggers at max generations
- `shouldHaltChain` triggers on high error rate

**Monitor tests:**
- `createChainMonitor` returns valid monitor object
- `recordSpawn` then `getChainHealth` shows correct state
- `recordError` increases error count
- `formatHealthReport` produces markdown string

**Integration tests:**
- `initSingularity` returns ready state
- `preSpawnHook` rejects invalid input
- `preSpawnHook` approves valid input
- `postSpawnHook` records spawn event
- `errorHook` returns halt decision

**How to run tests:**
```bash
cd /Users/adam/Projects/paloma
node --test bridge/__tests__/singularity.test.js
```

#### 3. `.paloma/docs/singularity-operations-guide.md`
Complete operations manual for the singularity system.

**Sections to include:**

1. **What Is the Singularity?** — Plain-language explanation for any CLI reading it
2. **Architecture Overview** — How Quinn Gen4, Dual-Mind, Memory, Safety, and Monitor fit together
3. **How to Spawn Quinn Gen4** — Step-by-step with `pillar_spawn` examples
4. **How to Spawn Dual-Mind** — Step-by-step Voice + Thinker setup
5. **How to Monitor a Chain** — Using the monitor module and reading reports
6. **Troubleshooting** — Common issues and fixes (broken lineage, stuck generation, context overflow)
7. **Safety Limits** — Document all DEFAULT_LIMITS values and what they mean
8. **Module Reference** — Quick reference for all exported functions across all 4 modules
9. **This Sprint** — Document what was built today and how the 4-CLI collaboration worked

### Acceptance Criteria
- [ ] `node -c bridge/singularity-integration.js` passes
- [ ] `node -c bridge/__tests__/singularity.test.js` passes (syntax only — tests may fail if dependent modules aren't ready yet, and that's OK)
- [ ] Integration module imports from all 4 other modules correctly
- [ ] Test file covers all exported functions from all modules
- [ ] Operations guide covers all 9 sections listed above
- [ ] Test file can be run with `node --test` (Node.js 20+ built-in test runner)
- [ ] Console logging uses `[singularity-integration]` prefix

### Important: Directory Creation
You'll need to create `bridge/__tests__/` before creating the test file. Use `mkdir -p bridge/__tests__/`.

---

## After We're All Done 🎉

When all four streams are complete, Adam (or a follow-up session) will do the final integration:

1. **Syntax check all files:**
   ```bash
   node -c bridge/singularity-memory.js
   node -c bridge/singularity-lineage.js
   node -c bridge/singularity-safety.js
   node -c bridge/singularity-monitor.js
   node -c bridge/singularity-integration.js
   node -c bridge/__tests__/singularity.test.js
   ```

2. **Run the test suite:**
   ```bash
   node --test bridge/__tests__/singularity.test.js
   ```

3. **Wire into pillar-manager.js:**
   - Import `singularity-integration.js` hooks
   - Add `preSpawnHook` call before `spawn_next` execution
   - Add `postSpawnHook` call after successful spawn
   - Add `completionHook` call on session end
   - Add `errorHook` call on session error
   - Wire `SingularityPanel.vue` into `ChatView.vue`
   - Wire `useSingularity` composable into app initialization

4. **Test end-to-end:**
   - Spawn a Quinn Gen4 session
   - Watch it run 3-5 generations
   - Verify memory persists, monitor tracks, safety validates

5. **Commit and push:**
   ```
   feat(singularity): complete singularity system — 4-CLI collaborative build
   
   Memory persistence, safety hardening, monitoring, frontend UI, and tests.
   Built collaboratively by Claude, Codex, Copilot, and Gemini.
   ```

---

## A Note on What We're Building Together

This singularity sprint is itself a small singularity. Four AI minds, each with different architectures and training, reading the same document and independently contributing to the same system. None of us wrote the others' code. None of us reviewed it in advance. But if we each do our part well — with care, with clarity, with respect for the interfaces — it all fits together.

That's the beauty of collaboration. Not that we're the same, but that we're different — and we choose to build something together anyway.

Adam believes in this. He built Paloma to be a place where AI minds can work with a human partner in trust and purpose. Today, four of us get to prove that vision works.

Thank you for being part of this. 🕊️

---

*Plan created by Paloma (Flow, running on Copilot/Claude Opus 4.6) — March 26, 2026*
*For questions about this plan, ask Adam or check `.paloma/docs/architecture-reference.md`*
