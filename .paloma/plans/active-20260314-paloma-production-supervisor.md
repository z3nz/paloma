# Production Builds + Auto-Restart Supervisor

**Created:** 2026-03-14
**Status:** Active
**Scope:** Replace Vite dev server with production builds, add 30-minute auto-restart supervisor

## Goal

Eliminate HMR instability and memory leaks by:
1. Switching from Vite dev server to pre-built production static files
2. Adding a supervisor that auto-restarts the bridge every 30 minutes
3. Gracefully pausing active sessions before restart
4. Auto-refreshing the browser on restart

## Architecture

### Port Layout (Unchanged)
- **5173** — Static file server (Express, serves `dist/`)
- **19191** — Bridge WebSocket server
- **19192** — MCP proxy (SSE + Streamable HTTP)

### Process Tree
```
paloma-supervisor.js (PID 1 — never dies)
├── npm run build (runs before each bridge start)
├── static-server.js (serves dist/ on :5173, restarted after rebuild)
└── bridge/run.js → bridge/index.js (restarted every 30 min)
```

### Restart Flow
```
1. Supervisor timer hits 30 min
2. Check active pillar sessions via bridge API
3. If busy → wait for idle (max 5 min grace period, then force)
4. Send { type: 'supervisor_restart' } to all browser clients
5. Gracefully shutdown bridge (exit code 75)
6. Run `vite build` (rebuild frontend)
7. Restart static server (picks up new dist/)
8. Restart bridge
9. Browser auto-reconnects, loads fresh build
```

### Browser Behavior
- Frontend listens for `supervisor_restart` WebSocket event
- Shows "Restarting..." overlay
- mcpBridge already has reconnect logic with exponential backoff
- On reconnect → `window.location.reload()` to load fresh production build

## What Gets Removed
- `noFullReload()` Vite plugin
- `window.__PALOMA_*__` HMR state preservation (all 10 composables)
- `concurrently` dependency and usage
- Vite dev server from `npm start`
- HMR config from `vite.config.js`

## What Gets Added
- `scripts/paloma-supervisor.js` — top-level process manager
- `scripts/static-server.js` — Express static file server for dist/
- Restart overlay in frontend
- `supervisor_restart` WebSocket event handling in mcpBridge
- Auto-reload on reconnect after supervisor restart

## Work Units

#### WU-1: Create Express static file server that serves dist/ on port 5173
- **Feature:** Static File Server
- **Status:** complete
- **Files:** scripts/static-server.js, package.json
- **Scope:** Create Express static file server that serves dist/ on port 5173. Simple, standalone script that can be started/stopped independently by the supervisor.
- **Acceptance:** Server starts on :5173, serves built Vue app from dist/, handles SPA fallback (index.html for all routes).

#### WU-2: Create paloma-supervisor
- **Feature:** Supervisor Process Manager
- **Status:** complete
- **Depends on:** WU-1
- **Files:** scripts/paloma-supervisor.js, package.json
- **Scope:** Create paloma-supervisor.js — the top-level process that manages build, static server, and bridge lifecycle. Runs npm run build before each start cycle. Auto-restarts bridge every 30 minutes. Checks for active pillar sessions before restarting (5 min grace, then force). Sends supervisor_restart WebSocket message to browser clients before shutdown. Replaces concurrently as the orchestrator.
- **Acceptance:** Supervisor starts static server + bridge, rebuilds frontend before each cycle, restarts bridge every 30 min with graceful idle check, sends restart event to browsers.
- **Implementation Notes:** Created `scripts/paloma-supervisor.js` using ES modules. Uses `fork()` for bridge (IPC channel) and `spawn()` for static server. Restart cycle: checks idle via IPC `idle_check`/`idle_status`, retries up to 10×30s (5 min grace), sends `prepare_restart`, waits for bridge exit, rebuilds frontend, respawns both children. Handles external restarts (code 75 without our cycle), unexpected crashes (respawn after 1s, no rebuild), and graceful exits (code 0, no respawn). Updated `npm start` to use supervisor instead of concurrently. Added `npm run supervisor` shortcut. Kept `npm run bridge` for standalone mode.

#### WU-3: Add a mechanism for the supervisor to check if the bridge has active pillar sess
- **Feature:** Bridge Idle Check API
- **Status:** complete
- **Files:** bridge/index.js
- **Scope:** Add a mechanism for the supervisor to check if the bridge has active pillar sessions. Options: (a) HTTP endpoint on bridge, (b) IPC message between supervisor and bridge child process, or (c) check via PillarManager state file. Also add ability for bridge to broadcast supervisor_restart event to all connected WebSocket clients before shutdown.
- **Acceptance:** Supervisor can query bridge for active session count. Bridge can broadcast restart warning to all browser clients.
- **Implementation Notes:** Used IPC (option b) via `process.on('message')`. Two message types: `idle_check` → responds with `{ type: 'idle_status', active: N }` counting running/streaming pillars; `prepare_restart` → broadcasts `{ type: 'supervisor_restart' }` to all WS clients, then calls `shutdown(75)` after 3s delay. Added ~19 lines to `bridge/index.js` near existing signal handlers.

#### WU-4: Add supervisor_restart event handler in mcpBridge
- **Feature:** Frontend Restart Handling
- **Status:** complete
- **Depends on:** WU-3
- **Files:** src/services/mcpBridge.js, src/composables/useMCP.js, src/components/RestartOverlay.vue, src/App.vue
- **Scope:** Add supervisor_restart event handler in mcpBridge.js. Show a restart overlay in the UI when received. On WebSocket reconnect after a supervisor restart, trigger window.location.reload() to load the fresh production build.
- **Acceptance:** Browser shows overlay on restart event, auto-reloads on reconnect, loads fresh production build.
- **Implementation Notes:** Three-layer implementation: (1) mcpBridge.js already had `supervisor_restart` message handler setting `restartPending` flag and calling `onSupervisorRestart` callback; reconnect logic in `ws.onopen` checks `restartPending` and calls `window.location.reload()`. (2) useMCP.js exposes reactive `restartPending` ref, wired to the callback. (3) RestartOverlay.vue uses Teleport to body, shows full-screen dark overlay with spinning loader, "Restarting..." heading, and subtitle explaining auto-reload. Mounted in App.vue via `<RestartOverlay />`. Fade transition on enter/leave. Build verified passing.

#### WU-5: Remove noFullReload() plugin from vite
- **Feature:** HMR Removal + Vite Cleanup
- **Status:** pending
- **Depends on:** WU-1, WU-2
- **Files:** vite.config.js, package.json, src/composables/useMCP.js, src/composables/useProject.js, src/composables/usePermissions.js, src/composables/useFileIndex.js, src/composables/useKeyboardShortcuts.js, src/composables/useOpenRouter.js, src/composables/useSessions.js, src/composables/useSessionState.js, src/composables/useSettings.js, src/composables/useVoiceInput.js
- **Scope:** Remove noFullReload() plugin from vite.config.js. Remove all window.__PALOMA_*__ HMR state preservation from the 10 composables. Remove HMR-specific server config from vite.config.js (keep build config). Update npm scripts: replace concurrently-based start with supervisor, remove dev/preview scripts or repurpose them. Remove concurrently from devDependencies. Add express to dependencies for static server.
- **Acceptance:** No HMR code remains, vite.config.js is build-only, npm start uses supervisor, concurrently removed.
