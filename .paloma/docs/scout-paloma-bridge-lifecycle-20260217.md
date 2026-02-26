# Scout: Bridge Lifecycle & Auto-Callback Hook Points

> **Scope:** Pillar Auto-Callback Notification System  
> **Focus:** Current bridge architecture and implementation entry points  
> **Date:** 2026-02-17

---

## Key Findings

The bridge layer is already **80% wired for auto-callbacks**. The infrastructure for resuming Flow's session, tracking pillar lifecycle, and routing notifications exists. We mainly need to connect the dots and add a few new message handlers.

---

## 1. Pillar Lifecycle Management (`bridge/pillar-manager.js`)

### Current State: `_handleCliEvent()` Method

**Location:** Lines 262-349 (approx)

**How it works:**
- Called for every CLI event from a pillar subprocess (stream deltas, completion, errors)
- Accumulates output in `session.currentOutput` during streaming
- On `claude_done`: saves output, checks message queue, sets status to `idle`
- Broadcasts `pillar_done` event to all browser clients with status (`idle`, `error`, `stopped`)

**Critical section for auto-callbacks (lines 326-344):**
```javascript
} else if (event.type === 'claude_done') {
  // ... finalize output, save to session.output array ...
  
  if (session.messageQueue.length > 0) {
    // Resume with queued messages
  } else {
    session.status = 'idle'
    this.broadcast({
      type: 'pillar_done',
      pillarId: session.pillarId,
      status: 'idle',
      pillar: session.pillar
    })

    // **EXISTING AUTO-CALLBACK ALREADY IMPLEMENTED:**
    console.log(`[pillar] Auto-notifying Flow: ${session.pillar} completed`)
    const notification = this._buildNotificationMessage('completion', session)
    this.notifyFlow(notification, session.pillarId)
  }
}
```

**Status: ✅ Phase 2 (Pillar Completion Callback) is ALREADY IMPLEMENTED!**

The code already:
- Detects when a pillar goes idle (finishes a turn with no queued messages)
- Builds a notification message via `_buildNotificationMessage('completion', session)`
- Calls `this.notifyFlow(notification, session.pillarId)`
- Also handles errors — same callback on `claude_error` (lines 345-362)

### Current State: `notifyFlow()` Method

**Location:** Lines 188-216

**How it works:**
- Checks if `flowSession` is registered (returns early if not)
- Implements cooldown: skips if same `pillarId` was notified within 5 seconds
- Rate limiting: max 10 notifications/minute, queues overflow
- If Flow is busy (`currentlyStreaming`), queues the notification
- Otherwise, increments counter and calls `_sendFlowNotification(message)`

**Status: ✅ Core notification logic exists and is production-ready.**

### Current State: `_sendFlowNotification()` Method

**Location:** Lines 218-232

**How it works:**
- Marks Flow as `currentlyStreaming = true`
- Calls `cliManager.chat()` with:
  - `prompt: message` (the notification text)
  - `model: this.flowSession.model`
  - `sessionId: this.flowSession.cliSessionId` ← **this is the `--resume` call**
  - `cwd: this.flowSession.cwd`
- Passes `_handleFlowNotificationEvent` as the event handler
- Stores the `requestId` on `flowSession.cliRequestId` for tracking

**Status: ✅ Flow resume mechanism is implemented correctly.**

### Current State: `_handleFlowNotificationEvent()` Method

**Location:** Lines 234-272

**How it works:**
- Forwards stream events to the browser via `flow_notification_stream` WebSocket messages
- On `claude_done`: clears `currentlyStreaming`, sends `flow_notification_done` to browser
- **Drains the notification queue** if more notifications are pending (batches them)
- On `claude_error`: logs error, sends `flow_notification_error` to browser

**Status: ✅ Event routing and queue draining implemented.**

### Current State: `registerFlowSession()` Method

**Location:** Lines 154-164

**How it works:**
- Called from `bridge/index.js` when browser sends `register_flow_session` message
- Stores Flow's metadata: `{ cliSessionId, model, cwd, wsClient, currentlyStreaming, notificationQueue }`
- Logs the registration to console

**Status: ✅ Flow registration exists.**

### Current State: `onFlowTurnComplete()` Method

**Location:** Lines 166-179

**How it works:**
- Called from `bridge/index.js` when a user-initiated Flow CLI turn finishes
- Sets `flowSession.currentlyStreaming = false`
- Drains the notification queue if any notifications were queued during the turn
- Builds a batched notification if multiple were queued

**Status: ✅ Queue draining for user-initiated turns implemented.**

---

## 2. WebSocket Message Routing (`bridge/index.js`)

### Current State: Session Tracking

**Mapping:** `cliRequestToWs` — Maps CLI `requestId` → originating WebSocket client

**How it's used:**
- Set in `claude_chat` handler: `cliRequestToWs.set(requestId, ws)` (line 100)
- Cleared on `claude_done` or `claude_error` (line 90)
- Used by `sendToOrigin(cliRequestId, msg)` to target the right browser tab (lines 43-49)

**Flow streaming detection (lines 101-104):**
```javascript
// If this is a message to the registered Flow session, mark it as streaming
if (pillarManager?.flowSession?.cliSessionId === (msg.sessionId || sessionId)) {
  pillarManager.flowSession.currentlyStreaming = true
}
```

**Flow turn completion detection (lines 87-92):**
```javascript
if (event.type === 'claude_done' || event.type === 'claude_error') {
  cliRequestToWs.delete(requestId)
  // If this was the Flow session, mark it as no longer streaming
  if (pillarManager?.flowSession?.cliSessionId === sessionId) {
    pillarManager.onFlowTurnComplete()
  }
}
```

**Status: ✅ Flow session tracking is wired into the `claude_chat` message handler.**

### Current State: `register_flow_session` Handler

**Location:** Lines 143-153

**How it works:**
- Receives `{ cliSessionId, model, cwd }` from browser
- Calls `pillarManager.registerFlowSession({ ...msg, wsClient: ws })`
- Sends back `flow_session_registered` acknowledgment

**Status: ✅ Handler exists.**

### Missing: `pillar_user_message` Handler

**What's needed:**
- New handler for when Adam sends a message directly to a pillar session (not Flow)
- Should build a CC notification and call `pillarManager.notifyFlow()`

**Status: ❌ Not yet implemented (Phase 3 requirement).**

**Where to add:** After `register_flow_session` handler, around line 154:
```javascript
} else if (msg.type === 'pillar_user_message') {
  // Phase 3: Adam CC notifications
  if (pillarManager) {
    const session = pillarManager.pillars.get(msg.pillarId)
    if (session) {
      const notification = pillarManager._buildNotificationMessage('adam_cc', session, {
        userMessage: msg.message
      })
      pillarManager.notifyFlow(notification)
    }
  }
  ws.send(JSON.stringify({ type: 'pillar_user_message_ack', id: msg.id }))
}
```

---

## 3. CLI Subprocess Management (`bridge/claude-cli.js`)

### Current State: `chat()` Method

**Location:** Lines 10-93

**How it works:**
- Spawns a `claude` CLI subprocess with appropriate flags
- **If `sessionId` is provided**: uses `--resume` flag (line 16-17)
- **If new session**: generates a new `sessionId`, uses `--session-id` flag (line 21)
- Always uses `--output-format stream-json` for JSON event streaming
- Injects MCP config with proxy URL (includes `cliRequestId` for routing)
- Pre-approves `mcp__paloma__*` tools (line 41)
- Sets `stdin: 'ignore'` (line 44) — **this is why we use `--resume` instead of writing to stdin**

**Resume pattern (lines 15-18):**
```javascript
if (sessionId) {
  // Resume existing conversation
  args.push('--resume', sessionId)
  console.log(`[cli] Resuming session ${sessionId}`)
}
```

**Status: ✅ Resume mechanism is production-ready and already used by `_sendFlowNotification()`.**

### Why stdin is 'ignore'

The Claude CLI's `stream-json` output mode reads the full prompt from the `-p` flag, not from stdin. Writing to stdin mid-stream would break JSON parsing. The `--resume` approach is the official, supported way to continue a conversation.

**Status: ✅ No changes needed here. The `--resume` pattern is correct.**

---

## 4. Notification Message Format

### Current State: `_buildNotificationMessage()` Method

**Location:** `pillar-manager.js`, lines 274-307

**How it works:**
- Takes `(type, pillarSession, extraData)`
- **Type `'completion'`**: formats a pillar completion callback with output summary (first 2000 chars) and instructions to call `pillar_read_output` for full output
- **Type `'adam_cc'`**: formats a CC notification when Adam messages a pillar (first 500 chars of message)
- Unknown types log a warning and return a fallback message

**Example output (completion):**
```
[PILLAR CALLBACK] Scout (pillarId: abc123) has completed.

## Output Summary
{first 2000 chars of the pillar's final output}

## Full Output Available
Call pillar_read_output with pillarId "abc123" and since "all" for the complete output.

React to this result — integrate findings, update the plan, or proceed to the next step.
```

**Status: ✅ Both message formats are implemented.**

### Current State: `_buildBatchedNotification()` Method

**Location:** Lines 309-318

**How it works:**
- Takes an array of notification messages
- If only 1 message, returns it as-is
- If multiple, wraps them in a numbered list with header `[PILLAR CALLBACKS — BATCHED]`

**Status: ✅ Batching implemented.**

---

## What's Already Done vs. What's Missing

### ✅ Already Implemented (Phases 1-2)

| Feature | Status | Location |
|---------|--------|----------|
| Flow session registration | ✅ | `pillar-manager.js:154-164`, `index.js:143-153` |
| Flow session metadata tracking | ✅ | `pillarManager.flowSession` object |
| Pillar completion detection | ✅ | `pillar-manager.js:326-344` (idle status) |
| Auto-callback on completion | ✅ | `notifyFlow()` called in `_handleCliEvent` |
| Auto-callback on error | ✅ | Same, line 361 |
| Notification message formatting | ✅ | `_buildNotificationMessage()` |
| Resume Flow's CLI session | ✅ | `_sendFlowNotification()` uses `--resume` |
| Notification queueing | ✅ | `notificationQueue` array, drained in `onFlowTurnComplete()` |
| Cooldown per pillarId | ✅ | 5-second cooldown in `notifyFlow()` |
| Rate limiting | ✅ | Max 10/minute in `notifyFlow()` |
| Flow streaming state tracking | ✅ | `currentlyStreaming` flag updated in `index.js` |
| Queue draining after user turns | ✅ | `onFlowTurnComplete()` called from `index.js` |
| Event forwarding to browser | ✅ | `_handleFlowNotificationEvent()` sends WS events |

**Phases 1-2 are 100% implemented.**

### ❌ Missing (Phase 3)

| Feature | Status | What's Needed |
|---------|--------|---------------|
| `pillar_user_message` WS handler | ❌ | Add handler in `index.js` (5 lines) |
| Adam CC notification trigger | ❌ | Frontend sends `pillar_user_message` when Adam types in pillar session |

**Phase 3 requires:**
1. **Bridge change:** Add `pillar_user_message` handler in `index.js` (trivial — 5-10 lines)
2. **Frontend change:** Detect when Adam sends a message to a non-Flow session and send `pillar_user_message` to bridge

---

## Frontend Integration Points (Phase 4-5)

These are OUT OF SCOPE for this Scout doc (they're frontend work, not bridge work), but for completeness:

**Phase 4: Notification UX**
- Handle `flow_notification_stream` and `flow_notification_done` WS events in `src/composables/useMCP.js`
- Render notification badges in `MessageItem.vue` and `ChatView.vue`
- Show notification indicator on Sidebar when Flow gets a callback

**Phase 5: Sidebar Tree View**
- Compute `sessionTree` from `sessions` array in `src/composables/useSessions.js`
- Track pillar status in `pillarStatuses` Map (populated from `pillar_done` WS events)
- Create `SidebarSessionTree.vue` component with collapsible tree rendering

---

## Critical Code Paths for Auto-Callbacks

### 1. Pillar Completes → Flow Notified

```
Pillar CLI subprocess → claude_done event
  ↓
PillarManager._handleCliEvent() detects status = 'idle'
  ↓
_buildNotificationMessage('completion', session)
  ↓
notifyFlow(notification, pillarId) — checks cooldown, rate limit, queue
  ↓
_sendFlowNotification(message) — calls cliManager.chat() with --resume
  ↓
ClaudeCliManager.chat() spawns `claude --resume {flowSessionId} -p "{notification}"`
  ↓
Flow CLI subprocess streams response
  ↓
_handleFlowNotificationEvent() forwards stream to browser via WS
  ↓
Browser renders Flow's reaction in the chat
```

### 2. Adam Messages Pillar → Flow CC'd

```
Browser: Adam types in pillar session
  ↓
(MISSING) Frontend sends `pillar_user_message` WS message to bridge
  ↓
(MISSING) Bridge index.js handler calls pillarManager._buildNotificationMessage('adam_cc', ...)
  ↓
(MISSING) pillarManager.notifyFlow(ccMessage)
  ↓
(Same path as above — _sendFlowNotification → resume Flow)
```

---

## Recommendations

### For Phase 2 (Pillar Completion Callbacks)

**Status: COMPLETE. Nothing to do.**

The code is already in production. When a pillar finishes, Flow gets auto-notified. The resume pattern works. Rate limiting and cooldown are in place. Queue draining handles Flow being busy.

### For Phase 3 (Adam CC Notifications)

**Bridge work (5-10 lines):**
1. Add `pillar_user_message` handler in `bridge/index.js` after line 153
2. Build CC notification via existing `_buildNotificationMessage('adam_cc', session, { userMessage: msg.message })`
3. Call `pillarManager.notifyFlow(ccMessage)`
4. Send acknowledgment back to browser

**Frontend work (defer to Forge/Chart):**
- Detect when a message is sent to a non-Flow pillar session
- Send `pillar_user_message` to bridge with `{ pillarId, message }`

### For Phase 4 (Notification UX)

**Bridge work: NONE. The bridge already sends `flow_notification_stream` and `flow_notification_done` events.**

Frontend needs to:
- Handle these events in `useMCP.js`
- Render notification indicators in chat and sidebar

### For Phase 5 (Sidebar Tree View)

**Bridge work: NONE. The bridge already broadcasts `pillar_session_created` and `pillar_done` with status.**

Frontend needs to:
- Compute `sessionTree` from existing `sessions` array
- Track `pillarStatuses` Map from WS events
- Build collapsible tree component

---

## Open Questions

None. The architecture is clear and implementation paths are straightforward.

---

## Next Steps

1. **Move to Flow** — this research is complete. Flow should read this doc and update the plan.
2. **Phases 1-2 are DONE** — mark them complete in the plan status tracker.
3. **Phase 3 is trivial** — 10 lines of code total (5 in bridge, 5 in frontend). Chart/Forge can knock this out in one turn.
4. **Phases 4-5 are frontend-only** — no bridge changes needed. Defer to Chart for design decisions on UX.

---

*This scout doc focused exclusively on the bridge layer — the backend infrastructure for callbacks. The frontend integration (phases 4-5) is separate scope and will need its own scout/chart cycle.*
