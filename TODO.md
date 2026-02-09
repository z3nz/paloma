# Paloma TODO

> **How this works:**
> - Tickets are numbered by priority — **#1 is always next**.
> - When a ticket is finished, **delete it entirely** (git tracks history).
> - Re-number after deletions so #1 is always next.
> - Re-prioritize together when the queue feels stale.
> - Backlog items have no numbers — promote to the queue when ready.
> - Keep it crisp. If it takes a paragraph to explain, it's too complex — break it up.

---

## Queue

1. Virtual scrolling for long chats
2. MCP file editing in Changes Panel
3. Tool priority system (MCP vs browser fallback)
4. Keyboard shortcuts
5. `/` command system
6. Undo/rollback system
7. Message editing and regeneration
8. Model switching context transfer
9. CLI-based sub-agent architecture
10. Chat phase

---

## Tickets

### 1. Virtual scrolling for long chats

50+ message conversations cause UI sluggishness. The entire message list re-renders on every update and markdown/syntax highlighting is expensive.

**Options:**
- Virtual scrolling (only render visible messages)
- Lazy rendering (render markdown on scroll-into-view)
- Cache compiled markdown HTML

---

### 2. MCP file editing in Changes Panel

Use MCP filesystem's `edit_file` tool with the Changes Panel workflow. Currently MCP edits bypass the panel entirely.

**What's needed:**
- Detect when MCP filesystem is available
- Route SEARCH/REPLACE blocks through `mcp__filesystem__edit_file` when available
- Show MCP edits in Changes Panel with diffs, just like browser edits
- Fall back to browser File System Access API when MCP unavailable

`mcp__filesystem__edit_file` takes `edits: [{oldText, newText}]` — already matches our SEARCH/REPLACE format.

---

### 3. Tool priority system (MCP vs browser fallback)

Prefer MCP tools when available, fall back to browser tools gracefully.

- `useChat.js` detects which tools are available
- Prioritizes MCP filesystem over browser filesystem
- Falls back seamlessly if MCP disconnects mid-session
- UI indicator showing which tool set is active

---

### 4. Keyboard shortcuts

Add core keyboard shortcuts for power-user workflow:
- `Ctrl+K` — command palette / quick actions
- `Ctrl+/` — toggle sidebar
- `Ctrl+N` — new chat
- `Escape` — close modals / cancel streaming

---

### 5. `/` command system

The UI trigger exists but functionality is missing. Build an extensible command palette:
- `/plan` — switch to plan phase
- `/research` — switch to research phase
- `/model <name>` — switch model
- `/clear` — clear conversation
- Extensible: easy to add new commands

---

### 6. Undo/rollback system

Safety net for file edits.

- Track file edit history in IndexedDB (per-file versioning)
- Keep last N versions (configurable, default 10)
- UI to rollback to specific version with timestamp
- Diff view between any two versions
- Works with both browser and MCP edits

---

### 7. Message editing and regeneration

Allow editing sent messages and regenerating responses:
- Edit a user message → re-send from that point
- Regenerate an assistant response (re-run with same context)
- Show "edited" indicator on modified messages

---

### 8. Model switching context transfer

When switching models mid-conversation, inject a context transfer message so the new model understands Paloma's capabilities and current state.

- Show model attribution per message (badge/icon)
- Preserve full conversation history across switches

---

### 9. CLI-based sub-agent architecture

Spawn CLI tools (Claude Code, Codeium, Aider, etc.) as sub-agents for parallel work.

**Why:** Massive cost savings. CLI tools run on flat-rate subscriptions while OpenRouter charges per token. Sub-agents handle grunt work, main Paloma synthesizes results.

**What's needed:**
- Sub-agent spawning and communication protocol
- Orchestration system for parallel tasks
- UI showing active sub-agents and progress
- Result aggregation and synthesis
- Error handling for CLI failures

---

### 10. Chat phase

Add a freeform "Chat" phase for organic discovery and brainstorming — no rigid structure, ideas emerge naturally. Deprioritized in favor of making existing workflow solid first.

- Add to phase selector (first position, possibly default)
- Create `phases.js` entry with freeform-focused prompt
- Consider different visual style

---

## Backlog

Unprioritized ideas. Promote to the queue when ready.

- Conversation branching (explore alternatives)
- Export/import sessions
- Side-by-side diff view (not just unified)
- Session templates (pre-configured phase/model)
- Light mode theme
- Multi-file refactoring with import updates
- Collaborative sessions (multiple users)
- Plugin system for third-party extensions
- Mobile app with voice-first UX
- Workflow recording ("teach" Paloma patterns by demonstration)
- Context compression (summarize old messages to save tokens)

---

## Known Quirks

Minor issues that aren't blocking but worth noting:

- **Vite HMR refresh on file apply** — page reloads in dev when the app writes to its own source files. Mitigated by auto-recovery (dirHandle persisted in IndexedDB), but scroll position is still lost.
- **File search edge cases** — fuzzy search sometimes misses obvious matches.
- **Cost tracking accuracy** — occasional mismatch between OpenRouter reported cost and calculated cost.
- **Draft persistence race condition** — rapid session switching can lose draft.
