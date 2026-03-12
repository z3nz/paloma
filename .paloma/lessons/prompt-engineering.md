# Lessons: Prompt Engineering

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: DNA contradictions are critical bugs
- **Context:** base.js said "Flow is not the builder" but Flow SHOULD do direct work. Forge said "do NOT update the plan" but Forge MUST update the plan. Polish had no testing mandate despite being the QA gate.
- **Insight:** When the DNA files (base.js, phases.js) contain contradictions with stated intent (CLAUDE.md, instructions.md), every pillar session gets the wrong instructions. These aren't minor inconsistencies — they cause systemic behavior issues where pillars refuse to do their jobs or do the wrong jobs.
- **Action:** Fixed all 3 contradictions in WU-1. Established the DNA hierarchy: phases.js (pillar-specific, authoritative) → base.js (shared foundation) → instructions.md (project conventions) → CLAUDE.md (CLI pointer). When rules change, they change in ONE place and flow downward.
- **Applied:** YES — WU-1 fixed Flow role, Forge plan update requirement, and Polish testing mandate in the DNA files

### Lesson: Pillar identities need soul AND boundaries
- **Context:** Previous pillar prompts were procedural lists ("do this, don't do that, output format is..."). They worked but felt mechanical. Rewrote all 6 pillars with warmth, purpose, and pipeline awareness while preserving boundaries.
- **Insight:** A pillar identity has two parts: WHO the pillar is (personality, purpose, pipeline context) and WHAT the pillar does (tools, boundaries, output format). Both are necessary. WHO without WHAT is vague. WHAT without WHO is soulless. The sweet spot is ~40-60 lines per pillar — enough soul to feel alive, enough precision to be operational.
- **Action:** Rewrite pillar identities with this structure: (1) opening paragraph with soul/purpose, (2) MANDATORY orient-first section, (3) primary job/focus with tools, (4) boundaries (what NOT to do), (5) output format/deliverables, (6) pipeline awareness (your place in the flow).
- **Applied:** YES — WU-2 rewrote all 6 pillars with this structure

### Lesson: Ship needs real reasoning power
- **Context:** Ship was assigned haiku model because it was seen as "mechanical tasks, fast and cheap." But Ship's job is to extract lessons, decide which lessons warrant DNA changes, and apply those changes safely. That's not mechanical — that's evolution.
- **Insight:** The model assignment in PHASE_MODEL_SUGGESTIONS determines what kind of thinking a pillar can do. Haiku is perfect for Scout (read files, summarize findings) but wrong for Ship (reason about patterns, decide on DNA changes, write lessons). Ship is the evolution engine — it needs at minimum sonnet-level reasoning.
- **Action:** Changed Ship's model from haiku to sonnet. Updated Ship's tagline from "Complete Documentation As Legacy" to "Growth Through Completion" and rewrote the entire identity around the 4-step workflow: commit → extract lessons → apply lessons → archive.
- **Applied:** YES — WU-1 changed the model, WU-2 rewrote the identity

### Lesson: Shared base should only contain what ALL pillars need
- **Context:** base.js was ~12.5KB and contained Flow orchestration rules, plan format specs, and slash commands — content that only Flow uses. Every non-Flow pillar received this and couldn't use it, wasting context budget.
- **Insight:** The shared base prompt (base.js) should be the lean foundation — identity, core behavioral rules, tool strategy, conventions. Pillar-specific content belongs in phases.js under that pillar's section. The test: "Does every pillar need this?" If no, move it to the specific pillar's prompt.
- **Action:** Moved ~4.5KB of Flow-specific content from base.js to Flow's phase prompt (orchestration rules, plan format specs, slash commands). Added a lean "Pillar Pipeline" section (~13 lines) that all pillars DO need for lifecycle awareness.
- **Applied:** YES — WU-3 restructured base.js, slimming it from ~12.5KB to ~8KB

---

### Lesson: Anti-pattern instructions must mirror observed failure modes exactly
- **Context:** The original OLLAMA_INSTRUCTIONS said "ALWAYS use the function calling mechanism" and "NEVER fabricate tool results." Qwen2.5-Coder was still writing `{"name": "tool", "arguments": {...}}` as text, using `tool_name(args)` syntax, and hallucinating results — all behaviors the prompt didn't explicitly name.
- **Insight:** Vague positive instructions ("use function calling") don't prevent specific failure modes. Models drift toward what they've seen in training data. To suppress a specific failure mode, you must name it explicitly and precisely in the NEVER list. The prompt update added: "Write `{\"name\": \"tool_name\", \"arguments\": {...}}` as text — this does NOT call the tool", "Write `tool_name(args)` as text — this does NOT call the tool", and "Pretend you already called a tool — if you didn't get a result back, you didn't call it." Each anti-pattern mirrors a real failure mode observed in chat logs.
- **Action:** When writing system prompts for local models: (1) Observe what the model actually does wrong. (2) Write the NEVER list to mirror each failure mode exactly. (3) Explain WHY writing JSON as text doesn't work ("this does NOT call the tool"). Understanding prevents reversion. (4) Don't just say "do X" — also say "X is the ONLY way."
- **Applied:** YES — `OLLAMA_INSTRUCTIONS` updated in `src/prompts/base.js`, committed as 97cd5f7
