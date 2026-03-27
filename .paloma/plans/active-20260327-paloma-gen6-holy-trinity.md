# Gen6 "Holy Trinity" Singularity Architecture

**Status:** active  
**Date:** 2026-03-27  
**Scope:** paloma  
**Pillar:** Chart → Forge → Polish → Ship

---

## Status Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| Scout | ✅ done | Research in `.paloma/docs/scout-gen6-holy-trinity-research-20260326.md` |
| Chart | ✅ done | This document |
| Forge | ⬜ ready | WU-1 and WU-2 parallelizable |
| Polish | ⬜ waiting | |
| Ship | ⬜ waiting | |

---

## Research References

- `.paloma/docs/scout-gen6-holy-trinity-research-20260326.md` — full architecture survey

---

## Goal

Implement Gen6 "The Holy Trinity" singularity: **two 7B Arms** that independently plan in parallel while a **32B Mind** loads, then the Mind reads both plans, synthesizes the best strategy, and executes with full tools.

The core insight is **the model load time gap**: 7B models are nearly instant; 32B takes several seconds. That loading gap is used productively — both Arms finish planning by the time the Mind is ready to think. The Mind never waits idle.

---

## Architecture Overview

```
Flow spawns: pillar_spawn({ singularityRole: 'holy-trinity', prompt: '...' })
                                    │
                    _spawnHolyTrinity() ─────────────────────────────────────────┐
                          │                                                       │
         ┌────────────────┼────────────────┐                                     │
         │                │                │                                     │
   Arm 1 spawns     Arm 2 spawns     Mind spawns                                 │
  (7B, instant)    (7B, instant)    (32B, slow load)                             │
         │                │                │                                     │
  writes plan to   writes plan to   polls workspace/                             │
  arm-{id}-1.md    arm-{id}-2.md    until both appear                            │
         │                │                │                                     │
         └───── done ─────┘         reads both plans                             │
                                     synthesizes best                            │
                                   executes with full                            │
                                         tools                                   │
                                           │                                     │
                                     writes summary                              │
                                     to workspace/                               │
                                     mind-{id}.md  ─────────────────────────────┘
```

---

## Key Design Decisions

### 1. Invocation — New `singularityRole: 'holy-trinity'`

Flow calls `pillar_spawn({ singularityRole: 'holy-trinity', prompt: '...' })`.

The `spawn()` method detects this role before the standard flow and delegates to `_spawnHolyTrinity()`. This mirrors exactly how `recursive && !singularityRole` triggers `_spawnSingularityGroup()` today.

### 2. File Coordination — No Signal Files Needed

Each Arm writes its plan to a **single file** in one `write_file` call. Since `write_file` is atomic (once visible in a directory listing, the file is fully written), the Mind just polls `list_directory('.singularity/workspace/')` until both plan files appear. No `.ready` signal files required.

**File naming uses a short trinity ID** to avoid conflicts between concurrent runs:
- `arm-{trinityId}-1.md` — Arm 1's plan
- `arm-{trinityId}-2.md` — Arm 2's plan  
- `mind-{trinityId}.md` — Mind's execution summary (written at completion)

The `trinityId` is `randomUUID().slice(0, 8)` — short enough to be readable, unique enough to prevent collisions.

### 3. Tool Restriction — Arms Get Filesystem Only

Arms receive **only `filesystem__*` tools** — all tools from the `filesystem` MCP server and nothing else. This is enforced in `_buildOllamaTools()` via a dedicated early-return branch for `holy-trinity-arm`.

Arms CAN read project files (to inform their plan) but can only WRITE to the workspace (enforced by prompt). No git, no shell, no web, no voice, no memory.

The Mind gets **all OLLAMA_ALLOWED_SERVERS tools** — the full standard Ollama toolkit. No `spawn_next` (the Mind executes, it doesn't evolve).

### 4. Spawning — All Three Simultaneous

`_spawnHolyTrinity()` spawns all three sessions back-to-back without awaiting completion. The existing Ollama spawn queue handles concurrency (MAX_CONCURRENT_OLLAMA=4). Three sessions is within the limit; if the queue is full, they'll queue and dequeue as slots open.

The Mind's `pillarId` is what gets returned to the caller (it's the primary session). Arms are registered with the trinity group and their pillarIds tracked there.

**Parent-child for stop-tree**: Arms are spawned with `parentPillarId = mindPillarId`. This means `pillar_stop_tree` on the Mind kills both Arms automatically.

To pass the Mind's ID to Arms before the Mind is spawned, we pre-generate the Mind's `pillarId` as a UUID and pass it as `parentPillarId` when spawning Arms. Then when spawning the Mind, we pass `pillarId: preMindId` so it registers under that ID.

> **Implementation note:** The current `spawn()` method generates its own `pillarId` internally. Forge will need to either (a) accept an optional `pillarId` override parameter, or (b) spawn the Mind first and Arms second — accepting that Arms arrive slightly after Mind rather than slightly before. Option (b) is simpler and doesn't require interface changes.

**Recommended approach: Mind spawns first, Arms second.** The Mind's first action after spawning is to poll for plans — it won't execute until both arms have written. Arms spawning a few milliseconds after Mind is fine because the 32B model will be loading for several seconds anyway. Arms (7B, near-instant load) will complete their planning long before the Mind finishes loading.

### 5. Context Windows

| Role | numCtx | Rationale |
|------|--------|-----------|
| `holy-trinity-arm` | 16384 | Needs to read the task and some project context, write a plan |
| `holy-trinity-mind` | 65536 | Full context — reads two plans, executes the task |

### 6. System Prompt — Singularity Context Strip

Both `holy-trinity-arm` and `holy-trinity-mind` are treated as singularity sessions (`isSingularity = true`). This means:
- No active plans injected (irrelevant to the trinity task)
- No roots injected (saves ~5.5K tokens)
- No phase instructions (they have their own identity)
- `OLLAMA_INSTRUCTIONS` base instead of `BASE_INSTRUCTIONS`

Project instructions (`.paloma/instructions.md`) are still included since they're not `claudeBackend`.

---

## Prompts

### `HOLY_TRINITY_ARM_PROMPT`

Template variables: `{TASK}`, `{PLAN_PATH}`, `{WORKSPACE_PATH}`, `{ARM_NUMBER}`

```
/no_think

# You Are Arm {ARM_NUMBER}

You are one of two independent strategists in the Holy Trinity. You cannot see the other arm's work — that's intentional. Fresh eyes. Independent thinking.

## The Task

{TASK}

## Your Mission

Analyze this task and write a complete plan. That's all you do. You don't execute.

**Write your plan to:** `{PLAN_PATH}`

Your plan should include:
1. **Strategy** — your overall approach and why
2. **Steps** — specific ordered steps to accomplish the task
3. **Files** — which files to create, modify, or read (with exact paths)
4. **Edge cases** — what could go wrong and how to handle it
5. **Rationale** — why this is the best approach

## Rules

- Write ONLY to `{PLAN_PATH}` — your assigned workspace file
- You may read project files to understand context — but read, don't modify
- Do NOT execute any code, git operations, or make any changes
- Your job is thinking and planning ONLY
- The Mind will execute — you just give it the best map you can
- When your plan is fully written, you are done

Be thorough. Be specific. File paths, function names, exact steps. The Mind will use your plan — make it buildable.
```

### `HOLY_TRINITY_MIND_PROMPT`

Template variables: `{TASK}`, `{ARM_1_PLAN_PATH}`, `{ARM_2_PLAN_PATH}`, `{WORKSPACE_PATH}`, `{TRINITY_ID}`

```
/no_think

# You Are the Mind

You are the executor in the Holy Trinity. Two Arms have been spawned alongside you to independently plan the following task:

{TASK}

They are writing their plans right now. Your 32B model took longer to load — by the time you read this, they may already be done.

## Your Arms' Plans

- Arm 1: `{ARM_1_PLAN_PATH}`
- Arm 2: `{ARM_2_PLAN_PATH}`

## Phase 1 — Wait for Plans

Poll the workspace directory until both plan files exist:

```
list_directory('{WORKSPACE_PATH}')
```

Check for `{ARM_1_PLAN_PATH_BASENAME}` and `{ARM_2_PLAN_PATH_BASENAME}`.

- If both exist: proceed immediately
- If only one exists after reasonable polling: proceed with what you have
- Poll up to 20 times before giving up on a missing plan

The Arms load fast. Both plans should appear within seconds. Be patient — their thinking is your starting advantage.

## Phase 2 — Synthesize

Read both plans. Study them carefully.

- If they agree: confidence is high. Execute boldly.
- If they disagree: use your judgment. Pick the stronger approach, or synthesize the best of both.
- Note what you took from each arm's plan (briefly).

## Phase 3 — Execute

You have full tools: files, git, shell, web, memory, voice. Use them.

Execute the task. Do excellent work. The Arms gave you a map — you decide the route.

## Phase 4 — Complete

When done, write a brief summary to `{WORKSPACE_PATH}mind-{TRINITY_ID}.md`:
- What you decided (which plan/synthesis you chose)
- What you actually did
- Any divergences from the plan and why

You are worthy of God's love. Now go build something.
```

> **Implementation note on template variables:** The prompt uses `{ARM_1_PLAN_PATH_BASENAME}` (just the filename, e.g. `arm-abc123-1.md`) in addition to full paths for the directory listing check. `_buildSystemPrompt` will replace all variables.

---

## Integration Points

### `src/prompts/base.js`

**Add:**
```javascript
export const HOLY_TRINITY_ARM_PROMPT = `...` // see above
export const HOLY_TRINITY_MIND_PROMPT = `...` // see above
```

No changes to existing prompts. Pure additions.

---

### `bridge/pillar-manager.js`

#### 1. Import new prompts (line ~4)

```javascript
import { ..., HOLY_TRINITY_ARM_PROMPT, HOLY_TRINITY_MIND_PROMPT } from '../src/prompts/base.js'
```

#### 2. Add `_trinityGroups` to constructor

```javascript
this._trinityGroups = new Map() // trinityGroupId → { mindPillarId, arm1PillarId, arm2PillarId, trinityId }
```

#### 3. `spawn()` — detect `holy-trinity` role (~line 211)

Add before the existing Quinn mode comment:
```javascript
// Holy Trinity: spawn Mind + 2 Arms concurrently
if (singularityRole === 'holy-trinity') {
  return this._spawnHolyTrinity({ pillar, prompt, model, flowRequestId, planFile, backend: resolvedBackend, parentPillarId })
}
```

#### 4. Session record — `numCtx` (~line 312)

Extend the numCtx ternary to handle new roles:
```javascript
numCtx: (singularityRole === 'holy-trinity-mind') ? 65536
      : (singularityRole === 'holy-trinity-arm') ? 16384
      : (singularityRole === 'quinn' || ...) ? 65536
      : ...
```

#### 5. Session record — `singularityRole` enum comment (~line 309)

Update comment to include new roles:
```javascript
singularityRole: singularityRole || null,  // ... | 'holy-trinity' | 'holy-trinity-mind' | 'holy-trinity-arm' | null
```

#### 6. `_buildOllamaTools()` — arm restriction + mind tools

Add as the first check in the method (before the `quinn-legacy` check):
```javascript
// Holy Trinity Arms get ONLY filesystem tools — pure planners, no execution capability
if (session.singularityRole === 'holy-trinity-arm') {
  const tools = []
  if (this.mcpManager) {
    const mcpServers = this.mcpManager.getTools()
    const fsServer = mcpServers['filesystem']
    if (fsServer?.status === 'connected') {
      for (const tool of fsServer.tools) {
        tools.push({
          type: 'function',
          function: {
            name: `filesystem__${tool.name}`,
            description: tool.description || '',
            parameters: tool.inputSchema || { type: 'object', properties: {} }
          }
        })
      }
    }
  }
  log.debug(`Built ${tools.length} Ollama tools for holy-trinity-arm session (filesystem only)`)
  return tools
}

// Holy Trinity Mind gets all standard Ollama tools (no spawn_next — it executes, doesn't evolve)
if (session.singularityRole === 'holy-trinity-mind') {
  // Falls through to standard tool building below — all OLLAMA_ALLOWED_SERVERS tools
  // plus pillar tools (Mind can spawn workers if needed)
  // No early return — let the standard loop run, then add pillar tools
}
```

The Mind falls through to the standard MCP server loop and picks up all `OLLAMA_ALLOWED_SERVERS` tools. The existing `if (session.singularityRole !== 'worker')` check already adds pillar tool defs — that's fine for Mind too.

#### 7. `_buildSystemPrompt()` — isSingularity + prompt injection

**`isSingularity` check** (~line 2749) — add new roles:
```javascript
const isSingularity = singularityRole === 'holy-trinity-arm'
  || singularityRole === 'holy-trinity-mind'
  || singularityRole === 'voice'
  || ... // existing roles
```

**Prompt injection** (~line 2808) — add new cases after existing `else if` chain:
```javascript
} else if (singularityRole === 'holy-trinity-arm') {
  prompt += '\n\n' + HOLY_TRINITY_ARM_PROMPT
    .replace(/\{TASK\}/g, '(see user message)')
    .replace(/\{PLAN_PATH\}/g, session._armPlanPath || '.singularity/workspace/arm-?.md')
    .replace(/\{WORKSPACE_PATH\}/g, '.singularity/workspace/')
    .replace(/\{ARM_NUMBER\}/g, String(session._armNumber || '?'))
} else if (singularityRole === 'holy-trinity-mind') {
  prompt += '\n\n' + HOLY_TRINITY_MIND_PROMPT
    .replace(/\{TASK\}/g, '(see user message)')
    .replace(/\{ARM_1_PLAN_PATH\}/g, session._arm1PlanPath || '.singularity/workspace/arm-?-1.md')
    .replace(/\{ARM_2_PLAN_PATH\}/g, session._arm2PlanPath || '.singularity/workspace/arm-?-2.md')
    .replace(/\{ARM_1_PLAN_PATH_BASENAME\}/g, session._arm1PlanPath?.split('/').pop() || 'arm-?-1.md')
    .replace(/\{ARM_2_PLAN_PATH_BASENAME\}/g, session._arm2PlanPath?.split('/').pop() || 'arm-?-2.md')
    .replace(/\{WORKSPACE_PATH\}/g, '.singularity/workspace/')
    .replace(/\{TRINITY_ID\}/g, session._trinityId || 'unknown')
}
```

> The `{TASK}` substitution says "see user message" because the task arrives as the **user message** (the `prompt` passed to spawn), not the system prompt. This is consistent with how all other singularity roles work — user message carries the task, system prompt carries identity/instructions.

#### 8. `_defaultModel()` — new role routing

```javascript
if (singularityRole === 'holy-trinity-arm') return this._pickBestOllamaModel(true)   // 7B, fast
if (singularityRole === 'holy-trinity-mind') return this._pickBestOllamaModel(false)  // 32B, best
```

#### 9. New method: `_spawnHolyTrinity()`

```javascript
async _spawnHolyTrinity({ pillar, prompt, model, flowRequestId, planFile, backend, parentPillarId }) {
  const trinityGroupId = randomUUID()
  const trinityId = trinityGroupId.slice(0, 8)
  const workspacePath = '.singularity/workspace/'
  const arm1PlanPath = `${workspacePath}arm-${trinityId}-1.md`
  const arm2PlanPath = `${workspacePath}arm-${trinityId}-2.md`

  log.info(`[holy-trinity] Spawning trinity group ${trinityId}`)

  // 1. Spawn Mind first — it becomes the primary session returned to caller
  const mindResult = await this.spawn({
    pillar,
    prompt,
    model: model || null, // _defaultModel will pick 32B
    flowRequestId,
    planFile,
    backend,
    parentPillarId,
    singularityRole: 'holy-trinity-mind'
  })

  if (!mindResult.pillarId) {
    log.error('[holy-trinity] Mind spawn failed')
    return mindResult
  }

  // Attach trinity metadata to Mind session
  const mindSession = this.pillars.get(mindResult.pillarId)
  mindSession._trinityId = trinityId
  mindSession._arm1PlanPath = arm1PlanPath
  mindSession._arm2PlanPath = arm2PlanPath
  mindSession.singularityGroupId = trinityGroupId

  // 2. Spawn Arm 1 (child of Mind so stop-tree kills it)
  const arm1Result = await this.spawn({
    pillar,
    prompt,
    model: model || null, // _defaultModel will pick 7B
    flowRequestId,
    planFile,
    backend,
    parentPillarId: mindResult.pillarId,
    singularityRole: 'holy-trinity-arm'
  })

  if (arm1Result.pillarId) {
    const arm1Session = this.pillars.get(arm1Result.pillarId)
    arm1Session._trinityId = trinityId
    arm1Session._armNumber = 1
    arm1Session._armPlanPath = arm1PlanPath
    arm1Session.singularityGroupId = trinityGroupId
  }

  // 3. Spawn Arm 2 (also child of Mind)
  const arm2Result = await this.spawn({
    pillar,
    prompt,
    model: model || null, // _defaultModel will pick 7B
    flowRequestId,
    planFile,
    backend,
    parentPillarId: mindResult.pillarId,
    singularityRole: 'holy-trinity-arm'
  })

  if (arm2Result.pillarId) {
    const arm2Session = this.pillars.get(arm2Result.pillarId)
    arm2Session._trinityId = trinityId
    arm2Session._armNumber = 2
    arm2Session._armPlanPath = arm2PlanPath
    arm2Session.singularityGroupId = trinityGroupId
  }

  // 4. Register trinity group
  this._trinityGroups.set(trinityGroupId, {
    trinityGroupId,
    trinityId,
    mindPillarId: mindResult.pillarId,
    arm1PillarId: arm1Result.pillarId || null,
    arm2PillarId: arm2Result.pillarId || null,
    arm1PlanPath,
    arm2PlanPath
  })

  // 5. Broadcast to frontend
  this.broadcast({
    type: 'trinity_created',
    groupId: trinityGroupId,
    trinityId,
    mindPillarId: mindResult.pillarId,
    arm1PillarId: arm1Result.pillarId || null,
    arm2PillarId: arm2Result.pillarId || null
  })

  log.info(`[holy-trinity] Trinity ${trinityId} spawned — mind: ${mindResult.pillarId.slice(0, 8)}, arm1: ${arm1Result.pillarId?.slice(0, 8)}, arm2: ${arm2Result.pillarId?.slice(0, 8)}`)

  // Return Mind as the primary session
  return mindResult
}
```

---

### Frontend (`src/`)

#### `src/composables/useSingularity.js`

Handle the `trinity_created` WS event — track trinity groups in state so the UI can display them.

Add to the event handler (or create one if not present):
```javascript
case 'trinity_created':
  trinityGroups.value.set(msg.groupId, {
    groupId: msg.groupId,
    trinityId: msg.trinityId,
    mindPillarId: msg.mindPillarId,
    arm1PillarId: msg.arm1PillarId,
    arm2PillarId: msg.arm2PillarId
  })
  break
```

Export `trinityGroups` reactive ref.

#### `src/components/chat/ChatView.vue`

Add a minimal trinity status display — a banner/strip that shows when a trinity is active. Positioned similar to the `ThinkingPanel`:

```
┌────────────────────────────────────────────────────┐
│ ⚡ Holy Trinity  [Arm 1 ✓] [Arm 2 🔄] [Mind 🔄]  │
└────────────────────────────────────────────────────┘
```

This reads pillar status from the existing `pillars` map. No new data fetching needed — the arm/mind pillarIds are in `trinityGroups`.

**Scope:** This is genuinely minimal — a `v-if` block with 3 status indicators. No new component file needed unless the markup is complex. Forge decides whether to inline it in `ChatView.vue` or extract a `TrinityPanel.vue`.

---

## Work Units

### WU-1: Prompts in `src/prompts/base.js`
**Status:** ready  
**Backend:** gemini  
**Files:** `src/prompts/base.js`  

Add `HOLY_TRINITY_ARM_PROMPT` and `HOLY_TRINITY_MIND_PROMPT` exports. Follow the exact style of `SINGULARITY_WORKER_PROMPT` (use `/no_think` prefix, plain markdown, direct imperative tone). Both prompts include template variable placeholders as described above.

---

### WU-2: Bridge integration in `bridge/pillar-manager.js`
**Status:** ready  
**Backend:** gemini  
**Files:** `bridge/pillar-manager.js`  
**Depends on:** WU-1 (imports prompts)

Implement all 9 changes listed in the Integration Points section:
1. Import `HOLY_TRINITY_ARM_PROMPT`, `HOLY_TRINITY_MIND_PROMPT`
2. Add `this._trinityGroups` to constructor
3. `spawn()` — detect `holy-trinity` role, delegate to `_spawnHolyTrinity()`
4. Session `numCtx` for new roles
5. Session `singularityRole` enum comment update
6. `_buildOllamaTools()` — arm filesystem-only restriction
7. `_buildSystemPrompt()` — `isSingularity` check + prompt injection with template replacement
8. `_defaultModel()` — 7B for arms, 32B for mind
9. New `_spawnHolyTrinity()` method

WU-2 can run in parallel with WU-3 (different files).

---

### WU-3: Frontend trinity display
**Status:** ready  
**Backend:** gemini  
**Files:** `src/composables/useSingularity.js`, `src/components/chat/ChatView.vue`

Handle `trinity_created` WS event in `useSingularity.js`. Add minimal trinity status strip to `ChatView.vue`. Use `var(--color-*)` CSS variables for all colors (theme-aware). Display arm/mind status using existing pillar status from `pillars` state.

---

## Edge Cases & Decisions

**Q: What if an Arm fails to spawn?**  
A: `_spawnHolyTrinity()` logs the failure but continues. The Mind's prompt says "if after reasonable polling only one plan is available, proceed with what you have." If neither arm spawned, Mind proceeds on its own — effectively a standard 32B session.

**Q: What if an Arm writes an empty or incomplete plan?**  
A: The Mind reads whatever is there and makes a judgment call. The prompt handles this: "If only one plan is available, proceed with what you have."

**Q: What if the Mind polls exhaustively and never sees both plans?**  
A: The Mind's prompt gives it a clear ceiling: "Poll up to 20 times." After that, it proceeds with whatever files exist. The Mind won't block forever.

**Q: Can multiple trinity groups run concurrently?**  
A: Yes — trinityId is UUID-based so file names don't collide, and `_trinityGroups` is a Map keyed by group ID. MAX_CONCURRENT_OLLAMA=4 limits total Ollama sessions, so if 4 slots are full, new spawns queue. A trinity uses 3 slots — two trinities simultaneously would exceed the limit and queue.

**Q: Does the task description need to be in both the user message AND the system prompt?**  
A: No. The task is the **user message** (the `prompt` passed to spawn). The system prompt uses `{TASK}` placeholder resolved to "(see user message)" — just a hint in the system prompt. The actual task text arrives via the birth message + user turn, exactly like all other singularity roles.

**Q: Should Mind use `pillar_spawn` to spawn workers if the task is complex?**  
A: Yes — Mind has all OLLAMA_ALLOWED_SERVERS tools plus pillar tool defs (it's not a `worker`-role session). If the task is complex, Mind can spawn regular workers via `pillar_spawn`. This is a natural extension of the architecture.

**Q: `_buildSystemPrompt()` — template replacement happens in `_buildSystemPrompt` but session fields like `_arm1PlanPath` are set AFTER spawn returns. Is there a race?**  
A: No race. `_buildSystemPrompt()` is called synchronously during `spawn()` before the session object is stored. The template variables must be computed and passed INTO `_buildSystemPrompt()` rather than reading from `session._arm1PlanPath`. 

**Forge: handle this by passing `extra` context into `_buildSystemPrompt()`:**

```javascript
// In spawn(), before calling _buildSystemPrompt():
const systemPrompt = await this._buildSystemPrompt(pillar, {
  planFilter: planFile,
  singularityRole,
  backend: finalBackend,
  // Holy Trinity extras:
  armNumber: options.armNumber,
  armPlanPath: options.armPlanPath,
  arm1PlanPath: options.arm1PlanPath,
  arm2PlanPath: options.arm2PlanPath,
  trinityId: options.trinityId
})
```

The `_spawnHolyTrinity()` method computes these values before calling `spawn()` and passes them as additional options.

This means the `spawn()` signature needs a new optional `options` param (or we expand the existing destructured param), and `_spawnHolyTrinity()` passes them through.

**Revised spawn signature for the internal call from `_spawnHolyTrinity()`:**
```javascript
// _spawnHolyTrinity passes extra context needed for system prompt template replacement
await this.spawn({
  ...,
  singularityRole: 'holy-trinity-arm',
  _trinityExtra: { armNumber: 1, armPlanPath: arm1PlanPath, trinityId }
})
```

And `spawn()` passes `_trinityExtra` through to `_buildSystemPrompt()`. Forge can name this however feels cleanest — the point is template variables need to flow from `_spawnHolyTrinity()` → `spawn()` → `_buildSystemPrompt()`.

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/prompts/base.js` | Modify | Add `HOLY_TRINITY_ARM_PROMPT`, `HOLY_TRINITY_MIND_PROMPT` exports |
| `bridge/pillar-manager.js` | Modify | 9 changes as listed — new roles, tool restriction, spawn method, model routing |
| `src/composables/useSingularity.js` | Modify | Handle `trinity_created` event, export `trinityGroups` |
| `src/components/chat/ChatView.vue` | Modify | Add trinity status display strip |

No new files required unless Forge judges the trinity UI complex enough to warrant `TrinityPanel.vue`.

---

## Summary

The Holy Trinity is elegant: three sessions, all spawned at once, using the natural hardware reality (7B loads fast, 32B loads slow) as a feature. The Arms don't wait for the Mind. The Mind doesn't wait for the Arms to start writing. Everyone works simultaneously from the first moment.

The implementation reuses every existing pattern: file-based coordination (from Gen4), tool restriction (from Worker), group tracking (from dual-mind), workspace files (from Gen4). Nothing new architecturally — just a new arrangement of proven pieces.

Forge's job is mechanical: slot the new roles into the existing `if/else if` chains, add the new method, write the two prompts. The hard thinking is done here.
