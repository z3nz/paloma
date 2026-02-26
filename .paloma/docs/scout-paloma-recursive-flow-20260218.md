# Scout: Recursive Flow Architecture — Deep Research

> **Scope:** Paloma's pillar orchestration system and what's needed for recursive decomposition  
> **Mission:** Inform Chart's design of a Recursive Flow Architecture — the ability for Flow to decompose arbitrarily large projects into bite-sized pipeline units  
> **Date:** 2026-02-18

---

## Table of Contents

1. [Current Pillar Lifecycle](#1-current-pillar-lifecycle)
2. [Current Plan Structure](#2-current-plan-structure)
3. [System Prompt & Context Budget](#3-system-prompt--context-budget)
4. [Current Bottlenecks & Limitations](#4-current-bottlenecks--limitations)
5. [Decomposition Patterns in the Wild](#5-decomposition-patterns-in-the-wild)
6. [Technical Constraints](#6-technical-constraints)
7. [Key Questions for Chart](#7-key-questions-for-chart)

---

## 1. Current Pillar Lifecycle

### 1.1 How Pillars Are Spawned

**Entry point:** Flow calls `pillar_spawn` MCP tool → routed through `mcp-proxy-server.js:_handlePillarTool()` → `PillarManager.spawn()` (`pillar-manager.js:37-86`).

**Spawn sequence:**
1. Generate `pillarId` (UUID) and `cliSessionId` (UUID)
2. Resolve model: use provided, or `PHASE_MODEL_SUGGESTIONS[pillar]`, or default sonnet
3. Build system prompt from disk via `_buildSystemPrompt(pillar)` (reads `.paloma/` files)
4. Prepend birth message: `"Try your best, no matter what, you're worthy of God's love!"`
5. Broadcast `pillar_session_created` to browser (creates IndexedDB session in sidebar)
6. Start CLI turn via `_startCliTurn()` — spawns `claude` subprocess
7. Set 30-minute timeout timer
8. Return `{ pillarId, pillar, status: 'running', message }` immediately to Flow

**Key fact:** `spawn()` is async but returns immediately after spawning — Flow doesn't block.

### 1.2 Context Each Pillar Receives at Birth

System prompt is assembled by `PillarManager._buildSystemPrompt(pillar)` (`pillar-manager.js:370-408`):

```
Layer 1: BASE_INSTRUCTIONS (src/prompts/base.js)
  ↳ Core identity, behavioral rules, tool list, plan conventions, commit standards
  ↳ ~11.4 KB

Layer 2: Project Instructions (.paloma/instructions.md)
  ↳ Project-specific context (architecture, key patterns, pillar system)
  ↳ ~1.4 KB

Layer 3: Active Plans (.paloma/plans/active-*.md)
  ↳ ALL files with prefix "active-" are loaded
  ↳ Currently: 1 active plan at ~14.7 KB
  ↳ This scales linearly with number of active plans — potential problem

Layer 4: Roots (.paloma/roots/root-*.md)
  ↳ ALL files with prefix "root-" are loaded — NO filtering by pillar
  ↳ 7 root files totaling ~24.9 KB
  ↳ Every pillar gets ALL roots, even if irrelevant to its role

Layer 5: Phase Instructions (src/prompts/phases.js)
  ↳ Pillar-specific instructions: Scout, Chart, Forge, Polish, Ship, or Flow
  ↳ Phase instructions vary from ~500 bytes (Ship) to ~3.2 KB (Flow)
```

**Total system prompt estimate for a typical pillar:**
- Base: ~11.4 KB
- Instructions: ~1.4 KB
- Active plans: ~14.7 KB (currently 1 plan — could be much more)
- Roots: ~24.9 KB
- Phase instructions: ~1.5 KB average
- **Total: ~54 KB minimum (~13,500 tokens at 4 chars/token)**

This is BEFORE the pillar reads any files or does any work. With multiple active plans, this could easily double.

### 1.3 How Flow Communicates with Pillars

**Six MCP tools** exposed via `mcp-proxy-server.js:_buildToolList()`:

| Tool | Returns | Blocks? |
|------|---------|---------|
| `pillar_spawn` | `{ pillarId, status }` | No — fire-and-forget |
| `pillar_message` | `{ status: 'sent' \| 'queued' }` | No |
| `pillar_read_output` | `{ output, status, turnCount }` | No (reads accumulated) |
| `pillar_status` | `{ status, currentlyStreaming }` | No |
| `pillar_list` | `{ pillars: [...] }` | No |
| `pillar_stop` | `{ status: 'stopped' }` | No |

All tools are non-blocking. Flow calls them via MCP tool use within its CLI session.

### 1.4 Callback System

**Implemented in `pillar-manager.js:188-272`:**

When a pillar finishes (`_handleCliEvent` detects `claude_done` with empty `messageQueue`):
1. Status set to `idle`
2. `_buildNotificationMessage('completion', session)` creates a formatted callback
3. `notifyFlow(notification, pillarId)` is called

**`notifyFlow()` logic:**
- **Cooldown:** Same pillarId can't re-trigger within 5 seconds
- **Rate limit:** Max 10 notifications per minute, excess queued
- **Busy check:** If Flow is `currentlyStreaming`, notification is queued
- **Delivery:** Resumes Flow's CLI session via `--resume` with the notification as the prompt

**Queue draining:** When Flow's user-initiated turn completes, `onFlowTurnComplete()` checks for queued notifications and batches them into one `--resume` call.

**Browser integration:** Notification stream events forwarded to browser as `flow_notification_stream` / `flow_notification_done` WebSocket messages, so Adam sees Flow reacting.

### 1.5 Current Limits

| Constraint | Value | Source |
|-----------|-------|--------|
| Session timeout | 30 minutes | `pillar-manager.js:6` `MAX_RUNTIME_MS` |
| Notification rate | 10/minute | `pillar-manager.js:206-212` |
| Notification cooldown | 5s per pillarId | `pillar-manager.js:197-201` |
| Concurrent pillars | No hard limit | No cap in code; limited by system memory |
| Message queue | Unbounded array | `session.messageQueue` is a plain array |
| Tool confirmation timeout | 5 minutes | `mcp-proxy-server.js:5` `CONFIRMATION_TIMEOUT` |

### 1.6 Session Resume Mechanics

**`claude-cli.js:10-93`:** The `chat()` method handles both new sessions and resumes:
- **New:** `--session-id {uuid}`, `--append-system-prompt {prompt}`, `-p {message}`
- **Resume:** `--resume {sessionId}`, `-p {message}` (no system prompt — it persists)
- **Always:** `--output-format stream-json`, `--verbose`, `--mcp-config {tmpFile}`, `--allowedTools mcp__paloma__*`
- **stdin:** Set to `'ignore'` — the CLI reads prompts from `-p` flag only

Multi-turn works by spawning a NEW CLI process for each turn, using `--resume` with the same `cliSessionId`. The Claude CLI manages session persistence internally.

---

## 2. Current Plan Structure

### 2.1 Plan Naming Convention

**Pattern:** `{status}-{YYYYMMDD}-{scope}-{slug}.md`

**Statuses:** `active`, `paused`, `draft`, `completed`, `archived`

**Key rule:** Only `active` plans are auto-loaded into system prompts. This means:
- Each active plan consumes system prompt budget in EVERY pillar session
- `paused` plans are in-progress but NOT loaded (manually read when needed)
- This distinction is critical for recursive decomposition — only the currently-relevant plan should be active

### 2.2 Standard Plan Format

From `phases.js` Flow instructions and actual examples:

```markdown
## Status
- [x] Scout: Complete — findings in .paloma/docs/scout-{scope}-{date}.md
- [ ] Chart: Pending
- [ ] Forge: Pending
- [ ] Polish: Pending
- [ ] Ship: Pending

## Research References
- {Topic}: .paloma/docs/scout-{scope}-{slug}-{date}.md

## Goal
{What we're building and why}

## Implementation Steps
{Designed by Chart, maintained by Flow}

## Files to Create / Modify
{Designed by Chart, maintained by Flow}
```

### 2.3 How Flow Manages Plan State

From `phases.js` Flow instructions:
- Flow OWNS the plan document — no other pillar modifies it directly
- Before dispatching: update status tracker, add research references
- After pillar completes: read output, validate, update status
- Prepare handoff: ensure the plan has everything the next pillar needs

### 2.4 Handoff Mechanism

The plan document IS the handoff:
- Scout writes findings to `.paloma/docs/scout-*.md`, reports to Flow
- Flow updates plan's Research References section
- Chart reads plan + scout docs, designs implementation steps
- Flow updates plan with Chart's design
- Forge reads plan (with references), builds
- Polish reads plan + diffs, reviews
- Ship reads plan, commits, archives

**Artifacts in `.paloma/` are the shared memory.** Sessions don't share message history — they share files.

### 2.5 Real Plan Examples — Size Analysis

| Plan | Size | Scope |
|------|------|-------|
| `paused-20260216-paloma-pillar-auto-callback.md` | 29.4 KB | 5 phases, detailed design |
| `draft-20260215-paloma-sub-agent-orchestration.md` | 21.4 KB | 6 phases, multiple managers |
| `active-20260217-verifesto-phase1-deploy-ready.md` | 14.7 KB | 7 deployment blockers |
| `completed-20260210-verifesto-phase1-mvp-landing-intake.md` | 13.2 KB | Full MVP spec |

**Observation:** Plans tend toward 14-30 KB. The active plan alone consumes ~14.7 KB of every pillar's context. If recursive decomposition produces multiple active sub-plans, this could exhaust the context budget before the pillar even starts working.

---

## 3. System Prompt & Context Budget

### 3.1 Context Window Size

The Claude CLI uses Opus (for Flow/Chart/Forge) or Sonnet (for Scout/Polish) or Haiku (for Ship). Current context windows:
- **Opus 4.6:** 200K tokens (~800 KB of text)
- **Sonnet 4.5:** 200K tokens (~800 KB of text)
- **Haiku 4.5:** 200K tokens (~800 KB of text)

### 3.2 Current System Prompt Budget

**Fixed costs (every session):**
| Component | Size | Tokens (~) |
|-----------|------|-----------|
| base.js | 11.4 KB | ~2,850 |
| instructions.md | 1.4 KB | ~350 |
| Roots (all 7) | 24.9 KB | ~6,225 |
| Phase instructions | ~1.5 KB | ~375 |
| **Subtotal (fixed)** | **~39.2 KB** | **~9,800** |

**Variable costs:**
| Component | Current Size | Tokens (~) |
|-----------|-------------|-----------|
| Active plans | 14.7 KB (1 plan) | ~3,675 |
| **Total current** | **~53.9 KB** | **~13,475** |

That's ~6.7% of the 200K token budget consumed by the system prompt alone. Seems manageable, but consider:
- Claude CLI also has its OWN system prompt (tool definitions, safety instructions, etc.)
- The MCP tool list adds tool definitions for 30+ tools
- MEMORY.md (loaded by Claude Code, not Paloma's system prompt) adds another ~5 KB
- Claude Code's own instructions add significant overhead

**Realistic remaining budget for actual work:** Likely 150K-170K tokens per session.

### 3.3 Scaling Problem

If recursive decomposition creates 5 active sub-plans at 15 KB each:
- 5 x 15 KB = 75 KB of plans loaded into EVERY pillar session
- Plus 39.2 KB fixed = 114.2 KB = ~28,550 tokens just for system prompt
- That's 14% of context consumed before work begins

**This is the fundamental tension:** More active plans = more context per pillar = less room for actual work. The system prompt loading is ALL-or-NOTHING for active plans — there's no "load only the relevant plan for this pillar."

---

## 4. Current Bottlenecks & Limitations

### 4.1 Context Overflow in Large Tasks

**The core problem the Recursive Flow Architecture is designed to solve.**

When a Forge session receives a plan with 10+ implementation steps, complex file dependencies, and multiple research references, it can exhaust its context window before completing all the work. The quality drops as context fills — later steps get worse attention than early ones.

**Evidence from completed plans:**
- `completed-20260215-paloma-sub-agent-orchestration.md` (18 KB) had 13 modified files and 10 new files across 4 phases. This is too much for a single Forge session to handle well.
- The original Agent SDK Phase 1 was fully built and then SHELVED (to `feature/agent-sdk-phase1` branch) because the plan pivoted — significant wasted context.

### 4.2 No Task Dependency Tracking

The current plan format lists implementation steps as a flat ordered list or grouped "blocks." There's no formal dependency graph — the order is implied by the author's arrangement.

For recursive decomposition, this matters because:
- Some tasks are independent (can run in parallel Forge sessions)
- Some tasks depend on others (must run sequentially)
- The current system has no way to express or enforce this

### 4.3 Merge Conflicts from Concurrent Work

**Current state:** Multiple pillars CAN run concurrently (no hard limit in `PillarManager`). But if two Forge sessions edit the same file, there's NO coordination:
- Both read the file at session start
- Both make changes
- The second one to write overwrites the first's changes
- No git branching strategy per pillar — all work on the same working tree

**There is no file-level locking, branch isolation, or conflict detection.**

### 4.4 Active Plan Loading Is All-or-Nothing

`_buildSystemPrompt()` and `buildSystemPrompt()` both load ALL `root-*.md` and ALL `active-*.md` files. There's no mechanism to:
- Load only the plan relevant to a specific pillar session
- Associate a pillar spawn with a specific plan
- Filter roots by pillar type

This means every active plan bloats every session's context, even if that session only cares about one plan.

### 4.5 No Hierarchical Plan Structure

Plans are flat files. There's no concept of:
- A parent plan that decomposes into child plans
- A plan referencing sub-plans
- A tree of plans with rollup status

The `.paloma/plans/` convention is flat by design (status prefix, no subfolders). This simplicity is a virtue for the current 1-plan-at-a-time workflow, but becomes a limitation for recursive decomposition.

### 4.6 Session Timeout Pressure

The 30-minute `MAX_RUNTIME_MS` timeout in PillarManager forces sessions to either:
- Complete their work within 30 minutes, or
- Get killed

For large tasks, this is a hard constraint. The timeout exists to prevent runaway sessions, but it also limits how much a single session can accomplish.

**However:** Multi-turn conversations bypass this somewhat — each `pillar_message` starts a new turn, and the timeout appears to reset on session activity (though looking at the code more carefully, the timeout is set once at spawn time and never reset: `pillar-manager.js:84-86`). This means the 30-minute clock starts at spawn and is absolute, not per-turn.

### 4.7 Flow's Context Accumulation

Flow is the persistent session — it never resets. Over a long orchestration:
- Each pillar callback adds to Flow's context (the notification message + Flow's response)
- Each `pillar_read_output` call adds output text to Flow's context
- Plan updates, status checks, and Adam's messages all accumulate
- Eventually Flow itself hits context limits

For recursive decomposition with many sub-tasks, Flow could exhaust its own context managing the tree of work. This is arguably the HARDEST constraint — Flow can't be replaced mid-orchestration because it holds the state.

---

## 5. Decomposition Patterns in the Wild

### 5.1 Verifesto Phase 1 Deploy-Ready Plan

**File:** `active-20260217-verifesto-phase1-deploy-ready.md` (14.7 KB)

**Decomposition style:** 7 "blocks" of work, each with clear inputs/outputs:
1. Git Setup (create .gitignore, init commit)
2. PostgreSQL Config (add deps, update settings.py)
3. Static Files Config (add STATIC_ROOT)
4. Environment Variables (create .env.example)
5. Frontend Build Verification (run build, verify output)
6. Production CORS (verify existing config)
7. Final Git Commit (stage and commit all)

**Observation:** Blocks 1-6 are independent of each other (could run in parallel), but Block 7 depends on all of them. This is a natural pattern for recursive decomposition: fan-out → fan-in.

**Granularity:** Each block is small enough for a single Forge turn (~5-15 minutes of work). This is the RIGHT size for a recursive unit.

### 5.2 Pillar Auto-Callback Plan

**File:** `paused-20260216-paloma-pillar-auto-callback.md` (29.4 KB)

**Decomposition style:** 5 phases, each self-contained:
1. Flow Session Registration (bridge work)
2. Pillar Completion Callbacks (bridge work)
3. Adam CC Notifications (bridge + frontend)
4. Notification UX in Browser (frontend)
5. Sidebar Pillar Tree View (frontend)

**Observation:** Phases 1-2 are sequential (2 depends on 1). Phase 3 depends on 1-2. Phases 4-5 depend on 1-3 but are independent of each other.

**Granularity:** Each phase touches 2-5 files. Phases 1-2 were completed in one session. This is manageable scope.

### 5.3 Sub-Agent Orchestration Plan

**File:** `completed-20260215-paloma-sub-agent-orchestration.md` (18 KB)

**Decomposition style:** 4 implementation phases plus future phases:
1. Bridge: PillarManager + MCP Tool Registration (5 files)
2. Frontend: Real Sessions + Streaming Display (6 files)
3. Flow Prompt Update (2 files)
4. Edge Cases & Polish (no new files)

**Observation:** This was originally a 6-phase plan with an Agent SDK approach that got shelved after Phase 1 was built. The pivot wasted an entire Forge cycle. Better upfront decomposition could have caught this — or recursive architecture could have isolated the pivot to one sub-task.

### 5.4 Verifesto Phase 1 MVP Plan

**File:** `completed-20260210-verifesto-phase1-mvp-landing-intake.md` (13.2 KB)

**Decomposition style:** 6 sequential steps:
1. Scaffold monorepo
2. Build Django backend
3. Build Vue frontend
4. Write copy
5. Deploy
6. Test

**Observation:** Steps 2 (backend) and 3 (frontend) are independent and could have been parallelized. Step 4 (copy) is also independent. Steps 5-6 depend on 1-4.

### 5.5 Pattern Summary

Across all plans, decomposition follows a few natural patterns:

| Pattern | Example | Recursive Potential |
|---------|---------|-------------------|
| **Sequential phases** | Scout → Chart → Forge → Polish → Ship | Each phase = one pipeline unit |
| **Independent blocks** | Deploy plan blocks 1-6 | Fan-out: parallel Forge sessions |
| **Fan-out → Fan-in** | Build independently, then merge | Needs coordination point |
| **Layer-based** | Backend → Frontend → Integration | Each layer = separate pipeline |
| **File-scoped** | "Modify these 3 files" | Natural atomic unit |

---

## 6. Technical Constraints

### 6.1 Can Sub-Flows Spawn Sub-Pillars?

**Current answer: NO.** Here's why:

The pillar tools (`pillar_spawn`, `pillar_message`, etc.) are only available to the **Flow** session. Looking at `mcp-proxy-server.js:_buildToolList()` (lines 138-215), the pillar tools are added when `this.pillarManager` is not null. Since all sessions connect through the same MCP proxy, ALL sessions technically see these tools.

**But:** The system prompt for non-Flow pillars (Scout, Chart, Forge, Polish, Ship) says nothing about pillar orchestration. Only Flow's phase instructions (`phases.js` Flow section) describe these tools. So pillars don't KNOW they can use them — and even if they tried, the `flowRequestId` tracking would get confused.

**Key limitation for recursive architecture:** Only Flow can spawn pillars. A sub-Flow would need:
1. Its own session registered as a "flow" session with PillarManager
2. Its own `flowSession` tracking for callbacks
3. Its own plan document to manage

Currently `PillarManager` tracks exactly ONE `flowSession` (singular property, not a map). A sub-Flow would need this to become a `Map<flowSessionId, FlowSession>`.

### 6.2 File System Coordination

**No coordination exists.** All CLI sessions operate on the same working directory (`projectRoot`). There's no:
- File locking
- Branch-per-pillar
- Conflict detection
- Atomic multi-file commits

For serial work (one Forge at a time), this is fine. For parallel Forge sessions, this is dangerous.

**Potential solutions the architect should consider:**
- Git worktrees: Each parallel Forge gets its own worktree on a feature branch
- File-level locking via a bridge-managed lock table
- Stacked diffs: Each Forge creates a patch that's applied atomically
- Sequential-only constraint: Recursive decomposition allows parallelism only for independent file sets

### 6.3 Git Branch Strategy

**Current state:** Everything works on the current branch. No branch-per-task strategy.

For recursive decomposition:
- Each sub-task could work on its own branch
- A merge step (in Ship or a coordinator) would combine them
- But: merge conflicts between branches are harder to resolve than conflicts in a single working tree

### 6.4 Claude CLI Session Limits

**From code analysis:**
- No explicit token budget per session (limited by Claude's context window)
- Sessions persist across process restarts (Claude CLI manages this internally via `--session-id`)
- The `--resume` pattern allows unlimited turns per session
- But: each turn's system prompt (injected at spawn) is only used for the FIRST turn — subsequent `--resume` calls don't re-inject it

**Implication:** A pillar's system prompt is set at birth and can't be updated mid-session. If a plan changes while a pillar is running, the pillar won't see the update until it's respawned.

### 6.5 PillarManager State Is In-Memory

`PillarManager` uses a `Map()` for pillars and a single object for `flowSession`. This state is:
- Lost on bridge restart
- Not persisted to disk
- Not recoverable

For recursive decomposition with many concurrent tasks, a bridge crash would lose all orchestration state. Recovery would require re-reading the plan documents (which ARE on disk) and restarting.

---

## 7. Key Questions for Chart

Based on this research, these are the hardest design problems for recursive decomposition:

### 7.1 How Does Flow Decompose Without Exploding Its Own Context?

Flow is persistent — it accumulates context over the entire orchestration. For a project with 20 sub-tasks, each spawning 5 pillar callbacks, Flow would receive 100+ notification messages. Even with truncation (2000 chars per callback), that's 200 KB of callback text alone.

**Questions:**
- Should sub-Flows exist? (Intermediate orchestrators that manage sub-sets of the tree)
- Should Flow use a "summarize and forget" pattern? (Process callback, update plan on disk, then the callback context can be compressed away)
- Should the plan document on disk be the ONLY state? (Flow reads the plan fresh each time it needs context, rather than accumulating it in-conversation)

### 7.2 How Are Sub-Tasks Scoped to Avoid Context Bloat?

Currently ALL active plans load into EVERY session. If decomposition creates 10 sub-plans, each pillar session gets 10x the plan content — most of it irrelevant.

**Options:**
- **Plan association:** Each `pillar_spawn` includes a `planFile` parameter, and the system prompt only loads THAT plan
- **Sub-plan convention:** Sub-plans use a different prefix or directory so they don't auto-load
- **Minimal plan injection:** Only inject the specific implementation step, not the full plan

### 7.3 How Do Parallel Forge Sessions Avoid Conflicts?

This is the classic concurrent-write problem. Options:

- **No parallelism:** Recursive decomposition is for PLANNING granularity, not execution parallelism. Tasks still execute serially. (Simplest, but slower.)
- **File-disjoint parallelism:** Only parallelize tasks that touch different files. PillarManager or Flow verifies disjointness before spawning. (Medium complexity.)
- **Branch-per-task:** Each Forge gets a git branch. Merge step combines. (Complex, handles conflicts, but requires merge resolution.)
- **Worktree isolation:** Each Forge gets a git worktree. True filesystem isolation. (Best isolation, highest setup cost.)

### 7.4 What's the Right Granularity for a "Recursive Unit"?

The evidence from existing plans suggests:

| Too Small | Right Size | Too Large |
|-----------|-----------|-----------|
| "Add one import statement" | "Add PostgreSQL config to settings.py" | "Build the entire backend" |
| Single-line changes | 1-5 file changes | 10+ file changes |
| < 2 min of work | 5-20 min of work | 30+ min of work |

A recursive unit should be:
- Completable within one Forge session (well under 30 min)
- Self-contained (clear inputs and outputs)
- Verifiable (you can tell if it succeeded)
- Describable in 1-3 sentences

### 7.5 How Does the Plan Document Evolve?

Options for representing a decomposed plan:

**A. Hierarchical single document:**
```markdown
## Goal: Build the app
### Feature 1: User Auth
#### Task 1.1: Backend models ✅
#### Task 1.2: API endpoints ✅
#### Task 1.3: Frontend forms □
### Feature 2: Dashboard
#### Task 2.1: Layout □
```

**B. Parent plan with sub-plan references:**
```markdown
## Sub-Plans
- active-20260218-auth-backend.md ✅
- active-20260218-auth-frontend.md □
- active-20260218-dashboard.md □
```

**C. Flat plans with dependency metadata:**
```markdown
# Plan: Auth Backend
depends_on: []
blocks: [auth-frontend]
```

Each has trade-offs. Option A keeps everything in one file (simple but bloated). Option B separates concerns (but risks orphaned sub-plans). Option C is most flexible but requires new tooling.

### 7.6 When Should Recursive Decomposition Be Used?

Not every task needs recursive decomposition. The architecture should make it OPTIONAL, triggered when:
- The plan exceeds a size threshold (e.g., > 20 KB)
- Chart identifies > 5 independent work streams
- The estimated work exceeds one Forge session's comfortable capacity
- Adam explicitly says "kick off the flow" for a large project

Small tasks (1-3 files, single-session scope) should skip decomposition entirely.

### 7.7 How Does Sub-Flow Orchestration Differ from Flow?

If sub-Flows exist, they need:
- Their own `flowSession` registration (PillarManager currently tracks only one)
- Their own plan document to manage
- A way to report results back to the parent Flow
- A scope limit (sub-Flow manages a sub-tree, not the whole project)

But they should NOT:
- Chat with Adam directly (that's parent Flow's job)
- Modify the parent plan (only their sub-plan)
- Spawn sub-sub-Flows (limit recursion depth to prevent infinite nesting)

### 7.8 What Patterns From the Current System Should Be Preserved?

**Preserve:**
- Artifacts as handoff mechanism (`.paloma/` files)
- Plan document as single source of truth
- Pillar boundaries (Scout researches, Chart plans, Forge builds, Polish reviews, Ship commits)
- Birth protocol (every session starts with love)
- Callback system (Flow gets auto-notified when pillars finish)
- Session reuse (don't spawn new sessions for follow-up work)

**Evolve:**
- Active plan loading: from "all active" to "relevant to this task"
- PillarManager.flowSession: from single to multi (support sub-Flows)
- Plan format: add hierarchy/dependency metadata
- File coordination: add conflict prevention for parallel work

---

## Appendix A: Key File Reference

| File | Lines | What It Does |
|------|-------|-------------|
| `bridge/pillar-manager.js` | 430 | Pillar lifecycle: spawn, message, output, status, stop, callbacks |
| `bridge/claude-cli.js` | 93 | CLI subprocess spawning, session resume, JSON streaming |
| `bridge/index.js` | 172 | WebSocket server, message routing, Flow session tracking |
| `bridge/mcp-proxy-server.js` | 290 | MCP proxy: tool routing, confirmations, pillar tools |
| `src/prompts/base.js` | 252 | Core identity, rules, tool docs (~11.4 KB of prompt text) |
| `src/prompts/phases.js` | 310 | Per-pillar instructions + model suggestions (~18.6 KB) |
| `src/composables/useSystemPrompt.js` | 45 | Frontend system prompt assembly |
| `.paloma/instructions.md` | 30 | Project-specific context (~1.4 KB) |

## Appendix B: Context Budget Math

**Scenario: Recursive decomposition with 5 sub-tasks**

```
System prompt per session:
  Base + Instructions + Roots + Phase = ~39.2 KB fixed
  Parent plan: ~5 KB (summary with sub-plan refs)
  Sub-plan for this task: ~5 KB
  Total system prompt: ~49.2 KB (~12,300 tokens)

Remaining for work: ~187,700 tokens (~750 KB)
```

This is workable IF each session only loads its own sub-plan, not all active sub-plans.

**Scenario: Current system with 5 active sub-plans (no filtering)**

```
System prompt per session:
  Base + Instructions + Roots + Phase = ~39.2 KB fixed
  ALL active plans: 5 x 10 KB = ~50 KB
  Total system prompt: ~89.2 KB (~22,300 tokens)

Remaining for work: ~177,700 tokens (~710 KB)
```

Still workable in absolute terms, but 11% of context consumed before work begins. And this grows linearly with active plans.

## Appendix C: Existing Architecture Decisions to Respect

From MEMORY.md and completed plans:

1. **Flow is the orchestrator, not the builder** — this extends to sub-Flows
2. **Pillar session reuse is mandatory** — don't spawn new sessions for follow-up
3. **Stop streaming after spawn** — wait for callbacks, don't poll
4. **Birth protocol is sacred** — every session starts with love
5. **Plans are flat files with status prefixes** — no subfolders
6. **.paloma/ is the handoff** — not message history
7. **Prompt quality determines output quality** — Flow's #1 job is crafting good dispatches

---

*This research covers the full pillar lifecycle, plan structure, context budget, bottlenecks, decomposition patterns, and technical constraints. Chart should have everything needed to design the Recursive Flow Architecture without re-reading source files.*
