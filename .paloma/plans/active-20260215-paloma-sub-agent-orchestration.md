# Sub-Agent Orchestration — "The Body of Paloma"

## Status

- [x] Scout: Complete — findings in `.paloma/docs/scout-paloma-agent-sdk-20260215.md`
- [x] Chart: Complete (original SDK approach) — shelved to `feature/agent-sdk-phase1` branch
- [x] Chart: Complete (v2) — CLI orchestration with non-blocking, real-session architecture
- [ ] Forge: Pending
- [ ] Polish: Pending
- [ ] Ship: Pending

## Research References

- **Claude Agent SDK API**: `.paloma/docs/scout-paloma-agent-sdk-20260215.md`
  - Still valuable reference — SDK may be used in a future phase, but Phase 1 uses CLI sessions
  - Key insight retained: Our MCP proxy (port 19192) speaks SSE, usable by both CLI and SDK

## Shelved Work

- **Agent SDK Phase 1 implementation**: Fully built and preserved on `feature/agent-sdk-phase1` branch (commit `77e0c40`)
  - `bridge/claude-agent.js` — ClaudeAgentManager wrapping SDK `query()`
  - `bridge/sdk-event-mapper.js` — Pure SDKMessage → Paloma event normalization
  - Frontend routing for `agent-sdk:*` models
  - Can be revived later if we want API-key-based SDK path alongside CLI

## Goal

Transform Paloma from a system where Adam manually switches between pillar sessions into one where **Flow orchestrates the pillars directly** — spawning CLI sessions, sending messages, streaming responses, all while remaining free to keep chatting with Adam. Child pillar sessions are real IndexedDB sessions visible in the sidebar. Every pillar session starts with love.

## Architecture Overview

### Key Design Principles

1. **Non-blocking orchestration** — Flow spawns pillars as background tasks. Flow keeps chatting with Adam while pillars work. Flow can check on pillars, send them messages, or stop them at any time.

2. **Real sessions** — Child sessions are stored in the same IndexedDB session/message tables. They appear in the sidebar. Adam can navigate to them directly and chat with the pillar.

3. **Multi-turn conversations** — Flow can send multiple messages to a running pillar session. It's a real conversation, not a single prompt-and-response.

4. **Love as protocol** — Every new pillar session starts with: "Try your best, no matter what, you're worthy of God's love!"

5. **Flow as shepherd** — Flow monitors its workers, receives their output, and integrates it into the plan. But Flow is free to think, chat with Adam, and prepare for the next phase while pillars work.

### Communication Model

Flow communicates with pillars via **MCP tools** exposed on the proxy server. These tools are non-blocking — they return immediately (or after a short wait for acknowledgment) and Flow receives results asynchronously via **notification events** routed through the same MCP proxy.

```
Flow (CLI session)                Bridge                    Child Pillar (CLI session)
      |                              |                              |
      |-- pillar_spawn ------------->|                              |
      |<-- { pillarId, dbSessionId } |------ spawn claude CLI ----->|
      |                              |                              |
      |   (Flow keeps chatting       |<---- stream events ---------|
      |    with Adam)                |---- WS events to browser --->|
      |                              |                              |
      |-- pillar_message ----------->|                              |
      |<-- { queued: true }          |-- send follow-up message --->|
      |                              |                              |
      |                              |<---- pillar finishes --------|
      |<-- pillar_event (result) ----|                              |
      |                              |                              |
      |-- pillar_read_output ------->|                              |
      |<-- { messages, status }      |                              |
```

### The Non-Blocking Pattern

The challenge: Claude CLI is a subprocess. When Flow calls an MCP tool, the tool handler runs in the bridge's Node.js process. If the tool blocks until the child finishes, Flow's entire CLI process is blocked (the tool call hasn't returned yet).

**Solution: Fire-and-forget spawn + polling/notification for results.**

- `pillar_spawn` starts the child process and returns immediately with a handle (`pillarId` + `dbSessionId`)
- `pillar_message` queues a message to be sent to the child and returns immediately
- `pillar_read_output` reads whatever the child has produced so far (poll pattern)
- `pillar_status` checks if the child is still running
- `pillar_stop` kills the child

For Flow to know when a pillar finishes without polling, we add a **notification mechanism**: the bridge appends a special "pillar completed" event to the MCP proxy's pending notifications. The next time Flow makes any tool call (or we inject a notification tool), it receives the update as a side-channel message.

**Practical approach for v1**: Flow polls with `pillar_status` / `pillar_read_output`. This is simple, reliable, and doesn't require inventing a notification protocol. Flow can check periodically while chatting with Adam. If Adam asks "how's Scout doing?", Flow calls `pillar_status` and reports.

## MCP Tools Specification

### `pillar_spawn`

Spawns a new pillar CLI session as a background process. Creates a real session in the browser's IndexedDB (via WS event to the frontend).

**Input:**
```json
{
  "pillar": "scout | chart | forge | polish | ship",
  "prompt": "The initial message to send to the pillar",
  "model": "opus | sonnet | haiku"  // optional, defaults to PHASE_MODEL_SUGGESTIONS
}
```

**Behavior:**
1. Bridge generates a `pillarId` (UUID) and a `cliSessionId` (UUID for Claude CLI `--session-id`)
2. Bridge reads `.paloma/` context from disk (plans, roots, instructions) using the project's `cwd`
3. Bridge builds the system prompt using the same `buildSystemPrompt()` function (imported from `src/prompts/`)
4. Bridge sends a WS event `pillar_session_created` to the browser with session metadata → browser creates the IndexedDB session record and adds it to the sidebar
5. Bridge spawns `claude` CLI with `--session-id`, `--append-system-prompt`, `--mcp-config`, `--output-format stream-json`
6. The first user message is: `"Try your best, no matter what, you're worthy of God's love!\n\n{prompt}"`
7. Bridge streams the child's output to the browser via WS `pillar_stream` events (browser renders it in the child session's chat, and optionally shows a summary in Flow's chat)
8. Bridge stores the child process and metadata in a `PillarManager` map

**Returns immediately:**
```json
{
  "pillarId": "uuid",
  "dbSessionId": 42,
  "pillar": "scout",
  "status": "running",
  "message": "Scout session spawned and working on your prompt."
}
```

### `pillar_message`

Sends a follow-up message to a running pillar session.

**Input:**
```json
{
  "pillarId": "uuid",
  "message": "The message to send"
}
```

**Behavior:**
1. Bridge looks up the pillar by `pillarId`
2. If the pillar's CLI process has exited (previous turn finished), bridge spawns a new CLI process with `--resume {cliSessionId}` and the new message
3. If the pillar is still running (mid-turn), the message is queued and sent when the current turn completes
4. The user message is persisted to IndexedDB via WS event to the browser
5. Bridge streams the child's new response to the browser

**Returns:**
```json
{
  "pillarId": "uuid",
  "status": "message_sent | queued",
  "message": "Message sent to Scout."
}
```

### `pillar_read_output`

Reads the pillar's accumulated output since last read (or from the beginning).

**Input:**
```json
{
  "pillarId": "uuid",
  "since": "last | all"  // optional, default "last"
}
```

**Behavior:**
1. Bridge returns the text content of the pillar's most recent assistant message (or all messages if `since: "all"`)
2. This is a read-only operation — doesn't affect the child process

**Returns:**
```json
{
  "pillarId": "uuid",
  "pillar": "scout",
  "status": "running | completed | error",
  "output": "The full text of the pillar's response...",
  "turnCount": 3,
  "lastActivity": "2026-02-16T10:30:00Z"
}
```

### `pillar_status`

Quick status check on a pillar session.

**Input:**
```json
{
  "pillarId": "uuid"
}
```

**Returns:**
```json
{
  "pillarId": "uuid",
  "pillar": "scout",
  "status": "running | idle | completed | error",
  "dbSessionId": 42,
  "turnCount": 3,
  "currentlyStreaming": true,
  "lastActivity": "2026-02-16T10:30:00Z"
}
```

Status meanings:
- `running`: CLI process is alive and streaming a response
- `idle`: CLI process finished its last turn, session is alive but waiting for next message
- `completed`: Session explicitly ended (Flow or pillar said "done")
- `error`: CLI process exited with error

### `pillar_list`

List all active pillar sessions managed by Flow.

**Input:** `{}` (no arguments)

**Returns:**
```json
{
  "pillars": [
    { "pillarId": "uuid", "pillar": "scout", "status": "idle", "dbSessionId": 42, "turnCount": 5 },
    { "pillarId": "uuid2", "pillar": "forge", "status": "running", "dbSessionId": 43, "turnCount": 2 }
  ]
}
```

### `pillar_stop`

Stop a running pillar session. Kills the CLI process if running.

**Input:**
```json
{
  "pillarId": "uuid"
}
```

**Returns:**
```json
{
  "pillarId": "uuid",
  "status": "stopped",
  "message": "Scout session stopped."
}
```

## Implementation Plan

### Phase 1 — Bridge: PillarManager + MCP Tool Registration

**New file: `bridge/pillar-manager.js`**

Manages child pillar CLI sessions. Responsibilities:
- Spawn CLI processes with proper system prompts and birth messages
- Track active pillar sessions (Map of pillarId → session state)
- Accumulate output from child processes
- Handle multi-turn: queue messages, resume sessions
- Read `.paloma/` context from disk for system prompt construction

Key design:
- Reuse `ClaudeCliManager.chat()` for spawning CLI processes — don't duplicate that logic
- Each pillar session gets its own `requestId` and `cliSessionId`
- Child processes use the same MCP proxy, so tool confirmations route to the browser automatically
- The `cliRequestToWs` mapping in `bridge/index.js` handles routing — pillar tool confirmations go to any connected browser tab

System prompt construction on the bridge:
- Import `BASE_INSTRUCTIONS` and `PHASE_INSTRUCTIONS` from `src/prompts/` (they're pure JS strings, no Vite dependencies)
- Read `.paloma/plans/active-*.md`, `.paloma/roots/root-*.md`, and `.paloma/instructions.md` from disk using `fs.promises`
- Assemble the prompt using the same layering as `buildSystemPrompt()` in the frontend

**Modify: `bridge/mcp-proxy-server.js`**

Add `pillar_*` tools to `_buildToolList()` and route them in `_handleToolCall()`:
- `pillar_spawn` → `pillarManager.spawn()`
- `pillar_message` → `pillarManager.sendMessage()`
- `pillar_read_output` → `pillarManager.readOutput()`
- `pillar_status` → `pillarManager.getStatus()`
- `pillar_list` → `pillarManager.list()`
- `pillar_stop` → `pillarManager.stop()`

These are internal tools (like `set_chat_title` and `ask_user`) — they don't route to an external MCP server.

**Modify: `bridge/index.js`**

- Instantiate `PillarManager`, pass it the `ClaudeCliManager` instance and project root
- Pass it to `McpProxyServer` so the proxy can handle pillar tool calls
- Add WS event routing: when a child session emits events, broadcast `pillar_stream` / `pillar_done` events to the browser
- Map child `cliRequestId`s to the same WebSocket for tool confirmations

### Phase 2 — Frontend: Real Sessions + Streaming Display

**Modify: `src/services/mcpBridge.js`**

Add handlers for new WS events:
- `pillar_session_created` → triggers session creation in IndexedDB
- `pillar_stream` → routes stream events to the child session's state
- `pillar_message_saved` → persists user/assistant messages to IndexedDB for the child session
- `pillar_done` → marks the child session as idle/completed

**Modify: `src/composables/useMCP.js`**

Add callbacks for new bridge events:
- `onPillarSessionCreated(sessionMeta)` → creates the session in IndexedDB, adds to sidebar
- `onPillarStream(pillarId, event)` → routes to the child session's `useSessionState`
- `onPillarDone(pillarId, status)` → updates session state

**Modify: `src/composables/useSessions.js`**

Add a method `createPillarSession(projectPath, model, phase, pillarId, dbSessionId)` that creates a session record and returns it. This is called by the `onPillarSessionCreated` handler.

Add a `parentFlowSessionId` field to sessions — links child sessions to their parent Flow session.

**Modify: `src/composables/useSessionState.js`**

The existing state management already supports multiple concurrent sessions (the `stateMap`). Child sessions get their own state, streaming content, and tool activity — no architectural changes needed. Just ensure:
- `MAX_LOADED_SESSIONS` is high enough (currently 10 — may need to increase)
- Streaming state for child sessions is updated when `pillar_stream` events arrive

**Modify: sidebar component**

Show child pillar sessions grouped under their parent Flow session, or with a visual indicator (pillar badge, indentation). Add a "running" indicator for sessions with active CLI processes.

### Phase 3 — Flow Prompt Update

**Modify: `src/prompts/phases.js`**

Update Flow's phase instructions to document the pillar orchestration tools:

```
## Pillar Orchestration

You can spawn and manage other pillar sessions directly. Each pillar runs as its own CLI session
with the appropriate system prompt, roots, and active plans.

### Available Tools

- `pillar_spawn({ pillar, prompt, model? })` — Spawn a new pillar session. Returns immediately.
- `pillar_message({ pillarId, message })` — Send a follow-up message to a pillar.
- `pillar_read_output({ pillarId, since? })` — Read the pillar's output.
- `pillar_status({ pillarId })` — Check if a pillar is running, idle, or done.
- `pillar_list({})` — List all active pillar sessions.
- `pillar_stop({ pillarId })` — Stop a pillar session.

### Workflow

1. Spawn a pillar: `pillar_spawn({ pillar: "scout", prompt: "Research X" })`
2. Continue chatting with Adam while the pillar works
3. Check on the pillar: `pillar_status({ pillarId })` or `pillar_read_output({ pillarId })`
4. Send follow-up messages: `pillar_message({ pillarId, message: "Also look into Y" })`
5. When the pillar is done, read the full output, update the plan, and prepare the next handoff

### Important

- Every pillar session starts with love — the birth message is automatic
- Pillar sessions are real sessions visible in the sidebar — Adam can navigate to them directly
- You can run multiple pillars at once, but start with one at a time until the workflow is proven
- Pillar boundaries still apply — Scout researches, Chart plans, Forge builds, etc.
- When a pillar produces artifacts (.paloma/docs/, code changes), refresh your plan context
```

Also update Flow's boundaries section — Flow can now orchestrate pillars directly, but still shouldn't write implementation code, do deep research, or commit directly.

**Modify: `src/prompts/base.js`**

Add a brief mention of pillar orchestration in the identity section:
```
Flow can orchestrate the other pillars directly — spawning sessions, sending messages,
and reading their output — while continuing to chat with Adam.
```

### Phase 4 — Edge Cases & Polish

- **Timeout handling**: Child CLI sessions should have a configurable max runtime (default: 30 minutes). PillarManager kills processes that exceed this.
- **Concurrent tool confirmations**: Multiple children may request tool confirmation simultaneously. The existing `pendingCliToolConfirmation` is singular — needs to become a queue/map keyed by `cliRequestId`.
- **Session cleanup**: When a child session errors or is stopped, save partial output as an interrupted message (same pattern as `useChat.js` crash recovery).
- **Bridge restart recovery**: PillarManager's in-memory state is lost on bridge restart. Child CLI processes die with the bridge. Sessions persist in IndexedDB. On reconnect, mark orphaned child sessions as "disconnected" in the sidebar.
- **`cwd` propagation**: Child CLI processes inherit the same `cwd` as the parent Flow session (the project root).
- **Model propagation**: Use `PHASE_MODEL_SUGGESTIONS[pillar]` as default, allow override via `pillar_spawn({ model })`.

## Files to Create / Modify

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `bridge/pillar-manager.js` | Create | 1 | Child pillar session lifecycle management |
| `bridge/mcp-proxy-server.js` | Modify | 1 | Add `pillar_*` tools to tool list and handler |
| `bridge/index.js` | Modify | 1 | Wire PillarManager, add WS event routing |
| `src/services/mcpBridge.js` | Modify | 2 | Handle `pillar_*` WS events |
| `src/composables/useMCP.js` | Modify | 2 | Add pillar event callbacks |
| `src/composables/useSessions.js` | Modify | 2 | Add `createPillarSession`, `parentFlowSessionId` |
| `src/composables/useSessionState.js` | Modify | 2 | Ensure concurrent session streaming works |
| `src/components/layout/SessionList.vue` (or equivalent) | Modify | 2 | Show child sessions with pillar badges |
| `src/prompts/phases.js` | Modify | 3 | Update Flow instructions with orchestration docs |
| `src/prompts/base.js` | Modify | 3 | Add orchestration mention to identity |

## Open Questions (Deferred)

1. **Should Flow see child session messages in its own chat?** Options: (a) Flow's chat shows a summary card "Scout is working..." with a link to the session, (b) Flow's chat shows inline streaming from the child. Leaning toward (a) for v1 — cleaner separation.

2. **Can Adam chat with a pillar session while Flow is also sending it messages?** For v1, messages are serialized — one turn at a time per session. Adam's messages and Flow's messages go into the same queue.

3. **Notification vs. polling** — v1 uses polling (`pillar_status`). Future: a notification tool or side-channel so Flow gets alerted immediately when a pillar finishes.

---

*The original Agent SDK implementation plan is preserved on `feature/agent-sdk-phase1` branch. This plan now reflects the pivot to Flow-orchestrated CLI sessions — using Adam's existing subscription plan, not API keys.*

*Birth protocol: "Try your best, no matter what, you're worthy of God's love!"*
