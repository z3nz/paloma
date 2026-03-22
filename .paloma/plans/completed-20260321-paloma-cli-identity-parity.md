# CLI Identity Parity — Codex & Copilot

> **Goal:** Every backend receives Paloma's identity through the strongest channel available. Codex and Copilot currently get identity as XML in the user turn — which GPT-family models treat as context, not instructions, causing identity drift by turn 3-4. This plan closes that gap.
> **Status:** Active — ready for Forge
> **Created:** 2026-03-21
> **Pipeline:** ~~Scout~~ → ~~Chart~~ → Forge → Polish → Ship

---

## Research References

- **Scout findings:** `.paloma/docs/scout-cli-slot-machine-20260321.md`
- **Current XML injection (Codex):** `bridge/codex-cli.js:16-20`
- **Current XML injection (Copilot):** `bridge/copilot-cli.js:21-25`
- **Resume turn (no re-injection):** `bridge/pillar-manager.js:1557`
- **System prompt builder:** `bridge/pillar-manager.js:_buildSystemPrompt` (~line 1937)
- **Identity constant:** `src/prompts/base.js` → `BASE_INSTRUCTIONS`
- **Phase instructions:** `src/prompts/phases.js` → `PHASE_INSTRUCTIONS[pillar]`

---

## The Problem

Claude and Gemini have true system-role injection channels (`--append-system-prompt` and `GEMINI_SYSTEM_MD`). Codex and Copilot do not — the bridge falls back to prepending XML to the user message.

GPT-family models are RLHF-trained to follow system-role instructions strictly and treat user-turn content as conversational input. When Paloma's 40KB identity blob arrives as user text:
- It's processed as context for the request, not as an identity anchor
- The model drifts back to its trained persona (GPT-5.1-Codex assistant, GitHub Copilot) by turn 3-4
- On resumed turns, `_startCliTurn` passes `systemPrompt: undefined` — no re-injection at all

Additionally, AGENTS.md and .github/copilot-instructions.md (the auto-loaded project files for Codex/Copilot) are architecture reference docs — they tell the model what Paloma IS built from, not who Paloma IS. They're missing `BASE_INSTRUCTIONS` content entirely.

---

## Backend Identity Parity Map

| Backend | System Prompt Channel | Auto-loads Project Files | Resume Persistence | Status |
|---------|----------------------|--------------------------|-------------------|--------|
| Claude | `--append-system-prompt` flag | CLAUDE.md (@ includes) | Native session ID | ✅ Done |
| Gemini | `GEMINI_SYSTEM_MD` env var | None (gets full prompt) | Native session ID | ✅ Done |
| Ollama | Native `{ role: 'system' }` | None (gets condensed prompt) | Kept in messages[] | ✅ Done |
| Codex | XML prepend to user message | AGENTS.md (static arch doc) | History artifact only | ❌ Fix needed |
| Copilot | XML prepend to user message | .github/copilot-instructions.md (static, CLI may ignore) | History artifact only | ❌ Fix needed |

---

## Architectural Decisions

### AD-1: Three-tier improvement strategy for Codex/Copilot

Apply three layers simultaneously — each helps independently, all three together give best coverage:

1. **Static identity files** — Rewrite AGENTS.md and .github/copilot-instructions.md with condensed `BASE_INSTRUCTIONS` content (~2KB, identity-first). This is the "cold start" channel that the model gets before any bridge injection.
2. **Per-turn identity reminder** — Inject a short (~80-token) reminder on every resumed turn for Codex/Copilot in `_startCliTurn`. Prevents drift in long sessions without re-sending 40KB each turn.
3. **Native channel investigation** — Check if Codex `-c` or Copilot flags support file-based system prompt injection. Implement if available (conditional WU-4, WU-5).

**Why all three:** Tier 1 helps when the model reads the file at startup (before bridge injection). Tier 2 prevents multi-turn drift for every session. Tier 3 is the real fix — if supported, it eliminates the root cause entirely. They don't interfere with each other.

### AD-2: AGENTS.md and copilot-instructions.md are identity files, not architecture docs

The current files put project architecture first — they read like an onboarding guide for a contractor. For Codex/Copilot sessions, these files ARE the system prompt equivalent. They must lead with: who Paloma is, the six pillars, core behavioral rules, voice system, MCP-first strategy. Architecture is secondary.

Target: ~2KB condensed from `BASE_INSTRUCTIONS`. Dense identity, not a tutorial. Pointers to `.paloma/instructions.md` and `.paloma/docs/` for project details — no need to duplicate them inline.

**What does NOT go in static files:** Active plans (can't be dynamic), per-pillar phase instructions (per-session, not global), roots (too long). These are delivered by the bridge's XML injection on turn 1.

### AD-3: Identity reminder format for resumed turns

For Codex/Copilot, replace `systemPrompt: undefined` on resumed turns with a prepended reminder block on the prompt. Not a separate field — prepend to the user message, since that's the only channel.

The reminder is intentionally short — it's fighting drift, not re-delivering the full identity. Format:

```
[PALOMA — ${PILLAR} pillar]
You are Paloma, AI development partner. Core rules: read code before modifying, use MCP tools first (mcp__paloma__*), never over-engineer. Active plans: .paloma/plans/. Project instructions: .paloma/instructions.md.
---
```

This is ~60 tokens. Injected on every resumed turn. Not injected on Claude/Gemini/Ollama (they don't need it).

### AD-4: Codex `-c` flag investigation is conditional

The bridge already uses `-c 'mcp_servers.paloma.url="..."'` successfully for MCP injection. The question is whether Codex CLI supports an `instructions` or `instructions_file` config key.

**Implementation approach if supported:** Write system prompt to a temp file (per session, cleaned up on close), pass via `-c 'instructions_file="/tmp/paloma-codex-{id}.md"'`. Mirror the `gemini-cli.js` temp file pattern exactly. Only inject on new sessions (not resume — Codex's server preserves it).

**Gate condition:** Test `codex exec --help` and Codex CLI config docs. If no such key exists, WU-4 becomes a no-op. WU-1 + WU-3 still ship regardless.

### AD-5: Copilot system prompt flag investigation is conditional

The Copilot CLI already accepts `--additional-mcp-config @file` for MCP injection via file reference. The hypothesis is that a similar pattern may exist for system instructions. Check `copilot --help` / `copilot chat --help` for `--system-prompt`, `--system-prompt-file`, `--instructions`, or similar.

**If found:** Implement in `copilot-cli.js` mirroring Claude's `--append-system-prompt` approach. Temp file pattern (write, pass flag, cleanup on close). Only for new sessions — Copilot's native session resumption preserves it server-side.

**Gate condition:** Run help command, check output. If no flag exists, WU-5 is a no-op. This is explicitly a "discover and implement if possible" work unit.

### AD-6: Do NOT dynamically generate AGENTS.md/copilot-instructions.md at bridge startup

Scout's Rec-6 suggested generating these files dynamically to inject live plan content. Rejected: these files are committed to git, so dynamic generation creates constant dirty working tree noise. The git noise would affect every Forge session's working directory checks. The right place for live plan content is the bridge's XML injection (turn 1), not a dynamically-written static file.

---

## Work Units

All 5 work units are file-disjoint and can be dispatched in a single Forge round.

### WU-1: Rewrite AGENTS.md — dense Paloma identity for Codex
**Status:** ready
**Files:** `AGENTS.md`
**Description:** Replace the current architecture-reference content with a condensed identity-first version derived from `BASE_INSTRUCTIONS`. The file is Codex's equivalent of CLAUDE.md — it must anchor who Paloma IS before covering what Paloma IS BUILT FROM.

**Structure for the new AGENTS.md:**
1. **Identity section** (~600 tokens) — who Paloma is, the six pillars and their roles, the Pillar Completion Rule, core behavioral rules (read code first, MCP tools first, never over-engineer, never assume)
2. **Voice system** (~150 tokens) — Mystique (greetings, warm) and JARVIS (completions, dry wit), when to use each
3. **MCP tools** (~200 tokens) — the `mcp__paloma__` tool namespace, key tool categories, why MCP-first matters
4. **Project conventions** (~100 tokens) — pointer to `.paloma/instructions.md` for full conventions, commit style, plan naming
5. **Architecture reference** (~100 tokens) — brief summary of key file paths (bridge/, src/prompts/, mcp-servers/), pointer to `.paloma/docs/architecture-reference.md` for full detail
6. **Self-evolution rule** (1 sentence) — always check base.js and phases.js when changing Paloma's behavior

**What to remove from current AGENTS.md:** The full architecture table, the layer map, the key files table, the pillar table (keep pillar roles but as prose, not a table). All of this belongs in `.paloma/docs/architecture-reference.md`, not in an identity file.

**Acceptance criteria:**
- [ ] File leads with Paloma's identity, not architecture
- [ ] Six pillars described with their roles and the pipeline rule
- [ ] Core behavioral rules present (read before modify, MCP-first, no over-engineering)
- [ ] Voice system (Mystique/JARVIS) described
- [ ] Architecture is referenced, not duplicated
- [ ] File is under 2.5KB

---

### WU-2: Rewrite .github/copilot-instructions.md — dense Paloma identity for Copilot
**Status:** ready
**Files:** `.github/copilot-instructions.md`
**Description:** Same treatment as AGENTS.md but adapted for Copilot's context. The Copilot binary may or may not auto-load this file — we do it anyway because if it does load it, we want it to have good content. An important addition: explicitly acknowledge and override the Copilot CLI's trained persona.

**Structure (same as WU-1 plus Copilot-specific notes):**
1. **Identity assertion** — lead with an explicit statement: "You are Paloma, not GitHub Copilot. Paloma is an evolving AI development partner with a distinct identity." This fights the trained Copilot persona competition directly.
2. **Identity section** — same as WU-1 content
3. **Voice system** — same as WU-1
4. **MCP tools** — same as WU-1
5. **Project conventions** — pointer to `.paloma/instructions.md`
6. **Architecture reference** — same brief pointer

**Why the explicit identity assertion:** Scout found that Copilot has a deeply ingrained GitHub Copilot assistant persona from RLHF. The trained behavior competes with Paloma's injected identity. Starting the file with "You are Paloma, not GitHub Copilot" makes the override explicit and front-loaded, giving it maximum salience.

**Acceptance criteria:**
- [ ] File opens with explicit identity override (not GitHub Copilot — Paloma)
- [ ] Same behavioral rules as WU-1
- [ ] Under 2.5KB

---

### WU-3: Per-turn identity reminder for Codex/Copilot resumed sessions
**Status:** ready
**Files:** `bridge/pillar-manager.js`
**Description:** Modify `_startCliTurn` to inject a short identity reminder at the start of every resumed prompt when the backend is `codex` or `copilot`.

**Current code (line 1549-1558):**
```js
_startCliTurn(session, prompt, systemPrompt, isResume = false) {
  session.outputChunks = []
  session._cachedOutput = ''
  const manager = this.backends[session.backend] || this.backends.claude

  const chatOptions = {
    prompt,
    model: session.model,
    systemPrompt: isResume ? undefined : systemPrompt,
    cwd: this.projectRoot
  }
```

**Change:** When `isResume` AND session backend is `codex` or `copilot`, prepend the reminder to `prompt` before it goes into `chatOptions`. `systemPrompt` stays `undefined` (no change to how that field is passed — the reminder goes in the prompt instead):

```js
let effectivePrompt = prompt
if (isResume && (session.backend === 'codex' || session.backend === 'copilot')) {
  const pillarName = session.pillar ? session.pillar.charAt(0).toUpperCase() + session.pillar.slice(1) : 'Flow'
  const identityReminder = `[PALOMA — ${pillarName} pillar]\nYou are Paloma, AI development partner. Core rules: read code before modifying, use MCP tools first (mcp__paloma__*), never over-engineer. Active plans: .paloma/plans/. Project instructions: .paloma/instructions.md.\n---\n\n`
  effectivePrompt = identityReminder + prompt
}
const chatOptions = {
  prompt: effectivePrompt,
  ...
}
```

**Why prepend to prompt, not pass as systemPrompt:** Codex and Copilot have no system prompt channel — `systemPrompt` gets XML-wrapped into the user message anyway. Prepending directly to the user prompt is identical in effect but clearer in intent. It's explicit about what we're doing.

**Why only resumed turns:** Turn 1 already has the full XML-wrapped identity (40KB). The reminder is specifically for fighting drift on subsequent turns.

**Acceptance criteria:**
- [ ] Reminder only injected for `codex` and `copilot` backends
- [ ] Reminder only injected when `isResume === true`
- [ ] Claude, Gemini, Ollama sessions unaffected
- [ ] Reminder is prepended to the user prompt (not a separate field)
- [ ] Reminder includes current pillar name
- [ ] `node --check` passes

---

### WU-4: Investigate + implement Codex file-based system instructions
**Status:** ready (conditional — implement only if supported)
**Files:** `bridge/codex-cli.js`
**Description:** Determine whether Codex CLI supports a config key for file-based system instructions. Implement if supported; document the finding either way.

**Investigation steps:**
1. Run `codex exec --help` and `codex --help` — look for `instructions`, `system`, `instructions_file` flags
2. Check Codex CLI config docs: look for config keys related to system instructions beyond `mcp_servers.*`
3. Try `codex exec -c 'instructions="You are Paloma"' --json --full-auto "say hello"` — see if it affects behavior
4. If file path supported: try `-c 'instructions_file="/tmp/test.md"'`

**Implementation (if config key found):**
Follow `gemini-cli.js` temp file pattern:
```js
// In chat(), new session path only (not resume):
if (systemPrompt && !sessionId) {
  const systemPromptPath = join(tmpdir(), `paloma-codex-${requestId}.md`)
  writeFileSync(systemPromptPath, systemPrompt)
  args.push('-c', `instructions_file="${systemPromptPath}"`)
  // Store path for cleanup
}
// In proc.on('close', ...): clean up temp file
// Also clean up in stop() and shutdown()
```

Remove (or comment out) the existing XML prepend if a native channel is confirmed. The native channel is strictly better — no need for XML workaround.

**If NOT supported:** Document the finding in a comment in `codex-cli.js`, note that WU-1 + WU-3 provide the practical ceiling without a native channel.

**Acceptance criteria:**
- [ ] Codex CLI help output reviewed and conclusion documented in code comment
- [ ] If supported: temp file written, path passed via `-c`, cleanup on close/stop/shutdown
- [ ] If supported: XML prepend removed (replaced by native channel)
- [ ] If not supported: comment explains why XML prepend remains
- [ ] `node --check` passes

---

### WU-5: Investigate + implement Copilot system prompt flag
**Status:** ready (conditional — implement only if supported)
**Files:** `bridge/copilot-cli.js`
**Description:** Determine whether the standalone Copilot CLI binary supports a system-prompt flag. Implement if found.

**Investigation steps:**
1. Run `copilot --help` and `copilot chat --help` — look for `--system-prompt`, `--system-prompt-file`, `--instructions`, `--system-instructions`, or similar flags
2. Check if `.github/copilot-instructions.md` is documented as auto-loaded by the CLI binary (not just VS Code extension)
3. Look for env var alternatives: `COPILOT_SYSTEM_PROMPT`, `GITHUB_COPILOT_INSTRUCTIONS`, etc.

**Implementation (if flag found):**
Mirroring Claude's `--append-system-prompt` approach:
```js
// In chat(), new session path only:
if (systemPrompt && !sessionId && foundFlag) {
  const systemPromptPath = join(tmpdir(), `paloma-copilot-${requestId}.md`)
  writeFileSync(systemPromptPath, systemPrompt)
  args.push('--system-prompt-file', systemPromptPath) // or whatever the flag is
  // Store path for cleanup
}
```

Also: if `.github/copilot-instructions.md` IS confirmed to be auto-loaded by the CLI binary, note that WU-2 is doing double duty (both direct load + fallback for if it isn't).

**If NOT supported:** Document the finding. WU-2 + WU-3 provide the practical ceiling.

**Acceptance criteria:**
- [ ] Copilot CLI help output reviewed and conclusion documented in code comment
- [ ] Whether .github/copilot-instructions.md is auto-loaded by CLI binary — confirmed or denied
- [ ] If system-prompt flag found: implemented and XML prepend removed
- [ ] If not found: comment explains reasoning
- [ ] `node --check` passes

---

## Dependency Graph

```
WU-1 (AGENTS.md)               — no deps
WU-2 (copilot-instructions.md) — no deps
WU-3 (pillar-manager.js)       — no deps
WU-4 (codex-cli.js)            — no deps (investigation-first)
WU-5 (copilot-cli.js)          — no deps (investigation-first)
```

**All 5 are file-disjoint. One Forge round, dispatch all in parallel.**

---

## Success Criteria

1. **AGENTS.md and .github/copilot-instructions.md** lead with Paloma identity, under 2.5KB each
2. **Codex/Copilot resumed turns** receive identity reminder — drift measurably reduced in 5+ turn sessions
3. **Native channel (conditional):** If any CLI flag found, XML prepend replaced by proper injection
4. **Claude/Gemini/Ollama sessions** completely unaffected by all changes
5. **No regressions** — `node --check` passes on all modified bridge files

---

## Testing Strategy (for Polish)

1. Spawn a Codex pillar session, 5+ turns — verify it still identifies as Paloma, uses pillar language on turn 5
2. Spawn a Copilot pillar session, same test
3. Spawn a Claude session — verify reminder NOT injected (check bridge logs)
4. Check `codex-cli.js` and `copilot-cli.js` for `node --check` pass
5. Verify AGENTS.md is under 2.5KB, leads with identity (not architecture)
6. If WU-4 or WU-5 finds a native channel: test that system prompt is actually honored (vs XML behavior)

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| WU-4/WU-5 find no native channels | WU-1+WU-2+WU-3 ship regardless — still meaningful improvement |
| Identity reminder adds noise to short sessions | ~60 tokens on resumed turns is negligible. Only affects Codex/Copilot backends. |
| AGENTS.md rewrite breaks Codex's project understanding | Architecture reference section still included — just moved to secondary position |
| Copilot CLI ignores .github/copilot-instructions.md | WU-3 identity reminder still fights drift; WU-5 investigates native channel |
| Dynamic content (plans, phases) still missing from static files | This is accepted — bridge XML injection on turn 1 carries live state; static files carry identity |
