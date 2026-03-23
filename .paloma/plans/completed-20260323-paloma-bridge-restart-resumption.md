# Plan: Bridge Restart Session Resumption

**Status:** ready
**Date:** 2026-03-23
**Scope:** Paloma Infrastructure
**Slug:** bridge-restart-resumption

## Goal
Enable Paloma to persist and restore active pillar and Flow sessions across bridge restarts (e.g., code changes, crashes, or manual restarts). Ensure the user doesn't lose work or context when the bridge's nervous system resets.

## Research References
- `.paloma/docs/scout-bridge-restart-session-resumption-20260323.md`
- `bridge/pillar-manager.js` (current session management)
- `src/composables/useMCP.js` (frontend reconciliation logic)

## Implementation Steps

### Phase 1: Bridge-side Persistence (Node.js)
1. **PillarManager State Persistence:**
   - Implement `_saveState()` and `_loadState()` in `PillarManager`.
   - Persist the `pillars` Map to `.paloma/active-pillars.json`.
   - Trigger `_saveState()` on pillar spawn, status change, turn completion, and error.
   - On bridge startup, `loadState()` should populate `this.pillars`.
   - **Status Mapping:** Sessions that were `running` or `streaming` at the time of save should be loaded as `interrupted` (since their child processes are dead).
2. **Flow Session Persistence:**
   - Persist `flowChatBuffers` (from `bridge/index.js`) to disk.
   - This allows the main Flow chat to recover its streaming content after a bridge-triggered page reload.

### Phase 2: CLI Session Continuity
1. **Early Session ID Capture:**
   - Update `PillarManager._handleCliEvent` to capture `session_id` stream events for Codex, Copilot, and Gemini backends.
   - This ensures we have the ID for resumption even if the turn was cut short.
2. **Resumption Tooling:**
   - Implement `pillar_resume({ pillarId })` in `PillarManager`.
   - This tool will restart the CLI turn for the specified pillar using the saved `cliSessionId` and the original prompt/context.

### Phase 3: Frontend Resilience (Vue)
1. **Avoid Destructive Reloads:**
   - Modify `src/services/mcpBridge.js` to avoid a full `window.location.reload()` on `supervisor_restart` if the bridge state can be recovered.
   - Instead, show a "Bridge Reconnecting..." overlay and trigger a re-sync on `onopen`.
2. **State Reconciliation Update:**
   - Update `_reconcilePillarSessions()` in `src/composables/useMCP.js` to handle the new `interrupted` status.
   - Ensure the UI reflects that a pillar is "Interrupted" and provides a "Resume" action.
3. **Pillar Card UI:**
   - Add a "Resume" button to the pillar status cards in the sidebar for `interrupted` sessions.

## Work Units

### WU-1: Persistence Foundation
**Status:** completed
**Backend:** gemini
**Files:**
- `bridge/pillar-manager.js`
- `bridge/index.js`
- `bridge/persistence.js`

**Scope:**
Implemented `Persistence` utility with debouncing. `PillarManager` now saves `this.pillars` and `flowChatBuffers` to `.paloma/bridge-state.json` on all state changes. Startup logic in `PillarManager` restores the state and marks active sessions as `interrupted`.

### WU-2: Capture Session IDs Early
**Status:** completed
**Backend:** gemini
**Files:**
- `bridge/pillar-manager.js`

**Scope:**
Updated `_handleCliEvent` to monitor for `sessionId` in all stream events. Captures and persists the ID immediately, ensuring the bridge has the necessary information to resume even if a turn is interrupted before completion.

## Implementation Notes

- **Persistence Utility:** Created `bridge/persistence.js` to handle JSON serialization with debouncing (default 2s) to prevent excessive disk I/O during high-frequency stream events.
- **Interrupted Status:** Sessions recovered during `_loadState` that were previously `running` or `streaming` are automatically transitioned to `interrupted`. This signal will be used by the frontend to offer resumption.
- **Buffer Recovery Fix:** `flowChatBuffers` map is now passed to the `PillarManager` constructor from `index.js`, ensuring it is initialized *before* `_loadState()` resolves. This fixes a race condition where the buffer was lost on restart.
- **Early Session ID Fix:** Updated `gemini-cli.js` and `codex-cli.js` to emit `sessionId` at the top-level of their early stream events, matching `PillarManager._handleCliEvent`'s expected schema for early capture.
- **Defensive Recovery:** Added robust error handling in `_loadState` to handle malformed or missing state files gracefully.

## Work Units (Remaining)
### WU-3: CLI Resumption Tool
**Status:** completed
**Backend:** gemini
**Files:**
- `bridge/pillar-manager.js`
- `bridge/mcp-proxy-server.js` (if exposed as tool)

**Scope:**
Implemented the `pillar_resume` logic. It takes an `interrupted` session, looks up its `cliSessionId`, and restarts a CLI turn using `--resume` flag with the existing state. Exposed as a tool for Ollama and Flow CLI.

### WU-4: Frontend Continuity & UX
**Status:** completed
**Backend:** gemini
**Files:**
- `src/services/mcpBridge.js`
- `src/composables/useMCP.js`
- `src/components/layout/SidebarSessionTree.vue`

**Scope:**
Updated the frontend to handle bridge reconnections gracefully without a full page reload. Added UI to show "Resume" buttons for interrupted tasks, which call the `resumePillar` method propagating back to `PillarManager`.

## Implementation Notes

- **Resume Tool Integration**: Created `resumeSession` method in `PillarManager`. Integrated it correctly to be callable by Flow via the new `pillar_resume` MCP tool and directly from the UI via websockets (`resumePillar`).
- **Frontend Graceful Reconnection**: Prevented `window.location.reload()` on supervisor restarts. `useMCP.js` now clears the `restartPending` state properly on WebSocket reconnection, avoiding destructive unhandled disruptions.
- **Pillar Tracking on UI**: `SidebarSessionTree.vue` now properly reflects the `interrupted` status state and provides a manual action for Adam to resume an interrupted process.

## Edge Cases
- **Tool calls mid-restart:** If a tool call was in progress, it will be lost. The resumed session may need to be informed that the tool execution failed.
- **Nearly-finished sessions:** If a session was 99% done, it will be marked `interrupted`. Resuming it will rerun the turn, potentially wasting tokens but ensuring completion.
- **Backend changes:** If a session was running on a backend that is no longer available on restart, `pillar_resume` should handle fallback.
