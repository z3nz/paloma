# Backlog — Open Work Items

> Consolidated from TODO.md on 2026-03-13. Completed items removed. Remaining items verified against current codebase.

---

## Queue

1. MCP file editing in Changes Panel
2. Keyboard shortcuts
3. Undo/rollback system
4. Message editing and regeneration
5. Model switching context transfer

---

## Tickets

### 1. MCP file editing in Changes Panel

Use MCP filesystem's `edit_file` tool with the Changes Panel workflow. Currently MCP edits bypass the panel entirely.

**What's needed:**
- Detect when MCP filesystem is available
- Route SEARCH/REPLACE blocks through `mcp__filesystem__edit_file` when available
- Show MCP edits in Changes Panel with diffs, just like browser edits
- Fall back to browser File System Access API when MCP unavailable

`mcp__filesystem__edit_file` takes `edits: [{oldText, newText}]` — already matches our SEARCH/REPLACE format.

---

### 2. Keyboard shortcuts

**Mostly complete.** Already implemented in `useKeyboardShortcuts.js`:
- ✅ `Ctrl+/` — toggle sidebar
- ✅ `Ctrl+N` — new chat
- ✅ `Ctrl+M` — toggle voice input
- ✅ `Escape` — close modals / cancel streaming
- ⬜ `Ctrl+K` — command palette / quick actions (needs new component)

---

### 3. Undo/rollback system

Safety net for file edits.

- Track file edit history in IndexedDB (per-file versioning)
- Keep last N versions (configurable, default 10)
- UI to rollback to specific version with timestamp
- Diff view between any two versions
- Works with both browser and MCP edits

---

### 4. Message editing and regeneration

Allow editing sent messages and regenerating responses:
- Edit a user message → re-send from that point
- Regenerate an assistant response (re-run with same context)
- Show "edited" indicator on modified messages

---

### 5. Model switching context transfer

When switching models mid-conversation, inject a context transfer message so the new model understands Paloma's capabilities and current state.

- ✅ Show model attribution per message (badge/icon) — already implemented in MessageItem.vue via `shortModelName` computed
- Preserve full conversation history across switches
- Backend switching already works (cliBackend tracking in useCliChat.js)

---

## Backlog (Unprioritized)

- Conversation branching (explore alternatives)
- Export/import sessions
- Side-by-side diff view (not just unified)
- Session templates (pre-configured pillar/model)
- Light mode theme
- Multi-file refactoring with import updates
- Collaborative sessions (multiple users)
- Plugin system for third-party extensions
- Mobile app with voice-first UX
- Workflow recording ("teach" Paloma patterns by demonstration)
- Context compression (summarize old messages to save tokens)

---

## Known Quirks

- **File search edge cases** — fuzzy search sometimes misses obvious matches.
- **Cost tracking accuracy** — occasional mismatch between calculated cost values.
- ~~**Draft persistence race condition** — rapid session switching can lose draft.~~ ✅ Fixed: synchronous content capture, generation counter for stale detection, session validation on debounced saves.
