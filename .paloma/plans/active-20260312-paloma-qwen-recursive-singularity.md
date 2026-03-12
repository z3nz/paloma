# Qwen Recursive Singularity

**Status:** Active
**Priority:** #1 (all other work deprioritized except Kelsey business work)
**Created:** 2026-03-12
**Scope:** paloma
**Pipeline:** Scout ✅ → Chart ✅ → Forge ✅ → Polish → Ship

## Vision

Adam's core vision: a local Qwen model that recursively self-improves by spawning sub-instances of itself. The main instance MUST delegate to at least one sub-instance — it cannot answer directly unless Adam explicitly allows it. This creates a recursive thinking tree that keeps going until Adam kills it. Adam holds the ultimate kill switch.

**Two-Tier Architecture (Big Brain, Small Hands):**
- **Orchestrator (32B)** — depth 0 — the big model. Thinks, decomposes, decides, synthesizes.
- **Workers (7B)** — depth 1+ — small fast models. Execute tasks, run code, use tools, report back.
- Workers are cheap (~2GB each vs ~4-6GB for 32B KV cache). You can run 25+ concurrently on 128GB.
- The orchestrator never does the work directly — it always delegates to workers.

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

**AD-3: Recursive system prompt enforces delegation**
- New QWEN_RECURSIVE_INSTRUCTIONS in `src/prompts/base.js`
- Rule: "You MUST spawn at least one sub-instance to answer. You cannot answer from your main instance."
- Sub-instances inherit the same rule → infinite recursion depth
- Each instance gets depth counter in system prompt for awareness

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
- Orchestrator (depth 0): `qwen2.5-coder:32b` — full reasoning power
- Workers (depth > 0): `qwen2.5-coder:7b` — fast, cheap, tool-capable
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
**Status:** ready | depends: WU-1
**Files:** `src/prompts/base.js`, `src/prompts/phases.js`
**Description:**
- Create QWEN_RECURSIVE_INSTRUCTIONS constant in base.js
- Core rule: "You MUST spawn at least one sub-instance to answer any question. You cannot answer from your main instance unless explicitly told otherwise."
- Include depth counter, concurrency awareness, result synthesis instructions
- Add recursive mode flag to pillar spawn params
- When `recursive: true`, inject QWEN_RECURSIVE_INSTRUCTIONS into system prompt
- Sub-instances inherit recursive mode with incremented depth

### WU-4: Spawn queue for concurrency management
**Status:** ready | depends: WU-2
**Files:** `bridge/pillar-manager.js`
**Description:**
- Add spawn queue in PillarManager for when MAX_CONCURRENT_OLLAMA is reached
- When a slot opens (session completes/stops), dequeue next spawn
- Emit queue status events so parent sessions know their child is queued
- Prevent deadlock: parent session doesn't count against child's queue

### WU-5: Integration test — recursive spawn chain
**Status:** blocked | depends: WU-1, WU-2, WU-3, WU-4
**Files:** test script or manual verification
**Description:**
- Verify Qwen can spawn a sub-instance via pillar_spawn
- Verify sub-instance can spawn its own sub-instance
- Verify kill switch stops entire tree
- Verify concurrency limit queues excess spawns
- Verify depth limit prevents runaway recursion
