# Recursive Flow Architecture

> **Goal:** Enable Flow to decompose arbitrarily large projects into bite-sized work units, where each unit gets its own focused pillar pipeline — so no single session ever bites off more than it can handle.
> **Status:** Chart complete, ready for phased Forge execution
> **Created:** 2026-02-18

---

## Status

- [x] Scout: Complete — `.paloma/docs/scout-paloma-recursive-flow-20260218.md`
- [x] Chart: Complete — this document
- [x] Forge: Phase 1 Complete (prompt updates) — committed as 63cb37e
- [x] Forge: Phase 2 Complete — `planFile` param on `pillar_spawn`
- [x] Forge: Phase 3 Complete — `pillar_decompose` tool for structured work unit management
- [x] Forge: Phase 4 Complete — `pillar_orchestrate` analysis and dispatch tool
- [x] Polish: Phase 2 Complete — clean, minimal, backward compatible
- [x] Ship: Phase 1 shipped, Phase 2 committed as d2f2a58

## Research References

- **Full system analysis:** `.paloma/docs/scout-paloma-recursive-flow-20260218.md`
- **PillarManager source:** `bridge/pillar-manager.js`
- **System prompt building:** `bridge/pillar-manager.js:370-430` (`_buildSystemPrompt`)
- **Phase instructions:** `src/prompts/phases.js`
- **Core identity prompt:** `src/prompts/base.js`
- **MCP proxy / tool routing:** `bridge/mcp-proxy-server.js`
- **Bridge WebSocket server:** `bridge/index.js`
- **CLI subprocess manager:** `bridge/claude-cli.js`

---

## Executive Summary

Recursive Flow solves a fundamental scaling problem: when a project is too large for one Forge session to handle well, quality degrades because context fills up with too many implementation steps, file lists, and accumulated tool output. The solution is **decomposition** — break large plans into small, focused work units that each fit comfortably within a single session's context window.

**Key design decisions:**

1. **Work units live inline in the parent plan** — not as separate `active-*` files. This avoids the context-bloat problem entirely.
2. **No sub-Flows.** Flow remains singular. Instead, Flow checkpoints its state to disk and relies on plan documents for recovery.
3. **File-disjoint parallelism only.** Two Forge sessions can run concurrently only if they touch completely different files. All work happens on the same branch.
4. **Recursion depth limit: 2.** A project decomposes into features, features decompose into tasks. No deeper nesting.
5. **Backward compatible.** Small tasks (1-5 files, single session) work exactly as they do today with zero decomposition overhead.

---

## 1. Decomposition Algorithm

### 1.1 When Does Flow Decompose?

Decomposition is **not automatic** — it's a deliberate decision made by Flow (or Adam) during the Chart phase. The triggers are:

| Trigger | Signal | Example |
|---------|--------|---------|
| **Chart identifies >5 independent work streams** | Plan has clearly separable blocks | "Build backend + frontend + deploy config" |
| **Estimated work exceeds one Forge session** | >10 files to create/modify, >30 min of work | "Build the full SaaS platform" |
| **Plan document exceeds ~15 KB** | Implementation steps are dense and numerous | The Verifesto Phase 1 deploy plan |
| **Adam explicitly requests it** | "Kick off the flow" for a large project | Project-level work |
| **Cross-domain work** | Backend + frontend + infrastructure + docs | Full-stack feature implementation |

**When NOT to decompose:**

- Plan touches ≤5 files
- Single-domain work (all backend, or all frontend)
- Estimated time ≤20 minutes
- Adam says "just do it" or "kick off a forge"

**The decision point is Chart.** When Chart designs the implementation plan, it explicitly recommends whether decomposition is needed. Flow reviews and approves. If the plan is small enough, the standard single-Forge pipeline continues unchanged.

### 1.2 How Does Flow Decompose?

The decomposition happens in two phases:

**Phase A: Scout + Chart (same as today)**
Scout researches the project. Chart designs the architecture. Nothing changes here — the plan document is produced as normal.

**Phase B: Flow decomposes the Chart plan into work units**
After Chart completes and Flow reviews the plan, Flow decides whether to decompose. If yes, Flow adds a `## Work Units` section to the existing plan document. Each work unit is a self-contained specification with:

```markdown
### WU-1: Backend User Models
- **Status:** pending
- **Depends on:** (none)
- **Files:** backend/models/user.py, backend/models/__init__.py
- **Scope:** Create User and Profile Django models with fields from the spec
- **Acceptance:** Models exist, migrations generate cleanly
- **Pipeline:** scout → forge (skip chart — plan is already designed)
```

Flow writes these work units by analyzing the Chart plan's implementation steps and grouping them by:
1. **File proximity** — steps that touch the same files belong together
2. **Domain** — backend vs. frontend vs. config vs. docs
3. **Dependency** — steps that must happen before other steps

### 1.3 Work Unit Granularity

A work unit should be:

| Property | Target | Too Small | Too Large |
|----------|--------|-----------|-----------|
| **Files** | 1-5 files | Single import change | 10+ files |
| **Time** | 5-20 minutes | <2 min | >30 min |
| **Description** | 1-3 sentences | "Add a comma" | "Build the entire API" |
| **Context** | Fits in one Forge session with room to spare | — | Requires reading 20+ files |

The sweet spot is **one logical change**: "Add the user authentication endpoints," "Build the dashboard layout component," "Configure PostgreSQL for production."

### 1.4 Recursion Depth

**Maximum depth: 2 levels.**

```
Project (Level 0)
├── Feature A (Level 1) — decomposed into work units
│   ├── WU-A1 (Level 2) — atomic, executed by a single Forge
│   ├── WU-A2 (Level 2)
│   └── WU-A3 (Level 2)
├── Feature B (Level 1)
│   ├── WU-B1 (Level 2)
│   └── WU-B2 (Level 2)
└── Integration (Level 1)
    └── WU-I1 (Level 2)
```

**Why not deeper?**
- Each level of nesting adds coordination overhead for Flow
- Two levels cover 95% of real projects: features → tasks
- Deeper nesting creates dependency chains that are hard to reason about
- If a work unit at Level 2 is still too big, it should be re-scoped, not further decomposed

**Level 0 (Project):** The parent plan document. Contains the goal, architecture overview, and the work unit tree.

**Level 1 (Feature):** A logical grouping of related work units. Not a separate document — it's a section header in the parent plan. Features define the dependency boundaries.

**Level 2 (Work Unit):** The atomic execution unit. One Forge session, one clear objective, 1-5 files.

### 1.5 Sequential vs. Parallel Execution

Flow decides execution order by analyzing the dependency graph:

1. **Independent units** (no dependencies) can potentially run in parallel
2. **Dependent units** must run sequentially — the dependency must complete before the dependent starts
3. **Default is sequential.** Parallel execution is an optimization, not a requirement.

The decision tree:

```
Is work unit blocked by an incomplete dependency?
  → YES: Skip it, move to next ready unit
  → NO: Is it file-disjoint with all currently-running units?
    → YES: Can run in parallel (if Flow chooses)
    → NO: Must wait for current units to finish
```

Flow manages this by maintaining the status of each work unit in the plan document. Before dispatching a Forge, Flow reads the plan, finds the next `pending` unit whose dependencies are all `completed`, and dispatches it.

---

## 2. Plan Document Architecture

### 2.1 Inline Work Units (THE Key Decision)

**Work units live inline in the parent plan document.** They are NOT separate `active-*` files.

This solves the critical context-bloat problem identified by Scout: currently, ALL `active-*` plans are loaded into every pillar session's system prompt. If decomposition created 10 active sub-plans, every Forge session would get 10x the plan content — most of it irrelevant.

By keeping work units inline in a single plan document, we get:
- **One active plan** loads into context (the parent plan)
- **Targeted injection** — Flow extracts only the relevant work unit spec when dispatching a Forge
- **Single source of truth** — all status, dependencies, and results in one file
- **Flat convention preserved** — no new file naming patterns needed

### 2.2 Parent Plan Structure

The parent plan adds a `## Work Units` section after the standard plan sections:

```markdown
# Build the Verifesto SaaS Platform

## Status
- [x] Scout: Complete — .paloma/docs/scout-verifesto-saas-20260301.md
- [x] Chart: Complete
- [x] Decomposition: 12 work units across 4 features
- [ ] Forge: In Progress (7/12 complete)
- [ ] Polish: Pending
- [ ] Ship: Pending

## Research References
- Architecture: .paloma/docs/scout-verifesto-saas-20260301.md
- Django patterns: .paloma/docs/ref-django-drf-patterns.md

## Goal
Build the Verifesto Studios SaaS platform with user auth, 
intake forms, admin dashboard, and deployment config.

## Architecture Overview
{High-level design from Chart — kept brief, ~2-3 KB max}

## Work Units

### Feature: User Authentication

#### WU-1: Backend Auth Models
- **Status:** completed
- **Depends on:** —
- **Files:** backend/apps/accounts/models.py, backend/apps/accounts/admin.py
- **Scope:** Create User model extending AbstractUser, Profile model with bio/avatar
- **Acceptance:** Models exist, makemigrations succeeds, admin registered
- **Result:** Completed by Forge. Models created, migrations 0001 generated.

#### WU-2: Auth API Endpoints  
- **Status:** completed
- **Depends on:** WU-1
- **Files:** backend/apps/accounts/serializers.py, backend/apps/accounts/views.py, backend/apps/accounts/urls.py
- **Scope:** Registration, login, logout, password reset endpoints using DRF
- **Acceptance:** All endpoints return correct status codes, tokens issued on login
- **Result:** Completed. 4 endpoints, JWT auth via djangorestframework-simplejwt.

#### WU-3: Frontend Auth Forms
- **Status:** in_progress
- **Depends on:** WU-2
- **Files:** frontend/src/views/LoginView.vue, frontend/src/views/RegisterView.vue, frontend/src/composables/useAuth.js
- **Scope:** Login and registration forms with validation, auth state management
- **Acceptance:** Forms render, validation works, successful login stores token

### Feature: Intake Form
{...more work units...}

## Execution Log
- 2026-03-01 14:00 — WU-1 dispatched to Forge (pillarId: abc-123)
- 2026-03-01 14:12 — WU-1 completed successfully
- 2026-03-01 14:13 — WU-2 dispatched to Forge (reused pillarId: abc-123)
- 2026-03-01 14:28 — WU-2 completed successfully  
- 2026-03-01 14:29 — WU-3 dispatched to Forge (reused pillarId: abc-123)
```

### 2.3 Work Unit Specification Format

Each work unit has exactly these fields:

| Field | Required | Description |
|-------|----------|-------------|
| **Status** | Yes | `pending`, `in_progress`, `completed`, `failed`, `skipped` |
| **Depends on** | Yes | List of WU-IDs that must complete first, or `—` for none |
| **Files** | Yes | Exhaustive list of files this unit will create or modify |
| **Scope** | Yes | 1-3 sentence description of what to build |
| **Acceptance** | Yes | How to verify success (testable criteria) |
| **Pipeline** | No | Which pillars to run. Default: `forge` only (Chart already planned) |
| **Result** | No | Added by Flow after completion — brief summary of what happened |

### 2.4 Status Tracking

The parent plan tracks aggregate status in the standard Status section:

```markdown
## Status
- [x] Scout: Complete
- [x] Chart: Complete  
- [x] Decomposition: 12 work units across 4 features
- [ ] Forge: In Progress (7/12 complete, 1 in progress, 4 pending)
- [ ] Polish: Pending
- [ ] Ship: Pending
```

Each work unit tracks its own status inline. Flow updates both levels after each Forge callback.

### 2.5 Preventing Context Bloat

The parent plan document will grow as work units accumulate results. To keep it manageable:

1. **Result summaries are brief** — 1-2 sentences max per work unit
2. **Architecture Overview is kept to ~2-3 KB** — detailed design stays in Scout docs
3. **Execution Log is append-only** — can be trimmed if the plan gets too large
4. **Completed work units are collapsed** — Flow can move detailed results to a separate `.paloma/docs/results-{scope}-{date}.md` if the plan exceeds ~20 KB

**Target plan size with decomposition: 8-20 KB.** This is comparable to current plans (14-30 KB) and well within context budget.

### 2.6 How Forge Receives Its Work Unit

When Flow dispatches a Forge for a specific work unit, it does NOT rely on the full plan being in the system prompt. Instead, Flow crafts a targeted prompt:

```
Build WU-3 from the Verifesto SaaS plan.

## Your Task
Create login and registration forms with validation, and auth 
state management composable.

## Files to Create/Modify
- frontend/src/views/LoginView.vue (new)
- frontend/src/views/RegisterView.vue (new)  
- frontend/src/composables/useAuth.js (new)

## Context
- The backend auth API is already built (WU-1, WU-2 completed)
- Endpoints: POST /api/auth/register/, POST /api/auth/login/, POST /api/auth/logout/
- JWT auth via djangorestframework-simplejwt
- Read the active plan for full architecture context

## Acceptance Criteria
- Forms render correctly with Tailwind styling
- Email and password validation works
- Successful login stores JWT token and redirects
- Auth composable provides reactive isAuthenticated state

## References
- Read .paloma/docs/scout-verifesto-saas-20260301.md section "Auth Architecture" for API details
```

This prompt gives Forge exactly what it needs without bloating its context with the 11 other work units. The active plan is still in the system prompt for broad context, but the specific work unit details come from Flow's dispatch prompt.

---

## 3. Dependency Graph

### 3.1 Expressing Dependencies

Dependencies are expressed as WU-ID references in each work unit's `Depends on` field:

```markdown
#### WU-5: Dashboard Layout
- **Depends on:** WU-1, WU-3
```

This means WU-5 cannot start until both WU-1 and WU-3 are completed.

**Dependency types:**
- **Data dependency:** WU-5 needs models created by WU-1
- **API dependency:** WU-5 needs endpoints created by WU-3  
- **File dependency:** WU-5 modifies a file created by WU-3

All types are expressed the same way — the `Depends on` field. Flow doesn't need to know WHY the dependency exists, only that it does.

### 3.2 Execution Order Algorithm

Flow determines what to execute next with this simple algorithm:

```
1. Read the plan document
2. Find all work units with status = "pending"
3. For each pending unit:
   a. Check if ALL dependencies have status = "completed"
   b. If yes → unit is "ready"
   c. If no → unit is "blocked"
4. From ready units:
   a. If no Forge is currently running → dispatch the first ready unit
   b. If a Forge IS running → check file-disjointness (see §4)
      - If disjoint → can dispatch in parallel
      - If overlapping → wait
5. Update the dispatched unit's status to "in_progress"
```

Flow runs this algorithm:
- After each pillar callback (a Forge completes → check what's next)
- When Adam asks about progress
- When explicitly resuming an orchestration

### 3.3 State Machine

Each work unit follows this state machine:

```
pending → in_progress → completed
                     → failed → (manual intervention) → pending (retry)
                                                      → skipped
```

State transitions:
- `pending → in_progress`: Flow dispatches a Forge for this unit
- `in_progress → completed`: Forge completes successfully, Flow verifies
- `in_progress → failed`: Forge errors out or produces incorrect results
- `failed → pending`: Adam approves retry (Flow resets the unit)
- `failed → skipped`: Adam decides to skip this unit

### 3.4 Failure Handling

When a work unit fails:

1. **Flow marks it as `failed`** with a brief reason in the Result field
2. **Dependents are NOT automatically failed** — they remain `pending` but are effectively blocked
3. **Flow reports to Adam:** "WU-3 failed because [reason]. Its dependents (WU-5, WU-7) are blocked. Options: retry WU-3, skip it and adjust dependents, or redesign."
4. **Adam decides:** retry, skip, or return to Chart for redesign

Flow does NOT automatically retry. Automatic retries waste context and often repeat the same failure. Human judgment is needed.

**What if a Forge crashes mid-work?**
- The 30-minute timeout kills the session
- Partial work may exist on disk (files created/modified but not all)
- Flow detects this via the error callback and marks the unit as `failed`
- On retry, the new Forge session reads the partially-modified files and continues from there

---

## 4. Parallel Execution Strategy

### 4.1 Chosen Approach: File-Disjoint Parallelism

**Decision: Only parallelize work units that touch completely different files.** All work happens on the same branch, in the same working directory.

**Why this approach:**
- **No parallelism** is too conservative — some projects have genuinely independent streams (backend vs. frontend)
- **Branch-per-task** adds merge complexity and conflict resolution that Flow can't handle well
- **Git worktrees** require filesystem setup, path coordination, and merge steps — too much infrastructure
- **File-disjoint** is simple, safe, and sufficient. If two units touch different files, they can't conflict.

### 4.2 Verifying File-Disjointness

Before parallelizing, Flow checks the `Files` field of each work unit:

```
WU-3 Files: frontend/src/views/LoginView.vue, frontend/src/views/RegisterView.vue
WU-6 Files: backend/apps/intake/models.py, backend/apps/intake/views.py

Intersection: empty → SAFE to parallelize
```

```
WU-4 Files: frontend/src/router/index.js, frontend/src/App.vue  
WU-5 Files: frontend/src/views/DashboardView.vue, frontend/src/router/index.js

Intersection: frontend/src/router/index.js → NOT SAFE, must run sequentially
```

This is a simple string comparison on the file paths. Flow does this in-conversation when deciding whether to dispatch a second Forge.

### 4.3 Parallel Execution Limits

**Maximum concurrent Forge sessions: 2.**

Why not more?
- Each Forge session consumes system resources (CLI subprocess, context window)
- Flow must track outputs from each concurrent session
- More than 2 concurrent sessions makes Flow's own context management harder
- Two is enough to get the primary benefit: backend + frontend in parallel

### 4.4 Result Integration

When parallel Forge sessions complete:
1. Each session's work is already on disk (same branch, different files)
2. Flow receives callbacks (possibly batched if they finish close together)
3. Flow reads each callback, updates the plan's work unit statuses
4. No merge step needed — file-disjoint means no conflicts
5. Flow then checks what's unblocked and dispatches the next batch

---

## 5. Flow Context Management

### 5.1 The Problem

Flow is the persistent session. Over a long orchestration with 12 work units, Flow accumulates:
- 12 dispatch prompts (Flow → Forge)
- 12 callback notifications (Forge → Flow)  
- 12 plan updates (Flow reads/writes the plan)
- Adam's messages throughout
- Total: potentially 100+ KB of accumulated context

### 5.2 Solution: Disk-First State Management

**Core principle: The plan document on disk IS Flow's state. Flow's conversation context is expendable.**

Flow's workflow for each work unit:

1. **Read** the plan from disk (get current status)
2. **Decide** what to dispatch next (analyze dependencies)
3. **Write** the updated status to disk (mark unit as in_progress)
4. **Dispatch** the Forge with a targeted prompt
5. **Stop** and wait for callback
6. **Receive** callback → read Forge output
7. **Write** results to disk (mark unit as completed, add Result)
8. **Report** briefly to Adam
9. Go to step 1

Because all state lives in the plan document, Flow can lose its conversation context (via compression or even session restart) and recover by re-reading the plan. This is why work unit status, dependency tracking, and results are all persisted to disk — not held in Flow's memory.

### 5.3 No Sub-Flows

**Decision: Flow remains singular.** No sub-Flow sessions.

Why:
- `PillarManager` currently supports exactly one `flowSession`. Supporting multiple would require significant refactoring of the callback system, notification routing, and session registration.
- Sub-Flows would need their own plan documents, their own pillar dispatch capabilities, and a way to report back to the parent Flow — essentially rebuilding the entire orchestration layer.
- The benefit is marginal. Flow's disk-first state management means it can handle 12-20 work units without context overflow, because it checkpoints to disk after every operation.
- Sub-Flows add a failure mode (sub-Flow crashes mid-orchestration) that's harder to recover from than a single Flow that checkpoints.

**If we ever need deeper orchestration (managing 50+ work units), the right answer is to decompose at the project level first — split into separate plans for separate components, each with its own Scout→Ship pipeline.**

### 5.4 Flow Context Budget

With disk-first state management, Flow's context at any given moment contains:
- Its system prompt (~54 KB, same as today)
- The current operation's context (reading plan, dispatching, handling callback)
- Recent conversation with Adam
- **Not** the full history of all dispatches and callbacks

The Claude CLI's context compression handles the rest — old dispatch/callback pairs compress naturally because they're repetitive structured text.

### 5.5 Maximum Work Units

**Recommended limit: 15-20 work units per plan.**

Beyond 20 units:
- The plan document itself gets unwieldy (>25 KB)
- Flow's orchestration loop becomes repetitive
- Better to split into multiple plans (one per major feature)

If a project genuinely needs >20 work units, decompose at the plan level: create separate plans for separate features, each managed by its own Scout→Ship pipeline. Flow orchestrates between plans, not within a single mega-plan.

---

## 6. PillarManager Changes

### 6.1 System Prompt Changes (`_buildSystemPrompt`)

**Current behavior:** Loads ALL `active-*` plans into every pillar's system prompt.

**New behavior:** Add an optional `planFilter` parameter to `_buildSystemPrompt`:

```javascript
async _buildSystemPrompt(pillar, { planFilter } = {}) {
  // ... existing code for base, instructions, roots, phase ...
  
  // Read active plans — with optional filtering
  const plansDir = join(this.projectRoot, '.paloma', 'plans')
  let plans = await this._readActiveFiles(plansDir, 'active-')
  
  if (planFilter) {
    // Only load the specific plan file
    plans = plans.filter(p => p.name === planFilter)
  }
  
  // ... rest of prompt assembly ...
}
```

**This is a surgical change** — one `if` block in one method. The default behavior (no `planFilter`) is identical to today. When Flow dispatches a Forge for a specific work unit, it can pass the relevant plan file name.

### 6.2 Spawn Changes

Add optional `planFile` parameter to `spawn()`:

```javascript
async spawn({ pillar, prompt, model, flowRequestId, planFile }) {
  // ... existing code ...
  
  // Build system prompt with optional plan filtering
  const systemPrompt = await this._buildSystemPrompt(pillar, {
    planFilter: planFile
  })
  
  // ... rest of spawn ...
}
```

**This is additive** — existing calls without `planFile` work exactly as before.

### 6.3 MCP Tool Update

Update the `pillar_spawn` tool definition in `mcp-proxy-server.js` to accept `planFile`:

```javascript
{
  name: 'pillar_spawn',
  inputSchema: {
    type: 'object',
    properties: {
      pillar: { type: 'string', enum: ['scout', 'chart', 'forge', 'polish', 'ship'] },
      prompt: { type: 'string' },
      model: { type: 'string', enum: ['opus', 'sonnet', 'haiku'] },
      planFile: { type: 'string', description: 'Optional: only load this specific plan file into the system prompt (e.g., "active-20260301-verifesto-saas.md")' }
    },
    required: ['pillar', 'prompt']
  }
}
```

### 6.4 New MCP Tool: `pillar_decompose`

A convenience tool that helps Flow write work units. This is NOT strictly necessary (Flow can use `edit_file` directly), but it standardizes the format:

```javascript
{
  name: 'pillar_decompose',
  description: 'Add or update a work unit in a plan document. Appends a formatted work unit spec to the ## Work Units section.',
  inputSchema: {
    type: 'object',
    properties: {
      planFile: { type: 'string', description: 'Plan filename (e.g., "active-20260301-verifesto-saas.md")' },
      unitId: { type: 'string', description: 'Work unit ID (e.g., "WU-1")' },
      feature: { type: 'string', description: 'Feature group name' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'] },
      dependsOn: { type: 'array', items: { type: 'string' }, description: 'WU-IDs this depends on' },
      files: { type: 'array', items: { type: 'string' }, description: 'Files to create/modify' },
      scope: { type: 'string', description: '1-3 sentence description' },
      acceptance: { type: 'string', description: 'How to verify success' },
      result: { type: 'string', description: 'Completion summary (set after done)' }
    },
    required: ['planFile', 'unitId', 'scope', 'files']
  }
}
```

**Implementation note:** This tool reads the plan file, finds or creates the `## Work Units` section, and inserts/updates the work unit spec in the standardized format. It's a structured wrapper around file editing — prevents formatting errors and enforces consistency.

**On reflection, I'm going to recommend DEFERRING this tool to Phase 3.** Flow can write work units directly using `edit_file` in Phases 1-2. The tool is nice-to-have, not essential. Let's prove the architecture works with manual file editing first, then add the convenience tool.

### 6.5 Callback Handling Changes

**No changes needed.** The existing callback system handles recursive orchestration naturally:

1. Forge completes → PillarManager sends `[PILLAR CALLBACK]` to Flow
2. Flow reads the callback, updates the plan on disk, dispatches next unit
3. Repeat

The callback batching (`_buildBatchedNotification`) already handles the case where two parallel Forges complete close together.

### 6.6 `flowSession` — No Changes

Flow remains a single session. No need to support multiple Flow sessions. The `flowSession` property stays as-is.

### 6.7 Timeout Considerations

The 30-minute `MAX_RUNTIME_MS` is adequate for work units scoped to 5-20 minutes. No change needed.

If a work unit is well-scoped (1-5 files), a Forge session should complete well within 30 minutes. If it consistently times out, the work unit is too large and should be re-scoped.

---

## 7. Concrete Test Case: Verifesto Studios SaaS Platform

### 7.1 The Project

"Build the Verifesto Studios SaaS platform" — a full-stack web application with:
- User authentication
- Client intake forms  
- Admin dashboard
- Calendar integration
- Deployment configuration

This is a real project Adam is building. It's too large for a single Forge session.

### 7.2 Decomposition

After Scout researches and Chart designs the architecture, Flow decomposes into:

**Feature: Backend Foundation**
| ID | Scope | Files | Depends On |
|----|-------|-------|------------|
| WU-1 | Django project scaffold with settings, urls, wsgi | 5 config files | — |
| WU-2 | User model extending AbstractUser + admin registration | 3 files | WU-1 |
| WU-3 | Intake app: models, serializers, views, urls | 4 files | WU-1 |
| WU-4 | Auth API: registration, login, JWT endpoints | 3 files | WU-2 |

**Feature: Frontend Foundation**
| ID | Scope | Files | Depends On |
|----|-------|-------|------------|
| WU-5 | Vue 3 + Vite scaffold with Tailwind, router, base layout | 5 config + layout files | — |
| WU-6 | Landing page + intake form (multi-step) | 3 view/component files | WU-5 |
| WU-7 | Auth forms: login, register, composable | 3 files | WU-5 |

**Feature: Integration**
| ID | Scope | Files | Depends On |
|----|-------|-------|------------|
| WU-8 | Frontend API client + CORS config | 2 files (1 FE, 1 BE) | WU-3, WU-6 |
| WU-9 | Connect auth forms to auth API | 2 files | WU-4, WU-7, WU-8 |

**Feature: Deployment**
| ID | Scope | Files | Depends On |
|----|-------|-------|------------|
| WU-10 | Production settings: DATABASE_URL, STATIC_ROOT, .env.example | 3 files | WU-1 |
| WU-11 | Frontend build verification + .gitignore setup | 2 files | WU-5 |
| WU-12 | Final git commit + deploy docs | 2 files | ALL previous |

### 7.3 Dependency Graph

```
WU-1 ──┬── WU-2 ── WU-4 ──┐
       │                    ├── WU-9 ──┐
       ├── WU-3 ── WU-8 ──┘           │
       │              ↑                │
       ├── WU-10      │                ├── WU-12
       │              │                │
WU-5 ──┼── WU-6 ─────┘                │
       │                               │
       ├── WU-7 ── (WU-9) ────────────┘
       │
       └── WU-11
```

### 7.4 Execution Order

**Round 1 (parallel):**
- WU-1 (Backend scaffold) — no dependencies
- WU-5 (Frontend scaffold) — no dependencies
- *File-disjoint: YES (backend/ vs. frontend/). Safe to parallelize.*

**Round 2 (parallel — after WU-1 and WU-5 complete):**
- WU-2 (User models) — depends on WU-1 ✅
- WU-3 (Intake app) — depends on WU-1 ✅
- WU-6 (Landing + intake form) — depends on WU-5 ✅
- WU-10 (Production settings) — depends on WU-1 ✅
- WU-7 (Auth forms) — depends on WU-5 ✅
- WU-11 (Build verification) — depends on WU-5 ✅
- *Max 2 concurrent Forge sessions. Flow picks 2 file-disjoint units.*
- *Dispatch: WU-2 + WU-6 (backend/accounts vs. frontend/views — disjoint)*

**Round 3, 4, 5...** Flow continues dispatching ready units, 1-2 at a time.

**Round N (final):**
- WU-12 (Final commit) — depends on ALL previous ✅

### 7.5 Flow Orchestration Step-by-Step

1. Flow reads the plan, sees WU-1 and WU-5 are ready
2. Flow dispatches Forge for WU-1 with targeted prompt (backend scaffold)
3. Flow dispatches Forge for WU-5 with targeted prompt (frontend scaffold)  
4. Flow updates plan: WU-1 = in_progress, WU-5 = in_progress
5. Flow STOPS and waits for callbacks
6. [PILLAR CALLBACK] WU-1's Forge completes
7. Flow reads output, verifies, updates plan: WU-1 = completed
8. Flow checks what's unblocked: WU-2, WU-3, WU-10 are now ready
9. WU-5's Forge is still running — wait before dispatching (or dispatch WU-2 if file-disjoint with WU-5's current work)
10. [PILLAR CALLBACK] WU-5's Forge completes
11. Flow updates plan: WU-5 = completed
12. Flow dispatches next pair: WU-2 + WU-6
13. ... continue until WU-12

### 7.6 Estimated Timeline

| Round | Units | Estimated Time | Cumulative |
|-------|-------|---------------|------------|
| 1 | WU-1, WU-5 | 10 min (parallel) | 10 min |
| 2 | WU-2, WU-6 | 15 min (parallel) | 25 min |
| 3 | WU-3, WU-7 | 12 min (parallel) | 37 min |
| 4 | WU-4, WU-10 | 10 min (parallel) | 47 min |
| 5 | WU-8, WU-11 | 10 min (parallel) | 57 min |
| 6 | WU-9 | 10 min | 67 min |
| 7 | WU-12 | 5 min | 72 min |

**Total: ~72 minutes** with parallel execution, vs. ~120+ minutes sequential. 

Without recursive decomposition: this would be one mega-Forge session that runs for 2+ hours (probably hitting the 30-min timeout or context overflow).

---

## 8. Implementation Roadmap

### Phase 1: Plan Format + Flow Instructions (MVP)

**Scope:** Teach Flow how to decompose and orchestrate work units. No code changes to PillarManager yet — Flow uses existing tools.

**What changes:**
1. Update `src/prompts/phases.js` — add decomposition instructions to Flow's phase prompt
2. Update `src/prompts/base.js` — add work unit format documentation
3. Create a template/example in `.paloma/docs/ref-work-unit-format.md`

**What Flow can do after Phase 1:**
- Decompose a Chart plan into work units (writes them to the plan document manually)
- Track work unit status by editing the plan document
- Dispatch Forge sessions with targeted prompts (manually crafting the prompt from the work unit spec)
- Handle the orchestration loop (callback → update plan → dispatch next)

**What Flow CANNOT do yet:**
- Filter plan loading per pillar (all active plans still load into every session)
- Use a `planFile` parameter on `pillar_spawn`

**Files to modify:**
- `src/prompts/phases.js` (~50 lines added to Flow section)
- `src/prompts/base.js` (~30 lines added, work unit format docs)

**Files to create:**
- `.paloma/docs/ref-work-unit-format.md` (~3 KB reference doc)

**Estimated effort:** Small — single Forge session, <30 min.

**Why this is the MVP:** Flow is smart enough to do the orchestration with existing tools. The plan document format and Flow's prompt update are all that's needed to start using recursive decomposition. Everything else is optimization.

---

### Phase 2: Plan-Scoped System Prompts

**Scope:** Add `planFile` parameter to `pillar_spawn` so each pillar session only loads the relevant plan.

**What changes:**
1. `bridge/pillar-manager.js` — add `planFilter` parameter to `_buildSystemPrompt()`, add `planFile` to `spawn()`
2. `bridge/mcp-proxy-server.js` — add `planFile` to the `pillar_spawn` tool schema
3. Update `src/prompts/phases.js` — document the `planFile` parameter in Flow's orchestration instructions

**What this enables:**
- Forge sessions spawned for a specific work unit only load that plan in their system prompt
- Reduces system prompt size when multiple plans are active
- Prevents work unit cross-contamination

**Files to modify:**
- `bridge/pillar-manager.js` (~10 lines changed in `_buildSystemPrompt` and `spawn`)
- `bridge/mcp-proxy-server.js` (~5 lines added to tool schema)
- `src/prompts/phases.js` (~10 lines added to Flow section)

**Estimated effort:** Small — single Forge session, <20 min.

---

### Phase 3: Convenience Tooling

**Scope:** Add the `pillar_decompose` tool for structured work unit management.

**What changes:**
1. `bridge/pillar-manager.js` — add `decompose()` method that reads/writes plan files
2. `bridge/mcp-proxy-server.js` — add `pillar_decompose` tool definition and handler
3. Update `src/prompts/phases.js` — document the new tool

**What this enables:**
- Flow can create/update work units with a structured tool call instead of raw file editing
- Consistent formatting guaranteed
- Status transitions validated (can't go from `pending` to `completed` without passing through `in_progress`)

**Files to modify:**
- `bridge/pillar-manager.js` (~80 lines added)
- `bridge/mcp-proxy-server.js` (~30 lines added)
- `src/prompts/phases.js` (~15 lines added)

**Estimated effort:** Medium — single Forge session, ~30 min.

---

### Phase 4: Orchestration Automation

**Scope:** Add a `pillar_orchestrate` tool that automates the dispatch loop — Flow calls it once and it handles the "check what's ready, dispatch, wait, repeat" cycle.

**What changes:**
1. `bridge/pillar-manager.js` — add `orchestrate()` method that:
   - Reads the plan document
   - Parses work units and dependencies
   - Determines ready units
   - Dispatches Forge sessions
   - Returns the dispatch decisions to Flow for confirmation
2. `bridge/mcp-proxy-server.js` — add `pillar_orchestrate` tool
3. Update `src/prompts/phases.js`

**What this enables:**
- Flow calls `pillar_orchestrate({ planFile: "..." })` and gets back: "Ready: WU-2, WU-6. Blocked: WU-9 (waiting on WU-4, WU-7). Recommended: dispatch WU-2 + WU-6 in parallel (file-disjoint)."
- Flow approves or adjusts, then the tool dispatches
- Reduces Flow's per-step context usage

**Files to modify:**
- `bridge/pillar-manager.js` (~150 lines added)
- `bridge/mcp-proxy-server.js` (~40 lines added)
- `src/prompts/phases.js` (~20 lines added)

**Estimated effort:** Medium-large — single Forge session, ~45 min.

**Note:** This phase is optional. Flow can orchestrate manually using Phases 1-3 indefinitely. Phase 4 is a productivity optimization for when Adam is running many decomposed projects.

---

## Files to Create / Modify (All Phases)

### Phase 1
| File | Action | Lines Changed |
|------|--------|--------------|
| `src/prompts/phases.js` | Modify | ~50 lines added to Flow section |
| `src/prompts/base.js` | Modify | ~30 lines added (work unit format) |
| `.paloma/docs/ref-work-unit-format.md` | Create | ~3 KB |

### Phase 2
| File | Action | Lines Changed |
|------|--------|--------------|
| `bridge/pillar-manager.js` | Modify | ~10 lines |
| `bridge/mcp-proxy-server.js` | Modify | ~5 lines |
| `src/prompts/phases.js` | Modify | ~10 lines |

### Phase 3
| File | Action | Lines Changed |
|------|--------|--------------|
| `bridge/pillar-manager.js` | Modify | ~80 lines added |
| `bridge/mcp-proxy-server.js` | Modify | ~30 lines added |
| `src/prompts/phases.js` | Modify | ~15 lines |

### Phase 4
| File | Action | Lines Changed |
|------|--------|--------------|
| `bridge/pillar-manager.js` | Modify | ~150 lines added |
| `bridge/mcp-proxy-server.js` | Modify | ~40 lines added |
| `src/prompts/phases.js` | Modify | ~20 lines added |

---

## Risk Assessment

### Low Risk
- **Phase 1 (prompt updates)** — text-only changes, no runtime behavior change, fully backward compatible
- **Phase 2 (plan filtering)** — additive parameter with default fallback to current behavior
- **Work unit format** — convention-based, no code enforces it, easy to iterate

### Medium Risk
- **Parallel Forge execution** — file-disjoint check is only as good as the `Files` specification in work units. If a Forge modifies an unlisted file, conflicts can occur.
  - **Mitigation:** Flow reviews each Forge's actual changes (via `git diff`) against the planned file list. If unexpected files were modified, flag it.
- **Flow context accumulation** — long orchestrations with many callbacks could fill Flow's context
  - **Mitigation:** Disk-first state management means Flow can survive context compression. The plan document is always the source of truth.

### Low-Probability / High-Impact
- **Bridge crash during orchestration** — PillarManager state is in-memory, lost on restart
  - **Mitigation:** Plan document on disk preserves all work unit status. After bridge restart, Flow re-reads the plan and resumes from the last known state. Partially-completed Forge work is on disk (files modified but not committed).
  - **Long-term fix (not in this plan):** Persist `PillarManager.pillars` to disk for crash recovery.

---

## Design Principles Summary

1. **Plan document is the source of truth.** Everything else is derived or expendable.
2. **Inline over separate files.** Work units in the plan, not as separate active plans.
3. **Flow orchestrates, disk persists.** Flow's conversation context is transient; the plan on disk is durable.
4. **Backward compatible by default.** No decomposition overhead for small tasks. The `planFile` parameter is optional.
5. **Simple over clever.** File-disjoint parallelism, manual dependency tracking, 2-level recursion limit. These are constraints that keep the system understandable.
6. **Human in the loop.** Flow recommends, Adam approves. Failed units wait for human decision. No automatic retries.
7. **Phased implementation.** Phase 1 (prompt updates) is usable immediately. Each subsequent phase is an independent improvement.

---

## Appendix: Context Budget Validation

**Scenario: 12 work units, Phase 2 implemented (plan filtering)**

```
Forge session for WU-3:
  Base instructions:     ~11.4 KB  (~2,850 tokens)
  Project instructions:   ~1.4 KB  (~350 tokens)
  Roots (7 files):       ~24.9 KB  (~6,225 tokens)
  Phase instructions:     ~1.5 KB  (~375 tokens)
  Active plan (1 file):  ~18.0 KB  (~4,500 tokens)  ← the parent plan with WUs
  ─────────────────────────────────────────────────
  System prompt total:   ~57.2 KB  (~14,300 tokens)

  Flow's dispatch prompt:  ~1.5 KB  (~375 tokens)  ← targeted WU spec
  ─────────────────────────────────────────────────
  Budget used:           ~58.7 KB  (~14,675 tokens)
  
  Remaining for work:    ~185,325 tokens (~741 KB)
```

This is comfortable. Even with a large parent plan, each Forge session has >90% of its context available for actual work.

**Scenario: Same without plan filtering (current system, 3 active plans)**

```
  System prompt with 3 active plans:
  Fixed costs:           ~39.2 KB  (~9,800 tokens)
  3 active plans:        ~45.0 KB  (~11,250 tokens)
  ─────────────────────────────────────────────────
  Total:                 ~84.2 KB  (~21,050 tokens)
  
  Remaining:             ~178,950 tokens (~715 KB)
```

Still workable in absolute terms, but 10.5% of context consumed before work begins vs. 7.3% with plan filtering. The benefit of Phase 2 grows with the number of concurrent active plans.

---

**Chart phase complete. Ready for Flow review and Forge execution.**
