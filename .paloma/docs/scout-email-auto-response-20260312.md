# Scout: Email Auto-Response Timeout System
**Date:** 2026-03-12
**Plan:** active-20260312-paloma-email-auto-response.md
**For:** Chart → Forge

---

## What I Read

- `bridge/email-watcher.js` — full file
- `mcp-servers/gmail.js` — full file
- `bridge/pillar-manager.js` — full file (timeout pattern reference)
- `bridge/index.js` — full file (integration point)

---

## Key Findings

### 1. EmailWatcher Has No Thread Tracking (Zero State Today)

`_spawnEmailSession` calls `this.cliManager.chat(...)` which returns `{ requestId, sessionId }`. **Both values are immediately discarded.** There is no Map, no Set, no timer — nothing tracking whether a spawned session ever replied.

The only tracking that exists is `this.seenIds` (a Set of Gmail message IDs), which only prevents re-spawning on the same message, not retry/timeout logic.

**The insertion point is clear:** `_spawnEmailSession` must capture `requestId` and `sessionId` at spawn time and feed them into a new `threadTracker` Map.

### 2. cliManager.stop(requestId) Exists

In `bridge/index.js` line ~`cliManager.stop(msg.requestId)` — the `stop()` method exists on `ClaudeCliManager`. This means when a timeout fires and Paloma hasn't replied, we can kill the original stale session before spawning the retry. Clean and safe.

### 3. email_check_thread Logic Must Be Replicated Inline (Not Called via MCP)

`mcp-servers/gmail.js`'s `handleCheckThread` is an MCP tool running in a **subprocess over stdio**. EmailWatcher cannot call it directly.

EmailWatcher already has `this.gmail` (a fully authenticated Gmail API client). We replicate the check inline:

```js
async _isThreadReplied(threadId, sinceMessageId) {
  const thread = await this.gmail.users.threads.get({
    userId: 'me', id: threadId, format: 'metadata',
    metadataHeaders: ['From']
  })
  let messages = thread.data.messages || []
  if (sinceMessageId) {
    const idx = messages.findIndex(m => m.id === sinceMessageId)
    if (idx !== -1) messages = messages.slice(idx + 1)
  }
  return messages.some(m => {
    const from = this._getHeader(m, 'From') || ''
    return from.includes('paloma@verifesto.com')
  })
}
```

`format: 'metadata'` with `metadataHeaders: ['From']` is enough — no need to fetch full bodies just to check the sender.

### 4. Pillar Timeout Pattern: Per-Object setTimeout (Exact Reference)

In `pillar-manager.js`:
```js
session.timeoutTimer = setTimeout(() => {
  try { this._timeout(pillarId) } catch (e) { ... }
}, MAX_RUNTIME_MS)  // 30 * 60 * 1000
```

`clearTimeout` is called in `stop()` when a session finishes normally. The same pattern is perfect for per-thread timers in EmailWatcher.

### 5. EmailWatcher Is Self-Contained — index.js Needs No Changes

`bridge/index.js` wires EmailWatcher as:
```js
emailWatcher = new EmailWatcher(cliManager, { broadcast })
emailWatcher.start()
```

EmailWatcher is completely self-contained. All timeout/tracking logic lives inside it. `index.js` only calls `emailWatcher.shutdown()` on exit. No changes needed to `index.js`.

### 6. Multiple Emails in Same Thread — The Complication

The poll loop iterates by **message ID**, not thread ID. If a thread gets two unanswered emails (e.g. customer sends a follow-up), each new message spawns its own session. With thread-level tracking, the second spawn should:
- Reset the timer on the existing thread entry (the new email is more recent)
- Update `sinceMessageId` to the new message (so reply detection looks at messages after it)
- Stop the OLD session's `requestId` before spawning the new one (the old session has stale context)

This is cleaner than per-message tracking and correctly handles thread-level deduplication.

### 7. Retry Cap: 2 Retries Max

Without a cap, a thread that never gets a reply would spawn sessions forever at 30-min intervals. Track `retryCount` on each thread entry and stop at 2 retries (covers up to 90 minutes of attempts). After 2 retries, log a warning and mark the thread as `abandoned`.

### 8. Bridge Restart: Acceptable State Loss

In-memory `threadTracker` is lost on restart. This is called out in the plan as acceptable. On restart, `seenIds` is repopulated via silent initial sync — no emails are re-spawned. Pending retry timers are simply lost. Real-world impact: very low (restarts are rare).

---

## Data Shape

```js
// this.threadTracker: Map<threadId, ThreadEntry>
{
  threadId: 'string',        // Gmail thread ID
  messageId: 'string',       // Gmail message ID that triggered spawn
  requestId: 'string',       // cliManager requestId — used to stop stale sessions
  sessionId: 'string',       // Claude session ID (for logs)
  spawnedAt: Date.now(),     // When the session was spawned
  timer: TimeoutHandle,      // The 30-min retry timer
  retryCount: 0              // How many retries have been attempted (max 2)
}
```

---

## Architecture Decision: Per-Thread setTimeout vs Periodic Sweep

**Chosen: per-thread setTimeout** (same as pillarManager pattern)

Rationale:
- Precise 30-min timing per thread regardless of when it arrived
- No periodic polling overhead against Gmail API (avoid rate limits)
- Maps cleanly to the pillar timeout pattern already in the codebase
- Simpler to reason about: one timer, one thread, one outcome

A periodic sweep (e.g. every 5 min checking all tracked threads) would work but requires checking all threads simultaneously, which clusters API calls and is harder to implement correctly with staggered arrival times.

---

## Implementation Plan for Chart/Forge

### Files to Modify

**Primary: `bridge/email-watcher.js` — all changes go here**

1. **Constructor** — add `this.threadTracker = new Map()`

2. **`_spawnEmailSession`** — capture return values and set up tracking:
   ```js
   const { requestId, sessionId } = this.cliManager.chat(...)
   
   // If thread already tracked (second email in same thread): stop old session
   const existing = this.threadTracker.get(threadId)
   if (existing) {
     clearTimeout(existing.timer)
     try { this.cliManager.stop(existing.requestId) } catch {}
   }
   
   const timer = setTimeout(() => this._checkAndRetryThread(threadId), 30 * 60 * 1000)
   this.threadTracker.set(threadId, { threadId, messageId, requestId, sessionId, spawnedAt: Date.now(), timer, retryCount: existing?.retryCount || 0 })
   ```

3. **`_checkAndRetryThread(threadId)`** — new method:
   ```js
   async _checkAndRetryThread(threadId) {
     const entry = this.threadTracker.get(threadId)
     if (!entry) return
     
     const replied = await this._isThreadReplied(threadId, entry.messageId)
     if (replied) {
       console.log(`[email-watcher] Thread ${threadId} replied — cleanup`)
       this.threadTracker.delete(threadId)
       return
     }
     
     if (entry.retryCount >= 2) {
       console.warn(`[email-watcher] Thread ${threadId} abandoned after 2 retries`)
       this.threadTracker.delete(threadId)
       return
     }
     
     console.log(`[email-watcher] Thread ${threadId} no reply — retry #${entry.retryCount + 1}`)
     try { this.cliManager.stop(entry.requestId) } catch {}
     
     // Re-read the original email to give the new session full context
     // (can store body at spawn time to avoid API re-fetch)
     this._spawnRetrySession(entry)
   }
   ```

4. **`_isThreadReplied(threadId, sinceMessageId)`** — new method (see code above)

5. **`_spawnRetrySession(entry)`** — new method that spawns with retry context in the prompt

6. **`shutdown()`** — clear all thread timers:
   ```js
   for (const [, entry] of this.threadTracker) {
     clearTimeout(entry.timer)
   }
   this.threadTracker.clear()
   ```

### Files That Don't Change
- `bridge/index.js` — no changes
- `mcp-servers/gmail.js` — no changes
- `bridge/pillar-manager.js` — no changes (reference only)

---

## Open Questions for Chart

1. **Store email body at spawn time?** The retry session needs enough context to send a meaningful response. Two options:
   - Store `{ from, subject, body }` in the threadTracker entry at spawn time (adds ~1-5KB per tracked thread, trivial for the expected load of a few threads)
   - Re-fetch from Gmail API at retry time using `messageId`
   
   **Recommendation:** store at spawn time. Simpler, no extra API call on retry.

2. **Retry prompt language?** The retry session should know it's a retry — "We haven't responded to this email yet. Please read and respond." vs just re-sending the original prompt. Chart should decide the exact retry prompt.

3. **Should the tracker clean up on successful session completion?** Currently there's no way for the spawned session to signal back to EmailWatcher that it replied. Options:
   - Keep it timer-only (simpler): just let the timer fire, check at 30 min, clean up if replied
   - Add a callback: complex, requires wiring cliManager events back to EmailWatcher
   
   **Recommendation:** timer-only. At 30 min, if Paloma replied (as she almost always will), the check returns true and we clean up. If not, we retry. The timer-only approach is simple and robust.

4. **What if `cliManager.stop(requestId)` fails?** Wrap in try/catch and log — the session will time out on its own eventually. Non-fatal.

---

## Summary

The implementation is surgically confined to `bridge/email-watcher.js`. The pattern mirrors `pillar-manager.js`'s timeout mechanism exactly. The Gmail reply check replicates `email_check_thread` logic inline using the existing `this.gmail` client.

**Estimated scope:** ~80-100 lines added to email-watcher.js across 4 new methods and modifications to `_spawnEmailSession` and `shutdown()`.

**Risk:** Low. Self-contained in one file. No changes to index.js, pillar-manager, or MCP servers. In-memory state is acceptable. Retry cap prevents runaway spawning.
