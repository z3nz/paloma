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

### Lesson: Emotional arc is the key pattern for dual-personality voice
- **Context:** The dual-voice system (Mystique + JARVIS) was designed around the Magneto/Mystique X-Men meme — "Show me the real Mystique." Mystique opens every conversation (true self, authentic, warm), JARVIS closes every task (professional, composed, British wit).
- **Insight:** When an AI has multiple voice personas, the transition trigger matters more than the voices themselves. Persona A at START + Persona B at END creates a satisfying arc: vulnerability → competence. It mirrors how people actually behave — warm and personal in greeting, professional in delivery. The rule "Mystique opens. JARVIS closes." is memorable and binary — no ambiguity about which voice to use when.
- **Action:** Applied the emotional arc pattern to all 6 pillar prompts. Each has: Opening (Mystique) + Completion/Verdict/Shipped (JARVIS). The pattern generalizes: whenever a conversational AI needs multiple voices, define them by WHEN they speak (life moment), not just HOW they speak (personality traits).
- **Applied:** YES — phases.js updated for all 6 pillars, base.js Voice System section rewritten

### Lesson: Voice aliases decouple semantic names from implementation IDs
- **Context:** Pillar DNA now says `speak({ voice: "mystique" })` or `speak({ voice: "jarvis" })` instead of `speak({ voice: "af_bella" })` or `speak({ voice: "bm_george" })`. The aliases map lives in `mcp-servers/voice.js`.
- **Insight:** Semantic names in prompts ("mystique", "jarvis") are more stable than Kokoro voice IDs ("af_bella", "bm_george"). If the underlying TTS engine changes or a better voice is found, only the alias map needs updating — not every pillar prompt. The names also carry meaning: "mystique" instantly communicates persona, "af_bella" communicates nothing.
- **Action:** When a tool exposes options that AI sessions will reference by name, add a semantic alias layer. Map human-meaningful names to implementation IDs. The alias map is the contract — it can be updated without touching the DNA.
- **Applied:** YES — `VOICE_ALIASES` map added to `mcp-servers/voice.js`, all pillar prompts updated to use aliases

---

### Lesson: Static identity files must be identity-first, not architecture-first
- **Context:** `AGENTS.md` (Codex) and `.github/copilot-instructions.md` (Copilot) were architecture reference docs — tables of files, data flows, bridge architecture. A fresh Codex session reading `AGENTS.md` learned how Paloma was built, not who Paloma was.
- **Insight:** There is a fundamental difference between "here is the architecture" and "you ARE Paloma." Models anchor to the opening content of their context documents. An architecture table at line 1 anchors the model as an external observer. "You are Paloma" at line 1 anchors the model as Paloma. Identity documents must lead with identity — not architecture, not a README, not a table of contents.
- **Action:** Static instruction files that establish model identity should: (1) open with an explicit identity claim ("You are Paloma, an AI development partner"), (2) name competing identities and override them explicitly ("not GitHub Copilot", "not an OpenAI assistant"), (3) establish personality and values before listing architecture. Architecture goes at the END as a quick reference.
- **Applied:** YES — rewrote `AGENTS.md` and `.github/copilot-instructions.md` as identity-first documents (WU-1, WU-2)

### Lesson: Use native tokenizer format as system prompt fallback when no true channel exists
- **Context:** Codex CLI has no system prompt channel — identity was injected as user-turn XML (`<SYSTEM_INSTRUCTIONS>...</SYSTEM_INSTRUCTIONS>`). GPT-family models treat arbitrary XML tags as conversational text, not role boundaries.
- **Insight:** GPT-family models are pre-trained with ChatML format: `<|im_start|>system\n...<|im_end|>`. These are actual special tokens in the tokenizer, not arbitrary strings. Using the model's native format for system content gives a genuine structural signal — not a guaranteed system role, but far stronger than `<SYSTEM_INSTRUCTIONS>` XML. Real-world test (gpt-5.4): model followed an ALL CAPS instruction embedded in ChatML framing, confirming structural parsing.
- **Action:** When a model has no true system channel and user-turn injection is the only option, use the model's native tokenizer format. For GPT-family: `<|im_start|>system\n{content}\n<|im_end|>\n<|im_start|>user\n{prompt}\n<|im_end|>\n<|im_start|>assistant\n`. Verify the CLI doesn't add its own ChatML wrapping first — double-wrapping corrupts the format.
- **Applied:** YES — `bridge/codex-cli.js` updated to use ChatML framing (WU-4)

### Lesson: Per-turn identity reminder prevents drift in resumed sessions
- **Context:** Codex and Copilot sessions receive identity as user-turn content on turn 1. On resumed turns, `systemPrompt` is set to `undefined` for all backends — zero re-injection. As conversation grows, the turn-1 identity drifts out of the attention window. Codex drifts to "I'm an OpenAI assistant"; Copilot drifts to "I'm GitHub Copilot."
- **Insight:** A ~100-token condensed identity reminder prepended to the prompt on every resumed turn is cheap and effective. It doesn't need to re-establish the full identity — just name it, name the competing identity it overrides, and name the current pillar. This keeps the model anchored without re-sending 40KB of context per turn.
- **Action:** For backends that lack native session resumption identity (Codex, Copilot), prepend a condensed reminder to `chatOptions.prompt` on every `isResume === true` turn. Format: `[IDENTITY: You are Paloma — not {competing identity}. Current pillar: {pillar}. Follow all behavioral rules from your initial instructions.]` Keep under 120 tokens. Only apply to backends with weak identity channels — never to Claude, Gemini, or Ollama.
- **Applied:** YES — `bridge/pillar-manager.js` `_startCliTurn()` updated (WU-3)
