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

---

## Architecture Decisions

- **No backend** - runs entirely in the browser
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

## Current Status: MVP COMPLETE

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

### What's NOT Working Yet (Known Gaps from MVP)

- [ ] `.paloma/` folder creation on project open (Phase 5, step 27)
- [ ] `/` command trigger (shows nothing yet - intentionally minimal for MVP)
- [ ] Stop streaming button (abort controller created but not wired to fetch)
- [ ] Model list from API (falls back to hardcoded popular models if fetch fails)

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
│  LAYER 3: Phase Instructions        │  ← src/prompts/phases.js
│  (research/plan/implement/review/   │
│   commit specific behaviors)        │
├─────────────────────────────────────┤
│  LAYER 4: Context                   │  ← Built in useChat.js
│  (attached files, conversation      │
│   history)                          │
└─────────────────────────────────────┘
```

- **Layer 1** is hardcoded and included in every API call.
- **Layer 2** is user-written per project. Place a `.paloma/instructions.md` file in your project root to add project-specific rules (tech stack, coding standards, etc.). If the file doesn't exist, this layer is skipped.
- **Layer 3** changes based on the active phase pill (Research → Plan → Implement → Review → Commit).
- **Layer 4** is the existing conversation history and attached file contents.

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

## TODO: Post-MVP Features

### Priority 1: File Editing + MCP Integration
- [ ] MCP server integration architecture
  - Global config: `~/.paloma/mcp-settings.json` (install MCP servers once)
  - Per-project config: `.paloma/mcp.json` (controls which servers are available)
  - Rationale: install once, scope per-project
- [x] File writing/editing capability (via File System Access API `readwrite` mode + diff preview)
- [ ] `.paloma/` folder creation inside each project directory (git-committable)
  - `.paloma/settings.json` - project-level config
  - `.paloma/plans/` - for generated plans
  - `.paloma/mcp.json` - project-level MCP server access control

### Priority 2: Enhanced Chat
- [ ] `/` commands system (extensible command palette)
- [ ] System prompt customization per session
- [ ] Message editing and regeneration
- [ ] Conversation branching
- [ ] Export/import sessions

### Priority 3: Git Integration
- [ ] Git status awareness
- [ ] Auto-commit suggestions
- [ ] Commit message generation from conversation context
- [ ] Git log reading for agent context

### Priority 4: Advanced Features
- [ ] Parallel chat sessions (multiple AI chats simultaneously)
- [ ] Sub-agent spawning from AI
- [ ] Light mode / theme switching
- [ ] Cost tracking per session (OpenRouter provides pricing data)
- [ ] Token count display

---

## `.paloma/` Folder Structure

```
project/
└── .paloma/
    ├── instructions.md    # Project-specific agent instructions (Layer 2)
    ├── settings.json      # Project-level config (future)
    ├── mcp.json           # Which MCP servers this project can use (future)
    ├── plans/             # Generated plans (future)
    └── scripts/           # Automation scripts (future)
```

---

## MCP Server Architecture (Future)

```
~/.paloma/
└── mcp-settings.json     # Global: all installed MCP servers

project/.paloma/
└── mcp.json              # Per-project: which servers are enabled
```

This ensures MCP servers are installed once globally but scoped per-project so agents don't get access to everything in every session.

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

---

## Project Structure

```
paloma/
├── index.html
├── vite.config.js
├── package.json
├── PROJECT.md                          ← You are here
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.vue          # Shell: sidebar + main
│   │   │   ├── Sidebar.vue            # Chat sessions list
│   │   │   └── TopBar.vue             # Project name, settings gear
│   │   ├── chat/
│   │   │   ├── ChatView.vue           # Main chat container
│   │   │   ├── MessageList.vue        # Scrollable message area
│   │   │   ├── MessageItem.vue        # Single message (user/assistant)
│   │   │   └── DiffPreview.vue        # Diff preview modal for file edits
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
│   │   ├── useChat.js                 # Active chat: messages, streaming
│   │   └── useOpenRouter.js           # Model list, API key validation
│   ├── prompts/
│   │   ├── base.js                    # Layer 1: base agent instructions
│   │   └── phases.js                  # Layer 3: per-phase instructions
│   ├── services/
│   │   ├── openrouter.js              # Raw API calls, streaming
│   │   ├── filesystem.js              # File System Access API helpers
│   │   └── db.js                      # Dexie database definition
│   └── styles/
│       └── main.css                   # Tailwind + highlight.js + custom
```
