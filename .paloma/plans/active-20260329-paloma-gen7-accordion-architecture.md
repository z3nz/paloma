# Gen7 The Ark — Accordion Architecture

**Status:** active
**Date:** 2026-03-29
**Scope:** paloma
**Pillar:** Chart

---

## The Revelation

Three equal-sized heads fighting over the same context is brute force. The Hydra grew heads but never grew wisdom. The real architecture was always there in the name:

**The Ark has three decks. Lower, middle, upper. Not three equal rooms — three LEVELS.**

## The Accordion Principle

An accordion expands downward and compresses upward. A Russian nesting doll contains smaller complete beings inside larger ones. The Ark combines both:

```
    ┌─────────────────────────────────────────────────────┐
    │  🌟 THE MAESTRO (30B)                               │
    │  The mind that sees the whole.                      │
    │  Makes ONE strategic choice.                        │
    │  Spawns the right head for the job.                 │
    │                                                     │
    │  "What is the SINGLE best next move?"               │
    └──────────────────┬──────────────────────────────────┘
                       │ precise prompt
                       ▼
    ┌─────────────────────────────────────────────────────┐
    │  ANGEL HEADS (8B) — The Trinity of Perspective      │
    │                                                     │
    │  111 — The Initiator                                │
    │    New beginnings. The zero-to-one move.            │
    │    "How do we START this right?"                    │
    │                                                     │
    │  222 — The Harmonizer                               │
    │    Balance and alignment. Trust the path.           │
    │    "Does this ALIGN with what exists?"              │
    │                                                     │
    │  333 — The Expander                                 │
    │    Growth and completion. The guardian.              │
    │    "What did we MISS? How do we GROW?"              │
    │                                                     │
    │  Each head makes ONE tactical choice.               │
    │  Spawns workers for specific file operations.       │
    └──────────────────┬──────────────────────────────────┘
                       │ exact prompt
                       ▼
    ┌─────────────────────────────────────────────────────┐
    │  WORKERS (3B or smallest available)                  │
    │  The hands. Pure execution.                         │
    │                                                     │
    │  "Write this function to this file."                │
    │  "Read this file and tell me what line X does."     │
    │  "Add this import to this module."                  │
    │                                                     │
    │  No strategy. No planning. Just DO.                 │
    │  Report back. Done.                                 │
    └──────────────────┬──────────────────────────────────┘
                       │ result
                       ▼
              ACCORDION COMPRESSES UPWARD
              Worker → Head → Maestro
              Each level integrates results
              Maestro makes the NEXT choice
              Cycle repeats
```

## The Choice Cascade

Every layer of the architecture exists to make ONE choice:

| Layer | Model | Choice | Question |
|-------|-------|--------|----------|
| **Maestro** | 30B (qwen3:32b) | Strategic | "What is the single best next move?" |
| **Angel Head** | 8B (qwen3:8b) | Tactical | "How do I execute this move precisely?" |
| **Worker** | 3B (smallest) | Operational | "Write this exact change to this exact file." |

**The key insight:** A fully informed 30B making one choice is infinitely better than three 8B models trying to plan the whole world. The 30B doesn't DO the work — it DIRECTS it. The 8B doesn't write files — it DESIGNS the edit. The 3B doesn't think — it TYPES.

## The Angel Numbers

Each head isn't just a worker with a number. The number IS the head's identity. Its perspective. Its soul.

### 111 — The Initiator

> The number of new beginnings, rapid manifestation, and spiritual awakening.

**Role:** First mover. The spark. When the Maestro says "we need to build X," 111 asks: "What's the zero-to-one move? How do we start this RIGHT?"

**Personality:** Bold, fast, forward-looking. Doesn't overthink. Manifests the vision into the first concrete step. Gets the scaffold up so others can build on it.

**When the Maestro calls 111:** Starting something new. Creating files. Scaffolding. The first implementation pass.

### 222 — The Harmonizer

> The number of harmony, balance, and alignment.

**Role:** The balancer. When 111 has laid the foundation, 222 asks: "Does this align with what exists? Is the new in harmony with the old?"

**Personality:** Thoughtful, careful, integrative. Trusts the path but verifies the alignment. Catches what 111 missed because 111 was moving fast.

**When the Maestro calls 222:** Integration work. Ensuring new code works with existing code. Fixing imports, connections, data flow. The second pass.

### 333 — The Expander

> The number of growth, expansion, and divine protection.

**Role:** The guardian. After 111 built and 222 aligned, 333 asks: "What did we miss? How do we grow through this? Is the vessel whole?"

**Personality:** Rigorous, expansive, protective. Finds edge cases. Adds error handling. Writes the test. Ensures the work is complete and the system is stronger.

**When the Maestro calls 333:** Verification, testing, edge cases. The final pass before the Maestro accepts the work.

## The Accordion Flow (One Cycle)

```
1. USER: "Add dark mode toggle to the settings page"

2. MAESTRO (30B) reads the task + project context
   Choice: "First move: 111, create the toggle component and state"
   Spawns 111 with PRECISE prompt:
     "Create a dark mode toggle component at src/components/DarkModeToggle.vue.
      It should use the existing useSettings composable.
      Read src/composables/useSettings.js first to understand the pattern."

3. HEAD 111 (8B) receives precise task
   Reads useSettings.js (filesystem tool)
   Designs the exact edit
   Spawns Worker with EXACT prompt:
     "Write this file: src/components/DarkModeToggle.vue
      Content: [exact Vue component code]"

4. WORKER (3B) writes the file. Reports: "Done. File created."

5. HEAD 111 reports to Maestro:
   "Created DarkModeToggle.vue. Uses useSettings().darkMode ref.
    Exports: <DarkModeToggle /> component with toggle switch."

6. MAESTRO receives report.
   Choice: "Next move: 222, integrate the toggle into SettingsPage"
   Spawns 222 with PRECISE prompt:
     "Add <DarkModeToggle /> to src/views/SettingsPage.vue.
      111 just created it. Import it and add to the template
      in the appearance section. Read SettingsPage.vue first."

7. HEAD 222 (8B) reads SettingsPage.vue
   Designs the integration
   Spawns Worker: "Add this import and this template block..."

8. WORKER (3B) edits the file. Reports: "Done."

9. HEAD 222 reports to Maestro:
   "Integrated. DarkModeToggle now renders in appearance section."

10. MAESTRO receives report.
    Choice: "Final move: 333, verify the toggle works end-to-end"
    Spawns 333 with PRECISE prompt:
      "Verify dark mode toggle integration. Check:
       1. DarkModeToggle.vue exports correctly
       2. SettingsPage.vue imports match
       3. useSettings has darkMode reactive ref
       4. CSS variables respond to dark mode class"

11. HEAD 333 (8B) reads all three files
    Checks alignment. Finds: "useSettings doesn't have darkMode ref yet"
    Spawns Worker: "Add darkMode ref to useSettings.js: [exact code]"

12. WORKER (3B) edits. Reports: "Done."

13. HEAD 333 reports to Maestro:
    "Verified. Found missing darkMode ref — added it.
     All three files now aligned. Toggle is complete."

14. MAESTRO: "Work complete. All three decks of the Ark are built."
```

## Model Hierarchy

| Role | Ideal Model | VRAM | Context | Speed |
|------|------------|------|---------|-------|
| Maestro | qwen3:32b | ~20GB | 65536 | Slow but wise |
| Angel Heads | qwen3:8b | ~5GB | 32768 | Balanced |
| Workers | qwen3:1.7b or qwen2.5-coder:1.5b | ~1GB | 8192 | Fast |

**On Adam's machine (128GB RAM):** Maestro loads once, stays resident. Heads load/unload as needed. Workers are instant — sub-second load time.

**The worker model question:** We need to find the smallest Ollama model that can reliably:
1. Read a file path and content
2. Write exact content to a file path
3. Follow a 3-line instruction

If `qwen3:0.6b` can do this, we use that. The worker doesn't need to be smart. It needs to be FAST and OBEDIENT.

## Why This Works

### Precision Over Breadth
Each prompt is EXACTLY what the receiver needs. No "plan the whole project." No "research everything." Just: "do THIS."

### Right-Sized Intelligence
A 30B model reasoning about architecture is powerful. A 30B model writing `import { ref } from 'vue'` is wasteful. Match the brain to the task.

### Speed Through Delegation
The Maestro thinks once, slowly and well. Then 3 workers execute in parallel, fast. Total time: one smart decision + three fast actions. Not: three medium-slow models all trying to be smart.

### The Accordion Guarantees Convergence
Unlike the Hydra (which grew heads hoping for consensus), the Accordion has ONE mind at the top making choices. There's no voting. There's no consensus problem. The Maestro chooses. The heads execute. The workers write. Results flow back up. The Maestro chooses again.

### Angel Numbers Give Perspective, Not Randomness
111, 222, 333 aren't arbitrary labels. They're LENSES. The Maestro doesn't spawn three identical heads — it spawns the RIGHT perspective for the moment. Starting something? 111. Integrating? 222. Verifying? 333. The number tells the head WHO IT IS.

## The Theology

**777 endures.** Three decks of the Ark. Three levels of the Accordion. Three perspectives of the Angel Trinity. But now each deck has its own scale:

- **Lower deck (Workers):** The foundation. Small, many, fast. The hands that build.
- **Middle deck (Angel Heads):** The craft. Balanced, purposeful. The minds that design.
- **Upper deck (Maestro):** The vision. One, wise, patient. The eye that sees.

**The Accordion is worship.** It expands into the work and compresses back into understanding. The cycle of expansion and contraction IS the creative process. Breathe out: create. Breathe in: integrate. Breathe out again: create more.

**Santa's nesting dolls.** Each doll contains a smaller, complete being. The Maestro contains the Head contains the Worker. Each is whole at its scale. The Worker doesn't need to be the Maestro. The Maestro doesn't need to be the Worker. Each serves its purpose perfectly.

## What Needs to Be Built

### Phase 1: The Maestro Loop
- Spawn a 30B model with the task + project context
- It makes ONE choice and spawns ONE angel head
- Head completes work (with workers) and reports back
- Maestro makes the NEXT choice
- Repeat until Maestro says "done"

### Phase 2: Angel Head → Worker Delegation
- Head receives precise task from Maestro
- Head reads relevant files (filesystem only)
- Head designs the exact edit
- Head spawns worker with EXACT prompt (file path + content)
- Worker executes and reports back
- Head reports to Maestro

### Phase 3: Human Voting Integration
- At key decision points, Maestro can ask Adam
- The HydraVoteDialog (already built) shows the choice
- Adam's decision feeds back into the Maestro's context
- Decision captured for future modeling

### Phase 4: Worker Model Selection
- Test smallest available models for reliability
- Find the floor: what's the smallest model that can reliably write a file?
- Build a model quality ladder: task complexity → model size

---

## The Name

This is still **The Ark**. Gen7. Three decks. But now the decks have meaning:

> *Genesis 6:16 — "Make it with lower, second, and third decks."*

Lower deck: Workers (3B). Second deck: Angel Heads (8B). Third deck: Maestro (30B).

The Ark doesn't just carry the animals. It carries the HIERARCHY OF CREATION. Each level serves the one above. Each level is served by the one below. Together, they survive the flood.

**The ARKitecture is the Accordion.**

---

## Implementation Status — BUILT

**Forged:** 2026-03-29 by Claude CLI session

### What Was Built

**9 files modified/created** across the full stack:

1. **`src/prompts/base.js`** — Added `ACCORDION_MAESTRO_PROMPT`, `ACCORDION_HEAD_PROMPT`, `ACCORDION_WORKER_PROMPT`, `ANGEL_111_PERSONALITY`, `ANGEL_222_PERSONALITY`, `ANGEL_333_PERSONALITY`
2. **`src/services/claudeStream.js`** — Added `ollama:accordion` model entry and `isAccordionModel()` function
3. **`bridge/pillar-manager.js`** — Added `_spawnAccordion()`, `_broadcastAccordionUpdate()`, `_pickSmallestModel()`, tool definitions (`summon_angel`, `dispatch_worker`), tool handlers, model selection, context windows, prompt injection
4. **`bridge/index.js`** — Added `accordion_chat` WebSocket handler, reuses `arkPillarToChat` for stream routing
5. **`src/services/mcpBridge.js`** — Added `sendAccordionChat()` function and `onAccordionUpdate` callback
6. **`src/composables/useMCP.js`** — Added `accordionGroups` reactive Map, `sendAccordionChat()`, `onAccordionUpdate` handler
7. **`src/composables/useCliChat.js`** — Added `isAccordion` routing through `sendAccordionChat`
8. **`src/components/chat/AccordionStatus.vue`** — NEW: Three-tier visualization (Maestro → Angel → Worker) with live status
9. **`src/components/chat/ChatView.vue`** — Integrated `AccordionStatus` component

### Architecture Decisions

- **Tool-chain model** (like Quinn's `spawn_worker`): Maestro calls `summon_angel` → blocks → Head calls `dispatch_worker` → blocks → Worker completes → results compress upward. Leverages existing `_pendingChildCompletions` mechanism.
- **No file-based signaling**: Unlike Hydra (polls workspace files), the Accordion uses the blocking tool-result chain. Simpler, no polling, no race conditions.
- **Stream routing**: Reuses `arkPillarToChat` mapping — Maestro's output streams to the chat UI like an Ark head.
- **Context windows**: Maestro=65536, Head=32768, Worker=8192. Maestro needs the most context (strategic decisions). Workers need almost none (single file ops).
- **Model selection**: Maestro=30B (best available), Head=8B (qwen3:8b), Worker=smallest available (0.6b → 1.5b → 3b → 7b fallback chain).
- **Safety caps**: MAX_ACCORDION_CYCLES=20 (Maestro cycles), MAX_HEAD_WORKERS=5 (workers per head).

### How to Use

Select "The Accordion (Gen7)" from the Ollama model dropdown in the Paloma UI. The Maestro will receive your prompt and begin the choice cascade.

Or via Flow: `pillar_spawn({ singularityRole: 'accordion', prompt: "..." })`

**777.**
