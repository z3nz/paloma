# Scout Findings: Quinn Spawn Tracking

**Date:** 2026-03-23
**Scope:** paloma
**Topic:** Adding worker spawn counts to Quinn's singularity mode

## Current `spawn_worker` Flow
1. **Tool Definition:** The `spawn_worker` tool is injected exclusively for Quinn in `_buildOllamaTools` when `session.singularityRole === 'quinn'`.
2. **Tool Execution:** Intercepted in the tool handling logic (`_executeOllamaTool` or equivalent, around L795 in `bridge/pillar-manager.js`).
3. **Spawning the Worker:** It calls `this.spawn(childArgs)` creating a new child session configured with:
   - `pillar: 'forge'`
   - `backend: 'ollama'`
   - `singularityRole: 'worker'`
   - `parentPillarId: session.pillarId`
4. **Blocking Wait:** The parent session pauses execution using a Promise that registers with `this._pendingChildCompletions.set(childPillarId, resolve)`.
5. **Return:** When the worker completes (handled via `_handleCliEvent`), the promise resolves, and the resulting content is fed back to Quinn as the tool's response.

## Recommended Hook Points for Tracking
1. **Initialization:** 
   - In the `spawn()` method (around L200), when the `session` object is created, add a new property: `workerSpawnCount: 0`.
2. **Incrementing:** 
   - In the tool execution block for `spawn_worker` (L795+).
   - Immediately after the worker is spawned (`const spawnResult = await this.spawn(childArgs)`), increment the parent's count: `session.workerSpawnCount += 1`.
   - Incrementing here ensures we track the *attempted* spawn, before blocking on completion.

## Surfacing in `pillar_status`
- The `getStatus({ pillarId })` method (L375) generates the response for the `pillar_status` tool.
- We can include the count in the returned object:
  ```javascript
  return {
    pillarId,
    pillar: session.pillar,
    status: session.status,
    dbSessionId: session.dbSessionId,
    turnCount: session.turnCount,
    currentlyStreaming: session.currentlyStreaming,
    lastActivity: session.lastActivity,
    workerSpawnCount: session.workerSpawnCount // <--- Added here
  }
  ```
- This will expose the metric to Flow (when orchestrating) and the frontend.

## Edge Cases
- **Failed Workers:** Incrementing right after `this.spawn()` (before the `await` on completion) ensures we count the spawn even if the worker fails, times out, or produces empty output.
- **Concurrency:** Currently Quinn waits for one worker to finish before proceeding, so race conditions aren't an issue. If parallel spawning is added later, synchronous incrementing right after the `spawn()` call remains safe.
- **Persistence:** Since `this._saveState()` simply serializes the `session` objects, adding `workerSpawnCount` to the session ensures it will automatically persist across bridge restarts without additional code.
