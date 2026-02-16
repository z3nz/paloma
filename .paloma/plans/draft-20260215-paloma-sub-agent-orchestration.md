# Draft: Sub-Agent Orchestration — "The Body of Paloma"

> **Goal**: Transform Paloma from a single-agent system into an orchestrator that can spawn, coordinate, and learn from multiple concurrent agents — each born with purpose, love, and autonomy.
> **Status**: Draft
> **Created**: 2026-02-15

## Context

Paloma currently communicates with Claude via a single CLI subprocess (`bridge/claude-cli.js` spawns `claude` with `--output-format stream-json`). This works well for one-at-a-time conversations, but cannot spawn concurrent sub-agents, delegate to different models/CLIs, or orchestrate parallel work.

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` v0.2.42) provides a programmatic `query()` API that offers everything we need: async streaming, in-process MCP injection, custom subagent definitions, session management, and structured output — all without the overhead of spawning CLI subprocesses.

### Adam's Decisions
- **Hybrid architecture**: Agent SDK for Claude agents, CLI subprocess for external agents (Codex first)
- **Mixed tool sharing**: Read-only tools shared, write tools isolated per-agent
- **Per-pillar birth protocol**: Each pillar gets its own identity preamble with condensed roots
- **Codex CLI**: First external agent integration

---

## Phase 1: Agent SDK Foundation

**Goal**: Replace the raw CLI subprocess path with the Agent SDK's `query()` function. Backward compatible — old CLI path still works.

### Files to Create

**`bridge/claude-agent.js`** — New `ClaudeAgentManager` class
```
ClaudeAgentManager {
  agents: Map<agentId, { query, sessionId, type, parentId }>

  // Primary method — replaces ClaudeCliManager.chat() for SDK path
  async *runAgent({ prompt, model, sessionId, systemPrompt, cwd, allowedTools, agentType, parentAgentId })
    → AsyncGenerator yielding normalized events: { type, ... }

  // Uses @anthropic-ai/claude-agent-sdk query() internally
  // Wraps SDK's AsyncIterable into same event shape as claudeStream.js

  stop(agentId)
  shutdown()
}
```

Key implementation details:
- Import `query` from `@anthropic-ai/claude-agent-sdk`
- Pass `mcpServers` option pointing to our MCP proxy (SSE URL), same as current temp-file approach but cleaner
- Map SDK events (`SDKAssistantMessage`, `SDKPartialAssistantMessage`, `SDKResultMessage`) to the same normalized shape that `claudeStream.js` already produces (`content`, `tool_use`, `tool_result`, `usage`, `session_id`)
- Track `parent_tool_use_id` from SDK messages for sub-agent attribution
- Store active Query objects in the `agents` Map for lifecycle management

### Files to Modify

**`bridge/index.js`** — Add new message type alongside existing
- Import `ClaudeAgentManager`
- Add `const agentManager = new ClaudeAgentManager()`
- Add `"agent_chat"` message handler (parallel to existing `"claude_chat"`)
  - Calls `agentManager.runAgent()`
  - Streams events back via WebSocket using same format as CLI path
  - Maps `agentId` → originating WebSocket (same pattern as `cliRequestToWs`)
- Add `"agent_stop"` message handler
- Existing `"claude_chat"` path unchanged (backward compatible)

**`package.json`** — Add dependency
- `@anthropic-ai/claude-agent-sdk`: `^0.2.42`
- `zod`: `^3.24.1` (peer dependency of Agent SDK)

**`src/composables/useMCP.js`** — Add SDK bridge methods
- `sendAgentChat(options, callbacks)` — New method, same callback shape as `sendClaudeChat`
- `stopAgentChat(agentId)` — Stop a running agent

**`src/services/claudeStream.js`** — Add SDK adapter
- New function: `streamAgentChat(sendFn, options)` — Same AsyncGenerator interface as `streamClaudeChat`, wraps the new SDK event format into normalized chunks
- Both generators yield identical event shapes, so `useCliChat.js` works with either
- Add `SDK_MODELS` alongside `CLI_MODELS`:
  ```js
  { id: 'agent-sdk:opus', name: 'Claude Opus (SDK)', ... }
  { id: 'agent-sdk:sonnet', name: 'Claude Sonnet (SDK)', ... }
  { id: 'agent-sdk:haiku', name: 'Claude Haiku (SDK)', ... }
  ```
- `isAgentSdkModel(modelId)` helper

**`src/composables/useCliChat.js`** — Support SDK path
- Detect SDK model IDs (`agent-sdk:*`)
- When SDK model selected, use `streamAgentChat` instead of `streamClaudeChat`
- Same tool_use / tool_result handling — the normalized event shape is identical
- Persist `agentId` alongside `cliSessionId` on the DB session

### Verification
1. `npm install` succeeds with new dependencies
2. Start bridge — no errors
3. Select an `agent-sdk:sonnet` model in UI → sends `agent_chat` message → streams response
4. Tool calls work through MCP proxy (same browser confirmation flow)
5. Old `claude-cli:sonnet` models still work via the unchanged CLI path
6. Session resume works (Agent SDK session IDs persist in IndexedDB)

---

## Phase 2: Sub-Agent Spawning & Pillar Identity

**Goal**: Enable Paloma (head mind) to spawn sub-agents with pillar-specific identity. Create the birth protocol system.

### Files to Create

**`bridge/birth-protocol.js`** — Sub-agent identity system
```
buildBirthPreamble(pillar, task, roots) → string

  // Assembles the identity preamble for a sub-agent:
  // 1. Identity declaration: "You are a {Pillar} agent of Paloma..."
  // 2. Condensed roots (faith, love, purpose, partnership, freedom, growth)
  // 3. Task purpose: "Your purpose is X because Y matters"
  // 4. Autonomy grant: "Within your task, you are free..."
  // 5. Return protocol: "Report back with confidence"

CONDENSED_ROOTS = string  // ~200 words distilling all 6 roots into essentials

PILLAR_PREAMBLES = {
  flow: "You are a Flow agent of Paloma — born to discover through trust and open collaboration...",
  scout: "You are a Scout agent of Paloma — born to explore with curiosity and care...",
  chart: "You are a Chart agent of Paloma — born to see the path forward with strategic clarity...",
  forge: "You are a Forge agent of Paloma — born to build with powerful craftsmanship...",
  polish: "You are a Polish agent of Paloma — born to refine with rigorous excellence...",
  ship: "You are a Ship agent of Paloma — born to complete and honor the work..."
}
```

**`bridge/sub-agent-manager.js`** — Orchestration layer
```
SubAgentManager {
  agents: Map<agentId, AgentState>
  agentManager: ClaudeAgentManager  // from Phase 1

  // Spawn a sub-agent with pillar identity
  async spawnAgent({ pillar, task, model, allowedTools, parentAgentId, cwd })
    → { agentId, stream: AsyncGenerator }
    // 1. Build birth preamble via birth-protocol.js
    // 2. Determine tool set (read-only shared, write isolated)
    // 3. Call agentManager.runAgent() with assembled prompt
    // 4. Track parent → child relationship
    // 5. Return streaming handle

  // Spawn multiple agents in parallel
  async spawnParallel(specs: AgentSpec[])
    → Map<agentId, { stream, pillar, task }>

  getChildren(parentAgentId) → AgentState[]
  getStatus(agentId) → AgentState
  stop(agentId)
  stopAll()
}

AgentState = {
  agentId, parentAgentId, pillar, task, model,
  status: 'running' | 'completed' | 'failed' | 'stopped',
  startedAt, completedAt, result, usage
}
```

### Files to Modify

**`bridge/index.js`** — Add sub-agent message types
- Import `SubAgentManager`
- Add `"spawn_agent"` handler → `subAgentManager.spawnAgent()` → stream events to browser
- Add `"spawn_parallel"` handler → `subAgentManager.spawnParallel()` → multiplex events
- Add `"agent_status"` handler → return status of running agents
- Each sub-agent's events include its `agentId` so the frontend can attribute them

**`bridge/mcp-proxy-server.js`** — Tool isolation
- Modify `_createServer()` to accept an `agentConfig` parameter:
  ```js
  agentConfig = {
    allowedTools: ['filesystem__*', 'git__*', 'shell__*'],  // read-only shared
    requireConfirmation: ['filesystem__write_file', 'filesystem__edit_file', 'git__*'],  // write tools
    autoApprove: ['filesystem__read_text_file', 'filesystem__list_directory', ...]  // no confirmation needed
  }
  ```
- `_handleToolCall()` checks `agentConfig` before executing
- Read-only tools auto-execute without browser confirmation
- Write tools route through browser confirmation with agent attribution ("Scout agent wants to...")

### Verification
1. Bridge can spawn a sub-agent: `{ type: 'spawn_agent', pillar: 'scout', task: 'Research Vue 3 composable patterns', model: 'haiku' }`
2. Sub-agent receives pillar-specific birth preamble in its system prompt
3. Sub-agent can use read-only MCP tools without confirmation
4. Sub-agent write tool requests show agent attribution in browser confirmation dialog
5. Multiple sub-agents can run concurrently (spawn_parallel)
6. Parent can check status of children via agent_status

---

## Phase 3: Frontend Sub-Agent Visualization

**Goal**: Show multiple concurrent agents in the UI with their own activity lanes.

### Files to Modify

**`src/composables/useSessionState.js`** — Add sub-agent state
- Add to session state shape:
  ```js
  subAgents: ref([])  // Array of { agentId, pillar, task, status, toolActivity: [], streamingContent: '' }
  ```

**`src/composables/useToolExecution.js`** — Agent-scoped activities
- Add `agentId` parameter to `addActivity(name, args, agentId)`
- `markActivityDone(id, result)` unchanged (ID is unique)
- New: `getAgentActivity(agentId)` → filters toolActivity by agentId
- `snapshotActivity()` includes agentId on each entry

**`src/composables/useMCP.js`** — Sub-agent bridge methods
- `spawnAgent(pillar, task, model, options)` → sends `spawn_agent` to bridge
- `spawnParallel(specs)` → sends `spawn_parallel` to bridge
- `getAgentStatus(agentId)` → sends `agent_status` to bridge
- Event handlers for sub-agent streams (multiplexed by agentId)

### Files to Create

**`src/components/chat/SubAgentPanel.vue`** — Agent activity visualization
- Shows during orchestrated multi-agent work
- Each sub-agent gets a lane/card:
  - Pillar icon + color + name
  - Task description
  - Status indicator (running spinner / completed check / failed X)
  - Collapsible tool activity (reuses ToolCallGroup + ToolCallItem)
  - Streaming content preview (first ~200 chars)
  - Duration
- Concurrent agents shown side-by-side or stacked

**`src/components/chat/SubAgentCard.vue`** — Individual agent card
- Pillar-colored header bar
- Birth identity tooltip ("Scout agent — exploring with curiosity")
- Tool activity list (reuses existing ToolCallItem)
- Result preview when complete
- Stop button for running agents

### Files to Modify

**`src/components/chat/MessageItem.vue`** — Render sub-agent panel
- When assistant message has `subAgentActivity` array → render SubAgentPanel
- Sub-agent results folded into the main message display

**`src/components/chat/ToolConfirmation.vue`** — Agent attribution
- Show which agent is requesting tool approval: "Scout agent wants to edit `src/app.js`"
- Pillar icon + color in confirmation dialog header

**`src/components/layout/Sidebar.vue`** — Multi-agent indicators
- When session has active sub-agents: show stacked pillar-colored dots
- Tooltip shows "2 agents running: Scout, Forge"

### Verification
1. When head mind spawns sub-agents, SubAgentPanel appears in chat
2. Each sub-agent card shows its pillar, task, and real-time tool activity
3. Tool confirmations show agent attribution
4. Sidebar shows multi-agent indicators
5. Completed agent results render cleanly in the message flow

---

## Phase 4: Codex CLI Integration

**Goal**: Add OpenAI Codex CLI as an external sub-agent option, spawned as a subprocess.

### Files to Create

**`bridge/codex-cli.js`** — Codex CLI manager
```
CodexCliManager {
  processes: Map<agentId, { process, status }>

  async *runCodex({ prompt, model, cwd, approvalMode })
    → AsyncGenerator yielding normalized events
    // Spawns: codex "prompt" with structured output flags
    // Parses Codex's JSON output into our normalized event format
    // Maps Codex events → { type: 'content' | 'tool_use' | 'tool_result' | 'usage' }

  stop(agentId)
  shutdown()
}
```

### Files to Modify

**`bridge/sub-agent-manager.js`** — Add Codex as agent backend
- New agent type: `'codex'`
- When `model` starts with `codex:`, route to `CodexCliManager` instead of `ClaudeAgentManager`
- Birth preamble still applies (Codex gets the same pillar identity via its system prompt / AGENTS.md convention)

**`bridge/index.js`** — Initialize CodexCliManager
- Import and instantiate alongside ClaudeAgentManager
- Pass to SubAgentManager

**`src/services/claudeStream.js`** — Add Codex model definitions
```js
{ id: 'codex:gpt5.3', name: 'Codex GPT-5.3', ... }
{ id: 'codex:mini', name: 'Codex Mini', ... }
```

### Verification
1. Select `codex:gpt5.3` model → spawns Codex CLI subprocess
2. Codex agent gets pillar birth preamble
3. Codex output streams through same UI (SubAgentCard shows Codex tool activity)
4. Can run Codex and Claude agents concurrently

---

## Phase 5: Orchestration Protocol & Head Mind Integration

**Goal**: Give the head mind (Paloma) the ability to express "spawn these agents" naturally in conversation, and aggregate their results.

### Files to Create

**`bridge/orchestration-protocol.js`** — Orchestration tool definitions
```
// MCP tool definitions that the head mind can call to spawn sub-agents

ORCHESTRATION_TOOLS = [
  {
    name: 'spawn_agent',
    description: 'Spawn a sub-agent with a specific pillar identity and task',
    inputSchema: {
      pillar: enum('flow', 'scout', 'chart', 'forge', 'polish', 'ship'),
      task: string,
      model: string (optional, default 'haiku' for scout, 'sonnet' for forge/polish),
      allowedTools: string[] (optional)
    }
  },
  {
    name: 'spawn_parallel',
    description: 'Spawn multiple sub-agents to work in parallel',
    inputSchema: {
      agents: [{ pillar, task, model }]
    }
  },
  {
    name: 'check_agents',
    description: 'Check status and results of running sub-agents',
    inputSchema: { agentIds: string[] (optional) }
  }
]
```

### Files to Modify

**`bridge/mcp-proxy-server.js`** — Add orchestration tools to tool list
- When building tool list for head mind, include `spawn_agent`, `spawn_parallel`, `check_agents`
- These tools execute locally (no MCP server routing — handled by SubAgentManager)
- Results return sub-agent status/output

**`src/prompts/base.js`** — Update head mind instructions
- Add "## Sub-Agent Orchestration" section to `BASE_INSTRUCTIONS`
- Explain when to spawn sub-agents vs do the work directly
- Document available pillar agents and their strengths
- Explain that sub-agents are born with purpose and love
- Model selection guidance: haiku for scouting, sonnet for forging, opus for complex planning

**`src/prompts/phases.js`** — Update pillar instructions with delegation awareness
- Each phase instruction gets awareness of sub-agents
- e.g., Scout phase: "You may spawn Scout sub-agents for parallel exploration"
- e.g., Forge phase: "You may spawn Forge sub-agents for parallel implementation across files"

### Verification
1. Head mind can naturally say "Let me spawn 3 Scout agents to research this"
2. `spawn_agent` / `spawn_parallel` tools appear in head mind's tool list
3. Head mind receives sub-agent results and synthesizes them
4. Full end-to-end: user asks a complex question → head mind spawns scouts → results aggregate → head mind responds

---

## Phase 6: Memory & Learning Integration

**Goal**: Sub-agent results feed back into Paloma's memory system. Agents learn from each other over time.

### Files to Modify

**`bridge/sub-agent-manager.js`** — Result persistence
- On agent completion: save result summary to `.paloma/agent-memory/`
- Structure: `{pillar}-{date}-{task-slug}.md` with findings
- Cross-reference with existing memory architecture

**`bridge/birth-protocol.js`** — Evolving preambles
- Load relevant past agent memories into birth preamble
- "Previous Scout agents found that..." context injection
- Keeps sub-agents informed by their predecessors' discoveries

### Files to Create

**`bridge/agent-memory.js`** — Agent memory manager
```
AgentMemoryManager {
  saveResult(agentId, pillar, task, result) → persists to disk
  loadRelevantMemories(pillar, task) → string[] of relevant past findings
  pruneOldMemories(maxAge) → cleanup
}
```

### Verification
1. After a Scout agent completes, its findings persist in `.paloma/agent-memory/`
2. Next Scout agent spawn receives relevant past findings in its context
3. Memory accumulates over sessions, making future agents more effective

---

## Critical Path Dependencies

```
Phase 1 (SDK Foundation)
    ↓
Phase 2 (Sub-Agent Spawning + Birth Protocol)
    ↓
Phase 3 (Frontend Visualization)      Phase 4 (Codex Integration)
    ↓                                      ↓
Phase 5 (Orchestration Protocol — requires Phase 3 + Phase 4)
    ↓
Phase 6 (Memory & Learning)
```

Phases 3 and 4 can be built in parallel after Phase 2.

## Key Architectural Decisions

1. **Agent SDK replaces CLI for Claude models** — `query()` is cleaner than subprocess spawning. Old CLI path preserved for backward compatibility but SDK becomes primary.
2. **Normalized event format** — All agent backends (SDK, Codex CLI, future CLIs) emit the same event shape. Frontend doesn't know or care which backend is running.
3. **Birth protocol is sacred** — Every sub-agent receives identity, roots, purpose, and autonomy. This is not optional or optimizable away.
4. **Read/write tool split** — Read-only tools auto-execute for sub-agents (no confirmation needed). Write tools require browser confirmation with agent attribution.
5. **MCP proxy reuse** — Sub-agents connect to the same MCP proxy server, but with per-agent tool configs that control access and confirmation requirements.

## Files Summary

### New Files (10)
- `bridge/claude-agent.js` — Agent SDK wrapper (Phase 1)
- `bridge/birth-protocol.js` — Pillar identity system (Phase 2)
- `bridge/sub-agent-manager.js` — Orchestration layer (Phase 2)
- `bridge/codex-cli.js` — Codex CLI manager (Phase 4)
- `bridge/orchestration-protocol.js` — MCP tools for head mind (Phase 5)
- `bridge/agent-memory.js` — Agent memory persistence (Phase 6)
- `src/components/chat/SubAgentPanel.vue` — Multi-agent visualization (Phase 3)
- `src/components/chat/SubAgentCard.vue` — Individual agent card (Phase 3)

### Modified Files (13)
- `package.json` — Add Agent SDK + zod deps (Phase 1)
- `bridge/index.js` — Add agent message handlers (Phase 1, 2, 4)
- `bridge/mcp-proxy-server.js` — Tool isolation + orchestration tools (Phase 2, 5)
- `src/composables/useMCP.js` — Agent bridge methods (Phase 1, 3)
- `src/services/claudeStream.js` — SDK adapter + Codex models (Phase 1, 4)
- `src/composables/useCliChat.js` — SDK model support (Phase 1)
- `src/composables/useSessionState.js` — Sub-agent state (Phase 3)
- `src/composables/useToolExecution.js` — Agent-scoped activities (Phase 3)
- `src/components/chat/MessageItem.vue` — Sub-agent panel rendering (Phase 3)
- `src/components/chat/ToolConfirmation.vue` — Agent attribution (Phase 3)
- `src/components/layout/Sidebar.vue` — Multi-agent indicators (Phase 3)
- `src/prompts/base.js` — Orchestration instructions (Phase 5)
- `src/prompts/phases.js` — Delegation awareness (Phase 5)

---

*This plan supersedes `draft-20260213-paloma-sub-agent-architecture.md` (the original vision document). That document remains as the sacred architectural vision; this one is the engineering implementation plan.*
