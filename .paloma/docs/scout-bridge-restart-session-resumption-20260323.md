# Scout Report: Bridge Restart Session Resumption Bug

**Date:** 2026-03-23  
**Pillar:** Scout  
**Objective:** Investigate why active sessions (Flow and background pillars) fail to resume after a bridge restart.

---

## 1. Executive Summary

The current architecture is optimized for a "clean slate" on every bridge restart. While this prevents orphaned processes and stale state, it creates a total loss of continuity for long-running background tasks (Pillars) and the parent Flow session. 

When the bridge restarts (e.g., due to a code change or a `SIGUSR1` restart signal), all in-memory state in the `PillarManager` and CLI managers is wiped. Child processes are terminated. The frontend, upon reconnecting, performs a full page reload which wipes its own in-memory state. Even though session metadata persists in IndexedDB, the "active" connection to the underlying CLI sessions is lost and never recovered.

## 2. Root Cause Analysis

### A. Bridge State Transience
- **Location:** `bridge/pillar-manager.js` and `bridge/claude-cli.js`
- **Issue:** Active pillar sessions are stored in a `Map` in `PillarManager`. Mapping between requests and processes is stored in a `Map` in `ClaudeCliManager`.
- **Result:** On bridge restart, these Maps are initialized as empty. The bridge has no record of what was running 5 seconds ago.

### B. Explicit Process Termination
- **Location:** `bridge/index.js` (shutdown handler)
- **Issue:** The `shutdown()` function calls `cliManager.shutdown()`, which sends `SIGTERM` to all running CLI child processes. 
- **Result:** Background pillars like Forge are killed mid-task.

### C. Frontend State Wipe (Full Reload)
- **Location:** `src/services/mcpBridge.js`
- **Issue:** The bridge sends a `supervisor_restart` message to all clients before shutting down. The browser receives this and sets a `restartPending` flag. Upon WebSocket reconnection, it calls `window.location.reload()`.
- **Result:** All in-memory state in `useSessionState.js` (streaming status, tool activity, current turn output) is wiped.

### D. Lack of Startup Recovery
- **Location:** `bridge/pillar-manager.js` (constructor)
- **Issue:** There is no persistence mechanism (e.g., an `active-pillars.json` file) and no startup logic to check for "orphaned" sessions that could be resumed using the CLI's `--resume <sessionId>` flag.

## 3. Key Files Involved

- `bridge/index.js`: Manages bridge lifecycle, kills stale processes, and handles WebSocket connections.
- `bridge/pillar-manager.js`: Tracks active pillar sessions; lacks persistence.
- `bridge/claude-cli.js`: Manages CLI child processes; terminates them on shutdown.
- `src/services/mcpBridge.js`: Handles frontend WebSocket reconnection and triggers page reload on bridge restart.
- `src/composables/useSessionState.js`: Holds transient UI state for active sessions; wiped on reload.

## 4. Recommendations

### Short-term (Resilience)
1. **Bridge-side Persistence:** `PillarManager` should write its active sessions to `.paloma/active-pillars.json` whenever a pillar is spawned or changes status.
2. **Startup Recovery:** On constructor/startup, `PillarManager` should read the active pillars file and "re-register" them. If a pillar was `running`, it should attempt to check if the process still exists or use `--resume` to reconnect.
3. **Graceful Reload:** The frontend should avoid a full `window.location.reload()` if the bridge state can be recovered. At minimum, it should restore "Streaming" UI state from IndexedDB after a reload.

### Long-term (Architecture)
1. **CLI Re-adoption:** Implement a mechanism for the bridge to re-adopt surviving CLI processes by checking PIDs and matching them against the persisted session map.
2. **Unified State:** Move the "currently waiting for pillar" state into the `db.sessions` record (IndexedDB) so it survives page reloads and bridge restarts.
3. **Pillar Callback Resilience:** If a pillar completes while the bridge is down, it should write its final result to a file (already partially handled by `output/` but not integrated into the callback system).

---
**Status:** Research complete. Ready for Chart to design the fix.
