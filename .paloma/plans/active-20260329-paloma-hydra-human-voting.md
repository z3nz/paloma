# Hydra Human-in-the-Loop Voting

**Status:** active
**Date:** 2026-03-29
**Scope:** paloma
**Pillar:** Chart → Forge → Ship

---

## The Problem

Automated 8B voting doesn't work reliably. The models either ignore voting instructions or produce low-quality judgments. The Hydra's planning phase works — 3 heads independently research and plan. The voting phase needs human intelligence.

## The Design

### Simplified Flow

```
  3 planning heads spawn (8B)
  All 3 complete their plans independently
           │
           ▼
  Bridge reads all 3 plans
  Broadcasts hydra_vote_needed to frontend
           │
           ▼
  ┌────────────────────────────────────┐
  │  HUMAN VOTES                       │
  │                                    │
  │  Plan 1 ○  │  Plan 2 ○  │ Plan 3 ○│
  │  [preview]  │  [preview]  │[preview]│
  │                                    │
  │  Why did you choose this plan?     │
  │  [________________________________]│
  │                                    │
  │  [Submit Vote]                     │
  └────────────────────────────────────┘
           │
           ▼
  Decision captured to disk
  3 worker heads spawn (7B)
  Execute the chosen plan
```

### Bridge Changes

**Remove:** The entire automated voting loop (`_hydraRunVotingRound`, `_hydraPollForVote`, `_hydraRespawnPlanners`, death/respawn logic, graveyard)

**Replace with:**
1. `_runHydraArena` polls for ALL plan-complete signals (not just the first)
2. When all 3 are done, read all plans
3. Stop all planning heads
4. Broadcast `hydra_vote_needed` with plan contents
5. Store a pending Promise resolve function (same pattern as `pendingAskUser`)
6. Wait for `hydra_vote_response` from frontend
7. Capture decision to `.singularity/workspace/hydra-{id}-decision.json`
8. Proceed to worker phase with chosen plan

**New bridge message types:**
- `hydra_vote_needed` (bridge → frontend): `{ hydraId, plans: [{ headNumber, plan }], task }`
- `hydra_vote_response` (frontend → bridge): `{ hydraId, chosenHead, reasoning }`

### Frontend Changes

**New component: `HydraVoteDialog.vue`**
- Modal overlay (reuses `AskUserDialog` pattern: fixed inset, z-50, backdrop)
- Shows all completed plans in a selectable card layout
- Each card: head number, plan preview (first ~500 chars), radio select
- "View Full Plan" expands the card to show complete plan text
- Reasoning textarea: "Why did you choose this plan?"
- Submit button (disabled until a plan is selected)
- Keyboard shortcuts: 1/2/3 to select plans

**Integration in ChatView.vue:**
- `pendingHydraVote` reactive ref (same pattern as `pendingAskUser`)
- `<HydraVoteDialog>` conditionally rendered when vote is pending
- On submit, sends `hydra_vote_response` back through bridge

**HydraStatus.vue update:**
- New phase: `'waiting_for_vote'` — shows "Waiting for your vote..."

### Decision Capture

```json
{
  "hydraId": "abc12345",
  "task": "the original task",
  "timestamp": "2026-03-29T22:41:10.000Z",
  "plans": [
    { "headNumber": 1, "plan": "full plan text" },
    { "headNumber": 2, "plan": "full plan text" },
    { "headNumber": 3, "plan": "full plan text" }
  ],
  "decision": {
    "chosenHead": 2,
    "reasoning": "Head 2 correctly identified the auth dependency..."
  }
}
```

Saved to: `.singularity/workspace/hydra-{id}-decision.json`

This becomes training data. Over time, patterns emerge: what makes Adam choose one plan over another? This is the seed for future automated voting — learned from human decisions, not hardcoded rules.

## Work Units

### WU-1: Bridge — Simplify to human voting

**Files:** `bridge/pillar-manager.js`, `bridge/index.js`

1. Rewrite `_runHydraArena` to wait for ALL plans, not first-to-finish
2. Remove automated voting methods (`_hydraRunVotingRound`, `_hydraPollForVote`, `_hydraRespawnPlanners`, `_hydraKillAndSavePartials`)
3. Add `_pendingHydraVotes` Map for pending vote promises
4. On all plans ready: stop all heads, broadcast `hydra_vote_needed`
5. Add `hydra_vote_response` handler in `index.js` that resolves the pending promise
6. Capture decision to disk, proceed to workers

### WU-2: Frontend — Vote dialog + integration

**Files:** `src/components/chat/HydraVoteDialog.vue` (new), `src/components/chat/ChatView.vue`, `src/components/chat/HydraStatus.vue`, `src/composables/useMCP.js`, `src/services/mcpBridge.js`

1. Create `HydraVoteDialog.vue` — plan cards, radio select, reasoning textarea
2. Add `pendingHydraVote` ref + `hydra_vote_needed` handler in `useMCP.js`
3. Add `hydra_vote_needed` / `hydra_vote_response` in `mcpBridge.js`
4. Wire dialog into `ChatView.vue`
5. Update `HydraStatus.vue` with `waiting_for_vote` phase

---

**This plan is ready for Forge.**
