# Auto-Scroll on Streaming Start

**Status:** active
**Created:** 2026-03-11
**Scope:** paloma

## Goal

When the user sends a message and the AI starts responding, the chat should immediately scroll down to show the loading/blinking cursor indicator. Currently it waits until a tool fires or content arrives.

## Root Cause

In `MessageList.vue`, there are scroll watchers for:
- Message count changes (new messages added)
- Tool activity changes
- Streaming content changes (throttled)

But there is NO watcher on the `streaming` prop itself. When `streaming` becomes `true`, the blinking cursor div renders but no scroll is triggered.

## Fix

Add a watcher on `props.streaming` in `MessageList.vue` to scroll to bottom immediately.

## Files

- `src/components/chat/MessageList.vue` — Add streaming watcher

## Pipeline

- [x] Flow: Direct fix (small, well-understood)
