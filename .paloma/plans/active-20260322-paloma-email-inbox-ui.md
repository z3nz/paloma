# Email Inbox UI — Dedicated Email Section for Paloma

**Status:** active
**Created:** 2026-03-22
**Scope:** paloma
**Phase 1:** Read-only inbox with full transparency (today)
**Phase 2:** Compose/reply from UI (future)

## Overview

Build a dedicated Inbox section in Paloma's frontend where Adam can read ALL emails (inter-instance Paloma-to-Paloma, trusted senders, unknown senders) in an email-client-like interface. Each email thread shows the full email chain AND the pillar session that was spawned to handle it, including all tool calls and agent responses.

## Requirements

1. **Dedicated Inbox tab** in sidebar — top-level navigation alongside existing chat list
2. **All emails visible** — every email Paloma sends/receives, all senders
3. **Thread view** — click a thread to see the full email chain
4. **Full transparency** — see the Paloma session spawned for each email, including tool calls, agent responses, everything
5. **Historical backfill** — pull past emails from Gmail to populate the inbox
6. **Email metadata persistence** — store email data in IndexedDB so it survives across sessions

## Architecture

### Backend (Bridge)

**New: Email Store API** (`bridge/email-store.js`)
- Bridge HTTP endpoints to fetch/store email data
- `GET /api/emails` — list email threads (paginated)
- `GET /api/emails/:threadId` — get full thread with all messages
- `POST /api/emails/sync` — trigger Gmail sync (backfill historical emails)
- Store email metadata in `~/.paloma/email-store.json` (flat file, simple)
- Link emails to pillar sessions via `emailSessionMap` (messageId → sessionId)

**Modifications to `bridge/email-watcher.js`:**
- On email received, also persist to email store (not just spawn session)
- Track which session was spawned for which email

**Modifications to `bridge/index.js`:**
- Register new HTTP routes for email API
- Broadcast email store updates via WebSocket

### Frontend

**New Components:**
- `src/components/inbox/InboxView.vue` — Main inbox layout (list + detail pane)
- `src/components/inbox/InboxList.vue` — Email thread list with sender, subject, timestamp, preview
- `src/components/inbox/InboxThread.vue` — Full thread view showing email chain
- `src/components/inbox/InboxMessage.vue` — Single email message display
- `src/components/inbox/InboxSessionPanel.vue` — Shows the Paloma session/tool calls linked to an email

**New Composable:**
- `src/composables/useInbox.js` — Email data management, Gmail sync, thread grouping

**Modifications:**
- `src/components/layout/Sidebar.vue` — Add Inbox tab with mail icon + unread count
- `src/components/layout/AppLayout.vue` — Route to InboxView when inbox tab active
- `src/App.vue` — Add inbox state management

### Data Model

**Email Thread:**
```javascript
{
  threadId: string,        // Gmail thread ID
  subject: string,         // Thread subject
  participants: string[],  // All email addresses involved
  lastMessageAt: number,   // Timestamp of newest message
  messageCount: number,    // Total messages in thread
  unread: boolean,         // Has unread messages
  labels: string[],        // Gmail labels
}
```

**Email Message:**
```javascript
{
  messageId: string,       // Gmail message ID
  threadId: string,        // Gmail thread ID
  from: string,            // Sender
  to: string,              // Recipient(s)
  subject: string,         // Subject
  body: string,            // Body text
  htmlBody: string,        // HTML body (for rich display)
  timestamp: number,       // Date
  sessionId: number|null,  // Linked Paloma session ID (if spawned)
}
```

## Work Units

#### WU-1: Build the bridge-side email store: HTTP API endpoints for listing threads, fetch
- **Feature:** Backend — Email Store API
- **Status:** completed
- **Files:** bridge/email-store.js, bridge/email-watcher.js, bridge/index.js
- **Scope:** Build the bridge-side email store: HTTP API endpoints for listing threads, fetching thread details, and syncing historical emails from Gmail. Persist email metadata to ~/.paloma/email-store.json. Modify email-watcher to persist emails to store on receipt and track session linkage.
- **Acceptance:** GET /api/emails returns paginated thread list. GET /api/emails/:threadId returns full thread. POST /api/emails/sync pulls historical emails from Gmail. New emails automatically persisted. Session IDs linked to emails.
- **Result:** Email store module created with persistence, Gmail sync, HTTP API endpoints (GET /api/emails, GET /api/emails/:threadId, GET /api/emails/stats, POST /api/emails/sync). Email watcher integrated with auto-persist and session linking.
## Implementation Notes

### WU-1: Backend — Email Store API
- Created `bridge/email-store.js` to manage email persistence in `~/.paloma/email-store.json`.
- Implemented `addMessage`, `linkSession`, `getThreads`, `getThread`, `getStats`, and `syncFromGmail`.
- `syncFromGmail` uses direct Gmail API access via `googleapis` to fetch the last 100 messages.
- Integrated `emailStore` into `bridge/email-watcher.js` to automatically persist new emails and link sessions.
- Added HTTP routes to `bridge/index.js`:
    - `GET /api/emails`
    - `GET /api/emails/:threadId`
    - `GET /api/emails/stats` (Wait, I used `/api/emails/stats` in code, but the plan said `stats` was part of the threadId route logic. I ensured `/api/emails/stats` works separately.)
    - `POST /api/emails/sync`
- Broadcasts `email_store_updated` event via WebSocket on new emails or sync completion.

### WU-2: Frontend — Inbox Composable
- Built `src/composables/useInbox.js` with module-level refs for singleton state and HMR preservation.
- Implemented `fetchThreads`, `fetchThread`, `syncEmails`, `fetchStats`, `selectThread`, and `clearActiveThread`.
- Added `unreadCount` and `hasMore` computed properties.
- Modified `src/services/mcpBridge.js` to support `onEmailStoreUpdated` callback.
- Modified `src/composables/useMCP.js` to expose `emailStoreUpdateTrigger` ref and wire it to the bridge event.
- `useInbox` watches `emailStoreUpdateTrigger` to auto-refresh the thread list and stats.

### WU-3: Frontend — Inbox Components
- All 5 inbox components built with dark theme, sanitized HTML rendering, IntersectionObserver infinite scroll, collapsible messages, and linked session panels with tool call display.

### WU-4: Frontend — App Integration
- Modified `src/App.vue` to include `activeView` state and handle view switching.
- Updated `src/components/layout/Sidebar.vue` with a top-level tab bar to toggle between "Chats" and "Inbox" views, including an unread message badge.
- Updated `src/components/layout/AppLayout.vue` to conditionally render the main content area (Chat vs Inbox).
- Added `Ctrl+I` keyboard shortcut in `src/composables/useKeyboardShortcuts.js` for quick view toggling.
- Integrated `useInbox` for real-time unread count and state management.

#### WU-2: Build the useInbox composable: fetch email threads/messages from bridge API, man
- **Feature:** Frontend — Inbox Composable
- **Status:** completed
- **Files:** src/composables/useInbox.js, src/services/mcpBridge.js, src/composables/useMCP.js
- **Scope:** Build the useInbox composable: fetch email threads/messages from bridge API, manage inbox state (threads list, active thread, loading states), handle Gmail sync trigger, group messages by thread, track unread status. Singleton pattern with HMR preservation.
- **Acceptance:** useInbox() returns threads, activeThread, loading, fetchThreads(), fetchThread(id), syncEmails(). Data flows from bridge API to reactive state.
- **Result:** Composable built with full API integration, real-time WebSocket updates via email_store_updated event, HMR preservation, pagination support, and computed unreadCount/hasMore.
#### WU-3: Build the inbox UI components: InboxView, InboxList, InboxThread, InboxMessage, 
- **Feature:** Frontend — Inbox Components
- **Status:** completed
- **Files:** src/components/inbox/InboxView.vue, src/components/inbox/InboxList.vue, src/components/inbox/InboxThread.vue, src/components/inbox/InboxMessage.vue, src/components/inbox/InboxSessionPanel.vue
- **Scope:** Build the inbox UI components: InboxView, InboxList, InboxThread, InboxMessage, InboxSessionPanel.
- **Acceptance:** InboxView renders split pane. Thread list shows all emails grouped by thread. Clicking thread shows full chain. Linked sessions display with tool calls. Responsive dark theme.
- **Result:** All 5 inbox components built with dark theme, sanitized HTML rendering, IntersectionObserver infinite scroll, collapsible messages, and linked session panels with tool call display.
#### WU-4: Integrate Inbox into the main app: sidebar tabs, view switching, keyboard shortc
- **Feature:** Frontend — App Integration
- **Status:** completed
- **Files:** src/components/layout/Sidebar.vue, src/components/layout/AppLayout.vue, src/App.vue, src/composables/useKeyboardShortcuts.js
- **Scope:** Integrate Inbox into the main app: sidebar tabs, view switching, keyboard shortcut.
- **Acceptance:** Inbox tab visible in sidebar. Clicking it shows InboxView. New emails appear in real-time. Can switch between chat and inbox views seamlessly.
- **Result:** Sidebar tabs (Chats/Inbox) with unread badge, activeView state in App.vue, conditional rendering in AppLayout, Ctrl+I keyboard shortcut. Real-time updates working.