# Plan: Email Inbox Session Visibility (Autonomous Transparency)

**Status:** active
**Date:** 2026-03-23
**Scope:** verifesto
**Slug:** email-inbox-visibility

## Goal
Enable full transparency for autonomous email sessions. When Paloma handles an email while the browser is closed, the user should still be able to see the full transcript (messages, tools, results) in the inbox and navigate to the full session view.

## Research References
- `.paloma/docs/scout-email-inbox-visibility-20260323.md` (Root cause and recommended approach)

## Status Tracker
- [x] WU-1: Bridge Persistence (EmailStore & EmailWatcher)
- [x] WU-2: Bridge API (History Endpoint)
- [x] WU-3: Frontend Hydration Logic
- [x] WU-4: UI Integration (InboxSessionPanel)
- [x] WU-5: Navigation & Final Polish

---

## Work Units

### WU-1: Bridge Persistence (EmailStore & EmailWatcher)
**Status:** completed
**Backend:** gemini
**Scope:** Update the bridge to capture and persist the raw event stream for every autonomous email session.
**Files:**
- `bridge/email-store.js`
- `bridge/email-watcher.js`

**Approach:**
1.  **`EmailStore`**:
    - Add a `sessionEvents` map (sessionId -> events array) to the class.
    - Update `load()` and `save()` to persist this map in `~/.paloma/email-store.json`.
    - Add `addSessionEvent(sessionId, event)` method to append events.
2.  **`EmailWatcher`**:
    - In `_spawnEmailSession`, update the `cliManager.chat` callback to call `this.emailStore.addSessionEvent(sessionId, event)` for every event received.

---

### WU-2: Bridge API (History Endpoint)
**Status:** completed
**Backend:** gemini
**Depends on:** WU-1
**Scope:** Expose the captured session history via a new REST endpoint.
**Files:**
- `bridge/index.js`

**Approach:**
1.  Add `app.get('/api/emails/session/:sessionId/history', (req, res) => { ... })`.
2.  Retrieve the events for the given `sessionId` from `EmailStore`.
3.  Return `{ events: [...] }` or 404 if not found.

---

### WU-3: Frontend Hydration Logic
**Status:** completed
**Backend:** claude
**Depends on:** WU-2
**Scope:** Implement logic to fetch history from the bridge and "hydrate" it into IndexedDB.
**Files:**
- `src/composables/useSessions.js`

**Approach:**
1.  Add `hydrateSessionFromBridge(cliSessionId, messageId)` function.
2.  Check IndexedDB for an existing session with `pillarId === "email:${messageId}"`.
3.  If not found:
    - Fetch history from `/api/emails/session/${cliSessionId}/history`.
    - Map raw events into `messages` objects (handling `text_delta`, `tool_use`, `tool_result`, etc.).
    - Create a new session record in IndexedDB with `pillarId`, `phase: 'flow'`, and `source: 'email'`.
    - Save the mapped messages to IndexedDB.
4.  Return the numeric IndexedDB `id`.

---

### WU-4: UI Integration (InboxSessionPanel)
**Status:** completed
**Backend:** gemini
**Depends on:** WU-3
**Scope:** Trigger hydration in the Inbox UI when a local session is missing.
**Files:**
- `src/components/inbox/InboxSessionPanel.vue`

**Approach:**
1.  Update `onMounted` logic.
2.  If the local session isn't found via `pillarId`, call `hydrateSessionFromBridge(props.sessionId, props.messageId)`.
3.  Update the `session` and `messages` refs with the hydrated data.
4.  Ensure the "Show details" toggle works with the newly hydrated session.

---

### WU-5: Navigation & Final Polish
**Status:** completed
**Backend:** gemini
**Depends on:** WU-4
**Scope:** Ensure seamless navigation from the inbox to the full session view.
**Files:**
- `src/App.vue`
- `src/components/inbox/InboxSessionPanel.vue`

**Approach:**
1.  Verify `navigateToSession` in `InboxSessionPanel.vue` uses the correct numeric ID.
2.  In `App.vue`, ensure `handleSelectSession` correctly handles the event and switches to the Chat view with the selected session active.
3.  Verify that hydrated email sessions are filtered *out* of the regular chat sidebar (already implemented in `useSessions.js` computed `sessionTree`).

---


#### WU-3: Frontend Hydration, UI, and Navigation logic
- **Status:** completed
- **Files:** src/composables/useSessions.js, src/components/inbox/InboxThread.vue, src/components/inbox/InboxSessionPanel.vue
- **Scope:** Frontend Hydration, UI, and Navigation logic.
- **Acceptance:** Inbox shows hydrated session history for email sessions handled while browser was offline. View Full Session link navigates to the chat view correctly. Hydrated sessions do not clutter the chat sidebar.
- **Result:** Implemented hydration logic in useSessions, updated InboxThread and InboxSessionPanel to trigger and display hydrated session data. Verified navigation and filtering.


#### WU-4: UI Integration (InboxSessionPanel)
- **Status:** completed
- **Files:** src/components/inbox/InboxSessionPanel.vue
- **Scope:** UI Integration (InboxSessionPanel)
- **Acceptance:** InboxSessionPanel triggers hydration and displays session details (phase, message count, assistant response, tools used). Handles loading and 'Details unavailable' states. Clicking 'Show details' expands/collapses. Clicking 'View Full Session History' navigates to ChatView.
- **Result:** Updated InboxSessionPanel with hydration trigger, loading state, and fallback UI. Refined template for better UX when session is missing or hydrating.


#### WU-5: Navigation & Final Polish
- **Status:** completed
- **Files:** src/App.vue, src/components/inbox/InboxSessionPanel.vue
- **Scope:** Navigation & Final Polish
- **Acceptance:** Seamless navigation from Inbox to ChatView for hydrated email sessions. Verified sessionTree filters out 'source: email' sessions. Verified event-based selection in App.vue works with numeric IDs from IndexedDB.
- **Result:** Verified and polished the navigation flow between Inbox and ChatView. Confirmed sidebar filtering logic is robust.

## Polish Report (2026-03-23)

### Issues Found & Fixed

**BUG 1 (blocking — fixed): Event duplication in `mapEventsToMessages`**
Claude CLI emits both streaming events (`content_block_start`, `content_block_delta`) AND a final complete `assistant` event. The original code processed all of them, causing text to be doubled and tool activities to appear twice. Fix: check for the presence of any final `assistant` event; if found, skip streaming events entirely. Fall back to streaming events only for interrupted sessions that never received a final event.

**BUG 2 (blocking — fixed): Wrong field name in `toolCalls` computed**
`InboxSessionPanel.vue` computed looked for `m.tool_calls || m.toolCalls`, but hydrated messages store tools under `toolActivity`. The "Tools Used" section was always empty for hydrated sessions. Fix: added `m.toolActivity` to the filter and flatMap.

**BUG 3 (non-blocking — fixed): Race condition on rapid double-clicks**
Two concurrent `hydrateSessionFromBridge` calls with the same `messageId` could both pass the dedup check and create duplicate sessions. Fix: module-level `_pendingHydrations` Map that returns the same in-progress Promise for concurrent calls with the same `pillarId`.

### Verified Clean
- Build passes with zero new errors
- Bridge `save()` is properly debounced (2s) — no performance issue from per-event calls
- API endpoint uses Map lookup only — no path traversal risk
- `addSessionEvent` null-guards sessionId; try/catch in `save()` protects bridge
- Loading/fallback UI states correct
- `source: 'email'` filter keeps hydrated sessions out of chat sidebar
- Navigation via `paloma:select-session` CustomEvent is wired correctly

## Edge Cases
- **Missing History**: If the bridge doesn't have history (e.g., sessions from before this update), the UI should degrade gracefully (show "Details unavailable").
- **Multiple Navigations**: Ensure hydration doesn't create duplicate sessions if clicked multiple times.
- **Large Sessions**: History endpoint should handle potentially large event streams (though email sessions are usually short).
