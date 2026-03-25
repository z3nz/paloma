# Scout Findings: Codex Readiness in Paloma

**Date:** 2026-03-25  
**Scope:** Deep dive into how Codex is wired into Paloma on this machine, what was actually running, and what needed tightening before relying on Codex-backed sessions in Paloma.

---

## Files Read

- `AGENTS.md`
- `README.md`
- `.paloma/instructions.md`
- `.paloma/machine-profile.json`
- `bridge/codex-cli.js`
- `bridge/pillar-manager.js`
- `bridge/backend-health.js`
- `bridge/mcp-proxy-server.js`
- `bridge/index.js`
- `src/prompts/base.js`
- `src/prompts/phases.js`
- `src/services/claudeStream.js`
- `src/composables/useCliChat.js`

---

## What the Codebase Was Already Doing Correctly

- Codex is a first-class backend in the bridge: `bridge/index.js` exposes `codex_chat`, `bridge/pillar-manager.js` can spawn Codex-backed pillars, and `bridge/mcp-proxy-server.js` exposes the Paloma MCP surface over Streamable HTTP at `/mcp`.
- Codex identity on turn 1 was already stronger than older XML injection. `bridge/codex-cli.js` uses ChatML framing for the initial system prompt because Codex exec mode has no real system-prompt flag.
- Codex thread IDs are captured from `thread.started`, then reused for multi-turn resume paths through `codex exec resume {threadId}`.
- The machine profile on this Mac (`.paloma/machine-profile.json`) shows all five backends available, including Codex.

---

## Gaps Found

### 1. Resumed Codex sessions were losing MCP tools

`bridge/codex-cli.js` only injected `-c mcp_servers.paloma.url=...` on brand-new Codex sessions. Resumed sessions used `codex exec resume ...` without reattaching the MCP proxy.

Impact:
- Turn 1 had Paloma tools.
- Later turns could silently lose bridge-delivered MCP tools even though the Codex thread itself resumed correctly.

### 2. Codex MCP tool activity was not normalized for the UI

Codex emitted `mcp_tool_call` items, but the rest of the app mostly understands the normalized `tool_use` / `tool_result` event pair.

Impact:
- Direct Codex chats did not surface MCP tool activity cleanly.
- Codex felt weaker than Claude/Copilot/Gemini in the UI even when tools worked.

### 3. Direct Codex/Copilot chats had no resumed-turn identity reminder

`bridge/pillar-manager.js` already prepended a short identity reminder for resumed Codex/Copilot pillar sessions, but direct CLI chats in `src/composables/useCliChat.js` did not.

Impact:
- Long-running direct Codex/Copilot chats were more likely to drift away from Paloma identity and phase behavior.

### 4. Copilot health detection still had a blind spot

`bridge/backend-health.js` checked Copilot config and token env vars, but not `gh auth token`, even though `bridge/copilot-cli.js` warms GitHub auth that way.

Impact:
- On machines where Copilot works via GitHub CLI auth but not via env vars, startup health could mark Copilot unavailable incorrectly.

### 5. Codex-facing instructions had drifted from runtime reality

`AGENTS.md` still described a different fallback chain and a different default backend story than the live bridge code.

Impact:
- Codex sessions were loading contradictory backend guidance directly from the repo instructions.

---

## Changes Shipped on 2026-03-25

### Runtime fixes

- `bridge/codex-cli.js`
  - Re-injects the Paloma MCP proxy config on **every** Codex invocation, including `exec resume`.
  - Normalizes Codex `mcp_tool_call` items into `tool_use` and `tool_result` events.

- `src/services/claudeStream.js`
  - `streamCodexChat()` now forwards normalized `tool_use` / `tool_result` events so direct Codex chats can show activity.

- `src/composables/useCliChat.js`
  - Adds the same condensed identity reminder on resumed direct Codex/Copilot turns that pillar sessions already used.

- `bridge/backend-health.js`
  - Adds `gh auth token` fallback probing when checking Copilot availability.

### Instruction/doc alignment

- `AGENTS.md`
  - Replaced stale backend-routing guidance with machine-profile-driven routing text.
  - Updated fallback chain to match live code: `claude → copilot → gemini → codex → ollama`.

- `src/prompts/base.js`
  - Synced backend-selection text with actual machine-profile-driven routing and the live fallback chain.

- `README.md`
  - Updated top-level architecture/backends overview to include Copilot CLI and Gemini CLI.

---

## Verification Performed

- `node --check bridge/codex-cli.js`
- `node --check bridge/backend-health.js`
- `node --check src/services/claudeStream.js`
- `node --check src/composables/useCliChat.js`
- `codex exec --help`
- `codex exec resume --help`

Observed during probing:
- `gh auth status` currently reports an invalid token for account `z3nz` on this machine.
- That means Copilot fallback through GitHub CLI auth is not currently healthy here unless Copilot's own stored auth/config still succeeds.

---

## Remaining Risks

- I did **not** run a full live `codex exec` conversation through the bridge in this pass, so the resume+MCP fix was validated structurally and by CLI help output, not by an end-to-end model turn.
- Copilot auth on this specific machine still deserves attention because `gh auth status` is failing. The bridge fix makes detection better, but it cannot invent valid auth.
- There is still broader documentation drift in older deep-reference docs such as `.paloma/docs/architecture-reference.md`; the runtime-critical Codex-facing surfaces were updated first.

---

## Bottom Line

Codex was already integrated deeply into Paloma, but it had a real resumed-session weakness and a visibility gap that made it feel less capable than it actually was. Those have now been tightened up. The main remaining operational concern on this machine is Copilot auth health, not Codex wiring.
