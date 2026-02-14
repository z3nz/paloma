# Tool Call Persistence & Rich UI Overhaul

> **Goal:** Make tool calls first-class citizens — beautifully rendered, permanently persisted, fully exportable, and a joy to browse through.
> **Status:** Active — Phase 1-3 complete, Phase 4 (CLI result storage) is next priority
> **Created:** 2026-02-13

---

## Current State (Session Handoff)

### What's DONE and Working

**Phase 1: Data Foundation** ✅
- `useToolExecution.js` — `addActivity()` records `startedAt`, `markActivityDone(id, result)` calculates `duration` and classifies `resultType` via `classifyResult()`
- `snapshotActivity()` — captures clean snapshots with JSON round-trip to prevent IndexedDB `DataCloneError`
- Assistant messages get `toolActivity` array persisted to IndexedDB
- Tool messages (`role: 'tool'`) get `resultType` field on save
- All data going into IndexedDB is sanitized via `JSON.parse(JSON.stringify())` to prevent clone errors

**Phase 2: UI Components** ✅
- `src/utils/toolClassifier.js` — Server colors, tool name parsing (`parseToolName`), smart summaries (`getToolSummary` with per-tool-name formatting), result classification (`classifyResult` → json/diff/file-content/directory/error/plain-text), language inference (`inferLanguage`)
- `src/components/chat/ToolCallGroup.vue` — Collapsible group header with: chevron, status dot (green=done, purple pulse=running), tool count, total duration, server breakdown pills (colored per-server). `live` prop controls streaming vs persisted behavior. Auto-expands when tools start running in live mode.
- `src/components/chat/ToolCallItem.vue` — Individual tool row with: spinner/check/X status indicator, colored server badge, tool short name, smart summary, duration, result size, expand chevron. `live` prop means spinners only show during active streaming (persisted = always complete).
- `src/components/chat/ToolResult.vue` — Smart renderer switching on `resultType`: error (red box), diff (green/red line coloring with hunk headers), json (pretty-printed + syntax highlighted via hljs), file-content (syntax highlighted with language detection from file path), directory (icons + entry list), plain-text (monospace pre). All types support "Show more" truncation at 50 lines.

**Phase 3: Integration** ✅
- `MessageList.vue` — Filters consumed `role: 'tool'` messages (they render inside ToolCallGroup instead of as standalone bubbles). `consumedToolIds` computed set tracks which tool messages belong to assistant messages with `toolActivity`. Live `ToolCallGroup` replaces old `ToolActivity.vue` during streaming. Cleared in `finally` block of `sendMessage()`.
- `MessageItem.vue` — New branch for assistant messages with `toolActivity` renders `ToolCallGroup` above content. Passes matched `toolMessages` down. Backwards-compatible: legacy messages without `toolActivity` still render the old way.
- `useChat.js` — `saveAssistantMessage()` accepts `toolActivitySnapshot` param. CLI path snapshots after `runCliChat()` returns. OpenRouter path uses `onToolsComplete()` callback to snapshot AFTER tools execute (not before). `finally` block clears live activity.
- `useOpenRouterChat.js` — `onToolsComplete` callback fires after each tool round. Result content passed to `markActivityDone()`.
- `useCliChat.js` — Safety net marks all still-running activities as done when stream ends. Result content from `tool_result` events passed for classification.
- `claudeStream.js` — Added parsing for `content_block_start` events (tool_use blocks) and `result.content` arrays (tool_result blocks).

**Styles** ✅
- `src/styles/main.css` — ~395 lines of new CSS covering all tool-call-group, tool-call-item, and tool-result classes. BEM-style naming. Animations for spinner and pulse dot.

### Bug Fixes Applied
- **DataCloneError** — All data paths into IndexedDB use `JSON.parse(JSON.stringify())` sanitization (snapshotActivity, onSaveTool args, toolCalls on assistant messages)
- **Tools stuck as "running"** — `live` prop system: `ToolCallGroup` and `ToolCallItem` only show running state when `live=true`. Persisted messages always show as complete. Safety net in `useCliChat.js` force-completes on stream end.
- **Live activity not clearing** — `clearActivity()` called in `finally` block of `sendMessage()`

---

## What's NOT Done — Priority Order

### Phase 4: CLI Tool Result Storage (NEXT — HIGH PRIORITY) 🔴

**The Problem:**
The OpenRouter path saves tool results as separate `role: 'tool'` messages in IndexedDB (with `toolCallId`, `toolName`, `toolArgs`, `content`, `resultType`). The CLI path does NOT — Claude CLI handles tools internally via the MCP proxy, and our frontend only sees `tool_use` and `tool_result` stream events. We never persist the actual tool result content for CLI sessions.

This means:
- When you expand a ToolCallItem from a CLI session, there's no `toolMessage` to show — `hasResult` is false, the expand chevron doesn't appear, you can't see what the tool returned.
- File reads, git diffs, directory listings — all invisible after the fact for CLI sessions.
- This is the #1 gap in the feature.

**The Solution — Architecture Decision Needed:**

Option A: **Save CLI tool results as `role: 'tool'` messages from the stream**
- In `useCliChat.js`, when we receive a `tool_result` event, save it to IndexedDB the same way OpenRouter does
- Requires: the `tool_result` event to have enough data (toolName, args come from the matching `tool_use` event — we already track this in `toolUseToActivity`)
- Pro: Consistent data model, ToolCallGroup "just works"
- Con: CLI tool results can be very large (file reads). Need to consider truncation strategy.

Option B: **Store result content on the activity snapshot itself**
- Instead of separate messages, embed result content directly in the `toolActivity` array on the assistant message
- Pro: Single-document storage, no cross-referencing needed
- Con: Makes assistant messages very large in IndexedDB. Harder to truncate.

**Recommended: Option A** — Save CLI tool results as `role: 'tool'` messages. Keep the same data model as OpenRouter. Implement as follows:

1. In `useCliChat.js`, maintain a map of `toolUseId → { name, args }` from `tool_use` events
2. On `tool_result` event, construct and save a `role: 'tool'` message to IndexedDB with `toolCallId`, `toolName`, `toolArgs`, `content`, `resultType`
3. Need to pass `sessionId` and `db` access into `useCliChat.js` (or pass a save callback like `onSaveTool`)
4. The `tool_result` content from CLI may be a string, an array of content blocks, or an object — normalize to string
5. Consider a size limit (e.g., truncate results > 50KB) to prevent DB bloat

**Files to modify:**
- `src/composables/useCliChat.js` — Add tool result persistence
- `src/composables/useChat.js` — Pass `onSaveTool` callback to `runCliChat()` (same pattern as OpenRouter)
- `src/services/claudeStream.js` — Ensure `tool_result` events carry the content we need

**Critical consideration:** The `tool_result` events from Claude CLI `stream-json` — do they actually carry the full result content? The current code extracts it:
```js
yield { type: 'tool_result', toolUseId: block.tool_use_id, content: block.content }
```
Need to verify this `content` field has the actual tool output (file contents, git status, etc.) and not just a summary. **Test this first** by adding `console.log` in `claudeStream.js` for `tool_result` events.

### Phase 5: Export & Import Enrichment (MEDIUM PRIORITY)

- Export format already includes `resultType` and `toolActivity` on new messages (additive, no breaking changes)
- Import: reconstruct ToolCallGroup from `toolActivity` + tool messages. Fall back for legacy data.
- Bridge `exportChats` in `useMCP.js` — verify it serializes the new fields correctly

### Phase 6: Polish & Interaction (LOW PRIORITY — incremental)

- Copy actions on ToolCallItem (copy result, copy tool call as command) — Copy button already exists and works
- Keyboard navigation through expanded tool groups
- Accessibility: screen reader labels, aria attributes
- Performance: virtualize very long results, lazy-render collapsed groups, memoize rendered HTML
- Reduced motion preference for spinner/pulse animations
- Consider whether `ToolActivity.vue` can be fully removed (it's still imported but unused since MessageList now uses ToolCallGroup)

---

## Files Reference

### New Files Created This Session
| File | Purpose |
|------|---------|
| `src/utils/toolClassifier.js` | Server colors, name parsing, smart summaries, result classification, language inference |
| `src/components/chat/ToolCallGroup.vue` | Collapsible tool group with summary header and server pills |
| `src/components/chat/ToolCallItem.vue` | Individual tool call row with status, badge, summary, duration |
| `src/components/chat/ToolResult.vue` | Smart result renderer (6 result types with syntax highlighting) |

### Modified Files This Session
| File | Changes |
|------|---------|
| `src/composables/useToolExecution.js` | `startedAt`, `duration`, `resultType` on activities. `snapshotActivity()` with JSON sanitization |
| `src/composables/useChat.js` | `toolActivitySnapshot` on assistant messages. `onToolsComplete` callback. `resultType` on tool messages. `clearActivity()` in finally. JSON sanitization on all DB writes |
| `src/composables/useOpenRouterChat.js` | `onToolsComplete` callback after each tool round. Result passed to `markActivityDone()` |
| `src/composables/useCliChat.js` | Result content passed to `markActivityDone()`. Safety net for still-running activities. `toolActivity` destructured for safety net |
| `src/services/claudeStream.js` | Parse `content_block_start` for tool_use. Parse `result.content` for tool_result |
| `src/components/chat/MessageItem.vue` | ToolCallGroup integration for assistant messages with toolActivity. `toolMessages` prop |
| `src/components/chat/MessageList.vue` | `consumedToolIds`, `displayMessages`, `getToolMessagesFor()`. ToolCallGroup replaces ToolActivity for live streaming |
| `src/styles/main.css` | ~395 lines of tool-call-group, tool-call-item, tool-result styles |
| `.paloma/plans/active-20260213-paloma-tool-call-persistence.md` | This file |

### Untouched (No Changes Needed)
- `src/services/db.js` — Dexie schemaless for non-indexed fields
- `src/composables/usePermissions.js`
- `src/composables/useMCP.js` (export changes deferred to Phase 5)
- `bridge/` — No bridge changes needed

---

## Design Principles (Carry Forward)

- **Collapsed by default** — tool groups don't dominate the conversation
- **Meaningful at a glance** — collapsed summary tells you WHAT happened
- **Beautiful when expanded** — syntax highlighting, proper formatting, clear hierarchy
- **Zero regression** — old messages without new fields still render correctly
- **Performance-conscious** — lazy rendering, memoization, no layout thrash
- **`live` prop system** — spinners only during active streaming, persisted = always complete
