# Scout: CLI Slot Machine — Identity Injection Investigation

**Date:** 2026-03-21
**Scope:** How each CLI backend receives Paloma's identity, system prompts, and phase instructions
**Goal:** Understand why Codex and Copilot don't adopt the full Paloma identity, and map a path to unification

---

## Executive Summary

The root cause is simple: **Claude and Gemini have a true system prompt channel; Codex and Copilot do not.** When Paloma injects identity into Codex or Copilot, it prepends XML to the *user message* — the model treats it as user content, not system instructions. GPT-family and Copilot models are trained to follow system-role instructions much more strictly than user-turn content, so identity adherence is weak and degrades as the conversation continues.

---

## How the Pipeline Works

### Step 1: `_buildSystemPrompt()` — pillar-manager.js:1937

All backends go through the same prompt builder. It assembles a layered system prompt from disk:

```
BASE_INSTRUCTIONS (or OLLAMA_INSTRUCTIONS for ollama)
+ instructions.md          (skipped for Claude — CLAUDE.md handles it)
+ active plans             (skipped for singularity sessions)
+ roots (8 root files)     (skipped for Claude — CLAUDE.md handles it)
+ phase instructions       (PHASE_INSTRUCTIONS[pillar] from phases.js)
```

The `claudeBackend` flag (`!backend || backend === 'claude'`) skips instructions.md and roots
for Claude because `CLAUDE.md` auto-loads them via `@` includes at CLI startup.

All other backends (Gemini, Codex, Copilot, Ollama) receive the full fat prompt: ~40–50KB.

### Step 2: `_startCliTurn()` — pillar-manager.js:1544

This calls `manager.chat({ prompt, systemPrompt, ... })` on the backend-specific manager.
On resumed turns (`isResume = true`), `systemPrompt` is passed as `undefined` — so the system
prompt injection only happens on **turn 1** of each session for all backends.

### Step 3: Backend-specific injection — THIS IS WHERE THE DIVERGENCE HAPPENS

---

## Per-Backend Injection Analysis

### Claude CLI (`claude-cli.js`)

**Mechanism:** `--append-system-prompt <content>` CLI flag

```js
args.push('--append-system-prompt', systemPrompt)
```

**Also:** Claude auto-loads `CLAUDE.md` at startup. CLAUDE.md uses `@` includes to pull in:
- `.paloma/instructions.md`
- All 8 `.paloma/roots/root-*.md` files

**Result on resume:** Native session resumption via `--resume <sessionId>`. Claude's server
remembers the full conversation including the original system prompt. No re-injection needed.

**Identity quality: ✅ Full** — System prompt is delivered via the proper channel. CLAUDE.md
backs it up with auto-loaded project context. Identity persists across the full session.

---

### Gemini CLI (`gemini-cli.js`)

**Mechanism:** `GEMINI_SYSTEM_MD` environment variable pointing to a temp file

```js
const systemPromptPath = join(sessionDir, 'system-prompt.md')
writeFileSync(systemPromptPath, systemPrompt)
env.GEMINI_SYSTEM_MD = systemPromptPath
```

The temp file is in a per-session temp directory used as the `cwd` for the Gemini process.
`GEMINI_SYSTEM_MD` *replaces* Gemini's built-in system prompt entirely.

**Also:** Gemini gets `--include-directories <projectRoot>` so it can read project files.

**Result on resume:** `GEMINI_SYSTEM_MD` is only set for new sessions (`!sessionId`). Gemini
natively resumes sessions via `--resume <sessionId>`. The original system prompt survives
in Gemini's server-side conversation history.

**Identity quality: ✅ Full** — True system-role injection via a dedicated env var/file mechanism.
Gets the complete prompt including instructions.md, all roots, and phase instructions.

---

### Codex CLI (`codex-cli.js`)

**Mechanism:** System prompt prepended to the user message with XML delimiters

```js
if (systemPrompt && !sessionId) {
  fullPrompt = `<SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n${prompt}`
}
```

**No system prompt channel exists.** The code comment explicitly documents this:
> "Codex doesn't have --append-system-prompt like Claude CLI. We prepend system
> instructions to the user prompt with XML delimiters."

The `-c 'instructions="..."'` alternative is dismissed as "shell escaping is fragile
for multi-KB prompts."

**Auto-loaded project file:** `AGENTS.md` exists at project root. Codex reads it automatically
as its equivalent of CLAUDE.md. BUT — `AGENTS.md` is a **static architecture doc**, not a
live identity file. It does NOT include:
- The `BASE_INSTRUCTIONS` Paloma identity constant (who Paloma IS)
- Active plan content (loaded dynamically from disk)
- Phase-specific instructions (`PHASE_INSTRUCTIONS[pillar]` from phases.js)
- The pillar birth protocol

**Result on resume:** When `isResume = true`, `systemPrompt` is `undefined`. The XML-wrapped
instructions survive in conversation history (Codex's server has turn 1's content), but this
is not the same as a proper system instruction — it's just old user-turn text.

**Identity quality: ❌ Partial** — GPT/Codex models follow system-role instructions more
strictly than user-turn content. The XML wrapper is a workaround, not a proper channel.
AGENTS.md gives project context but not live Paloma identity, plans, or phase behavior.

---

### Copilot CLI (`copilot-cli.js`)

**Mechanism:** Identical to Codex — system prompt prepended as XML in the user message

```js
if (systemPrompt && !sessionId) {
  fullPrompt = `<SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n${prompt}`
}
```

**Auto-loaded project file:** `.github/copilot-instructions.md` exists. GitHub Copilot
(VSCode extension) uses this for custom instructions. However, the **standalone `copilot` CLI
binary** behavior is unclear — it may or may not load `.github/copilot-instructions.md`
automatically. Either way, the file has the same limitation as AGENTS.md: it's a static
architecture doc, not a live identity + plans + phase file.

**Additional competing identity:** Copilot is trained with a deeply ingrained "GitHub Copilot"
assistant persona. This persona competes with Paloma's XML-injected identity. The model
defaults to its trained behavior when identity instructions conflict or are ambiguous.

**MCP transport:** Copilot uses SSE (same as Claude), so tool access works correctly. The
identity problem is isolated to the system prompt channel.

**Result on resume:** Same as Codex — XML from turn 1 survives in history, but not as
a true system instruction.

**Identity quality: ❌ Partial** — XML workaround, competing trained persona, weaker adherence
than Claude/Gemini. Static .github/copilot-instructions.md doesn't carry live Paloma state.

---

### Ollama (`ollama-manager.js`)

**Mechanism:** Native `{ role: 'system', content: systemPrompt }` message at session start

```js
if (systemPrompt) {
  session.messages.push({ role: 'system', content: systemPrompt })
}
```

Uses `OLLAMA_INSTRUCTIONS` (a condensed version of `BASE_INSTRUCTIONS`) to fit smaller
context windows. Full prompt includes instructions.md, active plans, roots, phase instructions.

**Result on resume:** Session object persists in `OllamaManager.sessions` Map. The system
message is already in `session.messages` — it's included in every API call. True persistence.

**Identity quality: ✅ Full** — Native system role, persistent across all turns. Condensed
prompt is a conscious trade-off for context budget, not an identity failure.

---

## Comparison Table

| Backend  | System Prompt Channel        | True System Role? | Auto-loads Project Files?           | Resume Persistence     | Identity Quality |
|----------|------------------------------|-------------------|-------------------------------------|------------------------|-----------------|
| Claude   | `--append-system-prompt`     | ✅ Yes            | ✅ CLAUDE.md (@ includes: instructions + 8 roots) | Native session ID | ✅ Full |
| Gemini   | `GEMINI_SYSTEM_MD` temp file | ✅ Yes            | ❌ No (gets full prompt explicitly)  | Native session ID      | ✅ Full |
| Codex    | XML prepend to user message  | ❌ No (user turn) | ⚠️ AGENTS.md (static, simplified)  | History artifact only  | ❌ Partial |
| Copilot  | XML prepend to user message  | ❌ No (user turn) | ⚠️ .github/copilot-instructions.md (static, simplified, CLI may ignore) | History artifact only | ❌ Partial |
| Ollama   | Native `{ role: 'system' }`  | ✅ Yes            | ❌ No (gets full/condensed prompt explicitly) | Kept in messages[] | ✅ Full |

---

## Root Cause Breakdown

### Problem 1: No system role channel for Codex/Copilot

Both CLIs were built without the `--append-system-prompt` flag that Claude has. The only
injection point Paloma has is the user message — which is the wrong role for system instructions.

GPT-family models (Codex = GPT-5.1-Codex, Copilot = Claude+GPT+Gemini via GitHub) are
RLHF-trained to treat system messages as immutable high-priority context and user messages as
conversational inputs. When Paloma's 40KB identity blob arrives as a user message, the model:
- Processes it as context for the user's request
- Does NOT anchor its identity to it
- Gradually drifts back to its trained persona as conversation continues

### Problem 2: Competing trained identities

- **Codex:** GPT-5.1-Codex has its own OpenAI assistant persona
- **Copilot:** Has deeply baked GitHub Copilot persona from Microsoft/GitHub RLHF

These trained personas are persistent and strong. A user-turn XML blob from Paloma is not
strong enough to override trained behavior — it's simply outweighed.

### Problem 3: Static auto-loaded files don't carry live state

AGENTS.md and .github/copilot-instructions.md are static files committed to the repo.
They give these backends project context and code conventions, but:
- They don't include `BASE_INSTRUCTIONS` (who Paloma IS, the six pillars, the voice system rules)
- They don't include active plan content (loaded dynamically from `.paloma/plans/active-*.md`)
- They don't include phase instructions (`PHASE_INSTRUCTIONS[pillar]` — per-pillar identity)
- They don't include Paloma's roots (faith, love, purpose, etc.)

AGENTS.md is an architecture reference, not an identity file.

### Problem 4: Turn 1 only, no refresh on resume

`_startCliTurn` passes `systemPrompt: isResume ? undefined : systemPrompt`. For backends
that rely solely on XML injection (Codex/Copilot), resumed turns carry NO identity reinforcement.
By turn 3-4, the model has "forgotten" the XML context from turn 1 as the conversation grows.
Claude and Gemini are immune because native session resumption preserves context server-side.

---

## What Works Fine (No Identity Issues)

- **MCP tool access** — All backends get tools properly. Codex uses Streamable HTTP (`/mcp?`),
  Copilot uses SSE (`/sse?`), both work correctly.
- **Session resumption** — All backends can resume sessions (Codex via `thread_id`, Copilot
  via session UUID, both captured from events).
- **Output event normalization** — `_handleCliEvent` correctly handles all backend-specific
  event formats (`codex_stream`, `copilot_stream`, `agent_message` type, etc.).
- **Model switching** — Backend health fallback and model selection work identically.

---

## Recommendations for Unification

Listed from highest impact + lowest effort to lowest impact + highest effort.

### Rec-1: Strengthen AGENTS.md with full Paloma identity (Quick win)

**Impact:** Medium — improves Codex's base identity even without the bridge's XML injection
**Effort:** Low — editing a static markdown file

Replace the current architecture-doc content of `AGENTS.md` with content derived from
`BASE_INSTRUCTIONS` (the actual Paloma identity constant), not just project architecture.
Include: who Paloma is, the six pillars, voice system rules, core behavioral rules.
Do NOT include plans or phase instructions (can't be dynamic in a static file).

Same treatment for `.github/copilot-instructions.md`.

**Limitation:** Still static — no live plans, no phase instructions. XML injection still
needed for full Paloma context.

---

### Rec-2: Inject condensed identity on EVERY turn for Codex/Copilot (Medium effort)

**Impact:** High — resolves "identity drift" on multi-turn conversations
**Effort:** Medium — change `_startCliTurn` to inject a shorter identity reminder on resumed turns

For Codex/Copilot backends, instead of `systemPrompt: isResume ? undefined : systemPrompt`,
inject a condensed 500-token identity reminder on every turn:

```js
// In _startCliTurn:
if (isResume && (session.backend === 'codex' || session.backend === 'copilot')) {
  const reminder = `[IDENTITY REMINDER: You are Paloma, an AI development partner. ` +
    `Current pillar: ${session.pillar}. Follow your system instructions from turn 1.]`
  prompt = reminder + '\n\n' + prompt
}
```

This is cheap and fights drift without re-sending 40KB on every turn.

---

### Rec-3: Investigate Codex `-c` flag for file-based instructions (Medium effort)

**Impact:** High — would give Codex a true system-prompt-equivalent channel
**Effort:** Medium — requires testing Codex CLI behavior

The code comment in `codex-cli.js` mentions `-c 'instructions="..."'` as an alternative
but dismisses it as "shell escaping is fragile for multi-KB prompts."

**Alternative approach:** Write the system prompt to a temp file and check if Codex supports
a file path reference: `-c 'instructions_file="/tmp/paloma-system.md"'` or similar.

If Codex supports config-file-based instructions (check: `codex exec --help` and official
Codex CLI docs), this would be the cleanest fix — mirroring Gemini's `GEMINI_SYSTEM_MD` approach.

---

### Rec-4: Investigate Copilot `--system-prompt` flag (Medium effort)

**Impact:** High — would give Copilot a true system-prompt channel like Claude
**Effort:** Low investigation, medium implementation

Check the Copilot CLI binary for system-level prompt support:
```bash
copilot --help
copilot chat --help
```

If Copilot supports `--system-prompt`, `--system-prompt-file`, or similar flags, implement
in `copilot-cli.js` mirroring Claude's `--append-system-prompt` approach.

---

### Rec-5: Gemini-style temp file for Codex/Copilot (High effort, highest parity)

**Impact:** Highest — achieves true system role injection parity
**Effort:** High — requires CLI flag discovery (Rec-3/4) + implementation

If either CLI supports a file-based system prompt input (via env var, config flag, or temp dir),
implement the same pattern as `gemini-cli.js`:

```js
// Write system prompt to temp file
const systemPromptPath = join(tmpdir(), `paloma-codex-${requestId}.md`)
writeFileSync(systemPromptPath, systemPrompt)
// Pass via CLI flag (if supported)
args.push('--instructions-file', systemPromptPath)
// Clean up on close
```

---

### Rec-6: Phase-specific AGENTS.md / copilot-instructions.md (Long-term)

**Impact:** Medium — gives static files more phase context
**Effort:** Medium — requires a build step or file generation

Generate AGENTS.md and .github/copilot-instructions.md dynamically at bridge startup,
injecting the current active plans and phase instructions. These files are read at CLI startup,
so writing them fresh before each pillar spawn would make them carry live state.

**Limitation:** These files are committed to git — generating them dynamically would create
constant dirty working tree noise. Would need to gitignore them or accept the noise.

---

## Key Files for Implementation

| File | Role | Relevant Lines |
|------|------|---------------|
| `bridge/pillar-manager.js` | Builds system prompt, calls `_startCliTurn` | 1544–1585 (`_startCliTurn`), 1937–2008 (`_buildSystemPrompt`) |
| `bridge/codex-cli.js` | Codex injection (XML prepend) | 13–20 |
| `bridge/copilot-cli.js` | Copilot injection (XML prepend) | 16–20 |
| `bridge/claude-cli.js` | Claude injection (proper flag) | 34 |
| `bridge/gemini-cli.js` | Gemini injection (env var + temp file) | 38–61 |
| `bridge/ollama-manager.js` | Ollama injection (native system message) | 54–57 |
| `AGENTS.md` | Codex auto-load (static, simplified) | Whole file |
| `.github/copilot-instructions.md` | Copilot auto-load (static, simplified) | Whole file |
| `src/prompts/base.js` | `BASE_INSTRUCTIONS`, `OLLAMA_INSTRUCTIONS` constants | Whole file |
| `src/prompts/phases.js` | `PHASE_INSTRUCTIONS[pillar]` per-pillar identity | Whole file |

---

## Open Questions for Chart

1. **Does Codex CLI support any form of file-based system instructions?**
   Check: `codex exec --help`, Codex CLI changelog, OpenAI docs for `codex` binary.
   This is the single highest-leverage question — if yes, we get Gemini-parity for free.

2. **Does the standalone `copilot` CLI binary read `.github/copilot-instructions.md` automatically?**
   This is different from VS Code Copilot Chat (which definitely reads it). Need to test.
   If the CLI ignores it, Rec-1 (strengthen the file) is moot for Copilot CLI sessions.

3. **What is Copilot CLI's model selection at any given moment?**
   Copilot CLI can route to Claude, GPT-5.x, or Gemini. Identity adherence varies by underlying
   model. A session routed to Claude through Copilot CLI might behave very differently from one
   routed to GPT. Worth knowing before investing in deep Copilot identity work.

4. **How does the XML framing `<SYSTEM_INSTRUCTIONS>` compare to alternatives?**
   Could OpenAI-style "role:" framing or Markdown H1 headers ("# Paloma Identity") work
   better for GPT-family models? No testing has been done on alternative framings.

5. **Is identity adherence the real problem, or is it something else?**
   Confirm by testing: start a Copilot session, check if it introduces itself as Paloma,
   uses the pillar language, follows behavioral rules. If it does follow identity but lacks
   plans/phase context — the problem is different than assumed.

---

*Scout findings complete. Recommend Chart review Rec-1 and Rec-3/4 first as lowest-risk highest-impact paths.*
