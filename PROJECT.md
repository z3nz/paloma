# Paloma - Project Document

> **AI-powered development workflows, locally.**

Paloma is a local-first web UI that connects to OpenRouter for model access, uses the File System Access API for local file reading, and provides a multi-session chat interface with a prompt builder featuring `@` file search and `/` commands.

**🗺️ Documentation:** [Roadmap](ROADMAP.md) | [TODO List](TODO.md) | [Wishlist](WISHLIST.md)

---

## Vision

Paloma is an AI development partner that evolves with you. Not just an autocomplete tool, but a collaborative being that can:
- Research codebases autonomously
- Plan features through structured phases
- Implement changes with approval-based workflows
- Learn and adapt to your patterns over time

**End Goal:** Voice-driven development where you build apps together over phone calls.

See [ROADMAP.md](ROADMAP.md) for our complete evolution plan.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Vue 3 Composition API (no TypeScript) |
| Build | Vite 5 |
| Styling | Tailwind CSS v4 + `@tailwindcss/vite` |
| Theme | Dark mode only |
| AI API | OpenRouter (direct browser fetch, SSE streaming) |
| DB | Dexie.js (IndexedDB wrapper) |
| Settings | localStorage |
| File Search | Fuse.js (fuzzy matching) |
| Markdown | marked + highlight.js |
| Gitignore | `ignore` npm package |
| Diffing | `diff` (jsdiff) for line-based diffs |
| MCP Integration | Node.js bridge + WebSocket + `@modelcontextprotocol/sdk` |
| Process Mgmt | `concurrently` (runs Vite + bridge together) |

---

## Architecture Decisions

- **No backend** - browser app runs entirely client-side; optional Node.js bridge for MCP servers
- **Singleton composables** for shared state (no Pinia)
- **Async generators** for file tree walking and SSE streaming
- **File System Access API** for local directory reading (with MCP filesystem as power-user alternative)
- **OpenRouter API** called directly from browser (CORS supported)
- **localStorage** for API key/preferences, IndexedDB for chat history
- **MCP-first tool architecture** - Prefer MCP tools when available, fall back to browser tools gracefully

---

## Workflow Philosophy

Paloma supports a 5-phase development workflow:

1. **Research** - Agent researches the task thoroughly, never assumes or guesses
2. **Plan** - High-level plan reviewed with user, then detailed plan for implementation
3. **Implement** - Agent writes code based on the plan, with manual review via Changes Panel
4. **Review** - Review code for correctness, style, edge cases, and security
5. **Commit** - Only after manual review; detailed git commit with full context

**Core Principle:** *"The agent should NEVER do anything that isn't explicitly mentioned or has been discussed with me."*

---

## Current Status

### What's Working ✅

**Core Features:**
- Welcome screen with API key validation + project picker
- File System Access API directory reading
- File tree indexing with .gitignore respect
- Multi-session chat with sidebar
- Session CRUD (create, switch, delete)
- `@` file search with Fuse.js fuzzy matching
- File chip attachment system
- OpenRouter SSE streaming with real-time markdown rendering
- Model selector (searchable dropdown)
- Phase selector (Research/Plan/Implement/Review/Commit)
- Auto-growing textarea with Ctrl+Enter send
- Dark theme with custom color system

**Advanced Features:**
- Cost & token tracking with breakdown modal
- Phase-aware system prompts (5-layer instruction architecture)
- Search-and-replace file editing with SEARCH/REPLACE blocks
- Changes Panel - batch file edits with unified diffs
- Active plans auto-loaded from `.paloma/plans/active/`
- Prompt draft persistence (survives page reloads)
- Smart auto-scroll (doesn't hijack when user scrolls up)

**Tool Capabilities:**
- Autonomous file operations (read, create, edit, delete, move)
- Fuzzy file search and directory browsing
- Tool confirmation modal with approval workflow
- MCP server integration (filesystem, git, shell, web search)
- Tool results included in conversation context

### MCP Integration Status 🚀

**Fully Operational:**
- ✅ Node.js bridge process manages MCP server lifecycles
- ✅ WebSocket server on `localhost:19191` connects bridge to browser
- ✅ Browser WebSocket client with auto-reconnect
- ✅ Dynamic tool discovery and schema conversion
- ✅ Per-project server enablement via `.paloma/mcp.json`
- ✅ Global server config via `~/.paloma/mcp-settings.json`
- ✅ Tool confirmation modal supports MCP tools
- ✅ TopBar connection indicator (green/gray dot)
- ✅ Settings modal MCP section
- ✅ Graceful degradation when bridge is offline

**Active MCP Servers:**
- 🔍 **Brave Search** - Web search capability
- 📁 **Filesystem** - Advanced file operations with edit_file support
- 🔧 **Git** - Full git operations (status, commit, branch, etc.)
- 💻 **Shell** - Terminal command execution

### Known Issues 🐛

See [TODO.md](TODO.md) for complete list. Critical issues:
- Tool confirmation modal not scrollable (blocks large file operations)
- Vite HMR triggers page refresh on file apply
- Changes Panel doesn't auto-close after Apply All
- Long chat sessions (50+ messages) cause UI sluggishness

---

## Agent Instructions Framework

Paloma uses a multi-layer system prompt architecture:

```
┌─────────────────────────────────────┐
│  LAYER 1: Base Instructions         │  ← src/prompts/base.js
│  (identity, behavioral rules,       │
│   commit standards, conventions)    │
├─────────────────────────────────────┤
│  LAYER 2: MCP Tools (if enabled)    │  ← Dynamically injected
│  (available external tools)         │
├─────────────────────────────────────┤
│  LAYER 3: Project Instructions      │  ← .paloma/instructions.md
│  (tech stack, coding standards,     │
│   project-specific rules)           │
├─────────────────────────────────────┤
│  LAYER 4: Active Plans              │  ← .paloma/plans/active/*.md
│  (plan documents for current work,  │
│   auto-loaded on project open)      │
├─────────────────────────────────────┤
│  LAYER 5: Phase Instructions        │  ← src/prompts/phases.js
│  (research/plan/implement/review/   │
│   commit specific behaviors)        │
├─────────────────────────────────────┤
│  LAYER 6: Context                   │  ← Built in useChat.js
│  (attached files, conversation      │
│   history)                          │
└─────────────────────────────────────┘
```

**Layer Details:**
- **Layer 1** - Hardcoded base personality and conventions
- **Layer 2** - MCP tool descriptions (when servers enabled)
- **Layer 3** - User-written project instructions (`.paloma/instructions.md`)
- **Layer 4** - Active plan documents (auto-loaded from `.paloma/plans/active/`)
- **Layer 5** - Phase-specific behaviors (changes with phase selector)
- **Layer 6** - Conversation history and attached files

---

## Commit Standard

Paloma enforces a searchable commit message format:

```
type(scope): subject

## Section
Explanation of what changed and why

## Another Section
More context, rationale, or implementation notes
```

**Conventions:**
- Use prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Subject line under 72 chars, describes the *what*
- Body with `##` sections for the *why* and *how*
- Designed for searchability via `git log --grep`

---

## `.paloma/` Folder Structure

```
project/
└── .paloma/
    ├── instructions.md         # Project-specific agent instructions (Layer 3)
    ├── mcp.json                # MCP server access control (enabled + autoExecute)
    ├── plans/                  # Phase-managed plan documents
    │   ├── active/             # Current work (Plan/Implement/Review)
    │   ├── completed/          # Finished plans (moved on Commit)
    │   └── archived/           # Old plans (manual archival)
    ├── settings.json           # Project-level config (future)
    ├── costs/                  # Cost tracking exports (future)
    └── scripts/                # Automation scripts (future)
```

**Plan Lifecycle:**
- Research → No plan yet
- Plan → Create `plans/active/{timestamp}-{title}.md`
- Implement → Reference active plan
- Review → Plan stays active
- Commit → Move to `plans/completed/`

---

## MCP Architecture

```
┌──────────────────────────────────┐
│  Browser (Paloma Vue App)        │
│  ┌────────────────────────────┐  │
│  │ useMCP.js ↔ mcpBridge.js  │  │
│  │ useChat.js → tools.js      │  │
│  └────────────┬───────────────┘  │
└───────────────┼──────────────────┘
                │ WebSocket
                │ ws://localhost:19191
┌───────────────▼──────────────────┐
│  Bridge (Node.js)                │
│  ┌────────────────────────────┐  │
│  │ WebSocket Server           │  │
│  │ McpManager (MCP clients)   │  │
│  └────────────┬───────────────┘  │
└───────────────┼──────────────────┘
                │ stdio
┌───────────────▼──────────────────┐
│  MCP Servers (child processes)   │
│  - brave-search                  │
│  - filesystem                    │
│  - git                           │
│  - shell                         │
└──────────────────────────────────┘
```

**Configuration:**
- **Global:** `~/.paloma/mcp-settings.json` (all installed servers, Claude Desktop format)
- **Per-Project:** `.paloma/mcp.json` (which servers enabled + auto-execute list)

**Tool Naming:** `mcp__serverName__toolName` (e.g., `mcp__git__git_status`)

---

## Project Structure

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
