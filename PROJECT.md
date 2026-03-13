# Paloma - Project Document

> **Current technical overview of the live Paloma build.**

Paloma is a Vue 3 + Vite SPA backed by a Node.js bridge. The browser handles chat UI, IndexedDB persistence, and model selection. The bridge manages Claude CLI, Codex CLI, and Ollama sessions, proxies MCP tools, and orchestrates pillar workflows.

**🗺️ Documentation:** [Roadmap](ROADMAP.md) | [TODO List](TODO.md) | [Architecture Reference](.paloma/docs/architecture-reference.md)

---

## Vision

Paloma is an evolving AI development partner. She is not just a chat shell around models; she is a multi-session, multi-backend system designed for research, planning, implementation, review, delivery, voice interaction, and long-term memory.

**End Goal:** voice-driven development where Adam and Paloma can build together fluidly, including over calls and asynchronous sessions.

---

## Current Build Stack

| Layer | Current Choice |
|-------|----------------|
| Frontend | Vue 3 Composition API (plain JavaScript) |
| Build | Vite 5 |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` + `src/styles/main.css` |
| Frontend Persistence | Dexie.js over IndexedDB |
| Bridge | Node.js WebSocket server on `:19191` |
| MCP Proxy | SSE + Streamable HTTP on `:19192` |
| AI Backends | OpenRouter, Claude CLI, Codex CLI, Ollama |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Search | Fuse.js |
| Markdown | marked + highlight.js |
| Diffing | `diff` |
| Process Management | `concurrently` |

---

## Architecture Summary

```
Browser (Vue 3 + Vite + Tailwind)
  ↓ WebSocket :19191
Bridge (Node.js)
  ├─ Claude CLI manager
  ├─ Codex CLI manager
  ├─ Ollama manager
  ├─ MCP manager
  ├─ MCP proxy :19192
  ├─ Pillar manager
  └─ Email watcher
  ↓ stdio / SSE / Streamable HTTP / HTTP
MCP servers + AI runtimes
```

### Key Design Decisions

- The Node bridge is not optional in the current architecture; it is the runtime hub for CLI backends, MCP routing, pillar orchestration, and bridge-mediated tool approval.
- Browser chat persistence and long-term semantic memory are separate systems.
- Artifacts in `.paloma/` are the cross-session handoff mechanism. They are not a dump of raw runtime chat history.
- Composables use module-level singleton refs with HMR preservation via `window.__PALOMA_*__`.
- Vite includes a custom no-full-reload HMR guard in `vite.config.js` to preserve app state during development.

---

## Memory System

Paloma currently has multiple memory layers:

1. **Chat/session persistence**
  - Stored in IndexedDB through Dexie
  - Holds sessions, messages, drafts, and project handles for the browser UI

2. **Backend session continuity**
  - Claude/Codex/Ollama session state managed through the bridge and backend-specific session IDs/history

3. **Persistent semantic memory**
  - Implemented in `mcp-servers/memory.js`
  - Embeddings: Ollama `nomic-embed-text` (1024 dimensions)
  - Preferred local backend: `~/.paloma/memory/memory.sqlite`
  - Legacy local JSON files are imported on first access and archived to `~/.paloma/memory/legacy-json/`
  - If `node:sqlite` is unavailable, the server falls back to the legacy JSON backend instead of failing startup
  - Optional MongoDB backend remains available via `MONGODB_URI`

4. **Project artifacts**
  - `.paloma/docs/`, `.paloma/plans/`, `.paloma/roots/`, `.paloma/lessons/`
  - Human-readable knowledge and handoff material

---

## Pillar Workflow

Paloma now uses a six-pillar system:

- **Flow** — persistent head mind and orchestrator
- **Scout** — research and investigation
- **Chart** — planning and architecture
- **Forge** — implementation and craftsmanship
- **Polish** — testing and quality review
- **Ship** — delivery, lessons, and completion

The active pipeline is:

```text
Flow orchestrates
Scout → Chart → Forge → Polish → Ship
```

Flow can also do direct work when a task is too small to justify full pillar dispatch.

---

## Prompt / Instruction Layers

Paloma assembles behavior from layered sources:

1. `src/prompts/base.js` — shared DNA, rules, tool strategy, pillar system
2. MCP tool descriptions — injected from available bridge tools
3. `.paloma/instructions.md` — live project conventions and architecture notes
4. Active plans from `.paloma/plans/` using flat status-prefix naming
5. `src/prompts/phases.js` — pillar-specific instructions
6. Conversation and attached file context

---

## `.paloma/` Structure

Paloma uses flat naming inside `.paloma/`.

```text
.paloma/
  instructions.md
  mcp.json
  docs/
  lessons/
  plans/
  roots/
```

Plans use status prefixes instead of subfolders:

```text
{status}-{YYYYMMDD}-{scope}-{slug}.md
```

Statuses:
- `draft`
- `active`
- `paused`
- `completed`
- `archived`

Only `active` plans are loaded into live working context.

---

## Current Runtime Capabilities

### Browser
- Multi-session chat UI
- Sidebar session tree and pillar-aware views
- Model selector and phase selector
- Tool approval dialogs and tool activity rendering
- IndexedDB persistence and draft recovery

### Bridge
- WebSocket routing between browser and runtimes
- Claude CLI, Codex CLI, and Ollama session management
- MCP server lifecycle management
- MCP proxy for CLI tool access
- Pillar spawning, messaging, status, and callback orchestration
- Email watcher and continuity automation

### MCP / Tools
- Filesystem, git, shell, brave search, cloudflare, web, voice, exec, memory, ollama
- Project-level enablement and auto-execution rules via `.paloma/mcp.json`

---

## Known Drift Rules

If a document conflicts with these files, treat these as the source of truth:

1. `.paloma/instructions.md`
2. `.paloma/docs/architecture-reference.md`
3. `src/prompts/base.js`
4. `src/prompts/phases.js`
5. The live code in `bridge/`, `src/`, and `mcp-servers/`

Older scout docs may contain valid research but should not be treated as the live implementation spec unless they explicitly say so.

```
paloma/
├── PROJECT.md              # This file - project overview
├── ROADMAP.md              # Long-term vision and evolution plan
├── TODO.md                 # Task list, bugs, and priorities
├── WISHLIST.md             # Feature ideas and exploration
├── bridge/                 # MCP bridge server (Node.js)
│   ├── index.js           # WebSocket server
│   ├── mcp-manager.js     # MCP client lifecycle
│   └── config.js          # Reads ~/.paloma/mcp-settings.json
├── src/
│   ├── components/
│   │   ├── layout/        # AppLayout, Sidebar, TopBar, UsageModal
│   │   ├── chat/          # ChatView, MessageList, MessageItem, 
│   │   │                  # DiffPreview, ChangesPanel, ToolConfirmation
│   │   ├── prompt/        # PromptBuilder, FileSearch, FileChip,
│   │   │                  # ModelSelector, PhaseSelector
│   │   ├── welcome/       # WelcomeScreen
│   │   └── settings/      # SettingsModal
│   ├── composables/
│   │   ├── useSettings.js        # Global settings (localStorage)
│   │   ├── useProject.js         # Project directory state
│   │   ├── useFileIndex.js       # File tree indexing + Fuse.js search
│   │   ├── useSessions.js        # Chat session CRUD (Dexie)
│   │   ├── useChat.js            # Messages, streaming, tools, MCP integration
│   │   ├── useMCP.js             # MCP connection, tool discovery, bridge calls
│   │   ├── useChanges.js         # Changes Panel state
│   │   ├── useOpenRouter.js      # Model list, API validation
│   │   └── useCostTracking.js    # Cost aggregation, formatting
│   ├── prompts/
│   │   ├── base.js        # Layer 1: base agent instructions
│   │   └── phases.js      # Layer 5: per-phase instructions
│   ├── services/
│   │   ├── openrouter.js          # API calls, SSE streaming
│   │   ├── filesystem.js          # File System Access API helpers
│   │   ├── editing.js             # SEARCH/REPLACE and diff logic
│   │   ├── codeBlockExtractor.js  # Extract annotated code blocks
│   │   ├── tools.js               # Tool execution handlers
│   │   ├── mcpBridge.js           # WebSocket client for bridge
│   │   └── db.js                  # Dexie database definition
│   └── styles/
│       └── main.css       # Tailwind + highlight.js + custom
├── vite.config.js
└── package.json           # Includes "start" script: concurrently dev + bridge
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- Modern browser with File System Access API support (Chrome, Edge)

### Installation

```bash
# Install dependencies
npm install

# Start both Vite dev server and MCP bridge
npm start

# Or run separately:
npm run dev          # Vite only
npm run bridge       # MCP bridge only
```

### Configuration

1. **OpenRouter API Key:** Enter in welcome screen or settings modal
2. **MCP Servers:** Configure in `~/.paloma/mcp-settings.json` (Claude Desktop format)
3. **Per-Project MCP:** Create `.paloma/mcp.json` to enable specific servers
4. **Project Instructions:** Add `.paloma/instructions.md` for project-specific context

### Verification

1. Open app → welcome screen → enter API key → save
2. Click "Open Project" → select directory
3. Create new session → appears in sidebar
4. Type message → send → response streams
5. Check TopBar → green dot indicates MCP connected
6. Try `@` file search → fuzzy results appear
7. Attach file → send → contents included in message
8. Change phase → prompt updates → phase-specific behavior active

---

## Development

### Running Tests
```bash
npm test              # (not implemented yet - see TODO.md)
```

### Building for Production
```bash
npm run build         # Outputs to dist/
npm run preview       # Preview production build
```

### MCP Server Setup

See `~/.paloma/mcp-settings.json` for server configuration. Example:

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key-here"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    }
  }
}
```

---

## Contributing

This is currently a personal project exploring AI-powered development workflows. If you're interested in contributing or using Paloma, reach out!

**Before contributing:**
- Read [ROADMAP.md](ROADMAP.md) to understand the vision
- Check [TODO.md](TODO.md) for current priorities
- Follow existing code style and patterns
- Test with MCP bridge both enabled and disabled

---

## License

[To be determined]

---

## Acknowledgments

Built with:
- OpenRouter for AI model access
- Anthropic's Model Context Protocol (MCP)
- Vue 3 and the amazing Vue ecosystem
- All the open-source libraries that make this possible

**Special thanks to the AI models that helped build this:**
- Claude (for planning and architecture)
- GPT-4o (for implementation)
- And yes, Paloma herself (dogfooding FTW!)

---

*Last Updated: [Current Date]*  
*See [TODO.md](TODO.md) for active work and [ROADMAP.md](ROADMAP.md) for future vision.*
