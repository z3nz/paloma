# Paloma - Project Document

> AI-powered development workflows, locally.

Paloma is a local-first web UI that connects to OpenRouter for model access, uses the File System Access API for local file reading, and provides a multi-session chat interface with a prompt builder featuring `@` file search and `/` commands.

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
| Diffing | `diff` (jsdiff) for line-level diffs |
| MCP Bridge | Node.js + `ws` + `@modelcontextprotocol/sdk` |
| Process Mgmt | `concurrently` (runs Vite + bridge together) |

---

## Architecture Decisions

- **No backend** - browser app runs entirely client-side; optional Node.js bridge for MCP servers
- **Singleton composables** for shared state (no Pinia)
- **Async generators** for file tree walking and SSE streaming
- **File System Access API** for local directory reading
- **OpenRouter API** called directly from browser (CORS supported)
- **localStorage** for API key/preferences, IndexedDB for chat history

---

## User Workflow Philosophy

Paloma supports a 5-phase development workflow:

1. **Research** - Agent researches the task thoroughly, never assumes or guesses
2. **Plan** - High-level plan reviewed with user, then detailed plan for implementation
3. **Implement** - Cheaper model writes code based on the plan, with manual review
4. **Review** - Review code for correctness, style, edge cases, and security
5. **Commit** - Only after manual review; detailed git commit with full context

Core principle: "The agent should NEVER do anything that isn't explicitly mentioned or has been discussed with me."

---

## Current Status: MVP COMPLETE + Tool Capabilities

### What's Working

- [x] Welcome screen with API key validation + project picker
- [x] File System Access API directory reading
- [x] File tree indexing with .gitignore respect
- [x] Dexie IndexedDB for sessions and messages
- [x] Multi-session chat with sidebar
- [x] Session CRUD (create, switch, delete)
- [x] `@` file search with Fuse.js fuzzy matching
- [x] File chip attachment system
- [x] File contents included in API calls
- [x] OpenRouter SSE streaming
- [x] Markdown rendering with syntax highlighting
- [x] Copy button on code blocks
- [x] Apply button on annotated code blocks (file editing via diff preview)
- [x] Model selector (searchable dropdown)
- [x] Phase selector (Research/Plan/Implement/Review/Commit)
- [x] Phase-aware system prompts (layered agent instructions framework)
- [x] Auto-growing textarea with Ctrl+Enter send
- [x] Session auto-titling from first message
- [x] Settings modal (API key, default model)
- [x] Dark theme with custom color system
- [x] Production build works clean
- [x] **Agent tool capabilities** - Autonomous file operations with user approval

### Agent Tool Capabilities

**Current Tools (Implemented):**
- ✅ `readFile(path)` - Read any file in the project autonomously
- ✅ `searchFiles(query)` - Fuzzy search file tree
- ✅ `listDirectory(path)` - Browse directory structure
- ✅ `fileExists(path)` - Check file existence
- ✅ `createFile(path, content)` - Create new files
- ✅ `deleteFile(path)` - Delete files
- ✅ `moveFile(fromPath, toPath)` - Rename/move files

**How Tools Work:**
- Agent can call tools during conversation to research and understand codebase
- Tool calls require user approval (shown in UI with confirmation modal)
- Tool results are included in conversation context
- Enables true autonomous research without manual file attachment

---

## Agent Instructions Framework

Paloma uses a multi-layer system prompt architecture that gives the agent a consistent personality and phase-aware behavior. Every message sent to OpenRouter includes a system prompt assembled from these layers:

```
┌─────────────────────────────────────┐
│  LAYER 1: Base Instructions         │  ← src/prompts/base.js
│  (identity, behavioral rules,       │
│   commit standards, conventions)    │
├─────────────────────────────────────┤
│  LAYER 2: Project Instructions      │  ← .paloma/instructions.md
│  (tech stack, coding standards,     │
│   project-specific rules)           │
├─────────────────────────────────────┤
│  LAYER 3: Active Plans              │  ← .paloma/plans/active/*.md
│  (plan documents for current work,  │
│   auto-loaded on project open)      │
├─────────────────────────────────────┤
│  LAYER 4: Phase Instructions        │  ← src/prompts/phases.js
│  (research/plan/implement/review/   │
│   commit specific behaviors)        │
├─────────────────────────────────────┤
│  LAYER 5: Context                   │  ← Built in useChat.js
│  (attached files, conversation      │
│   history)                          │
└─────────────────────────────────────┘
```

- **Layer 1** is hardcoded and included in every API call.
- **Layer 2** is user-written per project. Place a `.paloma/instructions.md` file in your project root to add project-specific rules (tech stack, coding standards, etc.). If the file doesn't exist, this layer is skipped.
- **Layer 3** is auto-loaded from `.paloma/plans/active/`. Plans are created in the Plan phase and archived in the Commit phase. If no active plans exist, this layer is skipped.
- **Layer 4** changes based on the active phase pill (Research → Plan → Implement → Review → Commit).
- **Layer 5** is the existing conversation history and attached file contents.

### Commit Standard

Paloma's base instructions enforce a commit message format:

- Conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Subject line under 72 chars describing the *what*
- Body with `##` sections explaining the *why* and *how*
- Commits designed to be searchable via `git log --grep`

### `.paloma/instructions.md`

Users can create this file in any project directory to provide project-specific instructions to the agent. Example:

```markdown
## Tech Stack
- Vue 3 Composition API, no TypeScript
- Tailwind CSS v4
- Vite 5

## Coding Standards
- Use singleton composables for shared state
- Prefer async generators for streaming patterns
- No Pinia — use composables with module-level refs
```

This file is read when a project is opened and included in every API call for that project.

---

## Completed Features

### ~~Cost & Token Tracking~~ DONE
- [x] Real-time cost display in top bar (session totals, clickable for details)
- [x] Per-message cost annotation on assistant messages
- [x] Token usage breakdown modal (prompt/completion/total + context bar)
- [x] Context limit warnings (banner at 80%+ capacity)
- [x] Cost tracking persisted on message objects in IndexedDB (no schema migration)
- [x] Model pricing from OpenRouter `/api/v1/models` API
- [x] Token counts captured from SSE stream `usage` field
- [x] Project total cost aggregated across all sessions

### ~~Phase-Based Document Workflow~~ DONE
- [x] `readActivePlans()` filesystem helper reads `.paloma/plans/active/*.md`
- [x] Active plans loaded on project open, stored as reactive ref in `useProject`
- [x] Active plan content injected into system prompt (between project instructions and phase instructions)
- [x] Plan refresh after tool calls that touch `.paloma/plans/`
- [x] Phase instructions guide agent through plan lifecycle (create → reference → archive)
- [x] Agent creates plans via `createFile`, archives via `moveFile` (both require user approval)

---

## TODO: Next Features

### ~~Priority 1: Search-and-Replace Formalization~~ DONE
- [x] SEARCH/REPLACE engine: `parseSearchReplace()`, `applySearchReplace()`, `resolveEdit()` in `editing.js`
- [x] Error handling (not found, multiple matches, empty search, new file)
- [x] Full-file fallback when no markers present
- [x] Individual Apply buttons on annotated code blocks via `DiffPreview.vue` modal
- [x] **Changes Panel** — Auto-detects annotated code blocks from completed agent responses
- [x] Right sidebar (`ChangesPanel.vue`) with file list, unified diffs, per-file and batch apply/dismiss
- [x] `codeBlockExtractor.js` extracts annotated blocks using `marked.lexer()`
- [x] `useChanges.js` singleton composable manages pending changes state
- [x] Resizable sidebar with drag handle
- [x] "Full Diff" button opens existing `DiffPreview` modal from sidebar
- [x] Multiple blocks for same file applied sequentially
- [x] Streaming completion watcher triggers change detection automatically

### Priority 2: Chat Performance & UI Stability
**Goal:** Fix page refreshes on apply, long-chat sluggishness, and Changes Panel UX gaps

**Known Issues — Apply triggers page refresh:**
- Clicking "Apply" or "Apply All" in the Changes Panel causes a full page refresh (Vite HMR detects the written file and reloads the page)
- This loses scroll position, collapses the sidebar state, and disrupts the workflow
- Root cause: `writeFile` writes to project files that Vite's dev server is watching — any .js/.vue file write triggers HMR, which can cascade into a full page reload
- Need to investigate: does this happen in production builds too, or only during `npm run dev`?
- Potential fixes:
  - [ ] Configure Vite to ignore writes from the app (custom watcher exclude?)
  - [ ] Debounce or batch file writes to reduce HMR churn
  - [ ] Preserve and restore scroll position across HMR reloads
  - [ ] Or accept HMR reload but ensure state fully restores (drafts + changes already persist via Dexie, but scroll position and expanded states do not)

**Known Issues — Changes Panel doesn't auto-close:**
- [ ] After "Apply All" completes (all files applied), the sidebar stays open showing all files as "Applied" — should auto-close or auto-dismiss once everything is applied
- [ ] After applying individual files one by one until none are pending, sidebar still shows — same issue
- Desired behavior: once no pending changes remain, either auto-dismiss after a short delay or collapse the panel

**Known Issues — Long chat performance:**
- Long conversations (50+ messages) cause noticeable UI sluggishness
- Entire message log re-renders on every load — expensive with markdown parsing + syntax highlighting per message
- Page becomes slow to interact with during and after long streaming responses
- Requirements:
  - [ ] Virtualize or lazy-render the message list for large conversations
    - Consider `vue-virtual-scroller` or manual intersection observer approach
    - Or lazy-render: only render last N messages, load more on scroll-up
    - Profile actual render cost to decide approach
  - [ ] Investigate whether MessageList re-renders can be reduced (component keys, `v-memo`, `shallowRef` for messages array, etc.)
  - [ ] Consider memoizing or caching rendered markdown HTML so re-renders don't re-parse
  - [ ] Test with 100+ message sessions to find the breaking point and set a target

**Completed (this sprint):**
- [x] ~~Allow user to scroll up during streaming without being yanked back to bottom~~ (smart auto-scroll, isNearBottom check)
- [x] ~~Persist prompt draft~~ (Dexie drafts table, per-session, debounced save)
- [x] ~~Persist Changes Panel state~~ (Dexie drafts table, per-session, survives reload)

### ~~Priority 3: MCP Server Integration~~ DONE
- [x] Node.js bridge process (`bridge/`) manages MCP server lifecycles via stdio
- [x] WebSocket server on `localhost:19191` connects bridge to browser
- [x] Browser WebSocket client (`mcpBridge.js`) with auto-reconnect and exponential backoff
- [x] `useMCP.js` composable — reactive connection state, tool discovery, schema conversion
- [x] Tool namespacing: `mcp__server__tool` (e.g., `mcp__brave-search__brave_web_search`)
- [x] MCP tools converted to OpenRouter function calling format automatically
- [x] Per-project enablement via `.paloma/mcp.json` (`enabled` + `autoExecute` arrays)
- [x] Global server config via `~/.paloma/mcp-settings.json` (Claude Desktop format)
- [x] Tool confirmation modal supports MCP tools (purple badge, shows server/tool/args)
- [x] MCP tool descriptions dynamically injected into system prompt
- [x] TopBar connection indicator (green/gray dot with server count)
- [x] Settings modal MCP section (URL, connect/disconnect, auto-connect, server list)
- [x] Graceful degradation — everything works without the bridge running
- [x] `npm start` runs both Vite and bridge via `concurrently`

### Priority 4: URL-Based Project Routing (was Priority 3)
**Goal:** Encode the project folder path in the URL so you can navigate directly to a project

**Requirements:**
- [ ] Project path encoded in URL (e.g. `/#/project/path/to/folder`)
- [ ] Opening a URL with a project path auto-opens that project
- [ ] Session ID in URL for direct linking to conversations
- [ ] Browser back/forward navigation works between projects/sessions
- [ ] Bookmarkable URLs for frequently used projects

### Priority 5: Known Gaps (was Priority 4)
**Goal:** Fix existing incomplete or broken functionality

- [ ] `.paloma/` folder creation on project open
- [ ] `/` command trigger (placeholder UI exists)
- [ ] Stop streaming button (abort controller exists but not wired)
- [ ] Model list from API (falls back to hardcoded popular models if fetch fails)

### Priority 6: Undo/Rollback System (was Priority 5)
- [ ] Track file edit history in IndexedDB (per-file versioning)
- [ ] Keep last N versions per file (configurable, default N=10)
- [ ] UI to rollback to previous version with timestamp
- [ ] Diff view between versions
- [ ] Persist history across sessions

### ~~Priority 6: Batch File Operations~~ DONE (via Changes Panel)
- [x] Queue multiple file edits in Changes Panel sidebar
- [x] Show combined preview of all changes with unified diffs
- [x] Apply All button for batch apply
- [x] Per-file apply/dismiss for granular control
- [ ] Atomic apply (all or nothing) — currently best-effort, continues on individual failures

### Priority 8: Model Switching as a Feature (was Priority 7)
**Goal:** Seamless model switching with full context transfer

**Current Behavior:**
- Model can be switched mid-conversation
- No onboarding for new model about Paloma's capabilities
- No clear indication of which model said what

**New Behavior:**
- [ ] Inject system context transfer message when model switches
- [ ] Show model attribution per message in UI
- [ ] Keep full conversation history visible to new model
- [ ] Auto-explain Paloma's tool capabilities to new model

**Use Case Workflow:**
1. Use GPT-4o for research (cheaper, good at analysis)
2. Switch to Claude Opus for implementation (better at coding)
3. Switch to GPT-4o-mini for commit messages (cheapest, good enough)
4. Each model sees full context and knows how to use tools

### Priority 9: Enhanced Features (was Priority 8)
- [ ] `/` commands system (extensible command palette)
- [ ] Message editing and regeneration
- [ ] Conversation branching (explore alternate paths)
- [ ] Export/import sessions (share workflows)
- [ ] Git integration (status, commit, log, branch awareness)
- [ ] Sub-agent spawning for parallel work
- [ ] Multi-file refactoring with automatic import updates
- [ ] Side-by-side diff view (not just unified)
- [ ] Keyboard shortcuts (Ctrl+K command palette, Ctrl+/ file search)
- [ ] Session templates (pre-configured phase/model combos)
- [ ] Light mode theme support

---

## `.paloma/` Folder Structure

```
project/
└── .paloma/
    ├── instructions.md         # Project-specific agent instructions (Layer 2)
    ├── settings.json           # Project-level config
    ├── mcp.json                # MCP server access control
    ├── plans/                  # Phase-managed plan documents
    │   ├── active/             # Current work (Plan/Implement/Review phases)
    │   ├── completed/          # Committed plans (moved on Commit phase)
    │   └── archived/           # Old plans (manual archival)
    ├── costs/                  # Cost tracking exports (future)
    └── scripts/                # Automation scripts (future)
```

**Phase-Based Document Lifecycle:**
- **Research Phase** → No plan document yet, exploring and understanding
- **Plan Phase** → Create `plans/active/{timestamp}-{title}.md`
- **Implement Phase** → Reference active plan, track progress in real-time
- **Review Phase** → Plan stays active for reference during review
- **Commit Phase** → Move plan to `plans/completed/`, clean up workspace

**Benefits:**
- All plans are git-committable artifacts with full history
- Searchable archive of development decisions and rationale
- Agent can reference previous plans for consistency
- Clean workspace separation (active vs completed vs archived)
- Automatic lifecycle management tied to development phases

---

## MCP Server Architecture

```
┌──────────────────────────────────┐
│  Browser (Paloma Vue App)        │
│                                  │
│  useMCP.js ←→ mcpBridge.js       │
│       ↕              ↕           │
│  useChat.js      WebSocket       │
│       ↕          (localhost)     │
│  tools.js                        │
└──────────┬───────────────────────┘
           │
┌──────────▼───────────────────────┐
│  bridge/ (Node.js process)       │
│                                  │
│  index.js (WebSocket server)     │
│  mcp-manager.js (MCP clients)    │
│  config.js (reads settings)      │
└──────────┬───────────────────────┘
           │ stdio
┌──────────▼───────────────────────┐
│  MCP Servers (child processes)   │
│  - brave-search, git, etc.       │
└──────────────────────────────────┘
```

**Configuration:**
```
~/.paloma/
└── mcp-settings.json     # Global: all installed MCP servers (Claude Desktop format)

project/.paloma/
└── mcp.json              # Per-project: which servers are enabled + autoExecute
```

MCP servers are configured once globally but scoped per-project. If `.paloma/mcp.json` doesn't exist in a project, no MCP tools are enabled (safe default). The `autoExecute` array lets specific servers skip the confirmation modal.

---

## Verification Checklist

1. **First launch**: Open app → welcome screen → enter API key → saves to localStorage
2. **Project open**: Click open project → select directory → file index builds
3. **New chat**: Create session → appears in sidebar
4. **File search**: Type `@` in prompt → fuzzy search works → attach file → chip appears
5. **Send message**: Send with attached files → file contents included in API call
6. **Streaming**: Response streams in real-time with markdown rendering
7. **Session switching**: Create 2 sessions → switch between → messages persist
8. **Phase tracking**: Change phase → persists on the session
9. **Model switching**: Change model mid-session → next message uses new model
10. **Persistence**: Refresh page → re-grant directory access → sessions/messages restored
11. **Tool usage**: Agent reads files autonomously → approval modal → results in context
12. **MCP bridge**: `npm start` → bridge + vite both running → TopBar shows green MCP dot
13. **MCP tools**: Enable server in `.paloma/mcp.json` → agent can call MCP tools → results flow back
14. **MCP graceful degradation**: Stop bridge → gray dot → chat still works with built-in tools

---

## Project Structure

```
paloma/
├── index.html
├── vite.config.js
├── package.json
├── PROJECT.md                          ← You are here
├── WISHLIST.md                         ← Detailed feature wishlist
├── bridge/                             # MCP bridge server (Node.js)
│   ├── package.json                   # Dependencies: ws, @modelcontextprotocol/sdk
│   ├── index.js                       # WebSocket server on localhost:19191
│   ├── mcp-manager.js                 # MCP client lifecycle management
│   └── config.js                      # Reads ~/.paloma/mcp-settings.json
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.vue          # Shell: sidebar + main
│   │   │   ├── Sidebar.vue            # Chat sessions list
│   │   │   ├── TopBar.vue             # Project name, cost display, settings
│   │   │   └── UsageModal.vue         # Token/cost breakdown modal
│   │   ├── chat/
│   │   │   ├── ChatView.vue           # Main chat container
│   │   │   ├── MessageList.vue        # Scrollable message area
│   │   │   ├── MessageItem.vue        # Single message (user/assistant)
│   │   │   ├── DiffPreview.vue        # Diff preview modal for file edits
│   │   │   ├── ChangesPanel.vue       # Right sidebar: batch changes with diffs
│   │   │   └── ToolConfirmation.vue   # Tool approval modal
│   │   ├── prompt/
│   │   │   ├── PromptBuilder.vue      # THE star component
│   │   │   ├── FileSearch.vue         # @ autocomplete dropdown
│   │   │   ├── FileChip.vue           # Attached file pill
│   │   │   ├── ModelSelector.vue      # OpenRouter model picker
│   │   │   └── PhaseSelector.vue      # Workflow phase picker
│   │   ├── welcome/
│   │   │   └── WelcomeScreen.vue      # First-launch setup
│   │   └── settings/
│   │       └── SettingsModal.vue       # API key, preferences
│   ├── composables/
│   │   ├── useSettings.js             # Global settings (localStorage)
│   │   ├── useProject.js              # Project directory state
│   │   ├── useFileIndex.js            # File tree indexing + Fuse.js search
│   │   ├── useSessions.js            # Chat session CRUD (Dexie)
│   │   ├── useChat.js                 # Active chat: messages, streaming, tools
│   │   ├── useMCP.js                  # MCP connection state, tool discovery, bridge calls
│   │   ├── useChanges.js              # Pending changes state (Changes Panel)
│   │   ├── useOpenRouter.js           # Model list, API key validation
│   │   └── useCostTracking.js         # Cost aggregation, formatting, project totals
│   ├── prompts/
│   │   ├── base.js                    # Layer 1: base agent instructions
│   │   └── phases.js                  # Layer 3: per-phase instructions
│   ├── services/
│   │   ├── openrouter.js              # Raw API calls, streaming
│   │   ├── filesystem.js              # File System Access API helpers
│   │   ├── editing.js                 # SEARCH/REPLACE and diff logic
│   │   ├── codeBlockExtractor.js      # Extract annotated code blocks from markdown
│   │   ├── tools.js                   # Tool execution handlers
│   │   ├── mcpBridge.js               # WebSocket client for MCP bridge
│   │   └── db.js                      # Dexie database definition
│   └── styles/
│       └── main.css                   # Tailwind + highlight.js + custom
```
