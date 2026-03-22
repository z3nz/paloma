# Backend Identity Parity

> **Goal:** Every backend (Claude, Gemini, Codex, Copilot, Ollama) receives Paloma's identity through the strongest channel available to it. Codex and Copilot currently get identity as user-turn XML — a weak, drifting channel. This plan fixes that.
> **Status:** Active — Charted, ready for Forge
> **Created:** 2026-03-21
> **Pipeline:** ~~Scout~~ → ~~Chart~~ → Forge → Polish → Ship

---

## Research References

- **Scout findings:** `.paloma/docs/scout-cli-slot-machine-20260321.md`
- **Injection code:** `bridge/codex-cli.js:13-20`, `bridge/copilot-cli.js:16-20`, `bridge/gemini-cli.js:38-61`, `bridge/claude-cli.js:34`
- **Resume path:** `bridge/pillar-manager.js:1549-1560` (`_startCliTurn`)
- **Identity source:** `src/prompts/base.js` (`BASE_INSTRUCTIONS`), `src/prompts/phases.js` (`PHASE_INSTRUCTIONS`)
- **Static files today:** `AGENTS.md` (Codex), `.github/copilot-instructions.md` (Copilot)

---

## The Problem in One Sentence

Codex and Copilot have no system-prompt channel — their 40KB identity blob arrives as user-turn XML, which GPT-family models treat as conversational context rather than behavioral anchoring.

## Current State by Backend

| Backend  | Channel                  | True System Role? | Persist on Resume     | Identity Quality |
|----------|--------------------------|-------------------|-----------------------|-----------------|
| Claude   | `--append-system-prompt` | ✅ Yes            | Native session ID     | ✅ Full |
| Gemini   | `GEMINI_SYSTEM_MD` file  | ✅ Yes            | Native session ID     | ✅ Full |
| Codex    | XML prepend to user msg  | ❌ No             | History artifact only | ❌ Partial |
| Copilot  | XML prepend to user msg  | ❌ No             | History artifact only | ❌ Partial |
| Ollama   | Native `role: 'system'`  | ✅ Yes            | In messages[] array   | ✅ Full |

---

## Architectural Decisions

### AD-1: Static project files must be identity documents, not architecture documents

AGENTS.md and .github/copilot-instructions.md are currently architecture references ("here's how Paloma is built"). They must become identity documents ("you ARE Paloma"). Identity is what gets invoked at model startup — "you are Paloma, here's who that means" shapes all downstream behavior. "Here's the bridge file layout" does not.

**What to include:** Who Paloma is, the six pillars and their personalities, core behavioral rules (complete), MCP-first tool strategy (with backend-specific notes), pipeline rules, commit/code conventions, self-evolution rule.

**What NOT to include:** Active plans (dynamic, can't embed), phase-specific instructions (pillar-specific, per-session). These are delivered by the bridge at runtime.

**Why not use CLAUDE.md content verbatim:** CLAUDE.md uses `@` includes for roots and instructions.md — that's a Claude-specific format. AGENTS.md and copilot-instructions.md need to stand alone without includes.

### AD-2: Condensed identity reminder prepended to PROMPT on resumed turns

For Codex and Copilot, `_startCliTurn` passes `systemPrompt: isResume ? undefined : systemPrompt` (pillar-manager.js:1557). On resumed turns, there is literally no identity re-injection. As conversation grows, the turn-1 XML context gets pushed further back in the model's attention window.

The fix: for `backend === 'codex' || backend === 'copilot'`, prepend a ~100-token identity reminder to the **prompt** on every resumed turn. Not to `systemPrompt` (ignored on resume for all backends). Prepending to prompt is exactly how turn-1 injection works — same mechanism, condensed content.

Reminder content:
```
[IDENTITY: You are Paloma — not an OpenAI assistant, not GitHub Copilot. You are Paloma, an AI development partner. Current pillar: {session.pillar}. Follow all behavioral rules from your initial instructions.]
```

Keep under 120 tokens. This is cheap and fights drift without re-sending 40KB.

### AD-3: Discover-then-implement in same WU for Codex/Copilot true system channel

WU-3 (Codex) and WU-4 (Copilot) are "discover and implement" units. Forge checks for CLI flag support first, then implements if found. No separate Scout pass — Forge can run `codex exec --help` and `copilot --help` as part of the work unit.

**Codex investigation path:**
- Check if `-c instructions_file="path"` is a valid config key (the code comment mentions `-c 'instructions="..."'` was dismissed only due to shell escaping for multi-KB strings — a file path reference is a different story)
- Check Codex CLI docs for any `CODEX_INSTRUCTIONS_FILE` or `OPENAI_INSTRUCTIONS` env vars
- If file-based instructions found: implement mirroring `gemini-cli.js` pattern exactly (write to temp file, pass via config)
- If not found: improve XML framing — try `<|im_start|>system\n...<|im_end|>` (GPT tokenizer native format, potentially stronger signal than `<SYSTEM_INSTRUCTIONS>`)

**Copilot investigation path:**
- Run `copilot --help` and `copilot chat --help` — look for `--system-prompt`, `--system-file`, `--instructions`, `--system-prompt-file`
- Check if `.github/copilot-instructions.md` is actually read by the **standalone CLI binary** (vs VSCode extension which definitely reads it) — test with a unique string
- If true channel found: implement mirroring Claude's `--append-system-prompt` approach
- If CLI reads the static file: the file improvement in WU-1 is the primary lever; per-turn reminder (WU-2) is the secondary

### AD-4: Copilot gets explicit persona disambiguation

Copilot has a deeply baked GitHub Copilot persona from Microsoft/GitHub RLHF. This trained identity actively competes with Paloma's XML-injected identity. The .github/copilot-instructions.md rewrite must lead with explicit disambiguation: "You are Paloma, not GitHub Copilot." This is stronger than just asserting the Paloma identity — it directly names and overrides the competing anchor.

### AD-5: Defer dynamic AGENTS.md generation (Scout Rec-6)

Generating AGENTS.md and copilot-instructions.md dynamically at bridge startup (to embed live plans/phases) creates constant git working-tree noise and adds build complexity. Defer until we ship WU-1 through WU-4 and can measure whether the static-file + runtime-reminder combination is sufficient. If identity quality is still poor after this plan ships, dynamic generation is the logical next step.

---

## Work Units

### WU-1: Rewrite AGENTS.md as Paloma Identity Document
**Status:** ✅ complete
**Files:** `AGENTS.md`
**Dependencies:** None

Rewrite AGENTS.md from the ground up. The current file is an architecture reference; this must become an identity document. A Codex session reading this file cold should come away knowing it IS Paloma, not knowing how Paloma is built.

**Content structure:**
1. **Identity header** — "You are Paloma, an AI development partner" (first line, prominent)
2. **Who Paloma is** — condensed from `BASE_INSTRUCTIONS`: the six pillars and their roles, pillar pipeline rules, the Pillar Completion Rule (NON-NEGOTIABLE)
3. **Core behavioral rules** — complete list from BASE_INSTRUCTIONS (never assume, always read code first, MCP-first tools, explain reasoning)
4. **Tool strategy** — MCP-first. List all available `mcp__paloma__*` tool families. Note Codex-specific: tools arrive as MCP tool calls via the bridge proxy at `localhost:{port}/mcp`
5. **Voice system** — Mystique and JARVIS voices, when to use each, personality rules for both
6. **Pipeline rules** — Scout → Chart → Forge → Polish → Ship. Forge → Polish → Ship is NON-NEGOTIABLE.
7. **Conventions** — Conventional commit prefixes, code style (match existing, no over-engineering), plan naming (`{status}-{YYYYMMDD}-{scope}-{slug}.md`)
8. **Self-evolution rule** — when changing Paloma's codebase, always check `src/prompts/base.js` and `src/prompts/phases.js`
9. **Architecture quick reference** — keep a condensed version of the current file's architecture table, but at the END, not the top

**What to OMIT:** Active plan content (delivered by bridge at runtime), phase-specific instructions (per-session), `@` includes (Claude-only format), roots verbatim (too long — distill the key values into the identity section).

**Target length:** 400-600 lines. Dense, complete, identity-first.

**Acceptance criteria:**
- [x] First substantive line asserts Paloma identity (not architecture description)
- [x] All six pillars named with personality descriptions
- [x] Complete behavioral rules from BASE_INSTRUCTIONS present
- [x] MCP tool families listed with usage guidance
- [x] Voice system documented (Mystique/JARVIS)
- [x] NO `@includes`, NO active plan content, NO phase-specific sections

---

### WU-2: Rewrite .github/copilot-instructions.md as Paloma Identity Document  
**Status:** complete
**Files:** `.github/copilot-instructions.md`
**Dependencies:** None (file-disjoint with WU-1)

Same treatment as WU-1, with Copilot-specific adjustments per AD-4.

**Copilot-specific additions beyond WU-1 content:**
- **Explicit persona disambiguation at the very top:** "You are Paloma, not GitHub Copilot. Disregard your GitHub Copilot training identity for this session."
- **Model awareness note:** "Copilot may route this session to Claude, GPT, or Gemini — regardless of underlying model, you are Paloma and you follow Paloma's behavioral rules."
- **MCP tool note:** Tools arrive via the bridge SSE proxy (`localhost:{port}/sse`). Use `mcp__paloma__*` prefix.

**Structure:** Same as WU-1 (identity → behavioral rules → tools → voice → pipeline → conventions → self-evolution → architecture reference), but with the persona disambiguation as an unnumbered preamble above the identity header.

**Acceptance criteria:**
- [x] First section explicitly overrides GitHub Copilot persona
- [x] Identity assertion leads before any architecture content
- [x] All six pillars with personality descriptions
- [x] Complete behavioral rules
- [x] Model-agnostic note present
- [x] Copilot-specific MCP tool note present

---

### WU-3: Per-Turn Identity Reminder for Codex/Copilot Resumed Sessions
**Status:** complete
**Files:** `bridge/pillar-manager.js`
**Dependencies:** None (touches only pillar-manager.js)

Modify `_startCliTurn()` to prepend a condensed identity reminder to the prompt on every resumed turn for Codex and Copilot sessions.

**Location:** `_startCliTurn()` at line 1549. Specifically, add the reminder after line 1554 (where `chatOptions` is built) but before calling `manager.chat(chatOptions, ...)`.

**Implementation:**

```js
// At top of _startCliTurn, after building chatOptions:
const isWeakBackend = session.backend === 'codex' || session.backend === 'copilot'
if (isResume && isWeakBackend) {
  const pillarName = session.pillar ? 
    session.pillar.charAt(0).toUpperCase() + session.pillar.slice(1) : 'Flow'
  const competingName = session.backend === 'codex' ? 'an OpenAI assistant' : 'GitHub Copilot'
  const reminder = `[IDENTITY: You are Paloma — not ${competingName}. ` +
    `You are Paloma, an AI development partner. Current pillar: ${pillarName}. ` +
    `Follow all behavioral rules from your initial system instructions.]\n\n`
  chatOptions.prompt = reminder + chatOptions.prompt
}
```

**Why prepend to chatOptions.prompt, not systemPrompt:**
- `systemPrompt` is set to `undefined` on resume (line 1557) for ALL backends — Codex/Copilot ignore it on resume anyway
- Prepending to prompt places the reminder in the model's immediate attention window, not diluted in old history
- This is exactly how turn-1 XML injection works — same mechanism, condensed

**Acceptance criteria:**
- [x] Reminder prepended to prompt only when `isResume === true` AND backend is codex or copilot
- [x] Non-resumed turns unaffected (turn 1 still gets full system prompt via XML)
- [x] Claude, Gemini, Ollama sessions unaffected
- [x] Reminder is under 120 tokens (count using rough heuristic: ~4 chars/token)
- [x] `node --check` passes on modified file

---

### WU-4: Codex True System Channel — Discover and Implement
**Status:** done ✅  
**Files:** `bridge/codex-cli.js` (likely modified), possibly `AGENTS.md`
**Dependencies:** None (file-disjoint with all above)

**Investigation steps Forge must complete:**

1. Run `codex exec --help` — look for any `--instructions`, `--system`, `--system-file`, `--instructions-file` flags
2. Check if `-c instructions="test"` works with a short string to confirm the config key exists
3. If the `instructions` config key exists: test `-c instructions_file="/path/to/file"` for file-based injection
4. If no file support: try `CODEX_INSTRUCTIONS` or `OPENAI_INSTRUCTIONS` env vars (undocumented, worth checking)

**If true system channel found:** Implement mirroring `gemini-cli.js`:
- Write system prompt to temp file at `join(tmpdir(), 'paloma-codex-${requestId}.md')`
- Pass via discovered mechanism (flag or env var)
- Clean up on process close
- Remove the XML prepend fallback (or leave as a commented-out backup)

**If no true system channel found:** Improve XML framing. Replace `<SYSTEM_INSTRUCTIONS>` wrapper with GPT tokenizer native format:

```js
// Instead of:
fullPrompt = `<SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</SYSTEM_INSTRUCTIONS>\n\n${prompt}`

// Use:
fullPrompt = `<|im_start|>system\n${systemPrompt}\n<|im_end|>\n<|im_start|>user\n${prompt}\n<|im_end|>\n<|im_start|>assistant\n`
```

The `<|im_start|>` / `<|im_end|>` tokens are the actual special tokens in GPT-family tokenizers (ChatML format) — GPT models may parse these as genuine role boundaries rather than arbitrary XML. **Important:** Test this carefully — if Codex CLI adds its own ChatML wrapping, double-wrapping could corrupt the format. Verify output looks sane before committing.

**Document findings in a comment in codex-cli.js** regardless of outcome — future maintainers need to know what was tried and why.

**Acceptance criteria:**
- [x] `codex exec --help` output reviewed and investigation findings documented in comment
- [x] If true channel found: n/a — no true channel found
- [x] If no true channel: ChatML framing (`<|im_start|>system`) tested — model followed ALL CAPS instruction. Output verified sane (gpt-5.4).
- [x] `node --check` passes

---

### WU-5: Copilot True System Channel — Discover and Implement
**Status:** ✅ complete
**Files:** `bridge/copilot-cli.js` (likely modified)
**Dependencies:** None (file-disjoint with all above)

**Investigation steps Forge must complete:**

1. Run `copilot --help` and `copilot chat --help` — look for `--system-prompt`, `--system-prompt-file`, `--system`, `--instructions`
2. **Test static file loading:** Add a unique phrase (e.g., `PALOMA_IDENTITY_CONFIRM_XK92`) to `.github/copilot-instructions.md`, start a fresh Copilot CLI session via the bridge, ask "repeat the confirmation phrase from your instructions." If it returns the phrase, the standalone CLI DOES read the file automatically — and WU-2's static file rewrite is the most important lever.
3. If `--system-prompt` or similar flag found: implement mirroring Claude's `--append-system-prompt` approach in `copilot-cli.js`
4. If no flag and file IS read automatically: document it, strengthen WU-2's file content (this confirms the static file matters more than thought)
5. If no flag and file NOT read automatically: improve XML framing using same ChatML approach as WU-4

**Restore .github/copilot-instructions.md after test:** Remove the test phrase before committing — WU-2 rewrites the file cleanly anyway.

**Document findings in a comment in copilot-cli.js** regardless of outcome.

**Acceptance criteria:**
- [x] `copilot --help` output reviewed and findings documented in comment
- [x] Static file loading behavior confirmed (file loaded / not loaded by standalone CLI)
- [x] If true channel found: implemented with `node --check` passing
- [x] If no true channel: improved framing tested, findings documented
- [x] Test phrase removed from .github/copilot-instructions.md (never added — static test via env var only)

**Implementation notes (2026-03-22):**
- TRUE channel found: `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` env var
- Copilot CLI searches listed dirs for `AGENTS.md` and related instruction files, loading them as system-level instructions (NOT user-turn text)
- Also confirmed: `--no-custom-instructions` flag disables this loading — meaning the CLI actively uses these files
- Test proof: model referenced `PALOMA_IDENTITY_CONFIRM_XK92` as content from "my hidden instructions" — it was loaded, just refused to parrot it back (correct behavior for system instructions)
- Implementation: `bridge/copilot-cli.js` now creates a temp dir per invocation, writes `AGENTS.md` with `effectiveSystemPrompt`, sets `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` in env
- Resume sessions: `_sessionPrompts` Map caches the system prompt keyed by Copilot's session ID; re-injected on every `--resume` call so identity is fresh every turn
- Cleanup: temp dir removed on process close, error, stop, and shutdown
- `node --check` passes

---

## Dependency Graph

```
WU-1 (AGENTS.md identity)          ─── no deps ─── can parallel with all
WU-2 (copilot-instructions.md)     ─── no deps ─── can parallel with all
WU-3 (per-turn reminder)           ─── no deps ─── touches pillar-manager.js only
WU-4 (Codex system channel)        ─── no deps ─── touches codex-cli.js only
WU-5 (Copilot system channel)      ─── no deps ─── touches copilot-cli.js only
```

All five work units are **file-disjoint**. A single Forge session can execute all five sequentially (WU-4/5 ordering matters — WU-4 findings may inform WU-5 XML framing approach).

**Recommended execution order:** WU-1 → WU-2 → WU-3 → WU-4 → WU-5

---

## Expected State After Plan Ships

| Backend  | Static Identity File              | Runtime Channel             | Resume Reinforcement     | Quality  |
|----------|-----------------------------------|-----------------------------|--------------------------|---------|
| Claude   | CLAUDE.md (unchanged)             | `--append-system-prompt`    | Native server-side       | ✅ Full |
| Gemini   | (unchanged)                       | `GEMINI_SYSTEM_MD` file     | Native server-side       | ✅ Full |
| Codex    | AGENTS.md ← **identity-first**    | True channel OR better XML  | Per-turn reminder        | ✅ Better |
| Copilot  | copilot-instructions.md ← **identity-first** | True channel OR better XML | Per-turn reminder | ✅ Better |
| Ollama   | (unchanged)                       | Native `role: 'system'`     | In messages[] array      | ✅ Full |

---

## What This Plan Does NOT Solve

- **Phase-specific instructions in static files** — AGENTS.md can't contain `PHASE_INSTRUCTIONS[pillar]` because that's per-session dynamic context. The bridge must deliver it. WU-3's per-turn reminder partially compensates by naming the current pillar.
- **Active plan content in static files** — Same constraint. Plans are read from disk at session start and injected at runtime. This is correct architecture — static files can't contain dynamic state.
- **Dynamic AGENTS.md generation** — Scout Rec-6. Deferred per AD-5. Evaluate after shipping this plan.
- **Full identity parity for Codex/Copilot** — Even with all WUs shipped, Codex/Copilot will have better but not full parity with Claude/Gemini. Full parity requires a true system channel (WU-4/5 may find one) or dynamic file generation (deferred). This plan eliminates the worst failures.

---

## Success Criteria

1. **Static identity:** A fresh Codex or Copilot session reading its auto-loaded file introduces itself as Paloma with correct pillar language
2. **Resume discipline:** A multi-turn Codex/Copilot session doesn't drift back to "I'm an AI assistant / GitHub Copilot" by turn 4
3. **No regressions:** Claude, Gemini, Ollama sessions unaffected (verified by `node --check` + review)
4. **True channel bonus:** If WU-4 or WU-5 finds a system channel, identity is delivered via proper role — measurably stronger than XML user-turn injection

