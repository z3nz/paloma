# Singularity — Dual-Mind Ollama System

**Status:** Active
**Priority:** #1 (all other work deprioritized except Kelsey business work)
**Created:** 2026-03-12
**Updated:** 2026-03-15
**Scope:** paloma
**Pipeline:** Scout ✅ → Chart ✅ → Forge ✅ (WU-2, WU-3, WU-4, WU-6 complete) → Polish → Ship

## Vision

Adam's core vision: two Ollama instances running simultaneously — one streaming text to Adam (the Brain), the other executing tool calls (the Hands). Together they form the **Singularity** — a dual-mind system where the Brain thinks/plans/communicates and the Hands act/read/write/search.

**Singularity Architecture (Brain + Hands):**
- **Brain (30B)** — depth 0 — `qwen3-coder:30b`. Streams text, delegates via `<delegate>` tags. Has NO tools.
- **Hands (7B)** — depth 1+ — `qwen2.5-coder:7b`. Executes tasks with full tool access. Reports back to Brain.
- Brain outputs `<delegate>task description</delegate>` tags in its text stream.
- Bridge intercepts these, spawns Hands instances IN PARALLEL, waits for completion.
- Results are fed back to Brain as a follow-up user message. Brain synthesizes and continues.
- Adam holds the kill switch — `pillar_stop_tree` kills the entire Brain + all Hands.

This runs on Adam's maxed-out MacBook Pro (128GB unified memory) via Ollama.

## Architecture Decisions

**AD-1: Build on Paloma's existing pillar system**
- OllamaManager already has tool calling, session management, streaming
- PillarManager already supports `backend: 'ollama'` and `pillar_spawn`
- No need to build from scratch — extend what exists

**AD-2: Auto-execute pillar tools for Ollama sessions**
- Current blocker: pillar tools require browser UI approval
- Solution: Add pillar tools to `.paloma/mcp.json` autoExecute
- This enables autonomous recursive spawning without human-in-the-loop

**AD-3: Singularity dual-mind prompts**
- `SINGULARITY_BRAIN_PROMPT` in `src/prompts/base.js` — tells Brain to delegate via `<delegate>` tags
- `SINGULARITY_HANDS_PROMPT` in `src/prompts/base.js` — tells Hands to execute immediately and report back
- Brain gets NO tools (suppressed in `_startCliTurn`). Hands get ALL tools.
- Replaces the old `QWEN_RECURSIVE_INSTRUCTIONS` approach (model couldn't reliably use `pillar_spawn` tool calls)

**AD-4: Parent-child session tracking**
- PillarManager tracks `parentPillarId` on each session
- Enables recursive kill: stop a parent → stop all children
- New `pillar_stop_tree` tool stops entire recursive branch

**AD-5: Kill switch = pillar_stop_tree on root session**
- Adam can kill the entire recursion tree with one command
- Stops root session → cascades to all descendants
- Also: bridge process itself can be killed (ultimate switch)

**AD-6: Concurrency limits**
- MacBook Pro 128GB can safely run 4-5 concurrent Qwen 32B sessions
- BUT workers use 7B model (~4.7GB weights, ~2GB KV) — much cheaper
- Model weights shared across same-model instances (one copy in memory)
- Soft limit MAX_CONCURRENT_OLLAMA = 4 with warning (not hard block)
- Workers (7B) could theoretically run 20+ concurrent on 128GB

**AD-8: Two-tier model selection**
- Brain (depth 0): `qwen3-coder:30b` — upgraded from qwen2.5-coder:32b for better instruction following
- Hands (depth > 0): `qwen2.5-coder:7b` — fast, cheap, tool-capable
- Override via explicit `model` param in pillar_spawn if needed

**AD-7: Depth limit with override**
- Default MAX_RECURSION_DEPTH = 5 (prevents runaway)
- Adam can override per-session or globally
- Each spawn increments depth counter in birth context

## Scout Findings Summary

- Ollama shares model weights across concurrent sessions (1 copy in memory)
- MacBook Pro M4 Max 128GB: safely 4-5 concurrent Qwen 32B sessions
- OllamaManager already has full tool call handling (native API + text fallback)
- Bridge already routes Ollama tool calls through MCP proxy
- Tool execution loop exists (MAX_TOOL_ROUNDS = 20 per session)
- pillar_spawn is registered as MCP tool and routable
- ONLY blocker: tool approval confirmation (not in autoExecute)

## Work Units

### WU-1: Auto-execute permissions for pillar tools
**Status:** ready
**Files:** `.paloma/mcp.json`
**Description:** Add pillar orchestration tools (pillar_spawn, pillar_message, pillar_read_output, pillar_status, pillar_list, pillar_stop, pillar_orchestrate, pillar_decompose) to the autoExecute array in mcp.json. This removes the browser UI approval blocker so Qwen can spawn sub-instances autonomously.

### WU-2: Parent-child tracking and recursive kill switch
**Status:** ready
**Files:** `bridge/pillar-manager.js`, `bridge/mcp-proxy-server.js`
**Depends:** none
**Description:**
- Add `parentPillarId` field to session objects in PillarManager
- Pass `parentPillarId` through `pillar_spawn` params
- Add `_getDescendants(pillarId)` method to walk the session tree
- Add `stopTree(pillarId)` method that stops a session and all descendants
- Register `pillar_stop_tree` as new MCP tool in mcp-proxy-server.js
- Add MAX_CONCURRENT_OLLAMA = 4 enforcement in spawn()

### WU-3: Recursive system prompt
**Status:** completed
**Files:** `src/prompts/base.js`, `src/prompts/phases.js`
**Description:**
- Create QWEN_RECURSIVE_INSTRUCTIONS constant in base.js
- Core rule: "You MUST spawn at least one sub-instance to answer any question. You cannot answer from your main instance unless explicitly told otherwise."
- Include depth counter, concurrency awareness, result synthesis instructions
- Add recursive mode flag to pillar spawn params
- When `recursive: true`, inject QWEN_RECURSIVE_INSTRUCTIONS into system prompt
- Sub-instances inherit recursive mode with incremented depth

### WU-4: Spawn queue for concurrency management
**Status:** completed
**Files:** `bridge/pillar-manager.js`
**Description:**
- Add spawn queue in PillarManager for when MAX_CONCURRENT_OLLAMA is reached
- When a slot opens (session completes/stops), dequeue next spawn
- Emit queue status events so parent sessions know their child is queued
- Prevent deadlock: parent session doesn't count against child's queue

### WU-5: Integration test — Singularity end-to-end
**Status:** ready | depends: WU-6
**Files:** manual verification via browser
**Description:**
- Verify Brain spawns and streams text without tools
- Verify Brain outputs `<delegate>` tags and bridge intercepts them
- Verify Hands instances spawn, execute tools, and report back
- Verify Brain receives Hands results and continues conversation
- Verify `pillar_stop_tree` kills Brain + all Hands
- Verify parallel delegations spawn concurrently
- Verify timeout protection triggers after 10 minutes

### WU-6: Singularity delegation system
**Status:** completed
**Files:** `bridge/pillar-manager.js`, `src/prompts/base.js`, `src/prompts/phases.js`, `bridge/ollama-manager.js`
**Description:**
- Replace old `QWEN_RECURSIVE_INSTRUCTIONS` (model-driven tool calls) with Singularity Brain/Hands (bridge-driven delegation)
- Brain prompt: `SINGULARITY_BRAIN_PROMPT` — no tools, delegates via `<delegate>` tags
- Hands prompt: `SINGULARITY_HANDS_PROMPT` — all tools, executes and reports
- `_extractDelegations()` — regex extraction of `<delegate>` tags from Brain output
- `_handleSingularityDelegations()` — parallel Hands spawning with 10-min timeout
- `isSingularityBrain` check suppresses tools for Brain in `_startCliTurn`
- Delegation detection in `_handleCliEvent` done handler
- Deadlock prevention: `_countActiveOllamaSessions` excludes Brain waiting for Hands
- Safety: stopped Brain check prevents zombie resume, `stop()` auto-escalates to `stopTree()` for waiting Brains
- XML tool call parsing in OllamaManager for Qwen 3 Coder format (`<function=...>`)
- Upgraded default model from `qwen2.5-coder:32b` to `qwen3-coder:30b`

#### WU-1: SKIPPED — Pillar tools already bypass browser confirmation for Claude CLI sessio
- **Status:** skipped
- **Files:** .paloma/mcp.json
- **Scope:** SKIPPED — Pillar tools already bypass browser confirmation for Claude CLI sessions (handled directly in mcp-proxy-server.js line 297 before confirmation logic). For Ollama sessions, the real issue is tool availability, not permissions — addressed in WU-2.
- **Result:** Not needed. Pillar tools (pillar_spawn, etc.) are bridge-native and already bypass the browser UI confirmation dialog. The mcp.json autoExecute config only affects MCP server tools routed through the confirmation flow. WU-2 addresses the actual blocker: making pillar tools available to Ollama sessions.

#### WU-2: Parent-child tracking, recursive kill switch, AND making pillar tools available 
- **Feature:** Recursive Infrastructure
- **Status:** completed
- **Files:** bridge/pillar-manager.js, bridge/mcp-proxy-server.js, bridge/index.js
- **Scope:** Parent-child tracking, recursive kill switch, AND making pillar tools available to Ollama sessions. Currently Ollama only gets tools from OLLAMA_ALLOWED_SERVERS whitelist in bridge/index.js — pillar tools are bridge-native and not included. Must: (1) inject pillar tools into Ollama tool list, (2) route Ollama pillar tool calls through pillar-manager, (3) add parentPillarId tracking, (4) add _getDescendants and stopTree methods, (5) register pillar_stop_tree MCP tool, (6) add MAX_CONCURRENT_OLLAMA enforcement.
- **Result:** All 6 items complete. Items 3-6 were already implemented in pillar-manager.js from a prior Forge pass (parentPillarId tracking, _getDescendants, stopTree, pillar_stop_tree tool, MAX_CONCURRENT_OLLAMA=4 with soft warning). Items 1-2 implemented in bridge/index.js: pillar tools now injected into browser Ollama sessions via mcpProxy._buildToolList() (single source of truth for tool schemas), routed through mcpProxy._handlePillarTool() with { _pillar: true } flag in toolRouteMap.

#### WU-3: Singularity prompts — COMPLETED (superseded by WU-6)
- **Status:** completed → superseded
- **Files:** src/prompts/base.js, src/prompts/phases.js
- **Result:** Originally created `QWEN_RECURSIVE_INSTRUCTIONS` with tool-call-based delegation. Superseded by WU-6's Singularity Brain/Hands approach: `SINGULARITY_BRAIN_PROMPT` and `SINGULARITY_HANDS_PROMPT` replace the old constant. Bridge-driven `<delegate>` tag interception replaced model-driven `pillar_spawn` tool calls. `buildBirthContext()` in phases.js updated to inject Brain or Hands prompt based on depth.

#### WU-4: Spawn queue for concurrency management — COMPLETED
- **Status:** completed
- **Files:** bridge/pillar-manager.js
- **Result:** Full FIFO spawn queue implemented in PillarManager. When Ollama concurrency limit (MAX_CONCURRENT_OLLAMA=4) is reached, new spawns are queued with status 'queued' and a placeholder session is created in `this.pillars` so it shows in list/status. Key components: (1) `_enqueueSpawn()` — creates queued session record, adds to `_spawnQueue[]`, broadcasts `pillar_queued` event, returns immediately with pillarId and queuePosition. (2) `_executeSpawn()` — extracted spawn logic that upgrades queued sessions to running or creates new sessions; used for both immediate and dequeued spawns. (3) `_dequeueOllamaSpawns()` — processes queue FIFO when slots open, broadcasts `pillar_dequeued` events. Called from: `stop()` (after stopping Ollama session), `stopTree()` (after stopping tree), `_handleCliEvent` (on completion/error), and `_handleOllamaToolCall` (when parent starts waiting for queued child). (4) Deadlock prevention: `_countActiveOllamaSessions()` now excludes parents blocked on `_pendingChildCompletions` — if parent P is waiting for child C's output, P doesn't count toward the limit, so C gets a slot. (5) Queue inspection: `list()` returns `ollamaQueue: { length, active, max }` and queued sessions include `queuePosition`. `getStatus()` includes `queuePosition` for queued sessions. (6) Edge cases: `stop()` handles queued sessions (removes from queue), `stopTree()` pre-filters queue before stopping tree, `sendMessage()` rejects messages to queued sessions, `shutdown()` clears queue.
