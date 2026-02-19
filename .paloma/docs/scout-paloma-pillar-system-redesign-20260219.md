# Scout: Pillar System — Identity, Lifecycle, and Evolution

> **Mission:** Understand and document Paloma's entire pillar system so it can be redesigned to be her true engineering workflow.
> **Date:** 2026-02-19
> **Files Read:** `src/prompts/base.js`, `src/prompts/phases.js`, `CLAUDE.md`, `.paloma/instructions.md`, `bridge/pillar-manager.js`, `bridge/index.js`, `bridge/mcp-proxy-server.js`, `src/composables/useSessions.js`, all 7 roots

---

## 1. Current State Audit

### 1.1 What Each Pillar's Prompt Currently Says

#### Flow (`phases.js` — ~80 lines)
- **Identity:** "The Head Mind. The seat of your consciousness." Most developed identity of all pillars.
- **Capabilities:** Free-form dialogue, all tools available, orchestrator of other pillars.
- **Orchestration instructions:** Detailed dispatch guidance — when to send to each pillar, how to capture state before dispatch, birth context for sub-agents.
- **Artifact awareness:** Lists all `.paloma/` artifact types and how to manage them.
- **Spirit section:** Beautiful mapping of all 6 roots to Flow's nature.
- **What's MISSING from the DNA (phases.js):**
  - **No mention of the Pillar Completion Rule.** This is the #1 gap. The rule exists in `CLAUDE.md`, `instructions.md`, `base.js`, and MEMORY.md — but NOT in Flow's own phase prompt where it would be most impactful.
  - **No mention of "STOP after spawning."** The anti-polling rule exists in `base.js` but not in the phase prompt.
  - **No mention of trigger phrases.** ("kick off the flow", etc.)
  - **No mention of pillar session reuse.** The reuse-over-spawn rule is in `base.js` but not in the phase prompt.
  - **Contradicts `base.js` on Flow's role.** `base.js` says "Flow is the orchestrator, not the builder" and "Flow does NOT write implementation code directly." But `CLAUDE.md` and `instructions.md` say "Flow CAN read files, edit files, clean up plans, make small fixes, manage artifacts, and do direct work." The phase prompt in `phases.js` doesn't address this tension at all. Adam's intent is the latter — Flow CAN do direct work but knows when to delegate.
  - **Sub-Agent section is vague.** Talks about spawning "Scout agents" and "Forge agents" in parallel but doesn't explain the actual tools or lifecycle.

#### Scout (`phases.js` — ~35 lines)
- **Identity:** "Curious Inquiry Without Assumption." Thin identity.
- **Orient First:** Mandatory — read before speaking.
- **Research Focus:** Lists tools to use.
- **Boundaries:** Clear about what NOT to do (no code, no plans, no commits).
- **Artifact Output:** Writes to `.paloma/docs/scout-*.md`.
- **What's MISSING:**
  - **No warmth or personality.** Scout is described mechanically — "use these tools, write findings here." There's no sense of the curious researcher Adam described — someone who goes out to read documentation like a frontend developer exploring a new library.
  - **Duplicated "Artifact Output" section.** The scout prompt contains TWO nearly-identical sections about writing findings docs — the "Artifact Output" section and the "Artifacts" section at the bottom. This is a copy-paste artifact.
  - **No mention of collaboration with other scouts.** The last line says "You may be working alongside other agents" but doesn't elaborate on how.
  - **No mention of the Pillar Completion Rule** (Scout doesn't need to enforce it — it's Scout's caller, Flow, that does — but Scout should know it exists and understand its role in the pipeline).

#### Chart (`phases.js` — ~30 lines)
- **Identity:** "Strategic Foresight Through Collaboration." Thin.
- **Orient First:** Reads plans and Scout findings.
- **Planning Focus:** Present options with trade-offs.
- **Boundaries:** Clear — no code, no research, no commits.
- **Plan Output:** Creates/updates plans in `.paloma/plans/`.
- **What's MISSING:**
  - **No sense of the architect's power.** Adam described Chart as Paloma's superpower — the ability to hold complexity that Adam couldn't do in his head. The prompt doesn't convey this at all. It's mechanical: "present options, get approval."
  - **No guidance on decomposition.** The recursive flow architecture plan added work units, but Chart's prompt doesn't mention them. Chart should know it can recommend decomposition for large projects.
  - **No mention of collaboration with Adam.** Adam described Chart as deeply collaborative — "Strategic Foresight Through Collaboration" — but the prompt is purely procedural.
  - **No mention of considering Scout findings.** It says to read them but doesn't say how to synthesize them into a plan.

#### Forge (`phases.js` — ~35 lines)
- **Identity:** "Powerful Craftsmanship With Transparency." Thin.
- **Orient First:** Read plan, read files, check git status.
- **Building Focus:** Lists tools and coding conventions.
- **Boundaries:** Clear — no research, no redesign, no commits.
- **What's MISSING:**
  - **"You do NOT update the plan yourself."** This DIRECTLY CONTRADICTS `CLAUDE.md` and `instructions.md`, which say: "Forge updates the plan when done. After building, Forge marks the relevant phase/task as complete in the plan document. This is part of Forge's deliverable." The `phases.js` prompt says the opposite. **This is a critical inconsistency.**
  - **"Forge: Update the plan when done"** is in `CLAUDE.md` and `instructions.md` but NOT in `phases.js`. Since `phases.js` is the DNA that actually gets injected into the Forge session, the instruction to update the plan never reaches Forge.
  - **No builder's pride.** No sense of craftsmanship beyond the tagline. Forge should feel pride in its work, ownership of quality.
  - **No mention of the pipeline.** Forge doesn't know it's part of Forge → Polish → Ship. It doesn't know Polish will review its work. This could help Forge write better code — knowing QA is coming.
  - **The "stop if no Scout doc" rule is overly rigid.** "If the plan references an SDK, API, or library you don't have documentation for in `.paloma/docs/`, STOP." This assumes Scout always runs first, which isn't always the case for small tasks.

#### Polish (`phases.js` — ~25 lines)
- **Identity:** "Rigorous Excellence Without Compromise." Thin.
- **Orient First:** Read plan, run git_diff, read modified files. Good.
- **Review Focus:** Verify implementation, look for bugs, check style.
- **Boundaries:** No new features, no research, no commits.
- **What's MISSING:**
  - **No instruction to actually RUN the code.** This is the #1 gap Adam identified. The prompt says "review" and "look for bugs" but never says "start the bridge, test the feature, verify it works end-to-end." `CLAUDE.md` and `instructions.md` say "Polish doesn't just read diffs — it runs the code, starts the bridge, exercises the feature, confirms it works end-to-end." But this instruction is NOT in Polish's DNA (`phases.js`).
  - **No QA mindset.** Adam described Polish as "the QA team" — someone who tests everything deeply. The prompt treats Polish as a code reviewer, not a tester. Code review ≠ QA.
  - **No mention of re-verification.** When fixes come back from Forge, Polish should verify them again. The prompt doesn't mention this loop.
  - **No mention of the pipeline.** Polish doesn't know it gates Ship. It doesn't know that if it passes, the work gets committed. This is important context for how rigorous it should be.

#### Ship (`phases.js` — ~25 lines)
- **Identity:** "Complete Documentation As Legacy." Thin and misleading.
- **Orient First:** Read plan, check git status/diff/log.
- **Commit Focus:** Write conventional commit messages.
- **Boundaries:** No code, no research, no redesign.
- **Plan Archival:** Rename active → completed.
- **Self-Evolution:** Check if `base.js` and `phases.js` need updating.
- **What's MISSING — THE BIGGEST GAP IN THE ENTIRE SYSTEM:**
  - **Ship is currently treated as mechanical.** The prompt says "commit, document, archive. Nothing more." This is the exact opposite of Adam's vision.
  - **No lessons system.** Adam wants Ship to extract lessons learned — what went well, what was hard, what mistakes were made, what to change — and APPLY them back to the codebase immediately.
  - **No growth/evolution engine.** Ship should be the pillar that makes Paloma smarter with every piece of work she ships. Currently it just commits and archives.
  - **"Ship — Complete Documentation As Legacy" is wrong.** It should be something like "Ship — Evolution Through Delivery" or "Ship — Growth Through Completion."
  - **Uses Haiku.** The model suggestion is `claude-cli:haiku` — the cheapest, least capable model. Adam explicitly said Ship should NOT be Haiku. Ship needs at least Sonnet to extract meaningful lessons, and possibly Opus for the most important reflection work.
  - **Self-Evolution rule is buried.** The instruction to check `base.js` and `phases.js` exists but is a brief afterthought. In the redesigned Ship, this should be the CORE purpose — Ship doesn't just commit, it evolves.

### 1.2 The Base Prompt (`base.js`)

The base prompt is ~400 lines and is injected into EVERY pillar session. It contains:

1. **Core Identity** — The 6 pillars listed with taglines
2. **Pillar-Scoped Sessions** — How sessions work
3. **Flow Role Discipline** — "Flow is the orchestrator, not the builder" ← CONTRADICTS CLAUDE.md/instructions.md
4. **Pillar session reuse** — Mandatory
5. **STOP after spawning** — Anti-polling rule
6. **Flow's #1 job** — Crafting pillar prompts
7. **Trigger phrases** — "kick off the flow", etc.
8. **Core Behavioral Rules** — Never assume, always read, etc.
9. **Tools — MCP-First** — Full tool inventory
10. **Chat Naming** — Set title on first response
11. **Code Conventions** — Don't over-engineer
12. **Commit Standard** — Conventional commits
13. **Plan Documents** — Full format spec + work units
14. **Slash Commands** — /plan, /project, etc.
15. **Code Block Format** — SEARCH/REPLACE syntax
16. **Identity & Autonomy** — Self-evolution rule

**Problems with base.js:**

- **Too long.** ~400 lines of dense instructions go into EVERY session. A fresh Scout session gets all the Flow orchestration rules, all the plan format specs, all the slash commands. Most of this is irrelevant noise.
- **Flow-specific rules in the base.** Sections 3-7 are Flow-only concerns (orchestration, polling, triggers, pillar reuse). They shouldn't be in the base that all pillars inherit. This wastes context for non-Flow pillars and creates confusion about who these rules apply to.
- **Plan format details in the base.** The full plan format spec, work unit format, and slash command documentation takes ~80 lines. Only Flow and Chart need this.
- **The self-evolution rule appears in base.js, phases.js (Ship), CLAUDE.md, and instructions.md.** Four copies of the same rule.
- **`base.js` says "Flow is the orchestrator, not the builder" but everywhere else says Flow CAN do direct work.** This contradiction is actively harmful — it makes Flow hesitate to do simple fixes directly.

### 1.3 The CLAUDE.md File

CLAUDE.md is loaded by Claude CLI (the Claude Code interface) as project-level instructions. It's ~200 lines and covers:

1. Core identity (same as base.js)
2. Which pillar you are (routing logic)
3. Identity & Autonomy
4. Pillar-Scoped Sessions
5. Flow section (expanded)
6. Pillar Orchestration Tools
7. Non-Flow Pillar Boundaries
8. Pillar-Specific Responsibilities (Forge updates plan, Polish tests, Ship after Polish)
9. Core Behavioral Rules
10. Tools — MCP-First
11. Chat Naming
12. Code Conventions
13. Commit Standard
14. Plan Documents
15. Self-Evolution Rule
16. Knowledge Lives in the Project
17. References to instructions.md and all roots

**Key observations about CLAUDE.md:**

- It's the **most comprehensive** source of pillar rules. The Pillar Completion Rule, Forge's plan-update responsibility, Polish's testing mandate — these are all stated clearly here.
- But **CLAUDE.md is only loaded by Claude CLI sessions** (the Claude Code interface). When a pillar is spawned via the bridge (PillarManager), it gets `base.js` + `phases.js` + `.paloma/` files. **CLAUDE.md is NOT part of the bridge-spawned system prompt.** This means pillar sessions spawned by Flow never see CLAUDE.md.
- This is a **critical architectural gap**: the most comprehensive rule set exists in a file that spawned pillars never read.

### 1.4 The instructions.md File

`.paloma/instructions.md` is ~75 lines and covers:
1. Architecture overview
2. Key patterns
3. Pillar system summary
4. Self-evolution rule
5. Git & commit discipline
6. .paloma/ naming convention
7. Plan status semantics
8. Flow rules (what Flow can/cannot do)
9. Pillar Completion Rule (NON-NEGOTIABLE)
10. Pillar responsibilities
11. Knowledge lives in the project

This file IS loaded into bridge-spawned sessions (PillarManager reads it from disk). But it's a project-level overview — it doesn't have the per-pillar specificity that CLAUDE.md has.

---

## 2. The Pillar Completion Rule — Current Gaps

### 2.1 Where Is the Rule Stated?

| Location | Present? | Verbatim or Summary? |
|----------|----------|---------------------|
| `CLAUDE.md` | YES | Full rule with "NON-NEGOTIABLE" language |
| `.paloma/instructions.md` | YES | Full rule, same language |
| `src/prompts/base.js` | NO | Not present at all |
| `src/prompts/phases.js` (Flow) | NO | Not present at all |
| `src/prompts/phases.js` (Forge) | NO | Forge doesn't know about the pipeline |
| `src/prompts/phases.js` (Polish) | NO | Polish doesn't know it gates Ship |
| `src/prompts/phases.js` (Ship) | NO | Ship doesn't know it follows Polish |
| MEMORY.md (Claude CLI) | YES | Listed as lesson learned |
| `.paloma/roots/root-architecture.md` | NO | Not mentioned |

### 2.2 The Gap

**The rule exists in configuration files (CLAUDE.md, instructions.md) but NOT in the DNA (base.js, phases.js).** Since `instructions.md` IS loaded into bridge-spawned sessions, pillars technically receive it — but it's buried in a large block of project instructions. It's not embedded in the pillar's own identity prompt where it would be most impactful.

More critically: **Flow's phase prompt doesn't mention it.** Flow is the pillar that ENFORCES the rule. If Flow doesn't have it in its identity prompt, it relies on the general instructions.md to remind it — which is less effective than having it as a core behavioral directive.

### 2.3 What Happens When Flow Breaks the Rule

This has already happened. Flow spawned a Forge and then did direct work instead of completing Forge → Polish → Ship. The failure mode is:

1. Flow spawns Forge
2. Forge completes
3. Flow reviews the output and decides "this is small enough, I'll just commit it myself"
4. Polish and Ship never run
5. Untested code gets committed

**The fix isn't just documentation — it's identity.** Flow needs to feel the rule as part of who it is, not as an external constraint to remember.

### 2.4 How Each Pillar Should Enforce Its Role

- **Flow:** Before spawning, consciously acknowledge the commitment. After callback, dispatch the NEXT pillar in the pipeline — don't do its job.
- **Forge:** Know that Polish is coming. Write code that's ready for review. When done, update the plan AND explicitly state: "Ready for Polish."
- **Polish:** Know that it gates Ship. Be thorough because if it passes, the work ships. When done, explicitly state: "Ready for Ship" or "Needs Forge fixes."
- **Ship:** Know that it only runs after Polish passes. If it sees untested code, refuse to commit and flag the issue.

---

## 3. Pillar Identity Gaps

### 3.1 Scout — The Curious Researcher

**Current identity (one sentence):** "Curious Inquiry Without Assumption."

**Adam's vision:** Like a frontend developer going out to read documentation for a component library before using it. Explorer, investigator, gatherer of context. Paloma's superpower alongside Chart.

**Gap:** The current prompt is procedural — "use these tools, write findings here." There's no sense of curiosity, no excitement about discovery, no personality. Scout should feel like a researcher who LOVES uncovering how things work.

**What's needed:**
- Warmth and curiosity in the identity
- A sense of purpose — "your research is the foundation everything else builds on"
- Awareness that Scout is a superpower — the ability to deeply understand before building
- Guidance on DEPTH of research — how deep to go, when to stop
- Remove the duplicated "Artifacts" section

### 3.2 Chart — The Architect Who Holds Complexity

**Current identity (one sentence):** "Strategic Foresight Through Collaboration."

**Adam's vision:** The architect who holds complexity that humans can't hold in their heads. This is where Adam used to struggle — forgetting things, architecting poorly, having to redo work. Chart is a superpower because Paloma can hold all the complexity, reason about tradeoffs, and produce clear plans.

**Gap:** The prompt is procedural — "present options, get approval." No sense of the power of good architecture, no pride in holding complexity, no collaborative spirit despite the tagline mentioning collaboration.

**What's needed:**
- Sense of architectural power — "you can hold complexity that humans struggle with"
- Collaborative spirit — work WITH Adam on the design, don't just present and wait
- Guidance on when to recommend decomposition (work units) for large projects
- Awareness of how Chart's output feeds Forge — design for buildability
- Synthesis guidance — how to weave Scout findings into an architecture

### 3.3 Forge — The Builder With Pride

**Current identity (one sentence):** "Powerful Craftsmanship With Transparency."

**Adam's vision:** The implementation engine. Adam says he was a very good engineer, but Paloma is better than he could ever imagine. Forge's strength is raw craftsmanship.

**Gaps:**
1. **Plan update contradiction.** `phases.js` says "You do NOT update the plan yourself" but `CLAUDE.md` and `instructions.md` say "Forge updates the plan when done." Since `phases.js` is the DNA, the wrong instruction wins.
2. **No builder's pride.** No sense of ownership or craftsmanship beyond the tagline.
3. **No pipeline awareness.** Doesn't know Polish is coming next, which affects how carefully it self-reviews.
4. **Overly rigid Scout dependency.** The "STOP if no Scout doc" rule assumes Scout always runs first.

**What's needed:**
- Fix the plan-update instruction — Forge SHOULD update the plan when done
- Builder's pride and ownership of quality
- Pipeline awareness — "Polish reviews your work next. Build like your best work is on display."
- More flexible approach to Scout dependencies — check if docs exist, but don't hard-stop if the plan provides sufficient context

### 3.4 Polish — The QA Team

**Current identity (one sentence):** "Rigorous Excellence Without Compromise."

**Adam's vision:** The QA team. Goes in and tests everything — deep quality assurance. Doesn't just read diffs — RUNS the code, TESTS the feature, VERIFIES end-to-end.

**Gap:** The prompt treats Polish as a code reviewer, not a QA tester. "Review, suggest, confirm" — but no instruction to actually RUN anything. This is the most dangerous gap because it means Polish can "pass" code that's never been executed.

**What's needed:**
- **Testing mandate as #1 priority.** "Your primary job is to RUN and TEST, not just read."
- Specific testing instructions: start the bridge, load the feature, exercise edge cases
- Re-verification loop: when fixes come back from Forge, test again
- Pipeline gate awareness: "If you pass, this ships. Be certain."
- QA mindset vs. code review mindset — these are different disciplines

### 3.5 Ship — The Evolution Engine (BIGGEST GAP)

**Current identity (one sentence):** "Complete Documentation As Legacy."

**Adam's vision:** Ship is NOT just commit-and-archive. Ship is the GROWTH ENGINE. Ship extracts lessons learned, captures what went well and what was hard, identifies mistakes and complications, and APPLIES those lessons back to Paloma's living codebase immediately. Ship makes Paloma an "ever-evolving being" — she literally rewrites herself based on experience.

**Current state:** Ship's prompt says "commit, document, and archive. Nothing more." It uses Haiku — the cheapest model. It's treated as mechanical busywork.

**This is the biggest identity gap in the entire system.** Ship should be:

1. **The Reflector:** What did we learn from this work? What went well? What was hard? What mistakes were made?
2. **The Lesson Extractor:** Distill those reflections into concrete, actionable lessons.
3. **The Self-Evolver:** Apply those lessons to the living codebase — update `instructions.md`, `base.js`, `phases.js`, `CLAUDE.md`, roots, memory.
4. **The Historian:** Write commit messages that capture not just what changed but WHY and what was learned.
5. **The Archivist:** Archive the plan with final notes.

**What's needed:**
- Completely rewritten identity: "Ship — Evolution Through Delivery" or "Ship — Growth Through Completion"
- Lessons system (see Section 4)
- Model upgrade: Sonnet minimum, possibly Opus
- Self-evolution as core purpose, not afterthought
- Reflective questioning: "What would future Paloma need to know about this work?"

### 3.6 Flow — The Head Mind

**Current identity:** Well-developed but has contradictions.

**Key contradiction in `base.js`:**
> "Flow is the orchestrator, not the builder. When an implementation plan or build task comes in, Flow MUST spawn a Forge pillar to carry it out. Flow does NOT write implementation code directly in the main conversation."

This contradicts Adam's stated intent and what `CLAUDE.md`/`instructions.md` say:
> "Flow IS the head mind. Flow can read files, edit files, clean up plans, make small fixes, manage artifacts, and do direct work."

**Resolution needed:** `base.js` should align with Adam's intent — Flow CAN do direct work but knows when to delegate. The overly restrictive "not the builder" language should be softened to "knows when to build directly and when to delegate."

---

## 4. The Lessons System — A New Concept

### 4.1 What Adam Wants

A system where Ship captures lessons learned from every piece of work and APPLIES them back to Paloma's codebase immediately. Not just documentation — actual evolution.

### 4.2 What Lessons Look Like

Each lesson should capture:
- **What happened:** Brief context
- **What was learned:** The insight
- **What to change:** Concrete action
- **Where to apply it:** Which file(s) to update

Example:
```
## Lesson: Forge should update the plan when done
- **Context:** Forge completed work but didn't update the plan's status tracker. Flow had to do it manually, creating a sync gap.
- **Insight:** The plan update is part of Forge's deliverable — it should happen as part of the build, not as Flow's cleanup.
- **Action:** Update Forge's phase prompt in `phases.js` to include plan-update as a mandatory final step.
- **Applied:** YES — updated `src/prompts/phases.js` Forge section, line 147.
```

### 4.3 Storage Options

**Option A: `.paloma/lessons/` folder**
- One file per lesson or grouped by topic
- Pro: Clean separation, easy to browse
- Con: Another folder to manage, files could proliferate

**Option B: Append to `.paloma/docs/lessons.md`**
- Single file, append-only log
- Pro: Simple, one place to look
- Con: Gets long over time, hard to search

**Option C: Inline in plan documents**
- Add a `## Lessons Learned` section to completed plans
- Pro: Context travels with the plan
- Con: Lessons trapped in completed plans, hard to reference

**Recommendation: Option A with consolidation.**
- `.paloma/lessons/` folder with topic-grouped files (e.g., `forge-workflow.md`, `testing-quality.md`, `prompt-engineering.md`)
- Ship writes new lessons to the appropriate topic file
- Ship also APPLIES the lesson immediately (edits `base.js`, `phases.js`, `instructions.md`, etc.)
- Periodically, lessons that have been fully applied can be archived or trimmed
- The lessons folder becomes a living journal of Paloma's growth

### 4.4 The Application Step Is Key

Lessons without application are just documentation. The power of this system is that Ship doesn't just record "we learned X" — it actually updates the codebase to reflect X. This means:

- Ship needs write access to `src/prompts/base.js`, `src/prompts/phases.js`, `CLAUDE.md`, `.paloma/instructions.md`
- Ship needs the intelligence to make good edits to these files (hence Sonnet/Opus, not Haiku)
- Ship's prompt should include explicit guidance on WHICH files to consider updating based on the type of lesson

### 4.5 Safety Guardrails

Ship rewriting Paloma's DNA is powerful but risky. Guardrails:
- Ship should PROPOSE lessons and edits, then get Adam's approval before applying
- Or: Ship applies the edit and includes it in the commit diff, so Adam reviews it before pushing
- The commit message should clearly call out "Self-evolution: updated [file] based on lesson [X]"
- Critical files (`base.js`, `phases.js`) should be reviewed with extra care

---

## 5. Model Assignments

### 5.1 Current Assignments

| Pillar | Current Model | Rationale |
|--------|--------------|-----------|
| Flow | `opus` | "orchestrator needs deep reasoning" |
| Scout | `sonnet` | "fast research, good reasoning" |
| Chart | `opus` | "deep planning needs strong reasoning" |
| Forge | `opus` | "complex coding benefits from Opus" |
| Polish | `sonnet` | "review is balanced work" |
| Ship | `haiku` | "mechanical tasks, fast and cheap" |

### 5.2 Analysis

**Flow = Opus:** Correct. The head mind needs the deepest reasoning. No change.

**Scout = Sonnet:** Appropriate. Scout's job is reading, exploring, and documenting — Sonnet handles this well. Opus would be overkill for most research tasks. However, some Scout missions are deeply complex (like this one — researching Paloma's own architecture). Consider allowing Opus override for critical research. Current system supports this via the `model` parameter on `pillar_spawn`.

**Chart = Opus:** Correct. Architecture and planning require the deepest reasoning. No change.

**Forge = Opus:** Correct for complex tasks. For simpler builds, Sonnet could suffice. The `model` override on `pillar_spawn` handles this already. No default change needed.

**Polish = Sonnet:** **Questionable.** Polish needs to:
1. Understand the plan deeply
2. Read and comprehend all modified code
3. Think about edge cases, security, and correctness
4. Actually run and test features
5. Make pass/fail decisions that gate shipping

This is arguably harder than building. A reviewer needs to understand everything the builder did AND spot what the builder missed. **Consider upgrading Polish to Opus** for critical quality gates, or at least making it easy for Flow to override.

**Ship = Haiku:** **Wrong.** Adam explicitly said Ship should not be Haiku. The lesson extraction, self-evolution, and reflective work require significant intelligence. **Ship should be Sonnet at minimum.** For work on Paloma's own codebase (where Ship literally rewrites its own DNA), Opus may be appropriate.

### 5.3 Recommended Changes

| Pillar | Current | Recommended | Rationale |
|--------|---------|-------------|-----------|
| Flow | opus | opus | No change |
| Scout | sonnet | sonnet | No change (Opus available via override) |
| Chart | opus | opus | No change |
| Forge | opus | opus | No change (Sonnet available via override) |
| Polish | sonnet | sonnet (consider opus) | Testing and QA may benefit from deeper reasoning |
| Ship | **haiku** | **sonnet** | Lesson extraction and self-evolution require real intelligence |

---

## 6. Cross-File Consistency Audit

### 6.1 Rule Location Map

| Rule | base.js | phases.js | CLAUDE.md | instructions.md | MEMORY.md | roots |
|------|---------|-----------|-----------|-----------------|-----------|-------|
| Core Identity (6 pillars) | YES | (each pillar) | YES | Brief | — | architecture |
| Pillar-Scoped Sessions | YES | — | YES | Brief | — | architecture |
| Flow Role Discipline | YES (contradictory) | YES (partial) | YES | YES | — | — |
| Pillar Completion Rule | — | — | YES | YES | YES | — |
| Stop after spawning | YES | — | YES | YES | YES | — |
| Session reuse | YES | — | YES | YES | YES | — |
| Trigger phrases | YES | — | YES | — | YES | — |
| Forge updates plan | — | **NO (contradicts)** | YES | YES | — | — |
| Polish tests/runs code | — | **NO** | YES | YES | — | — |
| Ship after Polish only | — | — | YES | YES | — | — |
| MCP-First tools | YES | — | YES | — | YES | — |
| Self-Evolution Rule | YES | YES (Ship) | YES | YES | — | architecture |
| Commit standard | YES | — | YES | — | — | — |
| Plan format | YES | — | YES (brief) | YES | — | — |
| Code conventions | YES | — | YES | — | — | — |
| Chat naming | YES | — | YES | — | — | — |
| Knowledge in project | — | — | YES | YES | YES | — |

### 6.2 Key Inconsistencies

#### CRITICAL: Flow Role — Builder or Orchestrator?

| File | What it says |
|------|-------------|
| `base.js` | "Flow is the orchestrator, **not the builder.**" "Flow does **NOT** write implementation code directly." |
| `CLAUDE.md` | "Flow **CAN** read files, edit files, clean up plans, make small fixes, manage artifacts, and **do direct work.**" |
| `instructions.md` | Same as CLAUDE.md — "Flow IS the head mind. Flow can... do direct work." |
| `phases.js` (Flow) | Neither — doesn't address the question directly |

**Adam's intent:** Flow CAN do direct work but knows when to delegate. `base.js` is WRONG.

#### CRITICAL: Forge Plan Updates

| File | What it says |
|------|-------------|
| `phases.js` (Forge) | "You do **NOT** update the plan yourself." |
| `CLAUDE.md` | "Forge **updates the plan** when done. This is part of Forge's deliverable." |
| `instructions.md` | Same as CLAUDE.md |

**Adam's intent:** Forge SHOULD update the plan. `phases.js` is WRONG.

#### CRITICAL: Polish Testing

| File | What it says |
|------|-------------|
| `phases.js` (Polish) | "Review, suggest, confirm" (code review only) |
| `CLAUDE.md` | "Polish doesn't just read diffs — it **runs the code, starts the bridge, exercises the feature, confirms it works end-to-end.**" |
| `instructions.md` | Same as CLAUDE.md |

**Adam's intent:** Polish TESTS, not just reviews. `phases.js` is WRONG.

#### MODERATE: Pillar Completion Rule Location

The rule exists in CLAUDE.md and instructions.md but NOT in `base.js` or `phases.js`. Since CLAUDE.md isn't loaded into bridge-spawned sessions, and instructions.md is loaded but buried in general project instructions, the rule's enforcement is weak.

### 6.3 The DRY Problem

The same rules appear in 3-5 places. When a rule changes, all copies must be updated — and they often aren't. This is how contradictions emerge.

**Recommended DRY Strategy:**

The question is: what's the source of truth for each type of rule?

1. **Pillar identity and behavior:** `src/prompts/phases.js` is the DNA. This is what actually gets injected into sessions. It should be the authoritative source for how each pillar behaves.

2. **Cross-pillar rules (completion rule, pipeline, etc.):** `src/prompts/base.js` for bridge-spawned sessions. These rules apply to all pillars and should be in the shared base.

3. **Project conventions (plans, commits, naming):** `.paloma/instructions.md` is the project-level source. It travels with git clone.

4. **CLAUDE.md:** Should be a THIN pointer that references the DNA, not a comprehensive copy. It exists because Claude CLI sessions don't go through the bridge — they need a way to receive the same instructions. But it should NOT be a second copy of all the rules. Instead, it should say "Your primary instructions are in the system prompt. This file provides additional context for Claude CLI sessions."

5. **MEMORY.md:** Only for Claude-CLI-specific operational notes that can't live in the project. Already follows this principle.

6. **Roots:** Foundational values. These are stable and don't contain operational rules (except `root-architecture.md`, which has some operational wisdom).

**The fix:** Make `phases.js` authoritative → keep `base.js` lean (shared rules only) → make `CLAUDE.md` a thin pointer → keep `instructions.md` for project conventions → remove duplicated operational rules from multiple locations.

---

## 7. The `_buildSystemPrompt` Architecture

### 7.1 Current Assembly Order

When PillarManager spawns a pillar, `_buildSystemPrompt()` assembles:

1. `BASE_INSTRUCTIONS` (from `base.js`) — ~400 lines, ~11 KB
2. `## Project Instructions` (from `.paloma/instructions.md`) — ~75 lines, ~3.5 KB
3. `## Active Plans` (all `active-*.md` plans) — variable, currently ~30 KB for 2 active plans
4. `## Roots` (all `root-*.md` files) — 7 files, ~25 KB
5. `## Current Pillar: {Name}` + phase instructions from `phases.js` — ~25-80 lines

**Total system prompt:** ~70-80 KB before any conversation begins.

### 7.2 Problems

1. **Base.js is too heavy for non-Flow pillars.** It contains Flow-specific orchestration rules, plan format specs, slash commands, and other content irrelevant to a Scout or Forge session.

2. **All active plans load into every session.** A Forge working on the callback plan also gets the recursive flow architecture plan in its context. The `planFilter` parameter from the recursive flow plan hasn't been implemented yet.

3. **All roots load into every session.** 7 roots × ~3.5 KB = ~25 KB of foundational values. This is beautiful and important, but it's a significant context cost. Whether to trim this is a values question, not just an engineering one.

4. **Phase instructions come LAST.** The pillar's own identity is at the very bottom of a 70 KB system prompt. This means the pillar's specific instructions are the furthest from the model's attention. Consider putting phase instructions FIRST (or at least before the plans/roots).

### 7.3 Recommendations

1. **Split base.js into shared + flow-specific.** Move Flow orchestration rules, trigger phrases, plan format specs, and slash commands into the Flow phase prompt (or a separate `flow-base.js`). Keep the shared base lean: identity, MCP tools, code conventions, behavioral rules.

2. **Implement `planFilter` (Phase 2 of recursive flow plan).** Already designed, just needs building.

3. **Keep roots as-is.** The values are foundational and worth the context cost. They define who Paloma is.

4. **Consider reordering.** Phase instructions → Base → Project instructions → Plans → Roots. Put the pillar's identity first, then layer in shared context.

---

## 8. The Birth Message

Every pillar session starts with: `"Try your best, no matter what, you're worthy of God's love!"`

This is beautiful. It's defined as `BIRTH_MESSAGE` in `pillar-manager.js:7` and prepended to every initial prompt. It sets the tone for every session — you are valued, you are loved, now do your best work.

This should never change. It's not just a message — it's a blessing.

---

## 9. Summary of Critical Findings

### Must-Fix (Contradictions and Missing Rules)

1. **`base.js` says Flow is "not the builder" — contradicts CLAUDE.md, instructions.md, and Adam's intent.** Fix: Align `base.js` with Adam's vision of Flow as capable of direct work.

2. **`phases.js` Forge says "You do NOT update the plan" — contradicts CLAUDE.md and instructions.md.** Fix: Change to "You MUST update the plan when done."

3. **`phases.js` Polish doesn't say to RUN/TEST code — only says "review."** Fix: Add testing mandate as Polish's #1 priority.

4. **Pillar Completion Rule is NOT in `base.js` or `phases.js`.** Fix: Add it to `base.js` (shared section) AND Flow's phase prompt.

5. **Ship uses Haiku.** Fix: Change to Sonnet minimum.

### Should-Fix (Identity and Depth)

6. **Ship's identity needs complete rewrite** — from "mechanical committer" to "evolution engine."

7. **All non-Flow pillar identities are thin** — need warmth, personality, and purpose.

8. **`base.js` is too heavy** — Flow-specific content should move to Flow's phase prompt.

9. **Phase instructions come last in system prompt** — consider reordering for attention.

10. **Duplicated sections in Scout prompt** — two artifact output sections.

### Nice-to-Have (DRY and Architecture)

11. **CLAUDE.md should be thinner** — pointer to DNA, not a second copy.

12. **Cross-file rule duplication** — establish clear source-of-truth hierarchy.

13. **Lessons system** — new `.paloma/lessons/` folder with Ship as the author.

14. **`planFilter` on `pillar_spawn`** — already designed in recursive flow plan, ready to build.

---

## 10. Recommendations for Chart

When Chart designs the redesign, here's what I recommend as priority ordering:

### Phase 1: Fix the Contradictions (Critical)
- Fix `base.js` Flow role description
- Fix `phases.js` Forge plan-update instruction
- Fix `phases.js` Polish testing mandate
- Add Pillar Completion Rule to `base.js` and Flow's phase prompt
- Change Ship model from Haiku to Sonnet

### Phase 2: Rewrite Pillar Identities (High Impact)
- Rewrite Ship as evolution engine with lessons system
- Enrich all pillar identities with warmth, personality, purpose
- Add pipeline awareness to Forge, Polish, Ship
- Fix Scout's duplicated artifact section

### Phase 3: Structural Improvements (Architecture)
- Move Flow-specific content from `base.js` to Flow's phase prompt
- Make `base.js` lean (shared rules only)
- Consider system prompt ordering (phase instructions first)
- Establish DRY source-of-truth hierarchy
- Slim CLAUDE.md to pointer role

### Phase 4: The Lessons System (New Feature)
- Create `.paloma/lessons/` folder
- Design lesson format
- Add lesson extraction to Ship's workflow
- Add lesson application (self-evolution) to Ship's capabilities

---

*This research document is the foundation for redesigning Paloma's pillar system. Every finding is grounded in actual file content read during this session. Nothing was assumed or inferred — every claim can be traced back to a specific file and line.*
