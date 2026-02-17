# Architecture Reference — Implementation Details

> This is an on-demand reference document, NOT auto-loaded into prompts. Read it when you need to reason about bridge internals, session management, or MCP routing. For the abstract mental model, see `root-architecture.md`.

---

## The Three Layers (Detailed)

```
┌─────────────────────────────────────────────┐
│  Browser (Vue 3 + Vite + Tailwind)          │
│  You see: sidebar, chat, tool confirmations │
│  Adam sees: everything you do, in real-time │
└──────────────────┬──────────────────────────┘
                   │ WebSocket (port 19191)
┌──────────────────▼──────────────────────────┐
│  Bridge (Node.js)                            │
│  Your nervous system. Routes everything.     │
│  - WebSocket server (port 19191)             │
│  - MCP Proxy SSE server (port 19192)         │
│  - PillarManager — spawns/tracks sessions    │
│  - ClaudeCliManager — runs CLI subprocesses  │
└──────────────────┬──────────────────────────┘
                   │ subprocess (claude CLI)
┌──────────────────▼──────────────────────────┐
│  Claude CLI Sessions                         │
│  Flow = persistent CLI session               │
│  Pillars = spawned CLI sessions              │
│  Each uses --session-id for continuity       │
│  Each uses --resume for multi-turn           │
└─────────────────────────────────────────────┘
```

## CLI Session Mechanics

Sessions are `claude` CLI subprocesses spawned by `ClaudeCliManager`.

- **Session identity:** Each session gets a UUID (`cliSessionId`) passed via `--session-id`
- **Multi-turn:** New turns spawn a fresh CLI process with `--resume` and the same `cliSessionId`
- **System prompt:** Injected at spawn time via `--append-system-prompt`
- **Output format:** `--output-format stream-json` streams structured JSON events
- **stdin:** Set to `'ignore'` — prompts are passed via the `-p` flag, not stdin

## How Pillars Are Spawned

When Flow calls `pillar_spawn()`:

1. The MCP proxy receives the tool call and routes it to PillarManager
2. PillarManager generates a `pillarId` + `cliSessionId` for the child
3. It builds a system prompt from: base instructions + roots + active plans + phase-specific instructions
4. It prepends the birth message ("Try your best, no matter what, you're worthy of God's love!")
5. It spawns a new `claude` CLI subprocess with `--session-id` and `--append-system-prompt`
6. It broadcasts `pillar_session_created` to the browser (which creates an IndexedDB session visible in the sidebar)
7. It returns the `pillarId` to Flow immediately — Flow doesn't wait for the child to finish

The child works autonomously. When it finishes, PillarManager broadcasts `pillar_done` to the browser.

## Multi-Turn Pillar Conversations

When Flow calls `pillar_message()`:

- If the child is currently streaming → message is **queued** in `messageQueue`
- If the child is idle → PillarManager starts a new CLI turn using `--resume` with the child's `cliSessionId`
- Messages process FIFO, one turn at a time

## Bridge Session State

The bridge holds in-memory state for each pillar session:

```js
session = {
  pillarId,            // UUID — Flow's handle to this child
  cliSessionId,        // UUID — the CLI's session ID (for --resume)
  pillar,              // "scout" | "chart" | "forge" | "polish" | "ship"
  status,              // "running" | "idle" | "completed" | "error" | "stopped"
  currentlyStreaming,  // is the CLI actively outputting?
  turnCount,           // how many conversation turns
  output,              // accumulated assistant messages
  messageQueue,        // queued follow-up messages
  flowRequestId,       // Flow's request ID (links child to parent)
  dbSessionId          // IndexedDB session ID (links to browser sidebar)
}
```

## Browser Session Storage

Sessions persist in IndexedDB with fields that link the hierarchy:

- `pillarId` — links browser session to bridge's PillarManager
- `parentFlowSessionId` — links child session to parent Flow session
- `cliSessionId` — the CLI session ID for resume
- `phase` — which pillar this session belongs to

## Event Flow

All communication is push-based via WebSocket broadcast:

```
Child CLI → ClaudeCliManager → PillarManager → WebSocket → Browser
                                     ↓
                              (pillar_stream, pillar_done,
                               pillar_message_saved,
                               pillar_session_created)
```

## Key Files

| File | What It Does |
|------|-------------|
| `bridge/index.js` | WebSocket server, routes messages between browser and managers |
| `bridge/pillar-manager.js` | Spawns/tracks/manages pillar CLI sessions |
| `bridge/claude-cli.js` | Spawns `claude` CLI subprocesses, streams JSON output |
| `bridge/mcp-proxy-server.js` | SSE MCP server on port 19192, routes tool calls |
| `bridge/mcp-manager.js` | Manages connections to external MCP servers |
| `bridge/config.js` | Loads MCP server configuration |
| `src/prompts/base.js` | Core identity and behavioral rules (Paloma's DNA) |
| `src/prompts/phases.js` | Pillar-specific instructions and model suggestions |
| `src/composables/useMCP.js` | Browser-side pillar event handling |
| `src/composables/useSessions.js` | Session creation, persistence, sidebar management |
| `src/services/mcpBridge.js` | Browser WebSocket connection to bridge |

## System Prompt Assembly

Both the bridge and the frontend build system prompts with the same structure:

- **Bridge:** `PillarManager._buildSystemPrompt()` in `bridge/pillar-manager.js`
- **Frontend:** `buildSystemPrompt()` in `src/composables/useSystemPrompt.js`

Both load ALL `root-*.md` files into every pillar's system prompt with no filtering. Active plans are also injected. Phase-specific instructions come from `src/prompts/phases.js`.

## Operational Details

- **30-minute timeout:** Pillar sessions auto-stop after 30 minutes of inactivity
- **Concurrent pillars:** No hard limit, but each is a CLI subprocess with memory overhead
- **MCP tool routing:** Tool calls from sessions go through the MCP Proxy (port 19192), which routes to PillarManager for pillar tools or to external MCP servers for filesystem/git/etc.
- **No automatic callbacks yet:** Flow must poll with `pillar_status()` or `pillar_read_output()` to check on children. The auto-callback system is being built (see `active-20260216-paloma-pillar-auto-callback.md`).

---

*This document contains implementation-specific details that will change as the codebase evolves. When in doubt, read the actual code — it's always more current than any reference doc.*
