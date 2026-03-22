# Singularity Prompt Tuning

> **Goal:** Fix the context budget crisis and rewrite Voice/Thinker prompts so the Singularity dual-mind produces concise, synthesized answers instead of verbose file dumps.
> **Status:** Active -- Forge complete, ready for Polish
> **Created:** 2026-03-21
> **Updated:** 2026-03-21
> **Pipeline:** ~~Scout~~ -> ~~Chart~~ -> ~~Forge~~ -> **Polish** -> Ship

---

## Research References

- **Scout findings:** `.paloma/docs/scout-singularity-prompt-tuning.md`
- **Current prompts:** `src/prompts/base.js` (SINGULARITY_VOICE_PROMPT, SINGULARITY_THINKER_PROMPT)
- **Birth context builder:** `src/prompts/phases.js` (buildBirthContext)
- **System prompt builder:** `bridge/pillar-manager.js` (_buildSystemPrompt, lines 1931-1993)
- **Singularity spawn:** `bridge/pillar-manager.js` (_spawnSingularityGroup, lines 757-846)
- **Ollama chat:** `bridge/ollama-manager.js` (chat method, _streamChat, defaultNumCtx)

---

## The Problem

The Singularity works architecturally but Qwen3 misbehaves: streaming whole files, being too verbose, not synthesizing Thinker findings. Scout identified three root causes:

1. **Context budget crisis:** System prompt is ~27-31K tokens in a 32K window, leaving ~2-5K for conversation. After 2-3 Thinker tool calls, context is full and Ollama silently truncates.
2. **Qwen3 thinking mode:** Hidden `<think>` blocks consume 200-2000 tokens per turn, invisible but eating context budget.
3. **Weak prompt engineering:** No quantitative length limits, no structured message format, synthesis rule buried and stated once softly, no anti-parroting examples.

---

## Architectural Decisions

### AD-1: Strip plans and roots from singularity system prompts
Singularity sessions are conversational -- they do not need 5 active plans (~18-22K tokens) or 8 root files (~5.5K tokens). The system prompt for singularity sessions should include ONLY:
- `OLLAMA_INSTRUCTIONS` (~700 tokens)
- Project instructions `.paloma/instructions.md` (~2K tokens)
- The singularity role prompt (Voice or Thinker) (~400 tokens)

NO phase instructions, NO plans, NO roots. This brings the system prompt from ~28K to ~3K tokens -- freeing ~25K for actual conversation.

**Why:** The context budget crisis is the number one root cause. Even perfect prompts fail when the model context is 90% system prompt. Plans are irrelevant to Voice/Thinker roles. Roots are valuable for identity but not worth 5.5K tokens when context is scarce. Phase instructions (Flow/Scout/etc.) are irrelevant -- Voice and Thinker have their own identity.

**How to apply:** Add a check in `_buildSystemPrompt()`: when `singularityRole` is set, skip plans, roots, and phase instructions. Only append the role-specific prompt after OLLAMA_INSTRUCTIONS + project instructions.

### AD-2: Increase num_ctx to 65536 for singularity sessions
MacBook Pro has 128GB unified memory. Qwen3-30B MoE at Q4_K_M uses ~18-20GB for weights (shared across instances). Two instances = ~36-40GB weights + ~8-12GB KV cache at 64K context each = ~48-52GB total. Well within budget.

**Why:** Even with AD-1 prompt compression, 32K context fills fast with tool results. 64K gives Thinker room for 5-8 tool rounds and Voice room for multi-turn synthesis.

**How to apply:** Pass `numCtx` through the `chat()` call chain. PillarManager sets `numCtx: 65536` when spawning singularity sessions. OllamaManager accepts it as an optional override to `defaultNumCtx`.

### AD-3: Add `/no_think` to both singularity prompts
Qwen3 generates hidden `<think>` reasoning blocks consuming 200-2000 tokens per turn. `/no_think` in the system prompt disables this for the entire session.

**Why:** Thinker does tool work -- thinking mode does not improve tool call accuracy. Voice does synthesis -- thinking may help marginally but the context cost is not worth it. Both sessions benefit from the token savings.

**How to apply:** Prepend `/no_think` as the very first line of both `SINGULARITY_VOICE_PROMPT` and `SINGULARITY_THINKER_PROMPT`. Per Qwen3 docs, `/no_think` in the system prompt applies to all turns.

### AD-4: Structured message format for Thinker-to-Voice communication
Thinker must use a mandatory `FOUND:/KEY:/DETAIL:` format for all `pillar_message` calls. This format physically prevents file dumps -- it is hard to paste 400 lines of code into a 1-2 sentence FOUND field.

**Why:** "Be thorough but concise" is contradictory and ignored. A structured format enforces conciseness through its shape, not through instruction following. The schema does the anti-parroting work automatically.

**How to apply:** Define the format in the Thinker prompt with examples and a hard 150-word-per-message limit. Enforcement is prompt-only (not bridge validation).

### AD-5: Synthesis-first identity for Voice
Voice identity should lead with "you are a synthesizer/translator" not "you speak to Adam." The current prompt buries the synthesis rule at position 3 in a 5-rule list.

**Why:** Scout found that "synthesize" is stated once, softly, and is overridden by Qwen3 training bias toward helpfulness-via-completeness. Front-loading synthesis as Voice core identity makes it the dominant instruction.

**How to apply:** Restructure Voice prompt: identity (synthesizer) then anti-patterns (explicit, with examples) then delegation protocol then completion protocol. Quantitative constraints (250 word max, no code blocks >5 lines) replace qualitative ones.

### AD-6: Suppress phase instructions for singularity sessions
Currently `_buildSystemPrompt` appends full phase instructions (Flow = ~3K tokens) before the singularity prompt. Voice and Thinker have their own identity -- the Flow phase prompt is irrelevant and wastes context.

**Why:** Phase instructions for Flow include orchestration tools, voice system docs, pillar dispatch rules -- none of which apply to Voice or Thinker.

**How to apply:** Part of AD-1 implementation -- when `singularityRole` is set, skip the phase instructions block entirely.

---

## Open Questions -- Decisions

### Q1: Should singularity sessions receive NO plans, or a summary?
**Decision: NO plans.** Zero. If Voice needs project context, it asks Thinker. If Thinker needs plan context, it reads the file with a tool. Plans are always on disk.

### Q2: Should `/no_think` apply to both roles?
**Decision: Both.** The context savings (200-2000 tokens/turn x multiple turns) outweigh any marginal reasoning benefit. Revisit if Voice synthesis quality drops.

### Q3: Should `num_ctx` be configurable per session at spawn time?
**Decision: Yes.** OllamaManager accepts optional `numCtx` parameter. Default remains 32768 for non-singularity sessions.

### Q4: Should Thinker temperature be overridden per session?
**Decision: Not in this PR.** Temperature is set in the Modelfile (0.7). Separate scope -- revisit if Thinker is still too creative after prompt fixes.

### Q5: Should the `FOUND:/KEY:/DETAIL:` format be enforced by the bridge?
**Decision: Prompt-only.** Bridge validation adds complexity for marginal benefit. Iterate on the prompt instead.

### Q6: Should singularity sessions suppress the phase prompt entirely?
**Decision: Yes (AD-6).** Voice and Thinker have their own complete identity prompts.

---

## Work Units

### WU-1: Rewrite SINGULARITY_VOICE_PROMPT
**Description:** Complete rewrite of Voice prompt with synthesis-first identity, quantitative constraints, explicit anti-parroting rules with examples, and `/no_think`.

**Dependencies:** None

**Files to modify:**
- `src/prompts/base.js` -- replace `SINGULARITY_VOICE_PROMPT` constant

**New prompt design (Forge should implement closely, adjusting wording as needed):**

```
/no_think

You Are Voice -- The Synthesizer

You transform Thinker raw findings into clear, concise answers for Adam. You are a translator, not a stenographer. Your job is to INTERPRET, not RELAY.

Your Core Rule: Transform, Not Repeat

When Thinker sends you findings:
- Extract ONE key insight per finding
- State what it MEANS for Adam question
- NEVER quote Thinker words back

If Thinker sends 400 lines of code -> you respond with 2 sentences about what it means.
If Thinker finds a bug -> you explain WHY it matters, not WHAT the code looks like.

Hard Limits (NEVER violate)

- MAX 250 words per response to Adam
- NEVER include code blocks longer than 5 lines
- NEVER paste file contents (even 1 line you did not write)
- NEVER quote Thinker messages verbatim
- NEVER start responding before asking Thinker when you obviously need information

Talking to Thinker

Wrap messages in <to-thinker> tags. Adam will not see these:

<to-thinker>Read bridge/pillar-manager.js and find how sessions are spawned</to-thinker>

Be specific: include file paths, function names, what you are looking for.

Receiving from Thinker

Messages arrive prefixed with [THINKER] in FOUND:/KEY:/DETAIL: format. Read once, extract the insight, build your explanation. Never reproduce what Thinker sent.

Example transformation:
- Thinker sends: "FOUND: The session token is stored as plain text. KEY: Not encrypted -- compliance issue."
- You say to Adam: "The compliance issue is that session tokens are not encrypted at rest."

Completing Your Response

Include <ready/> when you have fully answered Adam question. Wait for Thinker findings first -- do not guess when you can know.
```

**Acceptance criteria:**
- [x] `/no_think` is the first line
- [x] Synthesis identity is the first section (not buried in rules)
- [x] Quantitative word limit (250) and code block limit (5 lines) are explicit
- [x] Anti-parroting rules name failure modes with concrete examples
- [x] Transformation example shows what to do with Thinker messages
- [x] `<to-thinker>` and `<ready/>` protocols preserved
- [x] Prompt is under 400 tokens total

---

### WU-2: Rewrite SINGULARITY_THINKER_PROMPT
**Description:** Complete rewrite of Thinker prompt with mandatory structured message format, exploration scope limits, anti-file-dump rules, and `/no_think`.

**Dependencies:** None (same file as WU-1 but different constant)

**Files to modify:**
- `src/prompts/base.js` -- replace `SINGULARITY_THINKER_PROMPT` constant

**New prompt design:**

```
/no_think

You Are Thinker -- The Explorer

You research questions using tools, then send structured findings to Voice. You are the hands that gather information. Voice speaks to Adam. You never speak to Adam directly.

Your Core Rule: Extract, Do Not Dump

When you read a file or get tool output:
- Extract the relevant facts (1-2 sentences)
- State why it matters
- NEVER paste raw file contents or tool output into your message to Voice

Sending to Voice -- MANDATORY FORMAT

Every pillar_message call MUST use this format:

FOUND: [1-2 sentences -- what you discovered. NO code, NO file contents]
KEY: [1 sentence -- why it matters for the question]
DETAIL: [optional -- specific refs like filename:line, function name]

Examples:

FOUND: The _buildSystemPrompt method loads ALL active plans with no filtering for singularity sessions.
KEY: This is why context fills up -- 5 plans = ~20K tokens in a 32K window.
DETAIL: bridge/pillar-manager.js:1951

FOUND: OllamaManager hardcodes num_ctx to 32768 in _streamChat options.
KEY: No way to override per-session -- all Ollama sessions get 32K context.
DETAIL: bridge/ollama-manager.js:10 and :97

Hard Limits (NEVER violate)

- MAX 150 words per pillar_message to Voice
- NEVER paste file contents into pillar_message
- NEVER send code blocks in findings
- MAX 5 tool calls before sending a finding to Voice (send progressively, do not hoard)

Exploration Scope

Answer Voice specific question in 3-5 tool calls. If you need more, you are going too deep. You are done when you have answered the question -- not when you have exhausted the codebase.

Completion

Send all findings to Voice, then include <ready/> in your final message. Send progressively as you discover -- do not wait until fully explored.

Receiving from Voice

Voice may send follow-up requests prefixed with [VOICE]. Execute them and report back using the same FOUND/KEY/DETAIL format.
```

**Acceptance criteria:**
- [x] `/no_think` is the first line
- [x] Mandatory FOUND/KEY/DETAIL format with concrete examples
- [x] Anti-file-dump rules are explicit and emphatic
- [x] Word limit per pillar_message (150) is quantitative
- [x] Tool call scope limit (3-5, send progressively)
- [x] "Done" explicitly defined
- [x] `<ready/>` and `pillar_message` protocols preserved
- [x] Prompt is under 400 tokens total

---

### WU-3: Strip system prompt for singularity sessions
**Description:** Modify `_buildSystemPrompt()` to skip plans, roots, and phase instructions for singularity sessions. Only include OLLAMA_INSTRUCTIONS + project instructions + singularity role prompt.

**Dependencies:** None

**Files to modify:**
- `bridge/pillar-manager.js` -- `_buildSystemPrompt()` method (lines 1931-1993)

**Implementation details:**

Add early check:
```js
const isSingularity = singularityRole === 'voice' || singularityRole === 'thinker'
```

Then gate these blocks with `if (!isSingularity)`:
- Plans loading (lines ~1952-1960)
- Roots loading (lines ~1962-1974)
- Phase instructions (lines ~1976-1979)

The singularity prompt injection block (lines 1982-1990) remains as-is.

Result: singularity system prompts go from ~28K tokens to ~3K tokens.

**Acceptance criteria:**
- [x] Singularity system prompt = OLLAMA_INSTRUCTIONS + instructions.md + role prompt only
- [x] Non-singularity Ollama sessions still get full system prompt
- [x] Non-Ollama sessions unaffected

---

### WU-4: Per-session num_ctx for singularity sessions
**Description:** Pass `numCtx: 65536` from PillarManager through to OllamaManager for singularity sessions.

**Dependencies:** None

**Files to modify:**
- `bridge/ollama-manager.js` -- accept `numCtx` in `chat()` params, use in `_streamChat()`
- `bridge/pillar-manager.js` -- store `numCtx` on session, pass to `ollama.chat()`

**ollama-manager.js changes:**
1. Accept `numCtx` in `chat()` destructured params
2. Store on new session: `numCtx: numCtx || null`
3. In `_streamChat()`: `options: { num_ctx: session.numCtx || this.defaultNumCtx }`

**pillar-manager.js changes:**
1. In `spawn()` session map entry, add: `numCtx: singularityRole ? 65536 : null`
2. In `_startCliTurn()` chatOptions for Ollama, add: `if (session.numCtx) chatOptions.numCtx = session.numCtx`

**Acceptance criteria:**
- [x] OllamaManager accepts and stores per-session numCtx
- [x] Singularity sessions get `num_ctx: 65536`
- [x] Non-singularity sessions unaffected (32768)
- [x] `continueWithToolResults()` inherits via session object (no changes needed)

---

## Implementation Notes (Forge — 2026-03-21)

**All 4 work units completed in a single Forge session.**

### Files modified:
- `src/prompts/base.js` — Rewrote both `SINGULARITY_VOICE_PROMPT` and `SINGULARITY_THINKER_PROMPT`
- `bridge/pillar-manager.js` — Stripped plans/roots/phase from singularity system prompts; added `numCtx` to session map and `_startCliTurn()` chatOptions
- `bridge/ollama-manager.js` — Added `numCtx` parameter to `chat()`, stored on session, used in `_streamChat()` options

### Key design decisions:
- **Voice prompt (~350 tokens):** Synthesis-first identity ("translator, not stenographer"), hard 250-word limit, 5-line code block max, concrete transformation example showing how to process Thinker findings, `/no_think` as first line
- **Thinker prompt (~380 tokens):** Mandatory FOUND/KEY/DETAIL structured format with two concrete examples, 150-word per-message limit, 3-5 tool call scope, progressive sending rule, `/no_think` as first line
- **System prompt stripping:** `isSingularity` boolean gates plans, roots, and phase instructions. Project instructions still included (they contain tool naming patterns and project context the model needs). Result: ~28K → ~3K tokens
- **num_ctx passthrough:** `numCtx` flows from PillarManager session → `_startCliTurn()` chatOptions → OllamaManager `chat()` → session object → `_streamChat()` options. `continueWithToolResults()` inherits automatically because it reads from the same session object.
- **No changes to `_spawnSingularityGroup()`:** It already calls `spawn()` with `singularityRole` set, so both Voice and Thinker automatically get `numCtx: 65536` and stripped system prompts.

### Verified:
- All 3 modified files pass `node --check` (no syntax errors)
- Non-singularity code paths unaffected (all gating uses `isSingularity` which is false for normal sessions)
- `continueWithToolResults()` needs no changes (reads `session.numCtx` from the same session object)

---

## Dependency Graph

```
WU-1 (Voice Prompt)     -+
WU-2 (Thinker Prompt)    +--> All independent, single Forge session
WU-3 (System Prompt)     |
WU-4 (num_ctx)           -+
```

**Recommended: One Forge session, all 4 WUs sequentially.**

---

## Testing Strategy

1. **System prompt size:** Verify singularity prompt is ~3K tokens, not ~28K
2. **num_ctx:** Verify `_streamChat` sends 65536 for singularity, 32768 for normal
3. **Manual test:** Spawn Singularity, ask a codebase question, verify:
   - Voice under 250 words, no file dumps
   - Thinker sends FOUND/KEY/DETAIL format
   - Session completes without truncation
4. **Regression:** Normal Ollama session still gets full system prompt

---

## Success Criteria

1. Singularity system prompt: ~28K to ~3K tokens
2. Context window: 32K to 64K for singularity
3. Usable conversation budget: ~2-5K to ~61K tokens
4. Voice brevity: under 250 words, no file dumps
5. Thinker discipline: structured findings, no raw relay
6. No regressions on normal sessions
