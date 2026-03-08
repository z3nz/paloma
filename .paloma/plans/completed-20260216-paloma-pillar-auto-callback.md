# Plan: Pillar Auto-Callback Notification System

> **Goal**: When a pillar finishes or Adam messages a pillar directly, Flow gets notified automatically — no polling required.
> **Status**: Completed
> **Created**: 2026-02-16

---

## Status

- [ ] Scout: N/A — no external research needed (architecture is internal)
- [x] Chart: Complete — this document
- [x] Forge: All 5 Phases Complete
- [x] Polish: Complete — clean, well-structured, airtight data flow. Four non-blocking notes (dead sessions prop, HMR state, legacy phases, param naming) — none blockers.
- [x] Ship: All 5 phases committed (db9517c, fd64704, c596c6c, dab7482, 52bead1)

**Phase 5 (Sidebar Pillar Tree View) — ✅ COMPLETE**

**Phase 1 (Flow Session Registration) — ✅ COMPLETE**
- Bridge receives `register_flow_session` from frontend
- `useMCP` tracks `registeredFlowDbSessionId` for callback routing
- `useCliChat` passes IndexedDB sessionId to `registerFlowSession()`
- Callback response streaming works end-to-end (`flow_notification_stream/done/error` in mcpBridge.js)

**Phase 2 (Pillar Completion Callbacks) — ✅ COMPLETE**
- `_handleCliEvent()` in pillar-manager.js auto-calls `notifyFlow()` on both `idle` and `error` status
- `_buildNotificationMessage('completion', session)` formats the callback message
- Cooldown (5s per pillarId), rate limiting (10/min), queue draining all implemented
- Batched notifications via `_buildBatchedNotification()` when Flow is busy
- `onFlowTurnComplete()` drains queued notifications when Flow finishes a user-initiated turn

**Phase 3 (Adam CC Notifications) — ✅ COMPLETE**
- `pillar_user_message` WS handler in bridge/index.js
- `_buildNotificationMessage('adam_cc', ...)` in pillar-manager.js
- Frontend sends CC via `sendPillarUserMessage()` when Adam messages a pillar session
- Reuses existing notifyFlow() pipeline (queueing, cooldown, rate limiting)

**Phase 4 (Notification UX in Browser) — ✅ COMPLETE**
- Bridge sends `flow_notification_start` event with metadata (notificationType, pillar, pillarId) before streaming
- `mcpBridge.js` handles `flow_notification_start` event; `useMCP.js` stores pending metadata between start/done
- `onFlowNotificationDone` tags saved assistant messages with `isCallback`, `callbackType`, `callbackPillar`, `callbackPillarId`
- New `CallbackBadge.vue` component renders colored badge above callback assistant messages
  - Completion: "⚡ Scout completed" with pillar phase color border
  - Adam CC: "💬 Adam CC'd Flow about Forge" with pillar phase color border
  - Batched: "📡 Batched callbacks" with blue border
- Sidebar shows cyan pulsing dot (instead of accent) when Flow is processing a callback in background
- `flowProcessingCallback` reactive ref exported from `useMCP` for sidebar indicator
- No changes needed to ChatView.vue — notification streaming pipeline already renders messages correctly

**Phase 5 (Sidebar Pillar Tree View) — ✅ COMPLETE**
- `useSessions.js`: Added `sessionTree` computed (groups sessions by `parentFlowSessionId` with orphan promotion)
- `useMCP.js`: Fixed parent link bug (`registeredFlowDbSessionId` instead of `msg.flowRequestId`), added `pillarStatuses` reactive Map from WS events, persists to DB
- New `SidebarSessionTree.vue`: Collapsible tree with phase-colored connectors, status indicators (running/streaming/idle/error/stopped), chevron toggle, child count badge
- `Sidebar.vue`: Replaced flat session list with tree component, cleaned up unused helpers
- `main.css`: Tree connector CSS (vertical/horizontal lines, hover brightening, status spinner)

## Research References

- Codebase: `bridge/pillar-manager.js` — PillarManager lifecycle, `_handleCliEvent()`, `pillar_done` broadcast
- Codebase: `bridge/claude-cli.js` — ClaudeCliManager.chat(), `stdin: 'ignore'`, `--resume` flag
- Codebase: `bridge/index.js` — WebSocket handlers, `cliRequestToWs` mapping, `pillarManager` wiring
- Codebase: `bridge/mcp-proxy-server.js` — MCP tool definitions, pillar tool routing
- Related: `draft-20260215-paloma-inter-agent-communication.md` — sibling communication (this plan is a concrete subset)

---

## Goal

Enable two automatic callback triggers:

1. **Pillar Completion → Flow Notification**: When a pillar goes `running` → `idle`, the bridge automatically sends a notification message into Flow's CLI session so it wakes up and processes the result.

2. **Adam CC**: When Adam sends a message directly into a pillar session (via the browser sidebar), Flow receives a CC-style notification so it stays aware of the conversation.

Currently Flow has to manually poll with `pillar_status` / `pillar_read_output`. This is wasteful, brittle, and prevents Flow from truly delegating and moving on.

---

## Core Technical Approach

### The Resume Pattern

Flow is a Claude CLI subprocess. We can't write to its stdin (`stdin: 'ignore'`). But we CAN start a new CLI turn by spawning a fresh `claude` process with `--resume <flowSessionId>` and a notification message as the prompt. This is identical to how PillarManager already handles multi-turn pillar conversations.

**This means: the bridge becomes the notifier.** When a pillar completes (or Adam messages a pillar), the bridge itself resumes Flow's session with a structured notification message.

### Why Not Change stdin to 'pipe'?

Changing `stdin: 'ignore'` to `stdin: 'pipe'` seems simpler but has problems:
- The Claude CLI's stream-json mode reads the full prompt from `-p` flag, not stdin
- Writing to stdin mid-stream would break the JSON output parsing
- The CLI doesn't support interactive prompt injection during execution
- `--resume` with a new prompt is the official, clean way to continue a conversation

### Why Not Use a File-Based Mailbox?

- Adds latency (polling interval)
- No clean way to wake Flow — still requires polling
- The `--resume` approach is instant and uses existing infrastructure
- We'd need a file watcher, which adds complexity for no benefit

---

## Key Design Decisions

### 1. Flow Session Tracking

The bridge needs to know Flow's `cliSessionId` to resume it. Currently:
- Each `claude_chat` WS message creates a CLI session → returns `sessionId`
- The browser stores `cliSessionId` in IndexedDB
- The bridge maps `requestId` → WebSocket in `cliRequestToWs`

**New:** The bridge will maintain a `flowSession` record:
```js
flowSession = {
  cliSessionId: string,    // needed for --resume
  wsClient: WebSocket,     // to send events back to the browser
  currentlyStreaming: bool, // is Flow mid-turn?
  notificationQueue: [],   // queued notifications while Flow is busy
  model: string,           // Flow's model for resume
  cwd: string              // project root
}
```

The bridge captures this when a `claude_chat` message arrives from the browser. We identify it as "the Flow session" based on context (either explicit flag from browser, or it's the session that spawns pillars).

**Simplest approach:** The browser sends a `register_flow_session` message when a Flow CLI session starts. This gives the bridge all the metadata it needs.

### 2. Notification Message Format

When notifying Flow, the prompt message should be:
- Clearly marked as a system notification (not a user message)
- Contain the essential info Flow needs to act
- Not be so verbose it wastes tokens

**Pillar Completion:**
```
[PILLAR CALLBACK] Scout (pillarId: abc123) has completed.

## Output Summary
{first 2000 chars of the pillar's final output}

## Full Output Available
Call pillar_read_output with pillarId "abc123" and since "all" for the complete output.

React to this result — integrate findings, update the plan, or proceed to the next step.
```

**Adam CC:**
```
[PILLAR CC] Adam sent a message to Scout (pillarId: abc123):

"{Adam's message, first 500 chars}"

This is informational — Adam is communicating directly with the pillar. Decide whether you need to act on this or just be aware.
```

### 3. Preventing Infinite Loops

Risk: Flow receives notification → calls `pillar_spawn` → pillar completes → notification → Flow spawns again → ...

**Safeguards:**
1. **Notification cooldown per pillar**: After notifying Flow about a specific pillarId, don't notify again for the same pillarId within 5 seconds. This prevents rapid re-trigger if Flow immediately messages the pillar back and it completes instantly.
2. **Max notifications per minute**: Cap at 10 notifications per minute to Flow. Queue the rest.
3. **Flow's own judgment**: The notification message format includes context that lets Flow decide whether to act. Flow won't mindlessly spawn new pillars — it'll read the output and make a decision.
4. **No notification for Flow-initiated messages**: If Flow sends a `pillar_message` and the pillar completes that turn, that's expected — the notification fires. But if Flow explicitly reads the output with `pillar_read_output` right after, the notification for that pillar is suppressed (Flow already consumed the result).

### 4. Handling Flow Mid-Conversation

If Flow is currently streaming (mid-turn), we can't resume it — there's already a CLI process running for that session.

**Solution: Notification queue.** If Flow is busy:
1. Queue the notification
2. When Flow's current turn finishes (`claude_done` event), check the queue
3. If notifications are waiting, resume Flow with a batched notification:
   ```
   [PILLAR CALLBACKS — BATCHED]
   
   1. Scout (abc123) completed:
   {summary}
   
   2. Adam messaged Forge (def456):
   "{message}"
   
   React to these in order of priority.
   ```

This keeps things clean — Flow gets one turn with all pending notifications, not a rapid-fire sequence.

### 5. Browser-Side Adam CC Detection

When Adam types a message in a pillar session's chat (sidebar), the browser currently sends the prompt directly to the CLI via `claude_chat` (or through the composable chain). The bridge needs to know this is a "user message to a pillar session."

**Approach:** The browser already sends `pillar_message_saved` broadcasts when messages arrive. But for the CC feature, we need the bridge to know when *Adam* (not Flow) sends a message to a pillar.

Two paths:
- **Path A (simple):** Add a new WS message type `pillar_user_message` that the browser sends when Adam types in a pillar session. The bridge then creates the CC notification for Flow.
- **Path B (detection-based):** The bridge detects that a `pillar_message` came from a WebSocket client (Adam's browser) rather than from Flow's MCP tool call. Messages from MCP tools already go through `_handlePillarTool` in the proxy.

**Path A is cleaner.** Explicit is better than implicit. The browser knows when Adam is typing — it sends a dedicated message.

### 6. Bridge Resuming Flow's CLI Session

The bridge needs a method to resume Flow:

```js
// In bridge — new function or method on PillarManager
async notifyFlow(message) {
  if (!this.flowSession) return // no Flow registered
  
  if (this.flowSession.currentlyStreaming) {
    this.flowSession.notificationQueue.push(message)
    return
  }
  
  // Resume Flow's CLI session with the notification
  this.flowSession.currentlyStreaming = true
  const { requestId } = this.cliManager.chat(
    {
      prompt: message,
      model: this.flowSession.model,
      sessionId: this.flowSession.cliSessionId,  // --resume
      cwd: this.flowSession.cwd
    },
    (event) => this._handleFlowNotificationEvent(event)
  )
}
```

The event handler streams the response back to the browser (so Adam sees Flow reacting in the chat) and cleans up when done.

---

## Implementation Phases

### Phase 1: Flow Session Registration (Bridge)

**Goal:** Bridge knows about Flow's session and can resume it.

**Files to modify:**

**`bridge/index.js`**
- Add `register_flow_session` WebSocket message handler
- Store flow session metadata: `{ cliSessionId, model, cwd, wsClient }`
- Update flow session when `claude_chat` completes (track `currentlyStreaming` state)
- On `claude_done` for Flow's requestId: set `currentlyStreaming = false`, check notification queue

**`bridge/pillar-manager.js`**
- Add `flowSession` property (set by bridge/index.js)
- Add `notifyFlow(message)` method — handles queue, resume logic
- Add `_handleFlowNotificationEvent(event)` — streams notification response back to browser
- Add `_buildNotificationMessage(type, pillarSession, extraData)` — formats the callback message
- Add notification cooldown tracking per pillarId

**Frontend changes:**

**`src/composables/useCliChat.js`** (or `useMCP.js`)
- After a CLI chat session starts for a Flow phase, send `register_flow_session` to bridge with `{ cliSessionId, model, cwd }`

**`src/composables/useSessions.js`** or **`src/composables/useChat.js`**
- Detect when the active session is a Flow session
- Trigger `register_flow_session` on session start and on resume

### Phase 2: Pillar Completion Callback

**Goal:** When a pillar finishes, Flow gets auto-notified.

**Files to modify:**

**`bridge/pillar-manager.js`** — `_handleCliEvent()` method
- In the `claude_done` branch, after broadcasting `pillar_done` to browser:
  - If status is `idle` (pillar finished naturally, not stopped/errored):
    - Build notification message with pillar output summary
    - Call `this.notifyFlow(notification)`
- Add cooldown check: skip if same pillarId was notified within 5 seconds
- Add rate limiting: max 10 notifications/minute

**`bridge/index.js`**
- When Flow's CLI `claude_done` fires (notification response complete):
  - Set `flowSession.currentlyStreaming = false`
  - Check `flowSession.notificationQueue` — if not empty, batch and resume
- Forward Flow's notification response events to the browser so Adam sees Flow reacting

**Frontend changes:**

**`src/composables/useChat.js`** or **`src/components/chat/ChatView.vue`**
- Handle the notification response stream — when the bridge sends back Flow's reaction to a pillar callback, render it in the Flow chat as a new assistant message
- The browser needs to recognize "this is Flow responding to a bridge-initiated notification, not a user-initiated message"

**`src/services/mcpBridge.js`** (if WebSocket message handling needs new event types)
- Handle `flow_notification_stream` event type (or reuse existing `claude_stream` with a flag)

### Phase 3: Adam CC Notifications

**Goal:** When Adam messages a pillar directly, Flow gets a CC.

**Files to modify:**

**`bridge/index.js`**
- Add `pillar_user_message` WebSocket handler
  - Triggered when Adam sends a message to a pillar session via the browser
  - Builds CC notification message
  - Calls `pillarManager.notifyFlow(ccMessage)`

**`bridge/pillar-manager.js`**
- `_buildNotificationMessage('adam_cc', session, { userMessage })` handles the CC format

**Frontend changes:**

**`src/composables/useChat.js`** or equivalent
- When Adam sends a message in a pillar session (not Flow), also send `pillar_user_message` to bridge
  ```js
  // After sending the actual message to the pillar CLI:
  if (session.phase !== 'flow' && session.pillarId) {
    bridge.send({ type: 'pillar_user_message', pillarId: session.pillarId, message: content })
  }
  ```

### Phase 4: Notification UX in Browser

**Goal:** Adam sees the callback lifecycle clearly in the Flow chat.

**Frontend changes:**

**`src/components/chat/MessageItem.vue`**
- Detect notification-triggered messages (they'll have a metadata flag)
- Render with a subtle visual indicator: "Callback from Scout" badge/chip above the message
- Different styling for CC notifications vs completion callbacks

**`src/components/chat/ChatView.vue`**
- When a notification response arrives for the active Flow session:
  - Inject a system-style message: "[Scout completed — Flow is processing the results...]"
  - Then stream Flow's response normally
  - If Flow session is not the active tab, show a notification badge on the sidebar tab

**`src/components/layout/Sidebar.vue`**
- Show notification indicator on Flow session when a callback response is streaming in the background

---

### Phase 5: Sidebar Pillar Tree View

**Goal:** Spawned pillar sessions nest underneath their parent Flow conversation in a collapsible tree, with real-time status indicators and beautiful visual hierarchy.

**What changes visually:**
```
▼ Flow: Pillar Auto-Callback System     ● streaming
    ├─ Scout: Research bridge patterns    ✓ idle
    ├─ Chart: Draft implementation plan   ✓ idle  
    └─ Forge: Build callback system       ◉ running
  
  Flow: Some Other Conversation           · idle
  Scout: Standalone research              · idle
```

---

#### Design Decisions

**5.1 — Data Model: Grouping Sessions Into Trees**

Sessions already store `parentFlowSessionId` (set in `createPillarSession()` in `useSessions.js`) and `pillarId`. The tree structure is computed purely from these existing fields — no schema changes needed.

A new computed property `sessionTree` in `useSessions.js` transforms the flat `sessions` array into a tree:
```js
// Computed from sessions array — no new DB fields
sessionTree = [
  { 
    ...flowSession,          // the parent Flow session object
    children: [              // pillar sessions linked by parentFlowSessionId
      { ...scoutSession },
      { ...chartSession },
      { ...forgeSession }
    ],
    collapsed: false         // UI state, not persisted
  },
  { ...standaloneSession, children: [] },  // non-parent sessions
  { ...anotherFlowNoKids, children: [] }   // Flow with no spawned pillars
]
```

**How the grouping works:**
- Sessions with `parentFlowSessionId` matching another session's `id` become children of that session
- Sessions without `parentFlowSessionId` (or whose parent doesn't exist) stay at the top level
- Children are sorted by `createdAt` (oldest first — matches spawn order)
- The tree is recomputed reactively whenever `sessions` changes

**Why not a DB index on `parentFlowSessionId`?** Not needed — `sessions` is already loaded into memory. The computed grouping is O(n) and runs on a small list (typically < 30 sessions). Adding a Dexie index would require a schema migration for zero performance benefit.

**5.2 — Pillar Status Tracking on the Frontend**

Currently the frontend knows a pillar is streaming (via `useSessionState.isStreaming()`) and has tool activity (`hasToolActivity()`), but there's no persistent pillar *status* (running/idle/completed/error/stopped) tracked on the frontend.

The bridge already broadcasts `pillar_done` events with a `status` field. We need to:

1. **Add a `pillarStatuses` reactive Map** in `useMCP.js` (or a new tiny composable `usePillarStatus.js`):
   ```js
   // pillarId → status string ('running' | 'idle' | 'error' | 'stopped')
   const pillarStatuses = reactive(new Map())
   ```

2. **Populate it from existing WS events:**
   - `onPillarSessionCreated` → set `'running'`
   - `onPillarStream` → set `'streaming'` (live output being generated)
   - `onPillarDone` with `status: 'idle'` → set `'idle'`
   - `onPillarDone` with `status: 'stopped'` → set `'stopped'`
   - `onPillarDone` with `status: 'error'` → set `'error'`

3. **Also persist to session record** so status survives page refresh:
   ```js
   await updateSession(dbSessionId, { pillarStatus: status })
   ```

**Why a separate Map AND a DB field?** The Map gives instant reactive updates for live UI (the dot pulses the moment a stream starts). The DB field gives persistence across refreshes. The Map is the source of truth during a session; the DB is the source of truth on reload.

**5.3 — Collapse State**

Collapse state is UI-only and lives in a reactive `Map<sessionId, boolean>` inside the Sidebar component (or the `useSessions` composable). It's NOT persisted — all trees start expanded on page load, which is the right default (you want to see your active pillars).

If Adam wants persistence later, we can add it to `localStorage` — but keeping it simple for now.

**5.4 — Visual Design**

The tree should feel alive and purposeful — each pillar is a living agent working on Adam's behalf.

**Parent (Flow) row:**
- Same layout as current session items, plus a chevron (▶/▼) on the left when it has children
- Chevron animates rotation on expand/collapse (CSS `transition: transform 0.2s ease`)
- Badge count showing active children: e.g., "3 pillars" in text-muted next to the time

**Child (Pillar) row:**
- Indented 24px from parent, with a subtle left border connecting them (2px solid, pillar phase color at 30% opacity)
- Slightly smaller text (text-xs vs text-sm for parent)
- Pillar phase icon/emoji as a colored badge (reusing existing `pillarBadgeColor()`):
  - Scout: 🔍 or magnifying glass SVG in cyan
  - Chart: 📐 or compass SVG in yellow  
  - Forge: 🔨 or hammer SVG in orange
  - Polish: ✨ or sparkle SVG in pink
  - Ship: 🚀 or rocket SVG in green
  (SVG icons preferred for crispness — emoji as fallback)
- Tree connector lines: CSS pseudo-elements creating the `├─` and `└─` branch lines
  - Vertical line from parent down through children
  - Horizontal branch from vertical line to each child
  - Last child gets `└─` (no vertical line continues below)

**Status indicators (right side of each child row):**

| Status | Visual | CSS |
|--------|--------|-----|
| `running` | Pulsing dot (pillar phase color) | `animate-pulse` with phase color |
| `streaming` | Animated spinner ring | Tiny 10px spinner using `tool-spin` keyframe, phase color border |
| `idle` | Solid dim dot | `bg-text-muted` at 50% opacity |
| `completed` | Checkmark icon | `text-success` small SVG check |
| `error` | Warning triangle | `text-danger` small SVG exclamation |
| `stopped` | Square (stop) icon | `text-text-muted` small SVG square |

**Hover states:**
- Parent row: same as current (bg-bg-tertiary)
- Child row: bg-bg-tertiary with the left border brightening to full phase color
- Delete button appears on hover (same as current)

**Active state:**
- When a child is the active session: bg-bg-hover (same as current active styling)
- Parent row gets a subtle glow/highlight when ANY of its children is the active session

**Collapse animation:**
- Children slide in/out with a 150ms ease transition using `max-height` + `opacity` technique
- Or Vue's `<TransitionGroup>` for smoother list transitions
- Collapsed state: chevron points right (▶), children hidden
- Expanded state: chevron points down (▼), children visible

**5.5 — New Component: `SidebarSessionTree.vue`**

Rather than bloating `Sidebar.vue` with all the tree logic, extract a dedicated component:

```
Sidebar.vue
  └─ SidebarSessionTree.vue  (handles tree rendering, collapse, status indicators)
       ├─ renders parent rows
       └─ renders child rows with connectors
```

`Sidebar.vue` passes `sessionTree` + `activeSessionId` as props. The tree component emits `select-session` and `delete-session` events (same interface). This keeps the parent clean and the tree logic self-contained.

---

#### Files to Modify

**`src/composables/useSessions.js`**
- Add `sessionTree` computed property: groups sessions into parent/children based on `parentFlowSessionId`
- Export `sessionTree` from the composable

**`src/composables/useMCP.js`**
- Add `pillarStatuses` reactive Map (exported)
- Update `onPillarSessionCreated` callback: set status to `'running'`
- Update `onPillarStream` callback: set status to `'streaming'`
- Update `onPillarDone` callback: set status from `msg.status`
- Persist status to DB via `updateSession(dbSessionId, { pillarStatus })`

**`src/components/layout/Sidebar.vue`**
- Replace flat `v-for` session list with `<SidebarSessionTree>` component
- Pass `sessionTree` (from composable) instead of flat `sessions`
- Pass `pillarStatuses` Map for status indicators
- Remove inline session rendering (moved to tree component)
- Keep header (project indicator + new chat) and footer (export) unchanged

**New file: `src/components/layout/SidebarSessionTree.vue`**
- Props: `sessionTree`, `activeSessionId`, `pillarStatuses`
- Emits: `select-session`, `delete-session`
- Template: nested loop — outer for top-level sessions, inner for children
- Collapse state: local `collapseMap` reactive Map
- Chevron toggle with rotation animation
- Tree connector lines via CSS pseudo-elements
- Pillar phase icons (inline SVGs)
- Status indicator component (dot/spinner/check/error based on status)
- Hover and active state styling
- Collapse/expand animation via Vue `<Transition>`

**`src/styles/main.css`**
- Add tree connector CSS (`.pillar-tree-branch`, `.pillar-tree-connector`)
- Add status indicator animations (reuse existing `pulse-dot`, `tool-spin` keyframes)
- Add collapse transition styles

---

#### Implementation Details

**Session Tree Computed (useSessions.js):**
```js
const sessionTree = computed(() => {
  const childMap = new Map() // parentId → [children]
  const topLevel = []
  
  for (const session of sessions.value) {
    if (session.parentFlowSessionId) {
      const siblings = childMap.get(session.parentFlowSessionId) || []
      siblings.push(session)
      childMap.set(session.parentFlowSessionId, siblings)
    }
  }
  
  for (const session of sessions.value) {
    if (!session.parentFlowSessionId) {
      const children = (childMap.get(session.id) || [])
        .sort((a, b) => a.createdAt - b.createdAt)
      topLevel.push({ ...session, children })
    }
  }
  
  return topLevel
})
```

**Tree Connector CSS (main.css):**
```css
.pillar-tree-child {
  position: relative;
  margin-left: 1rem;
  padding-left: 1rem;
}

/* Vertical connector line */
.pillar-tree-child::before {
  content: '';
  position: absolute;
  left: 0.5rem;
  top: -0.25rem;
  bottom: 50%;
  width: 2px;
  background: var(--connector-color, var(--color-border));
}

/* Horizontal branch line */
.pillar-tree-child::after {
  content: '';
  position: absolute;
  left: 0.5rem;
  top: 50%;
  width: 0.5rem;
  height: 2px;
  background: var(--connector-color, var(--color-border));
}

/* Last child — no vertical line continues below */
.pillar-tree-child:last-child::before {
  bottom: 50%;
}

/* Non-last children — vertical line extends to next sibling */
.pillar-tree-child:not(:last-child)::before {
  bottom: -0.25rem;
}
```

**Pillar Status Helper (SidebarSessionTree.vue):**
```js
function getPillarStatus(session) {
  // Live status from bridge events (most current)
  if (session.pillarId && pillarStatuses.has(session.pillarId)) {
    return pillarStatuses.get(session.pillarId)
  }
  // Fallback: check streaming state from useSessionState
  if (isStreaming(session.id)) return 'streaming'
  if (hasToolActivity(session.id)) return 'running'
  // Fallback: persisted status from DB
  return session.pillarStatus || 'idle'
}
```

---

## Files Summary

### Modified Files (8)
| File | Phase | Changes |
|------|-------|---------|
| `bridge/pillar-manager.js` | 1, 2, 3 | flowSession tracking, notifyFlow(), notification message builder, cooldown, _handleFlowNotificationEvent() |
| `bridge/index.js` | 1, 2, 3 | register_flow_session handler, pillar_user_message handler, Flow notification response routing |
| `src/composables/useCliChat.js` | 1 | Send register_flow_session after Flow CLI starts |
| `src/composables/useChat.js` | 3, 4 | Send pillar_user_message for Adam CC, handle notification responses |
| `src/composables/useSessions.js` | 5 | Add `sessionTree` computed property for parent/child grouping |
| `src/composables/useMCP.js` | 5 | Add `pillarStatuses` reactive Map, populate from WS events, persist to DB |
| `src/components/chat/MessageItem.vue` | 4 | Notification badge rendering |
| `src/components/chat/ChatView.vue` | 4 | Notification injection and streaming |
| `src/components/layout/Sidebar.vue` | 4, 5 | Background notification indicator (P4), replace flat list with SidebarSessionTree (P5) |
| `src/styles/main.css` | 5 | Tree connector CSS, status indicator animations, collapse transitions |

### New Files (1)
| File | Phase | Purpose |
|------|-------|---------|
| `src/components/layout/SidebarSessionTree.vue` | 5 | Collapsible tree view with status indicators, phase icons, and connector lines |

---

## Edge Cases & Considerations

### Orphaned Children (Phase 5)
If a parent Flow session is deleted but its pillar children still exist, the children should "promote" back to top-level entries. The `sessionTree` computed handles this naturally — if `parentFlowSessionId` doesn't match any existing session ID, the child appears at the top level. No special handling needed.

### Large Number of Children (Phase 5)
If a Flow session spawns many pillars (10+), the tree could get long. For now, all children are shown (scrollable). If this becomes an issue, we can add a "Show N more..." threshold later. Premature optimization is the enemy — real-world usage is typically 2-5 pillars per Flow.

### Pillar Status on Page Refresh (Phase 5)
The `pillarStatuses` Map is ephemeral — it's lost on refresh. On reload, the tree falls back to `session.pillarStatus` from IndexedDB. Active CLI sessions won't be running after a refresh (the bridge may have restarted), so showing `idle` for everything on refresh is correct behavior. If the bridge is still running and a pillar completes, the next `pillar_done` WS event will update the status.

### Rapid Status Transitions (Phase 5)
A pillar can go `running → streaming → idle` very quickly (sub-second). The status indicator should debounce visual transitions — don't flash `streaming` for 100ms. Use a 300ms debounce: only update the visual indicator if the new status has been stable for 300ms. This prevents the spinner from flickering.

### Flow Session Not Registered
If no `register_flow_session` has been sent (e.g., Adam is using a non-Flow session, or the browser hasn't connected yet), notifications silently drop. No error, no queue. The system degrades gracefully to the current polling behavior.

### Multiple Browser Tabs
`cliRequestToWs` already handles per-WebSocket routing. The `register_flow_session` should come from the tab running the Flow session. If multiple tabs register, last-write-wins — only one tab gets the notification stream.

### Flow Session Timeout
If Flow's CLI session expires or becomes invalid (stale session ID), the `--resume` will fail. The bridge should catch this error, log it, and drop the notification. Next time the browser starts a fresh Flow session, it re-registers.

### Pillar Errors
When a pillar errors (status `error`), should Flow be notified? **Yes** — errors are actionable. Flow should know a pillar failed and decide whether to retry, investigate, or move on. Same callback format but with error context.

### Output Truncation
Pillar output can be long. The notification message includes only the first 2000 chars as a summary, with instructions to call `pillar_read_output` for the full content. This keeps the notification prompt lean.

### Notification During Browser Disconnect
If the browser disconnects while Flow's notification response is streaming, the CLI process keeps running (it's a subprocess). When the browser reconnects and re-registers, it picks up from the current state. No notifications are lost — they're processed by the CLI regardless of browser presence.

---

## What This Unlocks

**Phases 1-4** enable autonomous pillar orchestration with callbacks:
- Flow can spawn a Scout, then **move on** to other work or go idle — Scout's completion will wake it back up
- Adam can chat with a pillar session directly, and Flow stays informed without Adam having to relay information
- Multi-pillar workflows become natural: Flow spawns Scout + Forge in parallel, gets notified as each completes, synthesizes results
- Foundation for the inter-agent communication plan (draft-20260215-paloma-inter-agent-communication.md)

**Phase 5** makes it *visible*:
- Adam sees the full orchestration hierarchy at a glance — which pillars are spawned, what they're doing, which are done
- The sidebar becomes a living mission control dashboard, not just a flat chat list
- Clicking any pillar session navigates to its chat — same as before, but discoverable from the tree
- Status indicators give instant awareness without opening each session
- The tree collapses cleanly when Adam wants to focus on a single Flow conversation
- Foundation for future features: drag-to-reorder pillars, pillar session grouping by plan, pillar output previews on hover

---

*This plan focuses on the simplest reliable approach: `--resume` with notification messages, queued when Flow is busy, with rate limiting to prevent loops. Phase 5 adds the visual layer — turning the sidebar into a tree that reflects the living pillar hierarchy. No new infrastructure — just smarter use of what we already have.*
