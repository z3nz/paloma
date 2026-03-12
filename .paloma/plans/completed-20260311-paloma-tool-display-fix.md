# Tool Display Duplication Fix

**Status:** completed
**Created:** 2026-03-11
**Scope:** paloma

## Goal

Fix tool calls showing in two places (above and below the response). Remove the above display. Fix the below display to show correct text.

## Root Cause

1. **Duplication**: `consumedToolIds` Set is computed in `MessageList.vue` but `MessageItem.vue` checks `message._consumed` — a property that is never set on the message object. So tool messages always render as standalone items even when they're already shown in the assistant message's ToolCallGroup.

2. **Wrong text below**: The standalone tool messages (below) may be showing raw/truncated content instead of the formatted tool output that the ToolCallGroup shows correctly.

## Fix

- Pass `consumedToolIds` Set to the rendering logic and filter properly
- OR set `_consumed` on message objects when computing the Set
- Remove the "above" tool display and keep only the "below" ToolCallGroup with correct text

## Files

- `src/components/chat/MessageList.vue` — Fix consumption logic
- `src/components/chat/MessageItem.vue` — Fix v-if condition

## Pipeline

- [x] Flow: Direct fix (well-understood from code analysis)
