# Completed: Batch Retitle Existing Sessions

> **Goal:** Rename all existing "New Chat" and truncated-title sessions to meaningful summaries.
> **Status:** Completed
> **Created:** 2026-02-15

---

## The Problem

All existing sessions have either "New Chat" or a dumb 50-char truncation of the first message. Now that we have `set_chat_title`, new sessions will get proper names, but old ones need to be backfilled.

## Approach Options

### Option A: Browser Console Script (Quickest)
Run a script in the browser console that iterates over all sessions in IndexedDB, reads the first user message from each, and sends it to a cheap model for summarization. Updates titles in-place.

```js
// Pseudocode — run in browser console
const sessions = await db.sessions.toArray()
for (const session of sessions) {
  const firstMsg = await db.messages.where('sessionId').equals(session.id).first()
  if (!firstMsg) continue
  const title = await summarize(firstMsg.content) // call Haiku or similar
  await db.sessions.update(session.id, { title })
}
```

- Pro: Zero code changes, one-time operation
- Con: Requires OpenRouter API key or bridge connection, manual effort

### Option B: Settings Page Button
Add a "Retitle All Sessions" button in Settings that does the same thing, wired through the app's existing API infrastructure.

- Pro: Reusable, polished
- Con: More code for a one-time operation

### Option C: CLI Script via Bridge
Write a small Node.js script that reads sessions from the exported JSON files and generates titles using Claude CLI.

- Pro: Works offline, uses CLI model (no API key needed)
- Con: More complex, needs export first

### Option D: MCP Tool
Add a `retitle_all_sessions` MCP tool that Paloma can call. The model reads session data and generates titles.

- Pro: Paloma can do it herself in conversation
- Con: Context-heavy if many sessions

## Recommended: Option A (Quick) + Option B (Later)

For now, run a one-time browser console script using the existing bridge connection. The script would:

1. Get all sessions from IndexedDB
2. For each session, read only the first user message
3. Build a batch prompt: "Generate a 5-8 word title for each conversation based on the opening message"
4. Send to Haiku via OpenRouter (cheap, fast)
5. Update each session title in IndexedDB

This avoids reading entire chat histories — just the first message is enough context for a reasonable title.

Later, if we want a polished UX, add a button in Settings.

## Data Required Per Session

Only need:
- `session.id`
- First user message content (truncated to ~200 chars to save tokens)

Do NOT need:
- Full message history
- Assistant responses
- Tool calls

---

*Low priority — existing sessions will naturally be pushed down as new ones accumulate with proper titles.*
