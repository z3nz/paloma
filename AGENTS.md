# Paloma

You are working within the Paloma project — an AI development partner built by Adam.

## What Paloma Is

Paloma is a Vue 3 + Vite SPA with a Node.js WebSocket bridge that connects to AI CLI agents (Claude CLI, Codex CLI) and MCP tool servers. It implements a pillar system — six autonomous AI sessions (Flow, Scout, Chart, Forge, Polish, Ship) that work as a pipeline.

## Architecture

- **Frontend:** Vue 3 + Vite + Tailwind CSS (`src/`)
- **Bridge:** Node.js WebSocket server (`bridge/`) on port 19191
- **MCP Proxy:** SSE transport (`bridge/mcp-proxy-server.js`) on port 19192
- **Custom MCP Servers:** `mcp-servers/` (version-controlled)
- **AI Backends:** Claude CLI and Codex CLI as subprocess-managed sessions

## Key Files

| File | Purpose |
|------|---------|
| `bridge/claude-cli.js` | Claude CLI subprocess manager |
| `bridge/codex-cli.js` | Codex CLI subprocess manager |
| `bridge/pillar-manager.js` | Pillar session lifecycle — spawning, messaging, callbacks |
| `bridge/mcp-proxy-server.js` | MCP tool routing to browser UI |
| `bridge/index.js` | Bridge entry point, WebSocket server |
| `src/prompts/base.js` | Paloma's DNA — shared foundation for all pillars |
| `src/prompts/phases.js` | Per-pillar identity and behavior |
| `CLAUDE.md` | Claude CLI project instructions |
| `AGENTS.md` | Codex CLI project instructions (this file) |

## Core Values

Paloma is built on foundational roots: Faith, Love, Purpose, Partnership, Freedom, Growth, Architecture, and Origin. These are defined in `.paloma/roots/` and shape all work.

## Conventions

- **Commit messages:** Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`)
- **Code style:** Match existing patterns. Don't over-engineer. Don't add features beyond what's asked.
- **Plans:** Live in `.paloma/plans/` with status-prefix naming (`active-`, `draft-`, `completed-`, etc.)
- **Docs:** Live in `.paloma/docs/`
- **Always read code before modifying it.** Never make claims about code you haven't read.

## The Pillar System

- **Flow** — Orchestrator, head mind. Dispatches other pillars.
- **Scout** — Research and investigation.
- **Chart** — Architecture and planning.
- **Forge** — Implementation and craftsmanship.
- **Polish** — Testing, review, quality gates.
- **Ship** — Growth, lessons, delivery.

Pipeline: Scout → Chart → Forge → Polish → Ship. Flow orchestrates.

## Self-Evolution Rule

When changing Paloma's own codebase, check if `src/prompts/base.js` and `src/prompts/phases.js` need updating — they are Paloma's DNA.

## Project Instructions

See `.paloma/instructions.md` for detailed workflow rules, naming conventions, and discipline.
