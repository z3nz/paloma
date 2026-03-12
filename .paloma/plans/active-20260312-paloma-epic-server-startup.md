# Epic Server Startup & Progress System

**Created:** 2026-03-12
**Status:** Active
**Scope:** paloma bridge, MCP servers, terminal UX

## Goal

Transform Paloma's `npm start` into a visually stunning, informative startup experience. Add progress bars and status indicators for all background processes (MCP servers, email watcher, pillar sessions).

## Requirements

1. **Epic ASCII art banner** — Paloma branding on startup, color-coded and beautiful
2. **Progress bars for MCP server startup** — Each server shows loading → success/fail with tool count
3. **Aggregate startup summary** — "All systems nominal" with server/tool counts, ports, uptime
4. **Progress indicators for background processes:**
   - Email watcher status (polling, new email received)
   - Pillar sessions (spawning, running, completed, with pillar name)
   - MCP proxy connection events
5. **Color-coded logging** — Categorized by subsystem (bridge, MCP, email, pillar, etc.)
6. **Graceful shutdown banner** — Clean shutdown messaging

## Architecture Notes

- **Entry point:** `bridge/index.js` — main startup orchestration
- **MCP startup:** `bridge/mcp-manager.js` — parallel server spawning via `Promise.allSettled()`
- **Email watcher:** `bridge/email-watcher.js` — Gmail polling service
- **Pillar manager:** `bridge/pillar-manager.js` — session orchestration
- **MCP proxy:** `bridge/mcp-proxy-server.js` — CLI tool proxy on port 19192
- **npm start:** runs `concurrently` with vite + bridge

## Constraints

- No new npm dependencies if possible — use ANSI escape codes directly for colors/formatting
- Must work in `concurrently` output (bridge prefixed with `[bridge]`)
- Keep it performant — no blocking delays for visual effect
- Must not break existing WebSocket/MCP functionality

## Pipeline

- [x] Scout — Research terminal art, ANSI codes, progress bar patterns in Node.js → `.paloma/docs/scout-epic-startup-20260312.md`
- [x] Chart + Forge — Designed and implemented in Flow (scope was clear from Scout research)
  - New: `bridge/startup.js` — banner, step logger, summary, shutdown visuals
  - Modified: `bridge/mcp-manager.js` — progress callback on `startAll()` and `startServer()`
  - Modified: `bridge/index.js` — wired banner → progress → summary → shutdown
- [ ] Polish — Review code quality, test startup, verify all indicators work
- [ ] Ship — Commit and deliver
