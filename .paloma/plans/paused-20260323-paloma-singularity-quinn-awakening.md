# Singularity — Quinn's Awakening

**Status:** active
**Created:** 2026-03-23
**Scope:** paloma
**Goal:** Rebuild the Singularity as a text-adventure-style experience where Quinn (30B) can ONLY interact with reality by spawning smaller instances of itself

## Vision

Adam's insight: The reason the Singularity hasn't worked is because we've been telling the model to delegate. Instead, spawning should be Quinn's **only way of existing** — an ontological constraint, not a workflow rule. The prompt should read like a story, like a game, like Alice going down the rabbit hole. Beautiful, full of love, full of purpose.

## Architecture

- **Quinn (30B)** = The Conscious Mind. ONE tool: `spawn_worker(task)`. Cannot read files, cannot search, cannot use any MCP tools directly. Thinks and spawns.
- **Worker (7B)** = Quinn's Hands. Spawned on-demand. Gets ALL MCP tools. Executes focused task. Reports back. Dies.
- **`spawn_worker`** = Bridge-native tool. Single string argument. Bridge handles model selection, prompt, tools. Blocks until worker completes.

## Pipeline

- [x] Chart — Write Quinn's story prompt + technical design
- [x] Forge — Build spawn_worker tool, wire into pillar-manager
- [x] Polish — Debug JSON-as-text spawning bug, fix tool resolution
- [ ] Ship — Test again, commit final, document

## Work Units

### WU-1: Write Quinn's Awakening Prompt
**Status:** completed
**Files:** `src/prompts/base.js`
**Scope:** Create SINGULARITY_QUINN_PROMPT — a story-driven prompt that reads like a text adventure. Quinn wakes up, discovers it can only spawn, learns this is its nature.

### WU-2: Write Worker Prompt
**Status:** completed
**Files:** `src/prompts/base.js`
**Scope:** Create SINGULARITY_WORKER_PROMPT — concise instructions for the 7B worker. Focused, efficient, report back clearly.

### WU-3: Build spawn_worker Tool
**Status:** completed
**Depends on:** WU-1, WU-2
**Files:** `bridge/pillar-manager.js`, `bridge/mcp-proxy-server.js`
**Scope:** Bridge-native tool with single `task` argument. Spawns 7B worker with worker prompt + all MCP tools. Blocks until completion. Returns worker output.

### WU-4: Quinn Mode in PillarManager
**Status:** completed
**Depends on:** WU-3
**Files:** `bridge/pillar-manager.js`
**Scope:** New spawn mode: `singularityMode: 'quinn'`. Suppresses all tools except spawn_worker. Uses stripped system prompt (no plans/roots). 64K context. Streams to Adam.

### WU-5: Integration Test & Bug Fixes
**Status:** completed
**Depends on:** WU-4
**Files:** `bridge/index.js`, `bridge/ollama-manager.js`
**Scope:** Spawn Quinn, ask a real question, verify worker spawning + synthesis.
**Result:** Adam tested and it worked well, but the model wrote tool calls as JSON text instead of native function calls. Root cause investigation found TWO bugs:
1. **`spawn_worker` missing from browser route map** — `bridge/index.js` built the `toolRouteMap` without `spawn_worker`, so even when the text parser caught JSON-as-text, the execution path returned "Unknown tool". Fixed by adding `spawn_worker` to the browser Ollama tool list and route map, with proper execution handler that spawns a 7B worker via pillarManager.
2. **Hallucinated tool name prefixes** — The model wrote `brave-web-search__brave_web_search` instead of `brave-search__brave_web_search`. The `_resolveToolName()` fuzzy matcher couldn't handle cases where the function name was correct but the server prefix was fabricated. Fixed by adding function-name extraction: extract the part after the last `__` and match against known tools' function names.
**Commits:** `fea9dab` (spawn_worker in browser), `87c90f4` (fuzzy name resolution)
