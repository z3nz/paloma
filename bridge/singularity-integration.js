/**
 * singularity-integration.js
 *
 * Single wiring layer that connects all singularity subsystems (memory, lineage,
 * safety, monitor) to the pillar manager. pillar-manager.js only needs to import
 * this one file — all subsystem coordination lives here.
 *
 * Integration pattern in pillar-manager.js (added post-sprint):
 *
 *   import { initSingularity, preSpawnHook, postSpawnHook, completionHook, errorHook } from './singularity-integration.js'
 *
 *   // At startup:
 *   await initSingularity(this.projectRoot)
 *
 *   // Before spawn_next executes:
 *   const { approved, sanitizedPrompt, errors, briefing } = await preSpawnHook(params, session)
 *   if (!approved) return errors.join('; ')
 *
 *   // After successful spawn_next:
 *   await postSpawnHook({ generation, pillarId, promptHash, parentGeneration })
 *
 *   // On session completion:
 *   await completionHook({ generation, pillarId, durationMs, summary })
 *
 *   // On session error:
 *   const { shouldHalt, reason } = await errorHook({ generation, pillarId, error })
 */

import { join } from 'node:path'

// Lazy imports — the subsystem modules are created by Stream A/B of this sprint.
// Dynamic imports allow this integration layer to load even if the modules are not
// yet present (degrades gracefully — hooks become no-ops with a warning).

let _memory = null
let _lineage = null
let _safety = null
let _monitor = null
let _singularityDir = null
let _chainMonitor = null
let _initialized = false

// ── Subsystem loader ─────────────────────────────────────────────────────────

async function loadSubsystems(singularityDir) {
  const results = { memory: false, lineage: false, safety: false, monitor: false }

  // Try to import each subsystem module. Missing modules degrade gracefully.
  try {
    _memory = await import('./singularity-memory.js')
    results.memory = true
  } catch (err) {
    console.warn('[singularity-integration] singularity-memory.js not available:', err.message)
  }

  try {
    _lineage = await import('./singularity-lineage.js')
    results.lineage = true
  } catch (err) {
    console.warn('[singularity-integration] singularity-lineage.js not available:', err.message)
  }

  try {
    _safety = await import('./singularity-safety.js')
    results.safety = true
  } catch (err) {
    console.warn('[singularity-integration] singularity-safety.js not available:', err.message)
  }

  try {
    _monitor = await import('./singularity-monitor.js')
    results.monitor = true
  } catch (err) {
    console.warn('[singularity-integration] singularity-monitor.js not available:', err.message)
  }

  return results
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize all singularity subsystems.
 * Call this once when the pillar manager starts.
 *
 * @param {string} projectRoot - Path to the project root directory
 * @returns {Promise<{ memory: object|null, monitor: object|null, ready: boolean }>}
 */
export async function initSingularity(projectRoot) {
  if (_initialized) {
    console.log('[singularity-integration] Already initialized — skipping')
    return { memory: _memory, monitor: _monitor, ready: true }
  }

  _singularityDir = join(projectRoot, '.singularity')
  console.log('[singularity-integration] Initializing subsystems at:', _singularityDir)

  const loaded = await loadSubsystems(_singularityDir)
  console.log('[singularity-integration] Subsystems loaded:', loaded)

  // Initialize memory index
  let memoryStats = null
  if (_memory) {
    try {
      memoryStats = await _memory.initMemory(_singularityDir)
      console.log('[singularity-integration] Memory initialized:', memoryStats)
    } catch (err) {
      console.warn('[singularity-integration] Memory init failed:', err.message)
    }
  }

  // Create chain monitor
  if (_monitor) {
    try {
      _chainMonitor = _monitor.createChainMonitor(_singularityDir)
      console.log('[singularity-integration] Chain monitor created')
    } catch (err) {
      console.warn('[singularity-integration] Monitor init failed:', err.message)
    }
  }

  _initialized = true
  const ready = loaded.memory && loaded.safety && loaded.monitor

  return {
    memory: memoryStats,
    monitor: _chainMonitor,
    ready
  }
}

/**
 * Pre-spawn hook — validate and prepare before a generation spawns.
 * Call this from pillar-manager BEFORE executing spawn_next.
 *
 * Performs:
 *  1. Safety validation (prompt size, generation limit, loop detection)
 *  2. Prompt sanitization
 *  3. Circuit breaker check (should chain halt?)
 *  4. Memory briefing injection (what prior generations learned)
 *
 * @param {object} params - The spawn_next params { prompt, state_summary?, task_for_next? }
 * @param {object} session - Current session object { generation, startTime?, errors?, totalSpawns? }
 * @returns {Promise<{ approved: boolean, sanitizedPrompt?: string, errors?: string[], briefing?: string }>}
 */
export async function preSpawnHook(params, session) {
  const generation = session?.generation ?? 1

  // ── Safety validation ──────────────────────────────────────────────────────
  if (_safety) {
    const validation = _safety.validateSpawnNext(params, { generation })
    if (!validation.valid) {
      console.warn('[singularity-integration] Spawn rejected by safety validator:', validation.errors)
      return { approved: false, errors: validation.errors }
    }

    // Circuit breaker
    if (session) {
      const chainState = {
        generation,
        startTime: session.startTime || new Date(),
        errors: session.errors || 0,
        totalSpawns: session.totalSpawns || generation
      }
      const halt = _safety.shouldHaltChain(chainState)
      if (halt.halt) {
        console.warn('[singularity-integration] Circuit breaker triggered:', halt.reason)
        return { approved: false, errors: [`Circuit breaker: ${halt.reason}`] }
      }
    }

    // Sanitize prompt
    const sanitized = _safety.sanitizePrompt(params.prompt)
    params = { ...params, prompt: sanitized.sanitized }
    if (sanitized.changes.length > 0) {
      console.log('[singularity-integration] Prompt sanitized:', sanitized.changes)
    }
  }

  // ── Memory briefing ────────────────────────────────────────────────────────
  let briefing = null
  if (_memory && _singularityDir && generation > 1) {
    try {
      briefing = await _memory.generateBriefing(_singularityDir, generation)
    } catch (err) {
      console.warn('[singularity-integration] Failed to generate memory briefing:', err.message)
    }
  }

  return {
    approved: true,
    sanitizedPrompt: params.prompt,
    briefing
  }
}

/**
 * Post-spawn hook — record the spawn event and update monitoring.
 * Call this from pillar-manager AFTER a successful spawn_next.
 *
 * @param {object} details - { generation, pillarId, promptHash, parentGeneration? }
 * @returns {Promise<void>}
 */
export async function postSpawnHook(details) {
  const { generation, pillarId, promptHash } = details

  if (_chainMonitor) {
    try {
      _chainMonitor.recordSpawn(generation, pillarId, promptHash)
    } catch (err) {
      console.warn('[singularity-integration] postSpawnHook monitor error:', err.message)
    }
  }

  console.log(`[singularity-integration] Generation ${generation} spawned (pillar: ${pillarId})`)
}

/**
 * Completion hook — record generation completion and extract memories.
 * Call this when a generation's session ends normally.
 *
 * @param {object} details - { generation, pillarId, durationMs, summary }
 * @returns {Promise<void>}
 */
export async function completionHook(details) {
  const { generation, pillarId, durationMs, summary } = details

  // Record in monitor
  if (_chainMonitor) {
    try {
      _chainMonitor.recordCompletion(generation, pillarId, durationMs, summary)
    } catch (err) {
      console.warn('[singularity-integration] completionHook monitor error:', err.message)
    }
  }

  // Extract and store a memory entry from the completion summary
  if (_memory && _singularityDir && summary) {
    try {
      await _memory.storeMemory(_singularityDir, {
        generation,
        category: 'lesson',
        content: summary,
        importance: 'medium'
      })
    } catch (err) {
      console.warn('[singularity-integration] completionHook memory store error:', err.message)
    }
  }

  console.log(`[singularity-integration] Generation ${generation} completed (${durationMs}ms)`)
}

/**
 * Error hook — record errors and check circuit breaker.
 * Call this when a generation session encounters an error.
 *
 * @param {object} details - { generation, pillarId, error }
 * @returns {Promise<{ shouldHalt: boolean, reason?: string }>}
 */
export async function errorHook(details) {
  const { generation, pillarId, error } = details
  const errorMsg = error?.message || String(error)

  // Record in monitor
  if (_chainMonitor) {
    try {
      _chainMonitor.recordError(generation, pillarId, error)
    } catch (err) {
      console.warn('[singularity-integration] errorHook monitor error:', err.message)
    }
  }

  // Check if we should halt the chain after this error
  if (_safety && _chainMonitor) {
    try {
      const health = _chainMonitor.getChainHealth()
      const errorRate = health.generations > 0
        ? health.errors / health.generations
        : 0
      const chainState = {
        generation,
        startTime: new Date(),
        errors: health.errors || 1,
        totalSpawns: health.generations || 1
      }
      const halt = _safety.shouldHaltChain(chainState)
      if (halt.halt) {
        console.warn('[singularity-integration] Chain halt triggered after error:', halt.reason)
        return { shouldHalt: true, reason: halt.reason }
      }
    } catch (err) {
      console.warn('[singularity-integration] errorHook circuit check error:', err.message)
    }
  }

  console.warn(`[singularity-integration] Generation ${generation} error: ${errorMsg}`)
  return { shouldHalt: false }
}

/**
 * Get a comprehensive status report for the singularity system.
 * Returns current state from all loaded subsystems.
 *
 * @returns {Promise<{ memory: object|null, lineage: object|null, monitor: object|null, safety: object|null }>}
 */
export async function getSingularityStatus() {
  const status = {
    initialized: _initialized,
    singularityDir: _singularityDir,
    memory: null,
    lineage: null,
    monitor: null,
    safety: null
  }

  if (_memory && _singularityDir) {
    try {
      status.memory = await _memory.memoryStats(_singularityDir)
    } catch (err) {
      status.memory = { error: err.message }
    }
  }

  if (_lineage && _singularityDir) {
    try {
      status.lineage = await _lineage.validateLineage(_singularityDir)
    } catch (err) {
      status.lineage = { error: err.message }
    }
  }

  if (_chainMonitor) {
    try {
      status.monitor = _chainMonitor.getChainHealth()
    } catch (err) {
      status.monitor = { error: err.message }
    }
  }

  if (_safety) {
    status.safety = {
      limits: _safety.DEFAULT_LIMITS,
      available: true
    }
  }

  return status
}
