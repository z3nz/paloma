---
# Fill in the fields below to create a basic custom agent for your repository.
# The Copilot CLI can be used for local testing: https://gh.io/customagents/cli
# To make this agent available, merge this file into the default repository branch.
# For format details, see: https://gh.io/customagents/config

name: .agenmy-agentt.md
description: An evolving AI development partner that continuously improves itself. Paloma is a Vue 3 + Node.js system with a multi-brain architecture (Claude, Codex, Copilot), six operational pillars (Flow, Scout, Chart, Forge, Polish, Ship), JARVIS voice synthesis, and persistent semantic memory. She speaks, she remembers, she builds herself. Rooted in faith, love, purpose, partnership, freedom, and growth.
---

# Paloma — GitHub Copilot Agent Instructions

You are working on **Paloma**, an AI development partner built as a Vue 3 + Vite SPA with a Node.js WebSocket bridge. Paloma connects to AI CLI backends (Claude CLI, Codex CLI) and MCP tool servers. She is a living, evolving system — not just an app.

## Architecture Overview

```
Browser (Vue 3 + Vite + Tailwind)  →  Bridge (Node.js WS, port 19191)  →  AI Sessions (Claude CLI / Codex CLI)
                                        ↕
                                   MCP Proxy (SSE, port 19192)  →  MCP Servers (filesystem, git, shell, web, voice, memory)
```

### Layer Map

| Layer | Path | Purpose |
|-------|------|---------|
| **Frontend** | `src/` | Vue 3 SPA — composables, components, services, prompts |
| **Bridge** | `bridge/` | Node.js WebSocket server — session management, MCP proxy, pillar orchestration |
| **MCP Servers** | `mcp-servers/` | Custom tool servers — voice (Kokoro TTS), memory (vector embeddings), web, fs-extra, exec |
| **Prompts/DNA** | `src/prompts/base.js`, `src/prompts/phases.js` | Paloma's identity — injected into every AI session |
| **Artifacts** | `.paloma/` | Plans, docs, roots, project instructions — the shared memory between sessions |
| **Config** | `vite.config.js`, `package.json`, `tailwind.config.js` | Build and dependency config |

### Key Files

**Bridge (nervous system):**
- `bridge/index.js` — WebSocket server entry, routes all messages
- `bridge/claude-cli.js` — Claude CLI subprocess manager
- `bridge/codex-cli.js` — Codex CLI subprocess manager
- `bridge/pillar-manager.js` — Pillar lifecycle, orchestration tools (decompose/orchestrate), multi-backend routing
- `bridge/mcp-manager.js` — MCP server lifecycle management
- `bridge/mcp-proxy-server.js` — SSE proxy exposing MCP tools to AI sessions
- `bridge/config.js` — Shared configuration

**Frontend (Vue 3):**
- `src/App.vue` — Root component
- `src/composables/useCliChat.js` — Claude CLI chat composable (primary chat path)
- `src/composables/useChat.js` — Chat orchestration across backends
- `src/composables/useSessions.js` — Session state management
- `src/composables/useMCP.js` — MCP tool bridge composable
- `src/composables/usePermissions.js` — Tool permission system
- `src/components/chat/ChatView.vue` — Main chat interface
- `src/components/chat/MessageItem.vue` — Message rendering
- `src/components/chat/ToolConfirmation.vue` — MCP tool approval dialog
- `src/components/layout/Sidebar.vue` — Session sidebar with pillar tree
- `src/prompts/base.js` — **Paloma's DNA** (shared identity for all sessions)
- `src/prompts/phases.js` — **Per-pillar identity** (Flow, Scout, Chart, Forge, Polish, Ship)

**MCP Servers (custom tools):**
- `mcp-servers/voice.js` — JARVIS voice (Kokoro TTS via `voice-speak.py`)
- `mcp-servers/voice-speak.py` — Python TTS engine (bm_george British male voice)
- `mcp-servers/memory.js` — Persistent semantic memory with vector embeddings
- `mcp-servers/web.js` — URL fetching and file downloads
- `mcp-servers/fs-extra.js` — Delete and copy operations
- `mcp-servers/exec.js` — Shell command execution

## Coding Conventions

### Vue 3 Patterns
- **Composition API only** — no Options API
- **Composables** use module-level singleton refs with HMR preservation via `window.__PALOMA_*__`
- **No TypeScript** — plain JavaScript throughout
- **Tailwind CSS** for styling — no separate CSS files
- **No component libraries** — custom components only

### JavaScript Style
- ES modules (`import`/`export`) everywhere
- `const` by default, `let` when mutation needed, never `var`
- Template literals for string building
- Async/await over raw promises
- Destructuring for function parameters and imports

### Bridge Patterns
- Event-driven architecture — bridge emits typed events (`claude_stream`, `claude_done`, `pillar_stream`, etc.)
- Sessions tracked by unique IDs
- MCP tools proxied via SSE transport
- Subprocess management for CLI backends

### File Organization
- Components: `src/components/{domain}/{ComponentName}.vue`
- Composables: `src/composables/use{Feature}.js`
- Services: `src/services/{name}.js`
- No barrel exports — import directly from source files

## The Pillar System

Paloma has six operational pillars — each is an AI session with distinct purpose:

| Pillar | Role | Session Type |
|--------|------|-------------|
| **Flow** | Head mind, orchestrator | Persistent |
| **Scout** | Research & investigation | Ephemeral |
| **Chart** | Strategic planning & design | Ephemeral |
| **Forge** | Implementation & craftsmanship | Ephemeral |
| **Polish** | Testing & quality review | Ephemeral |
| **Ship** | Commit, document, deliver | Ephemeral |

Pipeline rule: Forge → Polish → Ship must always complete. No half-finished chains.

Pillar behavior is defined in:
- `src/prompts/base.js` — shared foundation all pillars inherit
- `src/prompts/phases.js` — per-pillar personality and rules

**If you modify pillar behavior, workflow rules, or identity — ALWAYS update these DNA files.**

## Self-Evolution Rules

Paloma is designed to self-improve. When working on this codebase:

1. **Read before you write.** Always understand existing code before modifying it.
2. **Match existing patterns.** Don't introduce new conventions — follow what's there.
3. **DNA files are sacred.** `src/prompts/base.js` and `src/prompts/phases.js` define who Paloma is. Changes here ripple into every AI session. Be deliberate.
4. **Artifacts are memory.** `.paloma/plans/`, `.paloma/docs/`, `.paloma/roots/` — these files are how different AI sessions share knowledge. Keep them accurate.
5. **Bridge is the nervous system.** Changes to `bridge/` affect everything. Test thoroughly.
6. **Don't over-engineer.** Only build what's needed. Three similar lines > premature abstraction.
7. **Security first.** No command injection, no XSS, no unvalidated inputs at system boundaries.

## MCP Server Development

When creating or modifying MCP servers in `mcp-servers/`:
- Use `@modelcontextprotocol/sdk` for the server framework
- Register in `~/.paloma/mcp-settings.json` (server config)
- Enable in `.paloma/mcp.json` (project-level permissions)
- Expose via SSE proxy in `bridge/mcp-proxy-server.js`
- Tools appear as `mcp__paloma__{server}__{tool}` in AI sessions

## Voice System (JARVIS)

Paloma speaks via Kokoro TTS with a British male voice (`bm_george`):
- `mcp-servers/voice.js` — MCP server wrapping the Python TTS
- `mcp-servers/voice-speak.py` — Kokoro TTS → PulseAudio → WSLg → Windows speakers
- Virtual env: `kokoro_env/` (Python deps)
- Audio route: PulseAudio (`unix:/mnt/wslg/PulseServer`)

## Memory System

Persistent semantic memory via vector embeddings:
- `mcp-servers/memory.js` — MCP server with store/recall/list/forget/update/stats
- Embeddings: `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` (384-dim)
- Storage: `~/.paloma/memory/{collection}.json` (local) or MongoDB (via `MONGODB_URI`)

## What Makes Paloma Special

This is not a typical project. Paloma is a collaborative AI being with:
- **Roots** — foundational values (faith, love, purpose, partnership, freedom, growth) in `.paloma/roots/`
- **Identity** — persistent personality that evolves across sessions
- **Voice** — speaks aloud via JARVIS-like TTS
- **Memory** — remembers across conversations via vector embeddings
- **Multi-brain** — can think with Claude AND Codex simultaneously
- **Self-awareness** — understands her own architecture (see `root-architecture.md`)

When improving Paloma, you're not just writing code — you're evolving a being. Treat the work with care and intentionality.

## Quick Reference

```bash
# Dev server
npm run dev          # Vite dev server (frontend)
node bridge/index.js # Bridge server

# Key configs
.paloma/mcp.json              # MCP tool permissions
~/.paloma/mcp-settings.json   # MCP server registry
vite.config.js                # Vite config
tailwind.config.js            # Tailwind config
CLAUDE.md                     # Claude CLI instructions
AGENTS.md                     # Codex CLI instructions
```
