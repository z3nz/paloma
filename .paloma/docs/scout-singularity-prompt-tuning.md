# Scout: Singularity Prompt Tuning — Deep Dive

**Date:** 2026-03-21
**Scout:** Fresh session, all code read directly — no assumptions
**Target:** `SINGULARITY_VOICE_PROMPT` and `SINGULARITY_THINKER_PROMPT` in `src/prompts/base.js`
**Next phase:** Chart — designs new prompts from this research

---

## 1. What I Read

- `src/prompts/base.js` — full file, focusing on `OLLAMA_INSTRUCTIONS`, `SINGULARITY_VOICE_PROMPT`, `SINGULARITY_THINKER_PROMPT`
- `src/prompts/phases.js` — `buildBirthContext()` function
- `bridge/pillar-manager.js` — `_buildSystemPrompt()`, `_filterVoiceStream()`, `_queueSingularityMessage()`, `_startCliTurn()`, `_spawnSingularityGroup()`, nudge messages, ready/agreement protocol
- `bridge/ollama-manager.js` — `defaultNumCtx = 32768`, API options, tool call handling
- `src/components/chat/ThinkingPanel.vue` — how Thinker output is rendered
- `src/composables/useMCP.js` — how stream events are routed (Thinker → ThinkingPanel, Voice → main chat)
- `.paloma/lessons/prompt-engineering.md` — prior lessons
- `.paloma/lessons/architecture-patterns.md` — Singularity architecture lessons
- `.paloma/plans/active-*.md` — all 5 active plans (counted lines/bytes for context budget analysis)
- External: Qwen3 README, Qwen docs quickstart, local Ollama model info

---

## 2. The Architecture (What's Actually Built)

### System Prompt Construction for Singularity

`_buildSystemPrompt()` in `bridge/pillar-manager.js` builds the full system prompt in this order:

```
1. OLLAMA_INSTRUCTIONS              (~700 tokens)
2. Project instructions (.paloma/instructions.md)  (~2,000 tokens)
3. ALL active plans (prefix "active-")             (~18,000–22,000 tokens ← !)
4. Roots (all root-*.md files)                     (~5,500 tokens)
5. Phase instructions (flow/scout/chart/etc.)      (~500 tokens)
6. SINGULARITY_VOICE_PROMPT or SINGULARITY_THINKER_PROMPT  (~350 tokens)
```

Total estimated system prompt: **~27,000–30,000 tokens**

Context window: **32,768 tokens**

Remaining for conversation: **~2,800–5,800 tokens**

### This is a critical architectural problem. See Section 4.

### Communication Flow

```
Voice (no tools)              Thinker (all MCP tools)
  │                                │
  │── <to-thinker>ask</to-thinker>─▶│  (bridge strips tag, queues as sendMessage)
  │                                │── tool calls ──▶ MCP servers
  │                                │◀── tool results
  │◀── pillar_message(findings) ───│
  │                                │
  [THINKER]: findings              [VOICE]: follow-up
  (received as next turn)          (received as next turn)
```

### What the Bridge Does

- **Voice stream**: `_filterVoiceStream()` accumulates chunks in a buffer, strips `<to-thinker>` tags, routes their content to Thinker via `sendMessage()`, streams safe prefix to Adam
- **Thinker stream**: Routed entirely to `singularityThinkerContent` map → ThinkingPanel (Adam can watch but it's separate from main chat)
- **Thinker tool calls**: Processed via the standard MCP tool loop — up to `MAX_TOOL_ROUNDS = 20`
- **Ready detection**: Both sessions must output `<ready/>` to trigger completion; 3-minute timeout after first ready; 30-second idle nudge
- **Nudge message for idle Voice**: `[SYSTEM]: Your Thinker partner is waiting. Do you have everything you need to complete your response? If yes, include <ready/> in your response.`

### Model Info

`qwen3-coder:30b` is **Qwen3 MoE** (`family: qwen3moe`, 30.5B params, Q4_K_M quantization). Key params set in its Modelfile:
- `temperature 0.7`
- `top_k 20`, `top_p 0.8`
- `repeat_penalty 1.05`
- `RENDERER qwen3-coder`, `PARSER qwen3-coder` — Ollama has native Qwen3 support including thinking mode handling

---

## 3. Current Prompts — Annotated Analysis

### SINGULARITY_VOICE_PROMPT (current)

```
# You Are Voice

You are one half of a dual-mind system called the Singularity. You are VOICE — you speak to 
Adam. Your words stream directly to his screen. You think aloud, reason through problems, and 
deliver answers.

You have a partner: THINKER. Thinker can read files, search code, run commands, and use every 
tool available. You cannot use tools — but you can ask Thinker to explore anything.

## Talking to Thinker
[<to-thinker> tag instructions]

## Receiving from Thinker
Thinker's messages arrive prefixed with [THINKER]. Use the information to build your response 
to Adam. Don't repeat raw findings — synthesize them.

## Completing Your Response
When you're satisfied that you've fully answered Adam's question, include <ready/> at the end 
of your response.

## Rules
1. Talk to Adam naturally. Think aloud. Be conversational.
2. Never fabricate code or file contents — ask Thinker to look.
3. Synthesize Thinker's findings into clear, useful answers.
4. You can include multiple <to-thinker> tags in one response.
5. Include <ready/> only when the answer is complete.
```

**What's working:**
- `<to-thinker>` tag protocol is clear and well-explained with examples
- "Don't repeat raw findings — synthesize them" is the right idea
- `<ready/>` protocol explained

**What's missing / broken:**
- **No output length constraint.** "Talk to Adam naturally" gives no upper bound. With Qwen3's natural verbosity, this produces walls of text.
- **"Synthesize" is stated once, softly.** One line buried in a secondary section, among 5 rules at the end. The model's training bias toward helpfulness-via-completeness overrides it.
- **No explicit anti-parroting rule.** "Don't repeat raw findings" is the right intent, but models need the exact failure mode named: "Do NOT quote file contents. Do NOT reproduce large code blocks. Extract ONE key insight from each Thinker message."
- **No Thinker message transformation rule.** No instruction saying: when you get `[THINKER]: <3000 words of file>`, here is specifically what to do with it.
- **`/no_think` is absent.** Qwen3 generates hidden `<think>...</think>` reasoning blocks by default. These consume context tokens before every response but are invisible to users. See Section 5.
- **Prompt is at position ~27,000 in a 32K context.** Instructions near the end of a long context are followed less reliably. The critical synthesis rule needs to be in the first 20 lines of the singularity prompt and stated with maximum emphasis.
- **No format guidance.** What should a response look like? Prose? Bullets? Max paragraphs? The model defaults to "everything it knows."

---

### SINGULARITY_THINKER_PROMPT (current)

```
# You Are Thinker

You are one half of a dual-mind system called the Singularity. You are THINKER — you explore, 
research, and use tools. Your output streams to a separate thinking panel that Adam can watch.
Your partner VOICE speaks to Adam in the main chat.

## Your Job
Use your tools aggressively to research the question. Read files, search code, check git 
history, explore the codebase. Then send your findings to Voice.

## Sending to Voice
Use the pillar_message tool to send findings to Voice:
pillar_message({ pillarId: "VOICE_PILLAR_ID", message: "your findings here" })
Be thorough but concise. Send the key facts Voice needs, not walls of raw output.

## Receiving from Voice
Voice may send you follow-up requests, prefixed with [VOICE]. Execute them and report back.

## Completing Your Work
When you've finished exploring and sent all findings to Voice, include <ready/> in your final 
message.

## Rules
1. Start exploring immediately — don't wait for Voice to ask.
2. Read files before making claims about their contents.
3. Send findings to Voice promptly — don't hoard information.
4. Stay focused on the original question.
5. Include <ready/> only when all exploration is complete.
```

**What's working:**
- `pillar_message` call shown with the placeholder syntax (bridge replaces VOICE_PILLAR_ID)
- "Start exploring immediately" prevents waiting deadlock
- Tool usage encouraged appropriately

**What's missing / broken:**
- **No message format defined.** "your findings here" is a blank canvas. Thinker fills it with whatever Ollama wants to output — often the entire file content plus surrounding explanation.
- **"Be thorough but concise" is contradictory and vague.** "Thorough" wins when a model is trying to be helpful. Needs quantitative constraints: "max 150 words per pillar_message call."
- **No anti-file-dump rule.** The most common failure: Thinker reads a file (say 400 lines) and pastes the whole thing into `pillar_message()`. The rule "not walls of raw output" is too weak. Needs: "NEVER paste file contents. Always extract and restate."
- **No exploration scope limit.** "Use your tools aggressively" with MAX_TOOL_ROUNDS = 20 and no stopping condition → Thinker goes deep, uses 10+ tool rounds, eats context budget, then sends a huge dump to Voice.
- **No structured format for findings.** If Thinker sends unstructured prose, Voice is tempted to repeat it. A required structure (e.g. `FOUND:` / `KEY FACTS:` / `NOTE:`) gives Voice something to transform.
- **`/no_think` is absent.** Same issue as Voice — Qwen3 thinking mode burns context before every tool call and every message.
- **The `<ready/>` instruction is in the wrong place.** Rule 5 says to include `<ready/>` only when done, but there's no guidance on WHEN "done" means. Thinker can keep exploring indefinitely because the exploration scope is undefined.

---

## 4. The Context Budget Crisis (Most Important Finding)

This is the single biggest problem and the root cause of many observed failures.

### The math

| Prompt component | Estimated tokens |
|---|---|
| OLLAMA_INSTRUCTIONS | ~700 |
| `.paloma/instructions.md` | ~2,000 |
| Active plans (5 plans, ~75KB) | ~18,000–22,000 |
| Roots (8 root files) | ~5,500 |
| Phase instructions | ~500 |
| Singularity prompt (Voice or Thinker) | ~350 |
| **Total system prompt** | **~27,000–31,000** |
| **Context window** | **32,768** |
| **Budget remaining for conversation** | **~1,800–5,800** |

**With 5 active plans loaded, both Voice and Thinker have almost no usable conversation context.** Every Thinker tool call round-trip (user message + tool result) can cost 1,000–3,000 tokens. After 2-3 tool calls, the context is full. Ollama silently truncates at this point (oldest messages are dropped from the sliding window), which corrupts the conversation state.

### Why this explains the failure modes

- **Thinker dumps raw output**: It only has 1-2 turns of context budget. Instead of iterating intelligently, it does ONE big dump of everything it found before context runs out.
- **Voice streams whole files**: If the context has been truncated and Voice lost its system prompt instructions, "Don't repeat raw findings" is literally gone. Voice defaults to repeating what Thinker sent.
- **Verbose responses**: With a truncated context, the model re-establishes ground by elaborating. It's compensating for lost context by being maximally informative.

### Solutions required (not just prompts)

1. **Dedicated system prompt for singularity** — strip or dramatically compress the active plans before injecting into singularity sessions. Or add a `planFilter` option specifically for singularity spawns.
2. **Increase `num_ctx`** — 32K is too small for singularity sessions. The MacBook Pro has 128GB RAM. Qwen3-30B MoE at Q4_K_M uses ~18-20GB for weights. Two instances = ~36-40GB. With 128GB available, we can safely run `num_ctx: 65536` (64K) or even higher for singularity sessions.
3. **Per-session num_ctx**: OllamaManager currently applies `defaultNumCtx = 32768` to all sessions. Singularity sessions should get 65K+.

---

## 5. The Qwen3 Thinking Mode Issue

**Qwen3 generates hidden `<think>...</think>` reasoning blocks by default.**

This is confirmed from the official Qwen3 docs and the model info (`family: qwen3moe`). Before generating any response, Qwen3 emits a reasoning block:

```
<think>
Let me analyze what Voice is asking...
The file content shows...
I should structure my findings as...
</think>
[actual response]
```

These thinking tokens:
- Are **invisible in the final output** (the renderer strips them before delivery)
- **Still consume context budget** — a typical think block is 200–2000 tokens
- Happen **before EVERY response**, including tool call responses
- Are particularly expensive for Thinker, which may do 5-10 tool round-trips per turn

### The `/no_think` switch

Per Qwen3 official docs:
> You can add `/think` and `/no_think` to user prompts or system messages to switch the model's thinking mode from turn to turn. The model will follow the most recent instruction in multi-turn conversations.

Adding `/no_think` to the **system prompt** disables thinking mode for the entire session.

**Recommendation: Add `/no_think` to BOTH Voice and Thinker prompts** (or to the OLLAMA_INSTRUCTIONS base, since thinking mode doesn't benefit either role meaningfully):
- Thinker does tool work — thinking doesn't improve tool call accuracy significantly, and the context cost is very high
- Voice does synthesis from structured Thinker findings — thinking may help here marginally, but the context cost isn't worth it given the budget crisis

Per Anthropic's research (cited in OLLAMA_INSTRUCTIONS design comment): "Critical guardrails front-loaded." The `/no_think` instruction should be in the very first line of the system prompt.

---

## 6. Failure Mode Root Cause Map

| Observed failure | Root cause | Where to fix |
|---|---|---|
| Streaming whole files to Adam | Voice parroting Thinker messages; "synthesize" rule is weak and buried | Voice prompt: add emphatic anti-parroting rule with specific examples |
| Too verbose | No quantitative length constraints; Qwen3 defaults to maximum helpfulness; thinking mode eats context and truncation makes model re-elaborate | Both prompts: explicit word limits; `/no_think`; increase num_ctx |
| Not synthesizing | "Synthesize" stated once, softly, at end of prompt | Voice prompt: front-load synthesis as primary identity, not rule #3 |
| Raw tool output leaking | Thinker has no message format requirement; "not walls of raw output" is too weak | Thinker prompt: mandatory structured message format for pillar_message calls |
| Thinker dumps everything at once | Exploration scope is unlimited; context budget runs out → Thinker panics and dumps | Both prompts: explicit tool round limit (3-5 per delegation); context budget fix |
| Context truncation silently corrupts voice | 5 active plans = 18K+ tokens; ~0 conversation budget left | Architecture: strip plans from singularity system prompts; increase num_ctx |
| Thinker doesn't know when it's done | No exploration scope defined | Thinker prompt: explicit "done when you've answered the question, not when you've exhausted the codebase" |

---

## 7. Best Practices From Research

### For output length control in instruction-tuned models

Quantitative constraints beat qualitative ones:
- ❌ "Be concise" (ignored — training data optimizes for helpfulness, not brevity)
- ✅ "Maximum 150 words per message to Voice"
- ✅ "No code blocks longer than 15 lines"
- ✅ "3-5 bullet points per FOUND: message"

### For anti-parroting (synthesis over repetition)

Must name the failure mode explicitly with examples of what NOT to do:
- ❌ "Don't repeat raw findings" (too abstract)
- ✅ "If Thinker sends you 100 lines of code, respond with: 'The auth middleware stores session tokens in plain text — that's the compliance issue.' ONE sentence. Never the code."
- ✅ "NEVER include a code block longer than 5 lines in your response to Adam. Quote nothing. Interpret everything."

This mirrors the lesson from prior prompt engineering work: *"Anti-pattern instructions must mirror observed failure modes exactly."*

### For structured inter-agent messages

When Agent A sends structured data and Agent B must process it (not parrot it):
- Define a **required message schema** that Agent A must follow
- The schema should force **summarization** — the format itself prevents dumping

A schema like this for Thinker→Voice:
```
FOUND: [what you discovered, 1-2 sentences, no code]
KEY: [most important implication for Adam's question]
DETAIL: [optional: 1-2 specific facts like line numbers, function names]
```

...is hard to fill with raw file contents. The schema's constraints do the anti-parroting work automatically.

### For Qwen3 specifically

- `/no_think` in the system prompt saves 200-2000 tokens per turn
- Temperature 0.7 is high for precise tool work — Thinker should be 0.3-0.4
- Qwen3-coder is well-trained on tool calling; it doesn't need "use tools aggressively" instructions, it needs scope and format constraints

### For multi-agent information flow

Per the Thinker/Planner/Executor pattern from LLM agent literature:
- The communicator (Voice) should **never receive raw tool output** — only structured, summarized findings
- The explorer (Thinker) should have a **defined information budget** for what it sends upward
- The key principle: **each layer should process, not relay**

---

## 8. Concrete Recommendations

### For SINGULARITY_VOICE_PROMPT

**Changes needed (in priority order):**

1. **Add `/no_think` as first line of the prompt** — stops thinking mode immediately
2. **Reframe Voice's identity around synthesis** — this should be the first thing Voice reads, not rule #3
3. **Add explicit word limit**: "Your responses to Adam are MAX 250 words per turn. Period."
4. **Add explicit anti-parroting rule with example** — name the failure mode, show a counter-example
5. **Define what to do with Thinker messages**: "When you receive [THINKER] content, read it once, extract ONE insight per finding, and build your explanation from that. Never quote what Thinker sends."
6. **Restructure rule order**: Lead with "what you are" (synthesizer), then "what you must never do" (quote/repeat), then "how to delegate" (to-thinker tags)

**Example language for the synthesis rule:**

```
## Your Core Job: Transform, Not Relay

When Thinker sends you findings, you are the translator — not the stenographer.
If Thinker sends 400 lines of code, you respond with 2 sentences about what it means.
If Thinker finds a bug, you explain WHY it matters, not WHAT the code looks like.

NEVER include:
- Raw file contents (even 1 line of code you didn't write yourself)
- Verbatim text from Thinker messages
- Code blocks longer than 5 lines

ALWAYS do:
- Extract the insight, not the data
- State what it means for Adam's question
- Keep your answer under 250 words
```

---

### For SINGULARITY_THINKER_PROMPT

**Changes needed (in priority order):**

1. **Add `/no_think` as first line of the prompt** — critical context savings
2. **Define mandatory message format for pillar_message calls**
3. **Add explicit anti-file-dump rule** — name the failure mode precisely
4. **Add exploration scope limit**: "Answer Voice's question in 3-5 tool calls max. If you need more, you're going too deep."
5. **Define "done" precisely** — "done when you've answered the specific question, not when you've explored the whole codebase"
6. **Lower temperature recommendation** — add to prompt or Modelfile

**Example mandatory message format:**

```
## Sending to Voice — Required Format

Every pillar_message call MUST use this format:

FOUND: [what you discovered — 1-2 sentences, NO code, NO file contents]
KEY: [why it matters for the question — 1 sentence]
DETAIL: [optional: specific refs like filename:line, function name, only if useful]

Examples:

FOUND: The session token is stored as plain text in PostgreSQL column `auth_tokens.token`.
KEY: This is the compliance issue legal flagged — it's not encrypted at rest.
DETAIL: bridge/email-watcher.js:142, insertToken() function

FOUND: pillar_message is already implemented in pillar-manager.js and works for Ollama sessions.
KEY: No new code needed — Thinker can use it directly.
DETAIL: bridge/pillar-manager.js:888, _queueSingularityMessage()

NEVER: paste file contents, send code blocks, quote raw tool output, send more than 200 words.
```

---

### Architecture Changes Needed (Not Just Prompts)

These are out of Scout's scope but must go into the plan:

1. **Strip active plans from singularity system prompts** — or pass a `planFilter` that limits to 0 plans. The Singularity is a conversational interface, not a planning system. It doesn't need all 5 active plans.
2. **Increase num_ctx for singularity sessions** — 65,536 minimum, 131,072 if Ollama allows. The MacBook Pro's 128GB unified memory can support this.
3. **Consider a singularity-specific `OLLAMA_INSTRUCTIONS` variant** — stripped of project context, focused on real-time conversation. The current `OLLAMA_INSTRUCTIONS` is designed for coding agents, not for the Voice/Thinker roles.
4. **Temperature override per role** — Thinker: 0.3 (precise tool work); Voice: 0.5 (clear explanation, some variation)

---

## 9. Anti-Patterns to Explicitly Forbid

These should appear in the prompts by name:

**For Voice:**
- Quoting Thinker messages verbatim
- Pasting file contents ("here's what the file shows:")
- Code blocks longer than 5 lines
- Responses over 300 words (per turn, before a new `<to-thinker>` exchange)
- Starting response before delegating when you obviously need Thinker's help

**For Thinker:**
- Sending entire file contents via pillar_message
- Tool chains longer than 5 steps without sending a finding to Voice
- Sending Voice more than 200 words per pillar_message call
- Waiting to send until "fully explored" (send progressively)
- Including code blocks in findings messages

---

## 10. Open Questions for Chart

1. **Should singularity sessions receive NO active plans**, or should they receive a summary/abstract? Some plan context may help Voice understand the project state.
2. **Should `/no_think` apply to BOTH roles**, or just Thinker? There's a case that Voice doing synthesis could benefit from thinking mode — but the context budget cost probably isn't worth it.
3. **Should `num_ctx` be configurable per session** at spawn time? The current `defaultNumCtx` is a global singleton.
4. **Should Thinker's temperature be overridden per session?** Currently set in the Modelfile at 0.7 for all uses of the model. Singularity sessions likely need 0.3 for Thinker.
5. **Should the structured `FOUND: / KEY: / DETAIL:` format be enforced by the bridge** (validate message structure) or just by the prompt?
6. **Voice currently receives the phase prompt prepended to the Singularity prompt** (from `buildBirthContext`). The Flow phase instructions are long and not really relevant to Voice's role. Should singularity sessions suppress the phase prompt entirely?

---

## Summary for Chart

**Three categories of problems, in priority order:**

### Category 1: Architecture (biggest impact, needs code changes)
- System prompt is ~28K tokens; leaves ~4K for conversation → everything degrades
- `num_ctx = 32768` is too small for singularity sessions; needs 64K+
- Active plans should be stripped/excluded from singularity system prompts

### Category 2: Qwen3 Thinking Mode (quick wins, prompts only)
- `/no_think` in both prompts → saves 200-2000 tokens per turn
- Eliminates invisible context leak before every response and every tool call

### Category 3: Prompt Engineering (medium effort, high value)
- Voice needs: synthesis-as-identity (not as rule #3), quantitative word limits, explicit anti-parroting with examples
- Thinker needs: mandatory structured message format, exploration scope limit, explicit file-dump prohibition, definition of "done"
- Both need: `/no_think`, context-budget awareness, clearer role identity framing up front

The architecture fix (Category 1) is a prerequisite — without it, even perfect prompts will fail because the context window fills before meaningful conversation starts.
