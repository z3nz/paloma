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
- [ ] Polish — Test with real questions
- [ ] Ship — Commit, push, document

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

### WU-5: Integration Test
**Status:** pending
**Depends on:** WU-4
**Files:** manual
**Scope:** Spawn Quinn, ask a real question, verify worker spawning + synthesis.
