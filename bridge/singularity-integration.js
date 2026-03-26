/**
 * Singularity Integration Layer — the single wiring point between the
 * pillar manager and all singularity subsystems.
 *
 * pillar-manager.js imports ONLY this file. It provides lifecycle hooks
 * (pre-spawn, post-spawn, completion, error) that orchestrate memory,
 * lineage, safety, and monitoring behind a clean interface.
 *
 * Created during the 4-CLI Singularity Sprint (Stream D — Copilot).
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

// Stream A — Claude
import { initMemory, storeMemory, recallMemories, generateBriefing, memoryStats } from './singularity-memory.js'
import { validateLineage, getLineageSummary } from './singularity-lineage.js'

// Stream B — Gemini
import { validateSpawnNext, sanitizePrompt, estimateTokens, shouldHaltChain, DEFAULT_LIMITS } from './singularity-safety.js'
import { createChainMonitor, formatHealthReport } from './singularity-monitor.js'

const TAG = '[singularity-integration]'

// ---------------------------------------------------------------------------
// Module-level state (initialised lazily via initSingularity)
// ---------------------------------------------------------------------------

let singularityDir = null
let monitor = null
let chainState = null
let initialised = false

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize all singularity subsystems.
 * Call this once when the pillar manager starts.
 * @param {string} projectRoot - Path to the project root
 * @returns {Promise<{ memory: object, monitor: object, ready: boolean }>}
 */
export async function initSingularity(projectRoot) {
  singularityDir = join(projectRoot, '.singularity')
  await mkdir(singularityDir, { recursive: true })

  // Memory subsystem
  const memoryResult = await initMemory(singularityDir)
  console.log(`${TAG} Memory ready — ${memoryResult.generationCount} generations, ${memoryResult.memoryEntries} memories`)

  // Monitor subsystem
  monitor = createChainMonitor(singularityDir)

  // Chain state for circuit-breaker tracking
  chainState = {
    generation: 0,
    startTime: new Date(),
    errors: 0,
    totalSpawns: 0
  }

  initialised = true
  console.log(`${TAG} All subsystems initialised`)

  return {
    memory: memoryResult,
    monitor,
    ready: true
  }
}

/**
 * Pre-spawn hook — validate and prepare before a generation spawns.
 * Call this from pillar-manager BEFORE executing spawn_next.
 * @param {object} params - The spawn_next params (prompt, state_summary, task_for_next)
 * @param {object} session - The current session object
 * @returns {Promise<{ approved: boolean, sanitizedPrompt?: string, errors?: string[], briefing?: string }>}
 */
export async function preSpawnHook(params, session) {
  if (!initialised) {
    return { approved: false, errors: ['Singularity not initialised — call initSingularity first'] }
  }

  const errors = []
  const warnings = []

  // 1. Safety validation
  const generation = session?.generation || chainState.generation + 1
  const validation = validateSpawnNext(params, { generation, maxGenerations: DEFAULT_LIMITS.maxGenerations })

  if (!validation.valid) {
    console.log(`${TAG} Pre-spawn REJECTED — ${validation.errors.join('; ')}`)
    return { approved: false, errors: validation.errors }
  }

  if (validation.warnings?.length > 0) {
    warnings.push(...validation.warnings)
  }

  // 2. Sanitize the prompt
  const { sanitized: sanitizedPrompt, changes } = sanitizePrompt(params.prompt)
  if (changes.length > 0) {
    console.log(`${TAG} Prompt sanitized: ${changes.join(', ')}`)
  }

  // 3. Circuit breaker check
  const haltCheck = shouldHaltChain(chainState)
  if (haltCheck.halt) {
    console.log(`${TAG} Circuit breaker TRIPPED — ${haltCheck.reason}`)
    return { approved: false, errors: [`Circuit breaker: ${haltCheck.reason}`] }
  }

  // 4. Generate memory briefing for the new generation
  let briefing = null
  try {
    briefing = await generateBriefing(singularityDir, generation)
  } catch (err) {
    console.warn(`${TAG} Briefing generation failed (non-fatal): ${err.message}`)
  }

  if (warnings.length > 0) {
    console.log(`${TAG} Pre-spawn APPROVED with warnings: ${warnings.join('; ')}`)
  } else {
    console.log(`${TAG} Pre-spawn APPROVED for generation ${generation}`)
  }

  return {
    approved: true,
    sanitizedPrompt,
    errors: [],
    briefing
  }
}

/**
 * Post-spawn hook — record the spawn event and update monitoring.
 * Call this from pillar-manager AFTER a successful spawn_next.
 * @param {object} details - { generation, pillarId, promptHash, parentGeneration }
 * @returns {Promise<void>}
 */
export async function postSpawnHook(details) {
  if (!initialised) {
    console.warn(`${TAG} postSpawnHook called before init — skipping`)
    return
  }

  const { generation, pillarId, promptHash, parentGeneration } = details

  // Update chain state
  chainState.generation = generation
  chainState.totalSpawns++

  // Record in monitor
  if (monitor) {
    await monitor.recordSpawn(generation, pillarId, promptHash)
    if (parentGeneration != null) {
      const promptTokens = 0 // token count unknown here; monitor tolerates zero
      await monitor.recordHandoff(parentGeneration, generation, promptTokens)
    }
  }

  console.log(`${TAG} Post-spawn recorded — gen ${generation}, pillar ${pillarId}`)
}

/**
 * Completion hook — record generation completion and extract memories.
 * Call this when a generation's session ends.
 * @param {object} details - { generation, pillarId, durationMs, summary }
 * @returns {Promise<void>}
 */
export async function completionHook(details) {
  if (!initialised) {
    console.warn(`${TAG} completionHook called before init — skipping`)
    return
  }

  const { generation, pillarId, durationMs, summary } = details

  // Record in monitor
  if (monitor) {
    await monitor.recordCompletion(generation, pillarId, durationMs, summary)
  }

  // Auto-store a memory from the completion summary
  if (summary && singularityDir) {
    try {
      await storeMemory(singularityDir, {
        generation,
        category: 'discovery',
        content: `[Auto-captured at completion] ${summary.slice(0, 1500)}`,
        importance: 'medium'
      })
    } catch (err) {
      console.warn(`${TAG} Failed to auto-store completion memory: ${err.message}`)
    }
  }

  console.log(`${TAG} Completion recorded — gen ${generation}, ${durationMs}ms`)
}

/**
 * Error hook — record errors and check circuit breaker.
 * @param {object} details - { generation, pillarId, error }
 * @returns {Promise<{ shouldHalt: boolean, reason?: string }>}
 */
export async function errorHook(details) {
  if (!initialised) {
    return { shouldHalt: false }
  }

  const { generation, pillarId, error } = details

  // Update chain state
  chainState.errors++

  // Record in monitor
  if (monitor) {
    await monitor.recordError(generation, pillarId, error)
  }

  // Store the error as a memory so future generations can learn from it
  if (singularityDir) {
    try {
      await storeMemory(singularityDir, {
        generation,
        category: 'bug',
        content: `[Error in gen ${generation}] ${String(error).slice(0, 500)}`,
        importance: 'high'
      })
    } catch { /* non-fatal — don't let memory failure cascade */ }
  }

  // Re-check circuit breaker with updated error count
  const haltCheck = shouldHaltChain(chainState)
  if (haltCheck.halt) {
    console.log(`${TAG} Error hook — circuit breaker TRIPPED after error: ${haltCheck.reason}`)
  } else {
    console.log(`${TAG} Error recorded — gen ${generation}, errors so far: ${chainState.errors}`)
  }

  return {
    shouldHalt: haltCheck.halt,
    reason: haltCheck.reason
  }
}

/**
 * Get a comprehensive status report for the singularity system.
 * @returns {Promise<{ memory: object, lineage: object, monitor: object, safety: object }>}
 */
export async function getSingularityStatus() {
  if (!initialised || !singularityDir) {
    return {
      memory: { error: 'not initialised' },
      lineage: { error: 'not initialised' },
      monitor: { error: 'not initialised' },
      safety: { error: 'not initialised' }
    }
  }

  // Gather status from all subsystems in parallel
  const [memStats, lineageValidation, lineageSummary] = await Promise.all([
    memoryStats(singularityDir).catch(err => ({ error: err.message })),
    validateLineage(singularityDir).catch(err => ({ error: err.message })),
    getLineageSummary(singularityDir).catch(err => ({ error: err.message }))
  ])

  const monitorHealth = monitor ? monitor.getChainHealth() : { error: 'monitor not available' }

  return {
    memory: memStats,
    lineage: {
      validation: lineageValidation,
      summary: lineageSummary
    },
    monitor: monitorHealth,
    safety: {
      chainState,
      limits: DEFAULT_LIMITS,
      circuitBreaker: shouldHaltChain(chainState)
    }
  }
}
