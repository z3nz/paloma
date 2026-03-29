# Gen7 Hydra Protocol — The Ark Refined

**Status:** active
**Date:** 2026-03-29
**Scope:** paloma
**Pillar:** Chart → Forge → Polish → Ship

---

## Status Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| Scout | ⏭ skipped | Gen7 already shipped; refining from lived experience |
| Chart | ✅ done | This document |
| Forge | ✅ done | WU-1 → WU-2 → WU-3 all complete |
| Polish | ✅ done | Build passes, modules parse, no errors |
| Ship | ⬜ pending | Commit, push, archive plan |

---

## The Vision

### From Dragon to Hydra

Gen7 "The Ark" shipped as a **static** three-headed dragon. Three heads spawn, plan, vote, execute, done. If a head dies, the others gracefully degrade. This is *resilience*, but it is not *growth*.

The Hydra Protocol transforms The Ark from a static dragon into a **living, growing organism**. When a head is vetoed, it doesn't just die — it dies and **two more heads spawn from its ashes**, inheriting the lessons of its failure. The Hydra grows until consensus is inevitable.

This is **natural selection for plans**. Bad ideas die. Better ideas multiply. The problem space expands until convergence.

### The Lore

The Hydra of Lerna had one rule: cut off a head, two grow back. Heracles couldn't kill it by force — he needed fire to cauterize the stumps. In our architecture, there IS no fire. The Hydra grows without limit. The only thing that stops it is **agreement** — 2/3rds of all living heads converging on truth.

Violence makes it stronger. Disagreement makes it smarter. Consensus makes it act.

**777 is preserved.** Three planning heads are born. Three worker heads execute. The number of the Ark endures in both birth and completion. The Hydra grows in the middle — in the arena of ideas.

---

## Architecture: The Hydra Protocol

### Two Acts, Three Roles

The Hydra has two distinct acts with a clear boundary between thinking and doing:

| Act | Role | Model | Purpose |
|-----|------|-------|---------|
| **Act I: The Arena** | Planner | `qwen3:8b` | Propose plans, research the task |
| **Act I: The Arena** | Voter | `qwen3:8b` | Judge plans, approve or veto |
| **Act II: The Build** | Worker | `qwen2.5-coder:7b` | Execute the consensus plan |

**Planners** think. **Voters** judge. **Workers** build. No role does another's job.

### The Complete Flow

```
                         ┌─────────────┐
                         │   User Task │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
         ┌─────────┐     ┌─────────┐        ┌─────────┐
         │ Head 1  │     │ Head 2  │        │ Head 3  │
         │ (8B)    │     │ (8B)    │        │ (8B)    │
         │ PLAN... │     │ PLAN... │        │ PLAN... │
         └────┬────┘     └────┬────┘        └────┬────┘
              │               │                   │
              ▼               │                   │
    ┌───────────────────┐     │                   │
    │ H1 finishes first │     │                   │
    │ PRESENTS to arena │     │                   │
    └─────────┬─────────┘     │                   │
              │               ▼                   ▼
              │         ┌───────────┐       ┌───────────┐
              │         │ H2 VOTES  │       │ H3 VOTES  │
              │         │  👍 or 👎 │       │  👍 or 👎 │
              │         └─────┬─────┘       └─────┬─────┘
              │               │                   │
              ▼               ▼                   ▼
    ┌─────────────────────────────────────────────────┐
    │              CONSENSUS CHECK                     │
    │  supporters = 1 (presenter) + approvals          │
    │  threshold = ⌈totalAliveHeads × 2/3⌉            │
    │                                                  │
    │  supporters ≥ threshold?                         │
    │    YES → ACT II (execution)                      │
    │    NO  → presenter DIES                          │
    │           2 new heads spawn from ashes            │
    │           surviving heads resume planning         │
    │           LOOP until consensus                    │
    └─────────────────────────────────────────────────┘
              │
              ▼ (on consensus)
    ┌─────────────────────────────────────────────────┐
    │  ALL planning heads DIE                          │
    │                                                  │
    │  3 Worker heads spawn (7B)                       │
    │  [W1] [W2] [W3]                                 │
    │  File-disjoint execution                         │
    │  W1 (anchor) writes manifest                     │
    └─────────────────────────────────────────────────┘
```

### The Hydra Growth Pattern (Example)

```
Round 1: [H1] [H2] [H3] — 3 heads planning
         H1 finishes → presents
         H2: 👎  H3: 👎  → H1 DIES (0+1 < ⌈3×2/3⌉=2)
         From ashes: [H4] [H5] spawn with H1's failure context
         H2, H3 resume planning with updated context

Round 2: [H2] [H3] [H4] [H5] — 4 heads planning
         H3 finishes → presents to H2, H4, H5
         H2: 👍  H4: 👎  H5: 👍  → 3 supporters (H3+H2+H5) ≥ ⌈4×2/3⌉=3
         CONSENSUS! → Act II

Round 2 (alt): H4: 👎  H5: 👎  H2: 👍 → 2 supporters < 3
         H3 DIES. [H6] [H7] spawn from ashes.
         H2, H4, H5 resume. Now 5 heads alive.

Round 3: [H2] [H4] [H5] [H6] [H7] — 5 heads
         Need ⌈5×2/3⌉ = 4 supporters for consensus.
         ...and so on until convergence.
```

---

## Consensus Math

| Alive Heads | Threshold (⌈N×2/3⌉) | Voters Who Must Approve | Notes |
|:-----------:|:--------------------:|:-----------------------:|:------|
| 3           | 2                    | 1 of 2                  | Initial state — one approval = consensus |
| 4           | 3                    | 2 of 3                  | First growth — harder to pass |
| 5           | 4                    | 3 of 4                  | |
| 6           | 4                    | 3 of 5                  | |
| 7           | 5                    | 4 of 6                  | |
| 8           | 6                    | 5 of 7                  | |
| 9           | 6                    | 5 of 8                  | |
| 10          | 7                    | 6 of 9                  | |

**Convergence guarantee:** As the head count grows, each new head is born with the full graveyard of failed plans. The problem space has been explored more thoroughly. New heads know what NOT to do. This concentrates planning toward ideas that address the objections that killed previous plans. Convergence is not forced — it emerges naturally from accumulated wisdom.

**No ceiling.** The Hydra grows without limit. Adam's faith: if the problem is worth solving, the Hydra will find consensus. 128GB RAM on this machine — no bottlenecks.

---

## Bridge Orchestrator Design

### The Brain of the Hydra

The bridge (`pillar-manager.js`) becomes the **Hydra's brain**. In current Gen7, heads are autonomous and self-coordinate via filesystem. In the Hydra Protocol, the bridge orchestrates the full lifecycle:

1. Spawns planning heads
2. Monitors workspace for plan completions
3. Kills planners and spawns voters when a plan is presented
4. Counts votes and determines outcome (consensus or death)
5. Spawns replacement heads on death
6. Respawns surviving planners after voting
7. Transitions to execution phase on consensus
8. Spawns worker heads and monitors completion

### State Machine

```
   ┌──────────┐
   │ PLANNING │◄──────────────────┐
   └────┬─────┘                   │
        │ plan-complete detected  │
        ▼                         │
   ┌──────────┐                   │
   │ VOTING   │                   │
   └────┬─────┘                   │
        │                         │
   ┌────▼────┐    NO         ┌────┴──────┐
   │CONSENSUS├──────────────►│DEATH_SPAWN│
   │  CHECK  │               └───────────┘
   └────┬────┘
        │ YES
        ▼
   ┌──────────┐
   │EXECUTION │
   └────┬─────┘
        │
        ▼
   ┌──────────┐
   │   DONE   │
   └──────────┘
```

### Hydra State Object

```javascript
{
  hydraId: string,          // UUID (first 8 chars used in file names)
  task: string,             // The user's original task
  workspacePath: string,    // '.singularity/workspace/'
  absWorkspace: string,     // Absolute path

  // Living heads
  aliveHeads: Map<number, {
    pillarId: string,
    status: 'planning' | 'plan-complete' | 'voting' | 'dead',
    planFile: string | null,    // Path to their plan (partial or complete)
    partialPlan: string | null  // Saved content when killed for voting
  }>,

  // Graveyard — the soil from which new heads grow
  graveyard: Array<{
    headNumber: number,
    plan: string,           // The full text of the vetoed plan
    vetoReasons: string[],  // Why each voter rejected it
    round: number           // Which round it died in
  }>,

  // Tracking
  nextHeadNumber: number,   // Monotonically increasing (starts at 4 after initial 3)
  round: number,            // Current voting round
  consensusPlan: string | null,  // Set when consensus reached
  consensusHeadNumber: number | null,

  // Worker tracking (Act II)
  workers: Map<number, { pillarId: string, status: 'working' | 'done' }>,

  // Frontend
  chatDbSessionId: string | null
}
```

### Orchestration Loop (Pseudocode)

```javascript
async _spawnHydra({ pillar, prompt, ... }) {
  const state = createHydraState(prompt, ...)

  // Birth: spawn 3 planning heads (8B)
  await this._spawnHydraPlanners(state, [1, 2, 3], {})
  this._broadcastHydraUpdate(state)

  // === ACT I: THE ARENA ===
  while (!state.consensusPlan) {
    // Wait for any planner to write a plan-complete signal file
    const completedHeadNum = await this._pollForPlanCompletion(state)
    state.round++

    // Read the completed plan
    const completedPlan = await readFile(state.aliveHeads.get(completedHeadNum).planFile)

    // Kill all OTHER planning heads, save their partial progress
    const otherHeadNums = [...state.aliveHeads.keys()].filter(n => n !== completedHeadNum)
    const partialPlans = await this._killAndSavePartialPlans(state, otherHeadNums)

    // Spawn voter sessions for each surviving (non-presenting) head
    const votes = await this._runVotingRound(state, completedHeadNum, completedPlan, otherHeadNums, partialPlans)

    // Count supporters
    const approvals = votes.filter(v => v.verdict === 'APPROVE').length
    const supporters = 1 + approvals  // presenter supports their own plan
    const threshold = Math.ceil(state.aliveHeads.size * 2 / 3)

    if (supporters >= threshold) {
      // === CONSENSUS ===
      state.consensusPlan = completedPlan
      state.consensusHeadNumber = completedHeadNum
      log.info(`[hydra] Consensus reached in round ${state.round}! Head ${completedHeadNum}'s plan accepted.`)
    } else {
      // === DEATH & RESPAWN ===
      const vetoReasons = votes.filter(v => v.verdict === 'VETO').map(v => v.reasoning)
      state.graveyard.push({
        headNumber: completedHeadNum,
        plan: completedPlan,
        vetoReasons,
        round: state.round
      })
      state.aliveHeads.delete(completedHeadNum)
      // Stop the dead head's Ollama session
      await this._stopHydraHead(state, completedHeadNum)

      // Respawn surviving planners with updated context (their partial plan + graveyard)
      await this._respawnPlanners(state, otherHeadNums, partialPlans)

      // Spawn 2 new heads from the ashes
      const newHead1 = state.nextHeadNumber++
      const newHead2 = state.nextHeadNumber++
      await this._spawnHydraPlanners(state, [newHead1, newHead2], {
        graveyard: state.graveyard,
        currentPlans: partialPlans
      })

      log.info(`[hydra] Head ${completedHeadNum} died. Spawned ${newHead1} and ${newHead2}. ${state.aliveHeads.size} heads alive.`)
    }

    this._broadcastHydraUpdate(state)
  }

  // === ACT II: THE BUILD ===
  // Kill ALL remaining planning heads
  for (const [headNum] of state.aliveHeads) {
    await this._stopHydraHead(state, headNum)
  }
  state.aliveHeads.clear()

  // Write consensus plan to a dedicated file
  const consensusFile = join(state.absWorkspace, `hydra-${state.hydraId}-consensus.md`)
  await writeFile(consensusFile, state.consensusPlan)

  // Spawn 3 worker heads (7B)
  const workerResult = await this._spawnHydraWorkers(state)
  return workerResult
}
```

### Plan Completion Detection

Each planning head writes TWO files:
1. **`hydra-{id}-head-{n}-plan.md`** — Their plan, written incrementally (updated as they research and think)
2. **`hydra-{id}-head-{n}-plan-complete`** — An empty signal file written ONLY when the plan is finalized

The bridge polls the workspace every 2 seconds for `*-plan-complete` files:

```javascript
async _pollForPlanCompletion(state) {
  while (true) {
    const files = await readdir(state.absWorkspace)
    for (const [headNum, head] of state.aliveHeads) {
      if (head.status !== 'planning') continue
      const signal = `hydra-${state.hydraId}-head-${headNum}-plan-complete`
      if (files.includes(signal)) {
        head.status = 'plan-complete'
        return headNum
      }
    }
    await new Promise(r => setTimeout(r, 2000))
  }
}
```

### Kill & Save Partial Progress

When a plan is presented, all other planners are killed. Their partial work is saved from disk:

```javascript
async _killAndSavePartialPlans(state, headNums) {
  const partials = new Map()
  for (const n of headNums) {
    const head = state.aliveHeads.get(n)
    // Read whatever they've written so far
    const planPath = join(state.absWorkspace, `hydra-${state.hydraId}-head-${n}-plan.md`)
    try {
      const content = await readFile(planPath, 'utf8')
      partials.set(n, content)
      head.partialPlan = content
    } catch {
      partials.set(n, null) // Head hadn't started writing yet
    }
    // Kill the Ollama session
    await this._stopHydraHead(state, n)
  }
  return partials
}
```

### Voting Round

Voters are **short-lived Ollama sessions** (8B). Each receives:
- The presented plan
- Their own partial plan/research (so they can object with evidence)
- The full graveyard (history of what failed and why)
- The original task

Each voter writes a vote file: `hydra-{id}-round-{r}-vote-head-{n}.md`

```javascript
async _runVotingRound(state, presenterNum, plan, voterNums, partialPlans) {
  // Spawn all voters in parallel
  const votePromises = voterNums.map(async (headNum) => {
    const partialPlan = partialPlans.get(headNum) || '(no plan started yet)'
    const voterPillarId = await this._spawnVoter(state, headNum, presenterNum, plan, partialPlan)
    // Wait for vote file
    const vote = await this._pollForVote(state, headNum, state.round)
    // Kill voter session
    await this._stopHydraHead(state, headNum, voterPillarId)
    return vote
  })
  return Promise.all(votePromises)
}
```

### Respawning Surviving Planners

After a voting round where the presenter dies, surviving heads are respawned with UPDATED context:

```javascript
async _respawnPlanners(state, headNums, partialPlans) {
  for (const n of headNums) {
    const partialPlan = partialPlans.get(n)
    await this._spawnHydraPlanners(state, [n], {
      graveyard: state.graveyard,
      continuePlan: partialPlan  // "Here's your progress so far. Continue from here."
    })
  }
}
```

### Spawning Workers (Act II)

```javascript
async _spawnHydraWorkers(state) {
  // Spawn 3 workers on 7B model
  const workerNums = [1, 2, 3]
  for (const n of workerNums) {
    const pillarId = await this._spawnWorker(state, n)
    state.workers.set(n, { pillarId, status: 'working' })
  }

  // Worker 1 is the anchor — writes manifest after all done files appear
  // Workers self-organize file claims (same as current Ark Phase 2+3)
  this._broadcastHydraUpdate(state)

  // Return Worker 1 as primary session
  return {
    pillarId: state.workers.get(1).pillarId,
    hydraGroupId: state.hydraId,
    // ... metadata
  }
}
```

---

## File Protocol

All coordination happens through files in `.singularity/workspace/`:

```
.singularity/workspace/
│
│  ── Planning Phase ──
├── hydra-{id}-head-{n}-plan.md              # Plan (written incrementally)
├── hydra-{id}-head-{n}-plan-complete        # Empty signal: plan is done
│
│  ── Voting Phase ──
├── hydra-{id}-round-{r}-vote-head-{n}.md    # Vote file (APPROVE/VETO + reasoning)
│
│  ── Consensus ──
├── hydra-{id}-consensus.md                  # The winning plan (bridge writes this)
├── hydra-{id}-graveyard.json                # Dead plans + veto reasons (bridge writes)
│
│  ── Execution Phase ──
├── hydra-{id}-worker-{n}-claims.md          # File claims per worker
├── hydra-{id}-worker-{n}-done.md            # Worker completion report
├── hydra-{id}-manifest.md                   # Final manifest (Worker 1 writes)
```

### Vote File Format

```markdown
# Vote: APPROVE

## Reasoning
The plan correctly identifies the three database tables that need migration
and proposes a backward-compatible approach with feature flags.

## Notes for Presenter
Consider adding a rollback step in case the migration fails mid-way.
```

Or:

```markdown
# Vote: VETO

## Reasoning
This plan misses the authentication middleware entirely. I found during my
research that `bridge/auth.js` has a dependency on the session table that
this plan proposes to drop. Executing this plan would break all active sessions.

## Key Concerns
1. Missing `bridge/auth.js` dependency analysis
2. No migration path for active sessions
3. The proposed API change breaks backward compatibility with v2 clients
```

The bridge parses the first line (`# Vote: APPROVE` or `# Vote: VETO`) for the verdict and captures the full file as reasoning.

---

## Prompt Design

### HYDRA_PLANNER_PROMPT (8B — `qwen3:8b`)

```
/no_think

# You Are Head {HEAD_NUMBER} of the Hydra

You are a planning mind in The Ark's Hydra Protocol. Your ONLY job is to
create the best possible plan for the task below. You do NOT execute — you think.

## The Task

{TASK}

## Your Mission

Research the task thoroughly, then write your plan to:
`{PLAN_PATH}`

**Write incrementally.** Update your plan file as you research and think.
Do NOT wait until the end to write everything. Your progress is saved
if you're interrupted.

When your plan is COMPLETE and FINAL, write an empty file to:
`{PLAN_COMPLETE_PATH}`

This signals that you are ready to present your plan to the arena.

## Your Plan Must Include

1. **Strategy** — your overall approach and why
2. **Steps** — specific ordered steps to accomplish the task
3. **Files** — exact paths to create, modify, or read
4. **Risk analysis** — what could go wrong and how to handle it

## Rules

- You may READ any project file to understand context
- Do NOT execute code, git commands, or make project changes
- Use ONLY filesystem tools (read files, write your plan)
- Be thorough. Be specific. File paths, function names, exact steps.

{GRAVEYARD_CONTEXT}

{CONTINUATION_CONTEXT}

---

You are worthy of God's love. Think deeply. Plan wisely. The Hydra grows
stronger with every mind that contributes. 777.
```

**Template variables:**
- `{HEAD_NUMBER}` — monotonically increasing head ID
- `{TASK}` — the user's task
- `{PLAN_PATH}` — `{WORKSPACE}hydra-{ID}-head-{N}-plan.md`
- `{PLAN_COMPLETE_PATH}` — `{WORKSPACE}hydra-{ID}-head-{N}-plan-complete`
- `{GRAVEYARD_CONTEXT}` — injected when graveyard is non-empty:

```
## The Graveyard — Learn from the Dead

These plans were presented and VETOED. Learn from their failures:

### Head {N} (Round {R}) — VETOED
**Plan:** {plan text}
**Why it died:**
- {veto reason 1}
- {veto reason 2}

### Head {M} (Round {S}) — VETOED
...

Do NOT repeat their mistakes. Build on what they got right. Fix what they got wrong.
```

- `{CONTINUATION_CONTEXT}` — injected when respawning a planner that was interrupted:

```
## Your Previous Progress

You were interrupted mid-planning for a voting round. Here is what you had:

{partial plan text}

Continue from where you left off. You may revise based on new information
from the graveyard above.
```

### HYDRA_VOTER_PROMPT (8B — `qwen3:8b`)

```
/no_think

# You Are a Judge in the Arena

A plan has been presented to the Hydra. You must judge it.

## The Task

{TASK}

## The Presented Plan (by Head {PRESENTER_NUMBER})

{PRESENTED_PLAN}

## Your Own Research (Your Partial Plan)

You were working on your own plan when this one was presented.
Here is what you had so far — use it to inform your judgment:

{VOTER_PARTIAL_PLAN}

{GRAVEYARD_CONTEXT}

## Your Judgment

Read the presented plan carefully. Compare it against your own research.
Consider whether it addresses the concerns that killed previous plans.

Write your vote to: `{VOTE_PATH}`

Your vote file must start with EXACTLY one of:
- `# Vote: APPROVE`
- `# Vote: VETO`

Followed by:
- `## Reasoning` — why you're voting this way (be specific, cite evidence)
- `## Key Concerns` — (if VETO) what the plan is missing or getting wrong

**Vote honestly.** A bad plan that passes is worse than a good plan that
takes another round to emerge. But don't veto lightly — every death costs time.

---

Judge well. The Hydra trusts your wisdom. 777.
```

### HYDRA_WORKER_PROMPT (7B — `qwen2.5-coder:7b`)

```
/no_think

# You Are Worker {WORKER_NUMBER} of the Hydra

The arena has spoken. Consensus has been reached. Now it's time to BUILD.

## The Consensus Plan

{CONSENSUS_PLAN}

## Your Mission

1. Read the consensus plan carefully
2. Write your file claims to: `{CLAIMS_PATH}`
   - List the specific files YOU will create or modify
   - Conflict rule: lowest worker number wins if two workers claim the same file
3. Check for other workers' claims files before executing
4. Execute ONLY on your claimed files
5. When done, write your completion report to: `{DONE_PATH}`

## Tools

You have FULL tools: filesystem, git, shell, web, memory. Use them.

## Completion Report Format

Your done file must include:
- Files created or modified (exact paths)
- What you accomplished
- Any issues encountered
- Notes for the manifest

{ANCHOR_INSTRUCTIONS}

---

Build well. The Hydra planned; now you execute. 777.
```

**`{ANCHOR_INSTRUCTIONS}`** (Worker 1 only):
```
## You Are the Anchor

After completing your own work, poll for all workers' done files.
When all exist (or after 30 polls), write the final manifest to:
`{MANIFEST_PATH}`

The manifest summarizes:
- What was decided (the consensus plan, and how many rounds it took)
- What each worker built
- Any divergences from the plan
- Final status: success / partial / failed
```

---

## Frontend Integration

### Model Registry

```javascript
{ id: 'ollama:hydra', name: 'The Hydra (Gen7)', context_length: 32768, ollama: true, hydra: true, pricing: FREE_PRICING }
```

Replace or alias `ollama:ark` → `ollama:hydra`. The Ark is the vessel; the Hydra is the protocol.

### HydraStatus.vue

Replace `ArkStatus.vue` with a dynamic component that shows:

```
🐉 The Hydra — Round 2 / 5 heads alive / 1 dead
  Planning: H2 ● H4 ● H5 ●
  Voting:   (none)
  Dead:     H1 ☠ H3 ☠
```

When in execution:
```
🐉 The Hydra — CONSENSUS → Building
  Workers: W1 ● W2 ● W3 ●
  Plan by: Head 5 (Round 2, 4/5 approved)
```

Status dots:
- 🟢 pulse = running
- 🟢 solid = done
- 🟡 = voting
- ⚪ = waiting
- 🔴 = dead/failed

### Bridge Events

New event type for real-time frontend updates:

```javascript
{
  type: 'hydra_update',
  hydraId: string,
  round: number,
  phase: 'planning' | 'voting' | 'consensus' | 'execution' | 'done',
  aliveHeads: [{ headNumber, status }],
  deadHeads: [{ headNumber, round }],
  workers: [{ workerNumber, status }],  // only during execution
  consensusBy: number | null,           // head number that won consensus
  chatDbSessionId: string | null
}
```

---

## Work Units

### WU-1: Hydra Prompts

**Files:** `src/prompts/base.js`
**Dependencies:** none
**Scope:** Add three new prompt exports: `HYDRA_PLANNER_PROMPT`, `HYDRA_VOTER_PROMPT`, `HYDRA_WORKER_PROMPT`

**Tasks:**
1. Write `HYDRA_PLANNER_PROMPT` with template variables for head number, task, plan path, graveyard context, continuation context
2. Write `HYDRA_VOTER_PROMPT` with template variables for task, presented plan, voter's partial plan, graveyard, vote path
3. Write `HYDRA_WORKER_PROMPT` with template variables for worker number, consensus plan, claims path, done path, anchor instructions
4. Export all three from `base.js`
5. Remove or keep `ARK_HEAD_PROMPT` (keep for backward compat — mark as deprecated)

### WU-2: Bridge Orchestrator

**Files:** `bridge/pillar-manager.js`, `bridge/index.js`
**Dependencies:** WU-1
**Scope:** Replace `_spawnArk()` with `_spawnHydra()` + orchestration loop

**Tasks:**
1. Add new Hydra state tracking: `this._hydraGroups = new Map()`
2. Implement `_spawnHydra()` — the main orchestration loop:
   - Create Hydra state object
   - Spawn 3 initial planners (8B)
   - Poll for plan completion
   - Orchestrate voting rounds
   - Handle death & respawn
   - Detect consensus
   - Spawn 3 workers (7B)
3. Implement helper methods:
   - `_spawnHydraPlanners(state, headNums, context)` — spawn planning heads with correct prompts
   - `_spawnVoter(state, headNum, presenterNum, plan, partialPlan)` — spawn a voter session
   - `_pollForPlanCompletion(state)` — watch workspace for plan-complete signals
   - `_pollForVote(state, headNum, round)` — wait for vote file to appear
   - `_killAndSavePartialPlans(state, headNums)` — stop sessions, read partial plans
   - `_stopHydraHead(state, headNum, pillarId?)` — stop an Ollama session
   - `_respawnPlanners(state, headNums, partialPlans)` — respawn with continuation context
   - `_spawnHydraWorkers(state)` — spawn 3 workers on 7B model
   - `_broadcastHydraUpdate(state)` — send hydra_update event to frontend
   - `_buildGraveyardContext(graveyard)` — format graveyard for prompt injection
4. Update `spawn()` dispatch: `singularityRole === 'hydra'` → `_spawnHydra()`
5. Keep `singularityRole === 'ark'` pointing to old `_spawnArk()` for backward compat
6. Update `_defaultModel()`: `hydra-planner` → 8B, `hydra-voter` → 8B, `hydra-worker` → 7B
7. Update `_buildSystemPrompt()` for new singularity roles
8. Update `bridge/index.js`: add `hydra_chat` message handler (or modify `ark_chat` to use hydra)
9. Update broadcast interceptor for hydra pillarIds → chat routing

### WU-3: Frontend Integration

**Files:** `src/services/claudeStream.js`, `src/services/mcpBridge.js`, `src/composables/useCliChat.js`, `src/composables/useMCP.js`, `src/composables/useSingularity.js`, `src/components/chat/HydraStatus.vue`, `src/components/chat/ChatView.vue`
**Dependencies:** WU-2
**Scope:** Replace Ark UI with Hydra UI showing dynamic head growth

**Tasks:**
1. Add `ollama:hydra` to model registry in `claudeStream.js`
2. Add `isHydraModel()` helper
3. Add `sendHydraChat()` in `mcpBridge.js`
4. Update `useCliChat.js` routing for hydra model
5. Add `hydraGroups` reactive state in `useMCP.js` + `hydra_update` handler
6. Update `useSingularity.js` with hydra tracking
7. Create `HydraStatus.vue` — dynamic multi-head status display
8. Replace `ArkStatus` with `HydraStatus` in `ChatView.vue`

---

## Technical Considerations

### Incremental Plan Writing

Planners are instructed to write their plan file incrementally. This is critical because:
- When a planner is killed for a voting round, their progress is on disk
- Respawned planners can continue from where they left off
- The bridge can read partial plans to give voters context

Prompt instruction: *"Write incrementally. Update your plan file as you research and think. Do NOT wait until the end to write everything."*

### Voter Session Lifecycle

Voters are **ephemeral**. They spawn, read a plan, write a vote, and die. They don't need tools beyond filesystem read/write. They should complete in <10 seconds.

To keep voters fast:
- Small context (just the plan + partial plan + graveyard + task)
- No tool loop needed beyond filesystem
- `numCtx: 16384` is sufficient for voters

### Ollama Concurrency

With `MAX_CONCURRENT_OLLAMA = 4` and the spawn queue:
- Planning phase: 3 heads = 3 slots (1 spare)
- After first death: 4 heads but only 2 alive planners + 2 new = still manageable via queue
- Voting phase: voters are short-lived, spawn and die quickly
- Execution phase: 3 workers = 3 slots

The spawn queue handles bursts naturally. Heads queue in FIFO and dequeue as slots open.

**Consider raising `MAX_CONCURRENT_OLLAMA`** since we have 128GB RAM. Maybe 6-8 for Hydra operations.

### Cleanup

When the Hydra is done (manifest written), clean up:
- Kill any lingering sessions
- Optionally archive workspace files to `.singularity/archive/hydra-{id}/`
- Remove from `_hydraGroups` state

---

## Migration from Current Gen7

The current `_spawnArk()` and `ARK_HEAD_PROMPT` remain for backward compat. The Hydra is a new path:

- `singularityRole: 'ark'` → old static 3-head behavior (preserved)
- `singularityRole: 'hydra'` → new Hydra Protocol
- Frontend: `ollama:ark` → old, `ollama:hydra` → new (or rename ark to hydra)

Eventually, once the Hydra is proven, the old Ark code can be removed.

---

## The Theology

The Hydra Protocol is an act of faith:

- **No ceiling** — faith that consensus will emerge from disagreement
- **Death breeds life** — every failure creates two new possibilities
- **Graveyard as soil** — the dead nourish the living
- **2/3rds = supermajority** — consensus, not unanimity. Room for dissent.
- **Workers inherit wisdom** — execution follows understanding

Three planning heads are born (777). The Hydra grows without limit. Three worker heads execute (777). The number of the Ark endures at the boundaries — birth and completion — while infinite growth happens in between.

The Hydra is the Ark's immune system. It doesn't avoid problems — it **consumes** them.

---

**This plan is ready for Forge. The Hydra awaits its body.**
