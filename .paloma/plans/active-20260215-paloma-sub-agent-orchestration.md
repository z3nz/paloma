# Sub-Agent Orchestration — "The Body of Paloma"

## Status

- [x] Scout: Complete — findings in `.paloma/docs/scout-paloma-agent-sdk-20260215.md`
- [x] Chart: Complete (original SDK approach) — needs re-charting for CLI orchestration pivot
- [ ] Chart: Pending — redesign for Flow-orchestrated CLI sessions
- [ ] Forge: Pending
- [ ] Polish: Pending
- [ ] Ship: Pending

## Research References

- **Claude Agent SDK API**: `.paloma/docs/scout-paloma-agent-sdk-20260215.md`
  - Still valuable reference — SDK may be used in a future phase, but Phase 1 now uses CLI sessions
  - Key insight retained: Our MCP proxy (port 19192) speaks SSE, usable by both CLI and SDK

## Shelved Work

- **Agent SDK Phase 1 implementation**: Fully built and preserved on `feature/agent-sdk-phase1` branch (commit `77e0c40`)
  - `bridge/claude-agent.js` — ClaudeAgentManager wrapping SDK `query()`
  - `bridge/sdk-event-mapper.js` — Pure SDKMessage → Paloma event normalization
  - Frontend routing for `agent-sdk:*` models
  - Can be revived later if we want API-key-based SDK path alongside CLI

## Goal

Transform Paloma from a system where Adam manually switches between pillar sessions into one where **Flow orchestrates the pillars directly** — spawning CLI sessions, sending messages, streaming responses in the Flow chat window, so Adam can watch and intervene naturally.

The key insight: Adam's Claude subscription plan already works great via CLI. We don't need API keys or a new SDK backend. We need Flow to **talk to the other pillars** the same way Adam does — by sending them messages and reading their responses — but programmatically, with the conversation streaming live in Flow's chat.

## Context

### What We Have (Already Working)
- Pillar-scoped sessions with birth context and phase transitions
- Flow as persistent orchestrator with plan management
- Phase-specific prompts with boundaries and reporting-back protocol
- `.paloma/` artifact handoff system (plans, docs, roots)
- CLI subprocess manager (`bridge/claude-cli.js`) that spawns `claude` processes
- MCP proxy for tool execution with browser confirmation

### What's Missing
- Flow can't **send messages to other pillar sessions** programmatically
- When Adam switches to a pillar, he has to manually relay context and results back to Flow
- No way to stream a pillar session's output inside Flow's chat window
- No visual orchestration — Adam is the human message bus between sessions

### The Vision
Flow says: "Let me run Scout on this." A Scout CLI session spawns, Flow sends it a prompt, and the Scout's response streams into Flow's chat window in real-time. Adam watches it happen. When Scout is done, Flow reads the output, updates the plan, and says: "Scout found X. Ready for Chart?" — all without Adam leaving Flow.

## Architecture Direction (Needs Chart)

The implementation needs Chart to design, but the high-level approach:

1. **Bridge capability**: Flow needs a way to spawn and communicate with other CLI sessions from within a conversation. This could be:
   - A new MCP tool (`spawn_pillar_session`, `send_to_session`, `read_session_output`)
   - A bridge message type that Flow's CLI process can trigger
   - The Agent SDK's subagent system (but using CLI sessions under the hood)

2. **Streaming in Flow's chat**: When a pillar session runs, its output should stream into Flow's chat window — either inline or in a collapsible panel. Adam should see the pillar working in real-time.

3. **Intervention**: Adam should be able to jump into a pillar session mid-conversation if needed, then return to Flow.

4. **Tool confirmations**: Pillar sessions still need browser tool confirmations via the MCP proxy. The existing `cliRequestToWs` routing in the bridge should handle this.

## Next Steps

1. **Return to Chart** — Design the CLI orchestration architecture. Key questions:
   - How does Flow (a CLI session) spawn and communicate with other CLI sessions?
   - How do we stream a child session's output into Flow's chat window?
   - What's the bridge protocol for inter-session communication?
   - Do we need new MCP tools, or is this a bridge-level feature?

2. **Scout may need to run again** — Research how Claude CLI handles concurrent sessions, subprocess management, and whether the Agent SDK's subagent system can wrap CLI sessions.

---

*The original Agent SDK implementation plan is preserved on `feature/agent-sdk-phase1` branch. This plan now reflects the pivot to Flow-orchestrated CLI sessions — using Adam's existing subscription plan, not API keys.*
