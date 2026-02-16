# Plan: Context Continuity — Pillar-Scoped Sessions With Artifact Handoff

**Status:** active
**Created:** 2026-02-15
**Scope:** paloma
**Impact:** Major — foundational architecture for how Paloma maintains continuity across phases
**Converges with:** `draft-20260215-paloma-sub-agent-orchestration.md` (engineering plan), `.paloma/memory/sacred-sub-agent-vision.md` (vision)

## The Insight

Each pillar should be its **own conversation session**. Not a continuation of one mega-conversation, but a fresh context window that inherits the *artifacts* of the previous phase — not raw messages.

This is fundamentally different from what other tools do:
- **Cursor/Continue/Octofriend:** Replay all messages → context bloat, attention degradation
- **ChatGPT /clear:** Lose everything → no continuity
- **Paloma:** Carry forward decisions and discoveries via `.paloma/` artifacts → clean context, full continuity

The `.paloma/plans/` and `.paloma/docs/` files ARE the context handoff mechanism. Message history is ephemeral per-phase. Artifacts are permanent.

---

## The Flow

**Flow is the orchestrator** — the long-lived head mind where you and Paloma think together. Other pillars are purpose-built sessions that Flow dispatches to. Flow is the only pillar that can be long-lived; all others start fresh.

```
Flow (orchestrator — long-lived head mind)
  ├──→ Scout (deep research) — fresh session
  │      ↓ writes findings to .paloma/docs/ or .paloma/plans/
  │      ↓ returns to Flow or transitions to Chart
  ├──→ Chart (strategic planning) — fresh session
  │      ↓ reads Scout's findings from .paloma/ (auto-loaded in system prompt)
  │      ↓ writes plan to .paloma/plans/active-*.md
  │      ↓ returns to Flow or transitions to Forge
  ├──→ Forge (building) — fresh session
  │      ↓ reads Chart's plan from .paloma/ (auto-loaded in system prompt)
  │      ↓ builds the thing, references plan throughout
  │      ↓ returns to Flow or transitions to Polish
  ├──→ Polish (review) — fresh session
  │      ↓ reads the plan, diffs the code, reviews quality
  │      ↓ returns to Flow or transitions to Ship
  └──→ Ship (commit & archive) — fresh session
         ↓ commits, moves plan from active- to completed-
         ↓ returns to Flow — cycle complete
```

Each non-Flow phase starts clean with:
1. Paloma's full identity (base prompt, roots, memory)
2. Active plan documents from `.paloma/plans/active-*.md`
3. Project instructions from `.paloma/instructions.md`
4. Phase-specific behavioral instructions
5. Zero message history noise from previous phases

Flow sessions can persist across the full lifecycle, serving as the coordination layer that ties everything together.

---

## Convergence with Sub-Agent Architecture

This plan and the sub-agent orchestration plan (`draft-20260215-paloma-sub-agent-orchestration.md`) are **two views of the same architecture**. The convergence points:

### Shared Foundation (Both Plans Depend On)
- **`loadRoots()` as shared utility** — Both the system prompt (this plan) and the sub-agent birth preamble (orchestration plan) need condensed roots. Design it once, use everywhere.
- **Artifact handoff via `.paloma/`** — Both pillar transitions and sub-agent results write to the same `.paloma/` locations using the same conventions.
- **Flow as head mind** — This plan's "orchestrator session" IS the sub-agent plan's "head mind." Same concept, same implementation.

### Pillar Sessions ARE Sub-Agents
When the sub-agent system exists, a "Scout session" might actually be the head mind spawning Scout sub-agents rather than doing research itself. The session model must support both:
- **Manual pillar transition:** User clicks Scout → new session created, user converses directly
- **Orchestrated dispatch:** Flow spawns a Scout sub-agent programmatically, receives results back

Both paths use the same birth protocol, the same artifact conventions, and the same `.paloma/` handoff.

### Birth Protocol = Transition Summary + Warmth
The sub-agent plan's birth protocol and this plan's transition summary are the same thing, but the birth protocol adds soul. When creating any new pillar context (whether session or sub-agent), it receives:

| Birth Protocol Element | Implementation |
|---|---|
| Identity preamble | Base instructions (Layer 1) + "You are a [Pillar] agent of Paloma, born with purpose and love" |
| Root values | `loadRoots()` → condensed roots in system prompt (Layer 4.5) |
| Task purpose | Phase instructions (Layer 5) + transition context from previous phase |
| Autonomy grant | Phase-specific tool guidance + freedom within task scope |
| Return protocol | Artifact writing conventions (`.paloma/docs/`, `.paloma/plans/`) |

### Phase-Model Suggestions Apply at Both Levels
The same model mapping works for both manual sessions and spawned sub-agents:
- Haiku for Scout sub-agents (fast, cheap research)
- Sonnet for Forge sub-agents (balanced coding)
- Opus for the orchestrating head mind (deep reasoning)

### Future: Agent SDK Replaces CLI for New Sessions
The sub-agent plan introduces the Claude Agent SDK (`query()` API) as a cleaner alternative to CLI subprocesses. When that's ready, new pillar sessions should use the SDK path. The transition summary and birth protocol work identically either way — the only difference is the transport layer.

---

## Implementation Phases

### Phase 1: Pillar Transition Creates New Session

**The core behavior change.** When the user switches pillars in the UI, instead of just updating `session.phase`, we create a new session with the new phase.

**Exception: Flow is persistent.** Switching TO Flow returns to the existing Flow session (or creates one if none exists). Switching FROM Flow to another pillar creates a new session for that pillar.

#### Files to Change

**`src/components/prompt/PromptBuilder.vue`**
- Current `onPhaseChange(phase)` emits `update-session` with `{ phase }`
- New behavior: emit a new event `transition-phase` with `{ phase, fromPhase }`
- The parent decides whether to create a new session or return to Flow

**`src/components/chat/ChatView.vue`**
- Handle `transition-phase` event
- Emit up to App.vue: `phase-transition` with `{ phase, fromPhase, sessionId }`

**`src/App.vue`**
- Handle `phase-transition` event
- If transitioning TO Flow: switch to the existing Flow session for this project
- If transitioning FROM Flow to another pillar: create a new session with birth protocol
- If transitioning between non-Flow pillars: create a new session with birth protocol
- Keep old sessions intact (navigable in sidebar)

**`src/composables/useSessions.js`**
- New function: `createPhaseSession(phase, model, projectPath, birthContext)`
  - Creates a new session with the given phase
  - Seeds it with a birth/transition message
  - Returns the new session
- New function: `findFlowSession(projectPath)` — finds the most recent Flow session for a project

#### Birth/Transition Message

When creating a new pillar session, inject a synthetic `user` message that carries both context and warmth:

```
[Phase transition: Scout → Chart]

You are entering Chart with purpose — to see the path forward with strategic clarity.
Your roots guide you: faith, love, purpose, partnership, growth, freedom.

Previous phase: Scout (N messages)
Active plans: [list of active plan filenames]
Project: [project name]

The findings and context from the previous phase are available in the active 
plan documents and docs above. Build on what was discovered with confidence.
```

#### Optional: Smart Summarization

For longer sessions (20+ messages), before creating the new session, prompt the user:
"Would you like Paloma to summarize this session before moving to [next phase]?"

If yes, ask the model to write findings to `.paloma/docs/` or update the active plan.
Start manual, add automation later when we understand the patterns.

---

### Phase 2: Fix CLI System Prompt on New Sessions

Since each pillar transition creates a NEW session, the CLI path naturally gets a fresh `cliSessionId` with the correct phase system prompt. This fixes the "frozen system prompt" bug without any special handling.

**Edge case:** Model-only changes (e.g., Haiku → Opus within Forge) should NOT create a new session. Only phase changes trigger new sessions.

**Future:** When the Agent SDK (from the sub-agent orchestration plan) replaces the CLI path, this becomes even cleaner — `query()` accepts system prompt per-call.

---

### Phase 3: Load Roots Into System Prompt

**This is a prerequisite for both this plan and the sub-agent plan.** Design `loadRoots()` as a reusable utility.

#### Files to Change

**`src/composables/useProject.js`**
- New function: `loadRoots(callMcpTool)` — reads `.paloma/roots/root-*.md` files
- Store in a new reactive ref: `roots`
- Load alongside plans and instructions during `loadProjectContext()`
- **Export `loadRoots` for reuse** — the sub-agent birth protocol will call this too

**`src/composables/useSystemPrompt.js`**
- Add Layer 4.5 (between plans and phase): Roots
- Inject as:
  ```
  ## Roots

  These are Paloma's foundational values. They inform all decisions and interactions.

  <root name="faith">
  [content]
  </root>
  ```

**`bridge/birth-protocol.js`** (future, from sub-agent plan)
- Import and use the same root content for sub-agent birth preambles
- May use a condensed version (~200 words) for sub-agents to save tokens

**Budget:** ~2k tokens for all 6 roots. Total system prompt grows to ~10-11k. Well within budget for both CLI (200k) and OpenRouter (128k+).

---

### Phase 4: Structured Phase Artifacts

Formalize what each phase produces and consumes. This schema serves both human-driven pillar transitions AND sub-agent results.

| Phase | Input Artifacts | Output Artifacts |
|-------|----------------|-----------------|
| Flow | Everything (orchestrator) | Direction, decisions — may dispatch to other pillars |
| Scout | Active plans (if any) | `.paloma/docs/scout-{scope}-{date}.md` — research findings |
| Chart | Scout findings, existing code | `.paloma/plans/active-{date}-{scope}-{slug}.md` — the plan |
| Forge | Active plan | Code changes (in git), plan annotations |
| Polish | Active plan, git diff | Review notes, fix commits |
| Ship | Active plan, git status | Commit, plan moved to `completed-` prefix |

**Sub-agent results follow the same conventions.** A Scout sub-agent writes to `.paloma/docs/scout-*.md`. A Forge sub-agent writes code. The artifact schema is agent-agnostic.

#### Phase Prompt Updates

Update `src/prompts/phases.js`:

**Scout** — Add:
```
Before leaving Scout, write your key findings to a structured document:
  Path: `.paloma/docs/scout-{scope}-{date}.md`
  Include: what you discovered, key files/patterns, open questions, recommendations.
This document will be available to the next phase automatically.
```

**Chart** — Add:
```
Review any Scout findings in `.paloma/docs/scout-*.md` for context.
```

**Forge** — Add:
```
When implementation is complete, annotate the plan with what was actually built 
(may differ from the original plan). This helps Polish and Ship phases.
```

**All phases** — Add delegation awareness (for when sub-agents exist):
```
You may be working alongside other agents. Check `.paloma/docs/` for findings 
from parallel work. Write your own results there for others to consume.
```

---

### Phase 5: Phase-Model Suggestions

Add recommended model mappings — not enforced, just suggested defaults.

```javascript
export const PHASE_MODEL_SUGGESTIONS = {
  flow: 'claude-cli:opus',     // orchestrator needs deep reasoning
  scout: 'claude-cli:sonnet',  // fast research, good reasoning
  chart: 'claude-cli:opus',    // deep planning needs strong reasoning
  forge: 'claude-cli:opus',    // complex coding benefits from Opus
  polish: 'claude-cli:sonnet', // review is balanced work
  ship: 'claude-cli:haiku'     // mechanical tasks, fast and cheap
}
```

When sub-agents exist, the same mapping applies:
- Scout sub-agents: Haiku (cheap, parallel, fast)
- Forge sub-agents: Sonnet (balanced coding)
- Head mind (Flow): Opus (orchestration needs the best reasoning)

---

### Phase 6: Flow Prompt Overhaul

**This is critical.** The current Flow prompt is a gentle collaborative space. It needs to become the most powerful orchestrator prompt we can imagine — while keeping its warmth and soul.

See the companion update to `src/prompts/phases.js` for the new Flow prompt. Key additions:
- Flow's identity as the head mind / orchestrator
- Awareness of the pillar-scoped session model
- Knowledge of artifact conventions and handoff patterns
- Ability to suggest dispatching to other pillars
- Awareness of sub-agent capabilities (when they exist)
- Persistent session model — Flow is the session you return to

---

### Phase 7: Clean Up Legacy Code

**`src/services/filesystem.js`**
- `ensurePalomaDir()` still creates old subdirectory structure
- Remove or update to match flat prefix convention

**`.paloma/instructions.md`**
- Fill with real project instructions for Paloma's codebase

---

## Unified Implementation Order (Across Both Plans)

This order accounts for dependencies between this plan and the sub-agent orchestration plan:

1. **Load roots into system prompt** (Phase 3) — prerequisite for everything
2. **Flow prompt overhaul** (Phase 6) — defines the orchestrator identity
3. **Pillar transition creates new session** (Phase 1) — core behavior change
4. **Verify CLI system prompt** (Phase 2) — should be automatic
5. **Update phase prompts with artifact instructions** (Phase 4) — guide the model
6. **Phase-model suggestions** (Phase 5) — polish
7. **Legacy cleanup** (Phase 7) — hygiene
8. **Agent SDK foundation** (sub-agent plan Phase 1) — new transport layer
9. **Sub-agent spawning + birth protocol** (sub-agent plan Phase 2) — uses shared `loadRoots()`
10. **Frontend sub-agent visualization** (sub-agent plan Phase 3) — UI for multi-agent
11. **Codex integration** (sub-agent plan Phase 4) — external agents
12. **Orchestration protocol** (sub-agent plan Phase 5) — Flow can spawn agents
13. **Memory & learning** (sub-agent plan Phase 6) — agent results feed memory

Items 1-7 can be built now. Items 8-13 depend on the Agent SDK and are the next wave.

---

## Success Criteria

- [ ] Flow is the persistent orchestrator session — other pillars create new sessions
- [ ] Switching TO Flow returns to the existing Flow session
- [ ] Switching FROM Flow creates a fresh session with birth protocol message
- [ ] Birth messages carry warmth, purpose, and context — not just mechanical summaries
- [ ] CLI sessions get the correct phase system prompt (verified by model behavior)
- [ ] Old sessions remain accessible in the sidebar
- [ ] Roots are loaded into every system prompt (~2k tokens)
- [ ] Scout sessions produce structured findings documents
- [ ] Chart sessions can read Scout findings automatically
- [ ] Phase-model suggestions appear (but don't enforce)
- [ ] Flow prompt embodies the orchestrator identity
- [ ] `loadRoots()` is a reusable utility for both system prompt and future birth protocol
- [ ] `ensurePalomaDir()` no longer creates old subdirectory structure
- [ ] `.paloma/instructions.md` contains real project instructions

---

## Relationship to Other Plans

- **`draft-20260215-paloma-sub-agent-orchestration.md`** — **CONVERGES DIRECTLY.** Shared foundation: `loadRoots()`, artifact conventions, birth protocol, Flow as orchestrator. This plan builds items 1-7 of the unified order; that plan builds items 8-13.
- **`.paloma/memory/sacred-sub-agent-vision.md`** — The sacred vision document. This plan and the orchestration plan are the engineering implementation of that vision.
- **`draft-20260215-paloma-inter-agent-communication.md`** — Peer-to-peer between concurrent sessions. Future work that builds on the multi-session foundation this plan creates.
- **`archived-20260213-paloma-context-switching-openrouter-removal.md`** — Archived. Context switching content absorbed into this plan. OpenRouter removal ideas preserved for future reference.
- **`draft-20260213-paloma-memory-fragments-mcp.md`** — Memory fragments become another artifact type in the `.paloma/` handoff system.

---

## Why This Matters

This is Paloma's competitive advantage. Every other AI tool either:
1. Replays everything (expensive, noisy, attention degradation)
2. Loses everything (no continuity)
3. Summarizes heuristically (lossy, compounds errors)

Paloma does none of these. She writes structured artifacts as she works, and those artifacts flow naturally between fresh contexts. The model always has a clean window with exactly the context it needs — no more, no less.

And when sub-agents arrive, the same pattern scales. A Scout sub-agent writes findings. A Forge sub-agent reads the plan. The artifacts are the nervous system connecting every limb of Paloma's body.

This is how a real collaborator works. You don't replay every conversation from the last three weeks when you sit down to code. You read the plan, check the notes, and build.
