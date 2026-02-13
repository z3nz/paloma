# Draft: Tool Call Persistence & Chat Export/Import

> **Goal:** Always store tool calls in message history so they're visible in past messages and survive export/import.
> **Status:** Draft
> **Created:** 2026-02-13

---

## The Problem

1. **Tool calls disappear** from previous messages — once a conversation scrolls past, the tool activity is gone
2. **Chat exports** don't include tool call data — losing critical context about what happened
3. **Future imports** would be incomplete without tool history

## What Needs to Happen

### Storage
- Tool calls (name, args, result, duration) should be stored as part of the message record in IndexedDB
- Each assistant message that triggers tools should have a `toolCalls` array persisted
- Each tool result message should store the full result (or truncated with a size limit)

### Display
- Previous messages should show their tool calls (collapsed by default, expandable)
- Same UI as the current ToolActivity component but inline with the message

### Export
- Chat export format must include tool calls per message
- Format should be human-readable (JSON with tool call details)
- Must be importable — round-trip fidelity

### Import
- Import should reconstruct messages WITH their tool call history
- Tool results should render correctly in the UI after import

## Technical Notes

- Current export goes through MCP bridge (`exportChats` in `useMCP.js`)
- Messages are stored in IndexedDB via `db.js` (Dexie)
- Tool messages already exist as separate `role: 'tool'` entries — but they're ephemeral in the UI
- Need to ensure the export includes ALL message types (user, assistant, tool)

## Relationship to Memory Fragments

When we build the MongoDB memory system, tool call history becomes part of the raw material for extracting memory fragments. Knowing WHAT tools were used and WHAT they returned is critical context for understanding what happened in a conversation.

---

*Capture doc — will build when we tackle Phase 2 CLI tooling.*
