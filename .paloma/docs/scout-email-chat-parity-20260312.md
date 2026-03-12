# Scout: Email Chat vs Regular Chat Parity
**Date:** 2026-03-12  
**Scope:** Full codebase audit — email chat vs regular chat rendering, data structures, tool tracking, token usage  
**Purpose:** Blueprint for making email sessions behave identically to regular chats in the Paloma UI

---

## TL;DR — The Problem in One Sentence

Email sessions bypass the entire `streamClaudeChat` / `runCliChat` processing pipeline and instead do raw event accumulation that only captures text, silently discarding tool activity, usage data, and proper model identification.

---

## 1. How Regular Chats Work (The Gold Standard)

### Data Flow

```
User input
  → ChatView.vue: handleSend()
  → useChat.js: sendMessage(sessionId, content, ...)
  → useCliChat.js: runCliChat({ sessionId, model, fullContent, ... })
  → useMCP.js: sendClaudeChat(options, callbacks)
  → services/mcpBridge.js: sendClaudeChat() → WebSocket (type: 'claude_chat')
  → bridge/index.js: cliManager.chat() → Claude CLI subprocess
  ← bridge: claude_stream events (id = requestId, NO emailTriggered flag)
  ← mcpBridge.js: streamListeners[id].onStream(event)
  ← claudeStream.js: streamClaudeChat() generator yields typed chunks
  ← useCliChat.js: processes each chunk type:
      tool_use     → addActivity() → toolActivity in sessionState
      tool_result  → markActivityDone() → saves role:'tool' message to IndexedDB
      content      → accumulates into sessionState.streamingContent
      usage        → captured for final message
      session_id   → persisted to db.sessions.cliSessionId
  ← useChat.js: saveAssistantMessage(sessionId, s, content, null, usage, model, toolActivitySnapshot)
```

### Data Structures

**Session (db.sessions, IndexedDB):**
```js
{
  id: Number,            // auto-increment
  projectPath: String,
  title: String,         // e.g. 'Flow Session'
  model: String,         // e.g. 'claude-cli:opus'
  phase: String,         // 'flow' | 'scout' | ...
  cliSessionId: String,  // Claude CLI resume ID
  cliBackend: String,    // 'claude' | 'codex'
  pillarId: String,      // for pillar sessions
  parentFlowSessionId: Number,
  createdAt: Number,
  updatedAt: Number
}
```

**Assistant message (db.messages):**
```js
{
  id: Number,            // auto-increment
  sessionId: Number,     // FK to session
  role: 'assistant',
  content: String,       // full markdown text
  model: String,         // e.g. 'claude-cli:opus'
  usage: {
    promptTokens: Number,
    completionTokens: Number,
    totalTokens: Number
  },
  toolActivity: [        // snapshot of all tools used in this turn
    {
      id: String,        // activityId
      name: String,      // e.g. 'mcp__paloma__filesystem__read_text_file'
      args: Object,
      status: 'done' | 'running',
      result: String,    // truncated result preview
      startTime: Number,
      duration: Number
    }
  ],
  files: [],
  timestamp: Number,
  interrupted: Boolean   // true if user stopped streaming
}
```

**Tool message (db.messages):**
```js
{
  id: Number,
  sessionId: Number,
  role: 'tool',
  toolCallId: String,    // matches activity.id
  activityId: String,    // same as toolCallId for CLI path
  toolName: String,
  toolArgs: Object,
  content: String,       // full tool result text
  resultType: String,    // 'code' | 'text' | 'json' (from toolClassifier.js)
  timestamp: Number
}
```

**User message (db.messages):**
```js
{
  id: Number,
  sessionId: Number,
  role: 'user',
  content: String,
  files: [{ path, name }],
  timestamp: Number
}
```

### Key Files (Regular Chat)

| File | Role |
|------|------|
| `src/composables/useChat.js` | Entry point: `sendMessage()`, `saveAssistantMessage()`, streaming lifecycle |
| `src/composables/useCliChat.js` | CLI streaming: tool tracking via `addActivity`/`markActivityDone`, IndexedDB saves for tool msgs |
| `src/services/claudeStream.js` | `streamClaudeChat()` generator — parses tool_use, tool_result, content, usage, session_id from raw CLI events |
| `src/composables/useSessionState.js` | Session state: messages, streaming, streamingContent, toolActivity, error, contextWarning |
| `src/composables/useToolExecution.js` | `addActivity`, `markActivityDone`, `snapshotActivity`, `clearActivity` |
| `src/services/mcpBridge.js` | WebSocket bridge client: routes `claude_stream` events to `streamListeners[id]` |
| `src/composables/useMCP.js` | `sendClaudeChat()`, `onPillarStream`, `onFlowNotification*` |
| `bridge/claude-cli.js` | Subprocess manager: spawns Claude CLI, emits `claude_stream`/`claude_done`/`claude_error` |
| `bridge/index.js` | `claude_chat` WebSocket handler — routes to cliManager, maps requestId→ws |

### What Regular Chats Display

- **Tool activity** — rich ToolCallGroup with server breakdown pills, duration, expand/collapse
- **Token/cost display** — per-message token annotation (bottom of each assistant msg)
- **TopBar usage bar** — session token total, context % bar, cost
- **UsageModal** — full breakdown: prompt tokens, completion tokens, context bar, project total
- **Streaming cursor** — live content as it arrives
- **Interrupted badge** — shows if user stopped mid-response

---

## 2. How Email Chats Work Currently

### Data Flow

```
Gmail poll (every 30s)
  → bridge/email-watcher.js: _spawnEmailSession({ messageId, threadId, from, subject, body })
  → cliManager.chat({ prompt, model: 'opus' }, broadcastCallback)
  → bridge/index.js: EmailWatcher calls cliManager.chat() directly
  → Claude CLI subprocess (model: opus, full MCP access)
  ← cliManager: emits claude_stream/claude_done events
  ← EmailWatcher.broadcastCallback: adds { emailTriggered: true, emailSubject: subject }
  ← broadcast() to ALL connected WebSocket clients
  
  In the browser (mcpBridge.js):
  ← claude_stream with emailTriggered=true → onEmailStream(id, event, emailSubject)
  ← claude_done  with emailTriggered=true → onEmailDone(id, cliSessionId, exitCode)
  ← email_received (separate event)        → onEmailReceived(msg)

  In useMCP.js:
  onEmailReceived: 
    → createPillarSession(projectPath, 'claude-cli:sonnet', 'flow', 'email:{messageId}', null, summary)
    → updateSession(dbSessionId, { title: msg.subject })
    → pendingEmailSessions.set(subject, dbSessionId)
    → activeEmailDbSessionId = dbSessionId

  onEmailStream:
    → finds dbSessionId from emailSessionMap or pendingEmailSessions
    → state.streaming.value = true
    → ONLY handles: event.type === 'assistant' (text blocks) + event.type === 'content_block_delta'
    → accumulates into state.streamingContent ONLY

  onEmailDone:
    → reads state.streamingContent
    → saves ONE assistant message: { role: 'assistant', content, model: 'claude-cli:sonnet', files: [], timestamp }
    → state.streaming = false, streamingContent = ''
    → emailSessionMap.delete(id)
    → activeEmailDbSessionId = null
```

### Email Session Database State

**Session (db.sessions):**
```js
{
  projectPath: 'paloma',
  title: msg.subject,           // set by onEmailReceived + updateSession
  model: 'claude-cli:sonnet',   // ← WRONG (should be 'claude-cli:opus')
  phase: 'flow',
  pillarId: 'email:{messageId}',
  parentFlowSessionId: null,
  createdAt, updatedAt
}
```

**Messages stored after completion:**
```js
// ONLY this one message. No user message. No tool messages.
{
  sessionId: dbSessionId,
  role: 'assistant',
  content: "...",               // ← full text only
  model: 'claude-cli:sonnet',   // ← WRONG hardcoded value
  files: [],
  timestamp: Date.now()
  // ← NO usage
  // ← NO toolActivity
  // ← NO interrupted flag
}
```

---

## 3. Gap Analysis — Every Difference

### Gap 1: Tool Activity Not Tracked

**Location:** `src/composables/useMCP.js` — `onEmailStream` handler (line ~183)

```js
// Current (broken):
async onEmailStream(id, event, emailSubject) {
  // ...setup...
  state.streaming.value = true
  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        state.streamingContent.value += block.text
      }
      // ← block.type === 'tool_use' is completely ignored
    }
  } else if (event.type === 'content_block_delta') {
    if (event.delta?.type === 'text_delta' && event.delta.text) {
      state.streamingContent.value += event.delta.text
    }
    // ← delta.type === 'input_json_delta' (tool args) ignored
  }
  // ← event.type === 'content_block_start' (tool_use start) ignored
  // ← event.type === 'user' (tool_result) ignored
  // ← event.type === 'result' (usage data + tool results) ignored
}
```

**Impact:** 
- No `toolActivity` array populated in session state during streaming
- ToolCallGroup never shown during live email streaming
- No tool messages saved to IndexedDB
- Final assistant message has no `toolActivity` field
- ToolCallGroup never shown when viewing saved email session

### Gap 2: Tool Messages Not Persisted

**Location:** `src/composables/useMCP.js` — `onEmailDone` (line ~221)

```js
// Current (broken):
async onEmailDone(id, cliSessionId, exitCode) {
  // ...
  if (content) {
    const dbMsg = {
      sessionId: dbSessionId,
      role: 'assistant',
      content,
      model: 'claude-cli:sonnet',  // ← HARDCODED WRONG
      files: [],
      timestamp: Date.now()
      // ← no usage
      // ← no toolActivity
    }
    await db.messages.add(dbMsg)
  }
}
```

**Impact:** Even if email session uses 50 MCP tools (git, filesystem, email_reply), none of those tool calls are recorded. The session shows as a single text message with no indication tools were used.

### Gap 3: Token/Usage Data Missing

**Root cause:** `claudeStream.js`'s `streamClaudeChat` generator extracts usage from `event.type === 'result'` events:
```js
} else if (event.type === 'result') {
  if (event.usage) {
    yield { type: 'usage', usage: { promptTokens, completionTokens, totalTokens } }
  }
}
```

The email `onEmailStream` handler never processes `result` events at all. So:
- No `usage` object on assistant messages
- `useCostTracking.sessionCost` → 0
- `useCostTracking.sessionTokens.total` → 0
- `TopBar.hasUsageData` → `false` → **usage button hidden entirely**
- Per-message token annotation in `MessageItem.vue` → not rendered (no `message.usage`)
- `UsageModal` shows all zeros

### Gap 4: Wrong Model Stored

**Two locations:**

**a) Session creation** — `useMCP.js` `onEmailReceived` (line ~157):
```js
const dbSessionId = await createPillarSession(
  projectPath,
  'claude-cli:sonnet',   // ← WRONG: email-watcher spawns with model:'opus'
  'flow',
  ...
)
```

**b) Assistant message** — `useMCP.js` `onEmailDone` (line ~225):
```js
const dbMsg = {
  model: 'claude-cli:sonnet',   // ← WRONG: same hardcoded error
  ...
}
```

**Impact:**
- `SidebarSessionTree.vue` shows "sonnet (CLI)" for all email sessions — incorrect
- `getContextUsage()` uses model to look up context_length — will use wrong model info
- `calculateMessageCost()` will use wrong pricing — not that it matters since usage=null anyway

### Gap 5: No User Message Saved

Regular chats save the user message FIRST before sending to AI. Email sessions skip this entirely. `onEmailReceived` creates the session with the email summary injected as a birth context message, but the `createPillarSession` function saves this as `role: 'user'` — so there IS a user message (the email summary). This is actually OK as-is.

Wait — re-reading `createPillarSession` in `useSessions.js`:
```js
if (prompt) {
  await db.messages.add({
    sessionId: id,
    role: 'user',
    content: prompt,  // email summary: "From: X\nSubject: Y\n...\nbody"
    files: [],
    timestamp: Date.now()
  })
}
```

The `summary` passed to this is:
```js
const summary = [`From: ${msg.from}`, `Subject: ${msg.subject}`, '', msg.body || ''].join('\n')
```

This is actually reasonable — the "user" message is the incoming email content. This part works.

### Gap 6: Email Session Not Selectable During Streaming

When an email arrives and `onEmailReceived` runs, `activeEmailDbSessionId` is set. But the user might be in a different session. The email session gets created in the sidebar but only becomes "active" for the user if they click on it.

When `onEmailDone` runs, the content is saved but the session was never "activated" via `activateSession()`. So if the user clicks on the email session while it's streaming, they'll see the live stream correctly (streamingContent is in state). But there's a subtle issue: `activate()` in `useSessionState` sets `activeId.value` — email sessions never go through this path unless the user manually clicks.

This is less of a bug and more of expected behavior (background sessions don't hijack focus).

### Gap 7: set_chat_title Routing Is Fragile

**Location:** `src/composables/useMCP.js` — `onSetTitle` (line ~65):
```js
onSetTitle(title) {
  const { activeSessionId, updateSession } = useSessions()
  const targetId = activeEmailDbSessionId !== null ? activeEmailDbSessionId : activeSessionId.value
  if (targetId && title) {
    updateSession(targetId, { title })
  }
},
```

**Issues:**
1. `activeEmailDbSessionId` is a module-level `let` — if two emails arrive quickly, the second email's `onEmailReceived` overwrites it before the first email's `set_chat_title` event arrives. First email's title goes to second email's session.
2. If an email session is active (`activeEmailDbSessionId !== null`) but the user sends a regular chat message, `set_chat_title` from the regular chat will be incorrectly routed to the email session.

In the regular chat path, `set_chat_title` comes through `bridge/index.js`:
```js
onSetTitle(title, cliRequestId) {
  sendToOrigin(cliRequestId, { type: 'set_chat_title', title })
}
```
The `cliRequestId` is used to target the right WebSocket — but the `set_chat_title` event itself doesn't carry `cliRequestId` or `requestId` when it arrives in the browser. So the frontend can't distinguish which session it came from. This is a pre-existing limitation but it bites email sessions harder because of concurrent email + regular chat.

### Gap 8: No Interrupted/Stop Mechanism

Regular chats have `stopStreaming()` which saves partial content with `interrupted: true`. Email sessions have no such mechanism — they run to completion or crash. If the bridge disconnects mid-email, the content is lost (no crash recovery draft for email sessions).

### Gap 9: Tool Confirmation Source Attribution

Email sessions CAN trigger tool confirmations (e.g., email_reply needs confirmation). The bridge routes tool confirmations via `sendToOrigin(cliRequestId, ...)`. Email sessions use `broadcast()` (all clients), so confirmations broadcast to all tabs.

In `useMCP.js`, `onCliToolConfirmation` stores the pending confirmation, which `ChatView.vue` picks up. Since `ChatView.vue` renders the currently active session, if the user is looking at the email session when the confirmation arrives, they'll see it. If they're in a different session, the confirmation dialog appears there instead, which is confusing.

**This is currently the same behavior as pillar tool confirmations** — both use broadcast — so it's not a new bug, but worth noting.

---

## 4. Architecture Map

### Files Involved in Regular Chat

```
src/
  App.vue                           → handleNewChat, handleSelectSession, handlePhaseTransition
  components/
    chat/
      ChatView.vue                  → handleSend, session watcher, tool confirmation handling
      MessageList.vue               → renders messages, live streaming area, ToolCallGroup live
      MessageItem.vue               → renders individual messages (text, toolActivity, usage)
      ToolCallGroup.vue             → collapsible tool list, server pills, duration
      ToolCallItem.vue              → individual tool: name, args, result
      CallbackBadge.vue             → badge for Flow callback messages
    layout/
      Sidebar.vue                   → export button, session tree wrapper
      SidebarSessionTree.vue        → tree rendering, streaming indicators, pillar badges
      TopBar.vue                    → cost/token bar, context % bar
      UsageModal.vue                → full token/cost breakdown popup
  composables/
    useChat.js                      → sendMessage, saveAssistantMessage, stopStreaming
    useCliChat.js                   → runCliChat (tool tracking + IndexedDB saves for tool msgs)
    useCostTracking.js              → sessionCost, sessionTokens, getContextUsage
    useMCP.js                       → WebSocket callbacks, email handlers, pillar handlers
    useSessions.js                  → createSession, createPillarSession, sessionTree
    useSessionState.js              → stateMap, getState, activate, activeState
    useToolExecution.js             → addActivity, markActivityDone, snapshotActivity
  services/
    claudeStream.js                 → streamClaudeChat() generator (parses ALL event types)
    mcpBridge.js                    → WebSocket client, routes stream events to listeners
    db.js                           → IndexedDB schema (sessions, messages, drafts)

bridge/
  index.js                          → WebSocket server, routes claude_chat → cliManager
  claude-cli.js                     → ClaudeCliManager: spawns subprocess, emits events
```

### Files Involved in Email Chat (Additional/Different)

```
bridge/
  email-watcher.js                  → EmailWatcher: Gmail polling, _spawnEmailSession(), broadcasts
  index.js                          → emailWatcher.start() wired with { broadcast }

src/
  services/mcpBridge.js             → onEmailStream, onEmailDone, onEmailError, onEmailReceived
  composables/useMCP.js             → onEmailReceived, onEmailStream, onEmailDone, onEmailError handlers
                                       + module-level state: emailSessionMap, pendingEmailSessions, activeEmailDbSessionId
```

### Event Routing Comparison

```
REGULAR CHAT:
  claude_chat (from frontend) → bridge → cliManager.chat()
  claude_stream (from bridge) → mcpBridge streamListeners[requestId].onStream(event)
  claude_done  (from bridge)  → mcpBridge streamListeners[requestId].onDone(sessionId, exitCode)
  Note: requestId is the key. Each frontend request has its own listener.

EMAIL CHAT:
  email-watcher.js calls cliManager.chat(...)
  broadcast({ ...event, emailTriggered: true, emailSubject: subject })
  ↓
  claude_stream (emailTriggered=true) → mcpBridge onEmailStream(msg.id, msg.event, msg.emailSubject)
  claude_done   (emailTriggered=true) → mcpBridge onEmailDone(msg.id, msg.sessionId, msg.exitCode)
  email_received                      → mcpBridge onEmailReceived(msg)
  Note: msg.id is the requestId. But there's no per-request listener — goes to global handlers.
```

### Data Flow Diagram: What Gets Discarded

```
Claude CLI (email session) emits:
  ├── content_block_start (tool_use)     → ❌ DISCARDED by onEmailStream
  ├── content_block_delta (text_delta)   → ✅ accumulated in streamingContent
  ├── content_block_delta (input_json)   → ❌ DISCARDED (tool args)
  ├── content_block_stop                 → ❌ DISCARDED
  ├── assistant event (text blocks)      → ✅ accumulated in streamingContent
  ├── assistant event (tool_use blocks)  → ❌ DISCARDED
  ├── user event (tool_result blocks)    → ❌ DISCARDED
  ├── result event (usage)              → ❌ DISCARDED
  └── result event (done)               → goes to claude_done → onEmailDone
      → saves text content only
      → NO: usage, toolActivity, tool messages, correct model
```

---

## 5. What Needs to Change to Achieve Parity

### Option A — Minimal Fix (Recommended)

Extend the existing email handlers in `useMCP.js` to track tools and usage, same as `useCliChat.js` does for regular sessions.

**Changes required:**

#### 1. `src/composables/useMCP.js` — `onEmailStream` handler

Add tool_use and tool_result processing, parallel to `runCliChat`:
```js
// Need per-email-session state (module-level Maps):
const emailToolUseToActivity = new Map()   // requestId+toolUseId → activityId
const emailToolUseMeta = new Map()         // requestId+toolUseId → { name, args }

async onEmailStream(id, event, emailSubject) {
  // ... session lookup unchanged ...
  
  // Text content — existing
  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        state.streamingContent.value += block.text
      } else if (block.type === 'tool_use') {
        // NEW: track tool_use
        const { addActivity } = useToolExecution(state)
        const activityId = addActivity(block.name, block.input)
        emailToolUseToActivity.set(`${id}:${block.id}`, activityId)
        emailToolUseMeta.set(`${id}:${block.id}`, { name: block.name, args: block.input })
      }
    }
  } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    // NEW: CLI stream-json emits tool_use via content_block_start
    const block = event.content_block
    const { addActivity } = useToolExecution(state)
    const activityId = addActivity(block.name, block.input || {})
    emailToolUseToActivity.set(`${id}:${block.id}`, activityId)
    emailToolUseMeta.set(`${id}:${block.id}`, { name: block.name, args: block.input || {} })
  } else if (event.type === 'user' && event.message?.content) {
    // NEW: tool_result blocks come as user-type events
    for (const block of event.message.content) {
      if (block.type === 'tool_result') {
        const key = `${id}:${block.tool_use_id}`
        const activityId = emailToolUseToActivity.get(key)
        const meta = emailToolUseMeta.get(key)
        const resultStr = /* normalize content same as useCliChat.js */
        if (activityId) { const { markActivityDone } = useToolExecution(state); markActivityDone(activityId, resultStr) }
        if (meta) {
          const toolMsg = { sessionId: dbSessionId, role: 'tool', toolCallId: activityId || block.tool_use_id, toolName: meta.name, toolArgs: meta.args, content: resultStr, resultType: classifyResult(meta.name, resultStr), timestamp: Date.now() }
          const msgId = await db.messages.add(toolMsg)
          toolMsg.id = msgId
          state.messages.value.push(toolMsg)
        }
        emailToolUseToActivity.delete(key)
        emailToolUseMeta.delete(key)
      }
    }
  } else if (event.type === 'result' && event.usage) {
    // NEW: capture usage (store on state for use in onEmailDone)
    state._emailUsage = { promptTokens: event.usage.input_tokens || 0, completionTokens: event.usage.output_tokens || 0, totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0) }
  }
  // ... delta handling unchanged ...
}
```

#### 2. `src/composables/useMCP.js` — `onEmailDone` handler

```js
async onEmailDone(id, cliSessionId, exitCode) {
  const dbSessionId = emailSessionMap.get(id)
  if (!dbSessionId) return
  const { getState } = useSessionState()
  const { updateSession } = useSessions()
  const state = getState(dbSessionId)
  const content = state.streamingContent.value
  if (content) {
    const { snapshotActivity } = useToolExecution(state)
    const toolActivitySnapshot = snapshotActivity()
    
    const dbMsg = {
      sessionId: dbSessionId,
      role: 'assistant',
      content,
      model: 'claude-cli:opus',     // FIXED: correct model
      files: [],
      timestamp: Date.now()
    }
    if (state._emailUsage) {
      dbMsg.usage = state._emailUsage       // FIXED: attach usage
      delete state._emailUsage
    }
    if (toolActivitySnapshot?.length) {
      dbMsg.toolActivity = toolActivitySnapshot  // FIXED: attach tool activity
    }
    
    const msgId = await db.messages.add(dbMsg)
    dbMsg.id = msgId
    state.messages.value.push(dbMsg)
  }
  // ... rest unchanged ...
}
```

#### 3. `src/composables/useMCP.js` — `onEmailReceived` handler

Fix the hardcoded wrong model:
```js
// Change:
'claude-cli:sonnet',
// To:
'claude-cli:opus',
```

#### 4. `bridge/email-watcher.js` — `_spawnEmailSession`

The `model: 'opus'` is correct here. No change needed. But the broadcast callback needs to pass `requestId` so the browser can map title updates correctly (see Gap 7). Currently `set_chat_title` carries no `requestId` — this is a pre-existing limitation in the bridge architecture, not specific to email.

### Option B — Proper Refactor

Extract the event-processing logic from `useCliChat.js` into a shared utility, then both regular chat and email handlers call it:

```js
// New: src/composables/useCliEventProcessor.js
export function createCliEventProcessor({ sessionId, state, onContent }) {
  // Encapsulates: addActivity, markActivityDone, tool message saves, usage capture
  // Returns: { processEvent(event), getUsage(), snapshotActivity() }
}
```

Then `runCliChat` and email handlers both use `createCliEventProcessor`. This eliminates duplication but requires more refactoring surface.

**Recommendation: Option A first.** It's minimal, targeted, and gives immediate parity. Option B can follow as a cleanup pass once parity is confirmed working.

---

## 6. Summary Table

| Feature | Regular Chat | Email Chat | Fix Needed |
|---------|-------------|-----------|-----------|
| Tool activity tracked live | ✅ Full | ❌ None | useMCP.js onEmailStream |
| Tool messages in IndexedDB | ✅ role:'tool' msgs | ❌ None | useMCP.js onEmailStream |
| ToolCallGroup displayed | ✅ Rich UI | ❌ Never shown | Follows from tool fix |
| Usage/token data on messages | ✅ usage obj | ❌ Missing | useMCP.js onEmailDone |
| TopBar token/cost bar | ✅ Visible | ❌ Hidden | Follows from usage fix |
| Per-message token annotation | ✅ Shown | ❌ Hidden | Follows from usage fix |
| UsageModal data | ✅ Populated | ❌ All zeros | Follows from usage fix |
| Model stored correctly | ✅ Correct | ❌ 'sonnet' (should be 'opus') | onEmailReceived + onEmailDone |
| SidebarSessionTree model badge | ✅ Correct | ❌ Wrong model | Follows from model fix |
| Interrupted badge | ✅ On stop | ❌ Never | N/A (emails run to completion) |
| Crash recovery (draft save) | ✅ Write-ahead log | ❌ None | Low priority |
| Stop streaming | ✅ Via stop button | ❌ Not wired | Low priority |
| set_chat_title routing | ✅ Per-session | ⚠️ Fragile (module var) | Should use requestId |

---

## 7. Files to Modify (For the Fix)

1. **`src/composables/useMCP.js`** — Primary change location
   - `onEmailReceived`: fix model from `'claude-cli:sonnet'` → `'claude-cli:opus'`
   - `onEmailStream`: add tool_use, tool_result, usage processing
   - `onEmailDone`: attach usage + toolActivity snapshot, fix model
   - Add module-level Maps: `emailToolUseToActivity`, `emailToolUseMeta`
   - Import: `useToolExecution`, `classifyResult`

2. **`src/composables/useToolExecution.js`** — Verify it can be called from useMCP (it should work fine — it's composable-safe)

3. No bridge changes needed for core parity. Bridge is working correctly.

---

## 8. What NOT to Change

- `bridge/email-watcher.js` — The spawning logic is correct. Model 'opus' is right. The broadcast approach is fine.
- `bridge/claude-cli.js` — No changes needed.
- `src/services/mcpBridge.js` — The routing of emailTriggered events is correct.
- `src/components/` — No component changes needed. Once messages have `toolActivity` and `usage`, the existing components will render them correctly automatically (MessageItem.vue already handles both paths).
- `src/services/db.js` — No schema changes needed. The existing schema already stores all needed fields.

---

## 9. Open Questions for Chart

1. **Email reply model**: Email sessions currently hardcode opus. Should this be configurable? Or always match the bridge's choice?

2. **The `requestId` attribution problem for `set_chat_title`**: The title can get routed to the wrong email session if two emails arrive in quick succession. The cleanest fix is to pass `requestId` through the `set_chat_title` event from the bridge all the way to the browser. Is this worth doing now, or save for a follow-up?

3. **Daily continuity email**: It uses the same `_spawnEmailSession` pathway. Should it also get parity? (Yes — same fix applies automatically.)

4. **Tool confirmation attribution**: Tool confirmations from email sessions broadcast to all tabs and show in whatever ChatView is active. This is the same behavior as pillar sessions. Is this acceptable or should it be fixed too?

5. **Streaming draft save for email sessions**: Regular chats have write-ahead crash recovery. Email sessions don't. This is lower priority but worth noting.
