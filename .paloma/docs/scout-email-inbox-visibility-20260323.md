# Scout Research: Email Inbox Session Visibility

**Date:** March 23, 2026  
**Status:** Completed  
**Objective:** Investigate why "view detail" link in email inbox is broken and ensure full session transparency for email handling.

---

## Current Architecture & Data Flow

### 1. Bridge-Side: Email Handling
- **`EmailWatcher`** (`bridge/email-watcher.js`) polls Gmail for unread messages.
- For each message, it spawns a background CLI session via `cliManager.chat`.
- The `EmailStore` (`bridge/email-store.js`) links the Gmail `messageId` to the CLI's `sessionId` (a string UUID).
- The bridge broadcasts `email_received`, `email_stream`, and `email_done` events over the WebSocket.

### 2. Frontend-Side: Session Capture
- **`useMCP.js`** listens for these WebSocket events.
- `onEmailReceived` calls `createPillarSession` in **`useSessions.js`** to create a record in IndexedDB with `pillarId: "email:${messageId}"`.
- `onEmailStream` accumulates the response into this local session.
- `onEmailDone` finalizes the assistant message in IndexedDB.

### 3. Frontend-Side: Inbox UI
- **`InboxView.vue`** fetches threads and messages from the bridge's REST API (`GET /api/emails`).
- These messages include the `sessionId` string (the CLI UUID) from the bridge's `EmailStore`.
- **`InboxSessionPanel.vue`** is rendered for messages with a `sessionId`.

---

## Root Cause Analysis: Why "View Detail" is Broken

The failure occurs because of a **synchronization gap** between the autonomous bridge and the transient browser client.

### 1. The Offline Gap
If the browser is closed when Paloma handles an email, the `email_received` and `email_stream` events are lost. Consequently, **no session is created in IndexedDB**. When the browser later opens and the user checks the inbox, the local database has no record of that handling session.

### 2. Broken Lookup Logic
In `InboxSessionPanel.vue`, the lookup logic uses two strategies:
- **Strategy 1**: Look for `pillarId: "email:${messageId}"` in IndexedDB. This fails if the browser was offline during handling.
- **Strategy 2**: Cast `message.sessionId` to a `Number` and look up by primary key. This fails because the bridge's `sessionId` is a string UUID, while IndexedDB uses numeric auto-incrementing IDs.

### 3. Navigation Failure
The `navigateToSession` button dispatches a `paloma:select-session` event with `session.value.id`. If no session was found in IndexedDB, this ID is null, and the event does nothing. Even if it provided the string UUID, `App.vue`'s `handleSelectSession` expects a numeric ID to match against its `sessions` list.

---

## Data Availability Assessment

- **Gmail Messages**: Persisted in `~/.paloma/email-store.json`.
- **CLI Sessions**: Resumable via UUID, but **transcripts are NOT persisted** on the bridge once the CLI process exits.
- **Local Sessions**: Persisted in IndexedDB, but only if the browser was active during the session's lifespan.

---

## Recommended Approach

To achieve "full transparency," we must bridge the offline gap by persisting transcripts on the bridge and allowing the frontend to "hydrate" them on demand.

### Phase 1: Bridge Persistence
- Update `EmailStore` to store the raw event stream for every email it handles.
- Add a new REST endpoint: `GET /api/emails/session/:sessionId/history`.

### Phase 2: Frontend Hydration
- In `useSessions.js`, add a function to `hydrateSessionFromBridge(cliSessionId, messageId)`.
- This function will fetch the history from the new API, create the IndexedDB session if it doesn't exist, and populate it with messages.
- Set the `pillarId` to `email:${messageId}` during hydration.

### Phase 3: UI Integration
- Update `InboxSessionPanel.vue` to call this hydration logic if the local session isn't found.
- Update `App.vue` and `useSessions.js` to handle navigation to string UUIDs by mapping them to their corresponding numeric IndexedDB IDs.

---

## Files Requiring Modification

| File | Section | Purpose |
|------|---------|---------|
| `bridge/email-store.js` | `addMessage` / `addEvent` | Store session event history in the JSON store. |
| `bridge/index.js` | API Routes | Add `GET /api/emails/session/:id/history`. |
| `bridge/email-watcher.js` | `_spawnEmailSession` | Push stream events into `EmailStore` during handling. |
| `src/composables/useSessions.js` | Actions | Add `hydrateSessionFromBridge`. |
| `src/components/inbox/InboxSessionPanel.vue` | `onMounted` | Trigger hydration if `Strategy 1` fails. |
| `src/App.vue` | `handleSelectSession` | Support string UUID navigation. |
| `src/composables/useMCP.js` | `onEmailDone` | (Cleanup) Ensure all email sessions are finalized correctly. |

---

## Open Questions
- Should we persist the *entire* event stream or just the final messages? (Raw events are safer for future UI compatibility).
- How long should we keep session history on the bridge? (Keep indefinitely in `email-store.json` for now).
