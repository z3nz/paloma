# Plan: Multi-Tab Parallel Sessions

**Status:** draft
**Created:** 2026-02-13
**Scope:** paloma
**Impact:** Major — architectural research needed, touches bridge, MCP proxy, session management

---

## The Problem

Adam wants to open multiple Paloma tabs, each working on a different project simultaneously. Today, this is untested territory. We need to understand what breaks, what works, and what needs to change.

---

## The Vision

Open Tab A on `fadden-demo`, Tab B on `verifesto-studios`, Tab C on a new project. All three work independently — different conversations, different project contexts, different tool permissions. No cross-talk, no shared state corruption.

---

## Research Questions (Must Answer Before Building)

### 1. Bridge WebSocket: Can Multiple Tabs Connect?

**Current state:** `bridge/index.js` creates a WebSocket server on port 19191.

**Questions:**
- Does the bridge support multiple concurrent WebSocket connections?
- Are tool calls routed per-connection or shared?
- Does `discover` return per-connection state or global state?
- If Tab A calls a tool, can Tab B's tool confirmation dialog accidentally catch it?

**Research approach:** Read bridge/index.js thoroughly. Check if connections are tracked individually. Test by opening two browser tabs.

### 2. MCP Proxy: Can Multiple CLI Subprocesses Coexist?

**Current state:** `bridge/mcp-proxy-server.js` runs an SSE server on port 19192. Claude CLI connects to it.

**Questions:**
- Can two CLI subprocesses connect simultaneously?
- Are tool confirmations routed to the correct browser tab?
- Is the `onToolConfirmation` callback per-connection?
- What happens if two CLIs request tools at the same time?

**Concern:** The proxy likely has a single `onToolConfirmation` handler. Two concurrent CLIs would fight for the same callback, causing cross-talk.

### 3. Session State: Is It Properly Isolated?

**Current state:** Composables use module-level singleton refs with HMR state on `window.__PALOMA_*__`.

**Questions:**
- Two tabs share `window` in the same browser? NO — each tab has its own window. Good.
- But do two tabs share the same IndexedDB? YES — same origin = same DB.
- Could two tabs write to the same session simultaneously? Possible if same session ID opened in both.
- What about `useSessions.js` — does it handle concurrent writes?

### 4. Project Context: Can Different Tabs Have Different Projects?

**Current state:** `useProject()` has module-level refs for `projectRoot`, `projectName`, etc.

**Questions:**
- Each tab has its own Vue instance → its own composable state. Should be isolated.
- But the bridge might not know which tab is associated with which project.
- CLI subprocess `cwd` is set per-request. Should work if each tab sends its own cwd.

### 5. `.paloma/mcp.json`: Concurrent Access?

**Questions:**
- Two tabs modifying the same project's mcp.json → last write wins. Acceptable?
- Two tabs modifying DIFFERENT projects' mcp.json → no conflict. Fine.

---

## Likely Architecture Changes

### A. Bridge Connection Multiplexing

The bridge needs to associate each WebSocket connection with a "session context":
- Connection ID → project path, active CLI subprocess, pending confirmations
- Tool confirmations routed to the correct connection
- `discover` returns the same global server list (shared resource)

### B. MCP Proxy Per-CLI Isolation

Options:
1. **Single proxy, multiplexed connections**: One SSE server, multiple CLI clients, route by connection ID
2. **Proxy per CLI**: Spawn a new SSE server on a dynamic port for each CLI subprocess
3. **Named pipes / IPC**: Skip SSE entirely for local connections

Option 2 is simplest and most isolated but uses more ports.
Option 1 is cleaner but requires proxy refactoring for multi-client support.

### C. Session Database Isolation

IndexedDB is shared per origin, but sessions are already keyed by `sessionId` and `projectPath`. As long as two tabs don't open the same session simultaneously, there's no conflict. We might want to add a "session lock" mechanism.

### D. Browser Tab Identity

Each tab needs a unique identity so the bridge can route responses correctly. Options:
- Generate a UUID on tab load, include in every bridge message
- Use the WebSocket connection ID (automatic, already unique per connection)

---

## Implementation Phases

### Phase 1: Research & Audit
- Read bridge/index.js and mcp-proxy-server.js for multi-connection support
- Manually test: open two tabs, send messages from both, observe behavior
- Document what works and what breaks

### Phase 2: Bridge Multi-Connection Support
- Track connections by ID in bridge
- Route tool confirmations to the correct connection
- Route CLI streams to the correct connection

### Phase 3: MCP Proxy Isolation
- Either multiplex or spawn per-CLI proxies
- Ensure tool confirmation callbacks are connection-specific

### Phase 4: Testing & Edge Cases
- Two tabs, same project: confirm no cross-talk
- Two tabs, different projects: confirm full isolation
- Tab closed while CLI running: graceful cleanup
- Rapid switching between tabs

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tool confirmation cross-talk | High | High | Connection-scoped routing |
| CLI subprocess leak on tab close | Medium | Medium | Cleanup on WS disconnect |
| IndexedDB race condition | Low | Low | Session locking or last-write-wins |
| Port exhaustion (if per-CLI proxy) | Low | Low | Reuse ports after cleanup |
| Bridge memory leak with many connections | Low | Medium | Connection lifecycle management |

---

## Success Criteria

- [ ] Two tabs can connect to bridge simultaneously
- [ ] Each tab can run independent CLI conversations
- [ ] Tool confirmations route to the correct tab
- [ ] Different projects in different tabs don't interfere
- [ ] Closing a tab cleans up its CLI subprocess
- [ ] Session list in sidebar is consistent across tabs (shared DB, not stale)
