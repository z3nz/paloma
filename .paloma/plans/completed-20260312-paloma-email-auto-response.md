# Email Auto-Response Timeout System

**Status:** completed
**Created:** 2026-03-12
**Scope:** paloma — bridge email system
**Goal:** Ensure every email thread in Paloma's inbox gets a response within 30 minutes

## Pipeline
- [x] Scout — explore current email-watcher architecture, identify integration points
- [x] Chart — design the tracking + timeout + auto-kick-back system
- [x] Forge — implement the feature
- [x] Polish — review, test, verify
- [x] Ship — commit, push, document

## Research References
- Scout findings: `.paloma/docs/scout-email-auto-response-20260312.md`

## Problem

The email watcher spawns Claude sessions when new emails arrive, but there's no guarantee those sessions actually send a reply. If a session times out, crashes, or simply doesn't respond, the email thread is left hanging with no follow-up mechanism.

## Design Decisions (Chart)

### D1: Store email body at spawn time → YES
The `from`, `subject`, and `body` are already available in `_spawnEmailSession` params. Storing ~1-5KB per tracked thread avoids an extra Gmail API call on retry. The retry session needs this context to compose a meaningful response.

### D2: Timer-only detection (no session callback) → YES
Adding a callback from Claude sessions back to EmailWatcher would require wiring `cliManager` events through the bridge — significant complexity for marginal benefit. The timer fires at 30 min, checks via one lightweight Gmail API call, and either cleans up or retries. This mirrors the pillar-manager timeout pattern exactly.

### D3: 2-retry cap → CONFIRMED
- Original session: 0–30 min
- Retry 1: 30–60 min
- Retry 2: 60–90 min
- After 90 min: thread marked abandoned, warning logged

After 3 total sessions and 90 minutes, more retries won't help — something is fundamentally broken.

### D4: RetryCount resets on new message in same thread → YES
A new inbound email in an already-tracked thread resets `retryCount` to 0. The new message may contain clarifications or new context — it's a fresh trigger, not a continuation of failed retries. It deserves its own retry budget.

### D5: Browser events for retries → YES
Broadcast `email_retry` event to browser for observability. Matches the existing `email_received` pattern.

### D6: API failure in reply check → treat as "not replied"
If `_isThreadReplied` fails (network, auth, rate limit), return `false` and proceed with retry. The retry cap prevents runaway spawning even if the API stays down.

## Data Shape

```js
// this.threadTracker: Map<threadId, ThreadEntry>
{
  threadId: string,        // Gmail thread ID
  messageId: string,       // Gmail message ID that triggered the current tracking
  requestId: string,       // cliManager requestId — used to stop stale sessions
  sessionId: string,       // Claude session ID (for logging)
  from: string,            // Sender address (stored for retry prompt)
  subject: string,         // Email subject (stored for retry prompt)
  body: string,            // Email body text (stored for retry prompt)
  spawnedAt: number,       // Date.now() timestamp of current session spawn
  timer: TimeoutHandle,    // setTimeout handle (30 min)
  retryCount: number       // 0, 1, or 2 — resets on new inbound message
}
```

## Method Signatures

### `_isThreadReplied(threadId, sinceMessageId) → Promise<boolean>`
Inline Gmail API call (does NOT go through MCP — uses `this.gmail` directly).
- Calls `gmail.users.threads.get({ format: 'metadata', metadataHeaders: ['From'] })`
- Finds messages after `sinceMessageId`, checks if any are from `paloma@verifesto.com`
- On API error: logs warning, returns `false` (safe default — triggers retry)
- Reuses existing `_getHeader(message, name)` helper

### `_checkAndRetryThread(threadId) → Promise<void>`
Timer callback (called 30 min after session spawn).
1. Get entry from `threadTracker`
2. Call `_isThreadReplied(threadId, entry.messageId)`
3. If replied → delete from tracker (cleanup) → return
4. If `retryCount >= 2` → log abandonment warning → delete from tracker → return
5. Otherwise → stop stale session via `cliManager.stop(entry.requestId)` → spawn retry

### `_spawnRetrySession(entry) → void`
Spawns a new Claude session with retry-specific prompt.
- Prompt includes `RETRY N/2` urgency header
- Tells session to use `email_check_thread` first for thread awareness
- Broadcasts `email_retry` event to browser
- Updates `threadTracker` with new `requestId`, `sessionId`, `timer`, incremented `retryCount`

### Modified: `_spawnEmailSession({ messageId, threadId, from, subject, body })`
Changes:
1. Capture `{ requestId, sessionId }` from `cliManager.chat()` (currently discarded)
2. If `threadTracker.has(threadId)` — clear old timer, stop old session, preserve nothing (retryCount resets)
3. Set 30-min timer: `setTimeout(() => this._checkAndRetryThread(threadId), 30 * 60 * 1000)`
4. Store full entry in `threadTracker`

### Modified: `shutdown()`
Add: iterate `threadTracker`, `clearTimeout` each entry's timer, then `threadTracker.clear()`.

### Modified: `constructor()`
Add: `this.threadTracker = new Map()`

## Retry Prompt Template

```
⚠️ RETRY {N}/2 — This email has NOT been responded to.

A session was spawned {M} minutes ago but did not send a reply.
Your one job: read this email and reply to it now.

From: {from}
Subject: {subject}
Thread ID: {threadId}
Message ID: {messageId}

--- Email Body ---
{body}
--- End ---

First, use email_check_thread("{threadId}") to see if there are any messages
in the thread you should be aware of (someone else may have replied).
Then respond thoughtfully using email_reply(threadId, body).
Set the chat title to "Retry: {subject}".
```

## Files to Modify

**ONLY: `bridge/email-watcher.js`**

No changes to:
- `bridge/index.js` — EmailWatcher is self-contained
- `mcp-servers/gmail.js` — reply check is inline, not via MCP
- `bridge/pillar-manager.js` — reference only

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Session replies at 29 min | Timer fires at 30 min, `_isThreadReplied` returns true, tracker cleaned up |
| Customer sends follow-up before 30 min | Old session stopped, new session spawned, retryCount resets to 0 |
| Gmail API down at check time | `_isThreadReplied` returns false, retry proceeds, cap prevents runaway |
| Bridge restarts | All threadTracker state lost (in-memory). seenIds repopulated silently. No retries for pre-restart threads. Acceptable. |
| Thread gets 3rd inbound email during retry #2 | Old retry stopped, fresh session with retryCount=0, full retry budget restored |
| cliManager.stop() fails | Wrapped in try/catch, logged, non-fatal. Stale session times out on its own. |

## Estimated Scope

~80-100 lines added to `email-watcher.js`:
- 3 new methods: `_isThreadReplied`, `_checkAndRetryThread`, `_spawnRetrySession`
- Modifications to: constructor, `_spawnEmailSession`, `shutdown`

## Implementation Notes (Forge)

**File modified:** `bridge/email-watcher.js` only (as planned)

**Constants added:**
- `RETRY_TIMEOUT_MS = 30 * 60 * 1000` (30 minutes)
- `MAX_RETRIES = 2`

**What was built:**
- `this.threadTracker = new Map()` in constructor
- `_spawnEmailSession` now checks for existing tracker entries (clears timer, stops stale session), captures `{ requestId, sessionId }`, sets 30-min setTimeout, and stores full ThreadEntry with all 10 fields (threadId, messageId, requestId, sessionId, from, subject, body, spawnedAt, timer, retryCount)
- `_isThreadReplied(threadId, sinceMessageId)` — inline Gmail API check using `this.gmail.users.threads.get` with `format: 'metadata'`. Returns false on API error.
- `_checkAndRetryThread(threadId)` — timer callback that checks reply status, enforces MAX_RETRIES cap with abandonment warning, stops stale sessions, delegates to `_spawnRetrySession`
- `_spawnRetrySession(entry)` — builds urgency-framed prompt matching plan template exactly, spawns opus session, updates tracker, broadcasts `email_retry` event
- `shutdown()` clears all thread retry timers and the Map

**Deviations from plan:** None. Implementation matches the charted design exactly.

**Lines added:** ~130 (slightly over estimate due to JSDoc comments and descriptive logging)

## Work Units

#### WU-1: Add threadTracker Map to constructor
- **Feature:** Thread Tracker Infrastructure
- **Status:** completed
- **Files:** bridge/email-watcher.js
- **Scope:** Add threadTracker Map to constructor. Modify _spawnEmailSession to capture and track sessions, handle existing tracker entries for same threadId, set 30-min setTimeout, and store full ThreadEntry. Update shutdown() to clear all thread timers.
- **Result:** Constructor initializes this.threadTracker = new Map(). _spawnEmailSession checks for existing tracker entries (clears timer, stops stale session via try/catch), captures { requestId, sessionId } from cliManager.chat(), sets 30-min setTimeout, and stores full ThreadEntry with all 10 fields. shutdown() iterates threadTracker to clearTimeout each timer, then clears the Map.
#### WU-2: Add _isThreadReplied(threadId, sinceMessageId) method
- **Feature:** Reply Detection
- **Status:** completed
- **Depends on:** WU-1
- **Files:** bridge/email-watcher.js
- **Scope:** Add _isThreadReplied(threadId, sinceMessageId) method. Uses this.gmail.users.threads.get with format: 'metadata' and metadataHeaders: ['From']. Finds messages after sinceMessageId, checks if any are from paloma@verifesto.com using existing _getHeader helper. On API error: log warning, return false.
- **Result:** _isThreadReplied uses this.gmail.users.threads.get with format: 'metadata' and metadataHeaders: ['From']. Slices messages after sinceMessageId index, checks for paloma@verifesto.com via _getHeader. Full try/catch returns false on API error with console.warn.
#### WU-3: Add _checkAndRetryThread(threadId) and _spawnRetrySession(entry) methods
- **Feature:** Retry Logic & Browser Events
- **Status:** completed
- **Depends on:** WU-1, WU-2
- **Files:** bridge/email-watcher.js
- **Scope:** Add _checkAndRetryThread(threadId) and _spawnRetrySession(entry) methods. Timer callback checks reply status, enforces 2-retry cap, stops stale sessions, spawns retry with urgency prompt, broadcasts email_retry events.
- **Result:** _checkAndRetryThread: calls _isThreadReplied, cleans up if replied, enforces MAX_RETRIES cap with abandonment warning, stops stale session via try/catch, calls _spawnRetrySession. _spawnRetrySession: builds urgency-framed prompt matching plan template exactly (RETRY N/2 header, email_check_thread instruction, email body context), spawns opus session, updates threadTracker with new session info and incremented retryCount, broadcasts email_retry event with threadId/messageId/from/subject/retryCount/maxRetries.
