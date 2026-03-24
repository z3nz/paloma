# Singularity — Quinn Spawn Tracking

**Status:** active
**Created:** 2026-03-23
**Scope:** paloma
**Goal:** Track and surface the number of workers spawned by Quinn in singularity mode.

## Implementation Steps
1. Initialize the spawn counter when a new session is created.
2. Increment the counter when the `spawn_worker` tool is invoked.
3. Expose the counter in the `pillar_status` output.

## Work Units

### WU-1: Initialize Spawn Counter
**Status:** completed
**Backend:** gemini
**Files:** `bridge/pillar-manager.js`
**Scope:** In the `spawn()` method (around line 200), initialize `workerSpawnCount: 0` on the newly created `session` object.

### WU-2: Increment Counter on Spawn
**Status:** completed
**Backend:** gemini
**Files:** `bridge/pillar-manager.js`
**Scope:** In the tool execution block for `spawn_worker` (around line 795), increment `session.workerSpawnCount += 1` immediately after the `this.spawn(childArgs)` call, before the blocking wait.

### WU-3: Surface Counter in Status
**Status:** completed
**Backend:** gemini
**Files:** `bridge/pillar-manager.js`
**Scope:** In the `getStatus({ pillarId })` method (around line 375), add `workerSpawnCount: session.workerSpawnCount` to the returned status object to expose it to Flow and the frontend.

## Implementation Notes
- Initialized `workerSpawnCount: 0` in the `session` object within the `spawn()` method.
- Added `session.workerSpawnCount += 1` inside the `spawn_worker` tool execution logic to track whenever a worker is spawned.
- Surfaced `workerSpawnCount` in the `getStatus` object to make it available to the frontend and Flow.