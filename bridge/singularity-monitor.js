/**
 * Singularity Chain Monitor
 *
 * Observability and health tracking for Quinn singularity generation chains.
 * Records spawn/completion/error/handoff events, tracks chain health over time,
 * and generates human-readable reports.
 *
 * Monitor data lives at: .singularity/chain-monitor.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createLogger } from './logger.js'

const log = createLogger('singularity-monitor')

const MONITOR_FILE = 'chain-monitor.json'

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Load monitor data from disk. Returns null if not found.
 * @param {string} singularityDir
 * @returns {Promise<object|null>}
 */
async function loadMonitorData(singularityDir) {
  const monitorPath = join(singularityDir, MONITOR_FILE)
  try {
    const raw = await readFile(monitorPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Save monitor data to disk. Creates directory if needed.
 * @param {string} singularityDir
 * @param {object} data
 */
async function saveMonitorData(singularityDir, data) {
  if (!existsSync(singularityDir)) {
    await mkdir(singularityDir, { recursive: true })
  }
  const monitorPath = join(singularityDir, MONITOR_FILE)
  await writeFile(monitorPath, JSON.stringify(data, null, 2), 'utf8')
}

// ─── ChainMonitor class ───────────────────────────────────────────────────────

/**
 * ChainMonitor — tracks health and progress of a singularity generation chain.
 *
 * Instantiate with createChainMonitor() or createChainMonitorAsync().
 * All mutation methods fire-and-forget persist to disk.
 */
class ChainMonitor {
  /**
   * @param {string} singularityDir
   * @param {object|null} existingData - Previously saved data, or null for fresh chain
   */
  constructor(singularityDir, existingData = null) {
    this.singularityDir = singularityDir
    this.data = existingData || {
      chainId: randomUUID(),
      startedAt: new Date().toISOString(),
      generations: [],
      currentGeneration: 0,
      isActive: true,
      totalErrors: 0
    }
  }

  /**
   * Record a new generation spawn event.
   * @param {number} generation
   * @param {string} pillarId
   * @param {string} promptHash
   */
  recordSpawn(generation, pillarId, promptHash) {
    const existing = this.data.generations.find(g => g.generation === generation)
    if (existing) {
      // Update in place if already partially recorded
      existing.pillarId = pillarId
      existing.promptHash = promptHash
      existing.spawnedAt = new Date().toISOString()
    } else {
      this.data.generations.push({
        generation,
        pillarId,
        promptHash,
        spawnedAt: new Date().toISOString(),
        completedAt: null,
        durationMs: null,
        summary: null,
        handoffTo: null,
        handoffPromptTokens: null,
        errors: []
      })
    }
    this.data.currentGeneration = Math.max(this.data.currentGeneration, generation)
    this.data.isActive = true

    log.info('Spawn recorded', { generation, pillarId, promptHash })
    this._persist()
  }

  /**
   * Record generation completion.
   * @param {number} generation
   * @param {string} pillarId
   * @param {number} durationMs
   * @param {string} summary
   */
  recordCompletion(generation, pillarId, durationMs, summary) {
    const genData = this.data.generations.find(g => g.generation === generation)
    if (genData) {
      genData.completedAt = new Date().toISOString()
      genData.durationMs = typeof durationMs === 'number' ? durationMs : null
      genData.summary = summary || null
    } else {
      // Completion recorded without a prior spawn — create a synthetic entry
      this.data.generations.push({
        generation,
        pillarId,
        promptHash: 'unknown',
        spawnedAt: null,
        completedAt: new Date().toISOString(),
        durationMs: typeof durationMs === 'number' ? durationMs : null,
        summary: summary || null,
        handoffTo: null,
        handoffPromptTokens: null,
        errors: []
      })
    }
    log.info('Completion recorded', { generation, durationMs })
    this._persist()
  }

  /**
   * Record an error for a generation.
   * @param {number} generation
   * @param {string} pillarId
   * @param {string|Error} error
   */
  recordError(generation, pillarId, error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const genData = this.data.generations.find(g => g.generation === generation)

    if (genData) {
      if (!Array.isArray(genData.errors)) genData.errors = []
      genData.errors.push({
        timestamp: new Date().toISOString(),
        pillarId,
        message: errorMsg
      })
    } else {
      // Error without a spawn record
      this.data.generations.push({
        generation,
        pillarId,
        promptHash: 'unknown',
        spawnedAt: null,
        completedAt: null,
        durationMs: null,
        summary: null,
        handoffTo: null,
        handoffPromptTokens: null,
        errors: [{ timestamp: new Date().toISOString(), pillarId, message: errorMsg }]
      })
    }

    this.data.totalErrors++
    log.warn('Error recorded', { generation, error: errorMsg })
    this._persist()
  }

  /**
   * Record a handoff event from one generation to the next.
   * @param {number} fromGeneration
   * @param {number} toGeneration
   * @param {number} promptSizeTokens
   */
  recordHandoff(fromGeneration, toGeneration, promptSizeTokens) {
    const fromData = this.data.generations.find(g => g.generation === fromGeneration)
    if (fromData) {
      fromData.handoffTo = toGeneration
      fromData.handoffPromptTokens = promptSizeTokens
    }
    log.info('Handoff recorded', { fromGeneration, toGeneration, promptSizeTokens })
    this._persist()
  }

  /**
   * Get the current chain health summary.
   * @returns {{ generations, successRate, avgDuration, currentGeneration, isActive, errors }}
   */
  getChainHealth() {
    const gens = this.data.generations
    const completed = gens.filter(g => g.completedAt !== null)
    const withErrors = gens.filter(g => Array.isArray(g.errors) && g.errors.length > 0)

    const successRate = gens.length > 0
      ? (completed.length - withErrors.length) / gens.length
      : 0

    const durations = completed
      .filter(g => typeof g.durationMs === 'number')
      .map(g => g.durationMs)

    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null

    return {
      generations: gens.length,
      successRate: Math.round(successRate * 100) / 100,
      avgDuration,
      currentGeneration: this.data.currentGeneration,
      isActive: this.data.isActive,
      errors: this.data.totalErrors
    }
  }

  /**
   * Get a detailed report for a specific generation.
   * Returns null if the generation is not tracked.
   * @param {number} generation
   * @returns {{ spawned, completed, duration, promptHash, summary, errors }|null}
   */
  getGenerationReport(generation) {
    const genData = this.data.generations.find(g => g.generation === generation)
    if (!genData) return null

    return {
      spawned: genData.spawnedAt,
      completed: genData.completedAt,
      duration: genData.durationMs,
      promptHash: genData.promptHash,
      summary: genData.summary,
      errors: genData.errors || []
    }
  }

  /**
   * Get a comprehensive chain report as a markdown string.
   * @returns {string}
   */
  getFullReport() {
    const health = this.getChainHealth()
    const statusIcon = health.isActive ? '🟢' : '⚫'
    const lines = []

    lines.push(`# Singularity Chain Report`)
    lines.push(``)
    lines.push(`**Chain ID:** \`${this.data.chainId}\``)
    lines.push(`**Started:** ${this.data.startedAt}`)
    lines.push(`**Status:** ${statusIcon} ${health.isActive ? 'Active' : 'Inactive'}`)
    lines.push(``)
    lines.push(`## Health Summary`)
    lines.push(``)
    lines.push(`| Metric | Value |`)
    lines.push(`|--------|-------|`)
    lines.push(`| Current Generation | ${health.currentGeneration} |`)
    lines.push(`| Total Generations | ${health.generations} |`)
    lines.push(`| Success Rate | ${Math.round(health.successRate * 100)}% |`)
    lines.push(`| Avg Duration | ${health.avgDuration !== null ? `${Math.round(health.avgDuration / 1000)}s` : 'N/A'} |`)
    lines.push(`| Total Errors | ${health.errors} |`)
    lines.push(``)
    lines.push(`## Generation History`)

    const sorted = [...this.data.generations].sort((a, b) => a.generation - b.generation)
    for (const gen of sorted) {
      const hasErrors = Array.isArray(gen.errors) && gen.errors.length > 0
      const status = gen.completedAt
        ? (hasErrors ? '⚠️' : '✅')
        : (gen.spawnedAt ? '🔄' : '❓')

      lines.push(``)
      lines.push(`### ${status} Generation ${gen.generation}`)
      if (gen.pillarId) lines.push(`- **Pillar:** \`${gen.pillarId}\``)
      if (gen.promptHash) lines.push(`- **Prompt Hash:** \`${gen.promptHash}\``)
      if (gen.spawnedAt) lines.push(`- **Spawned:** ${gen.spawnedAt}`)
      if (gen.completedAt) lines.push(`- **Completed:** ${gen.completedAt}`)
      if (gen.durationMs != null) lines.push(`- **Duration:** ${Math.round(gen.durationMs / 1000)}s`)
      if (gen.handoffTo != null) {
        lines.push(`- **Handoff to:** Generation ${gen.handoffTo} (~${gen.handoffPromptTokens || '?'} tokens)`)
      }
      if (gen.summary) {
        lines.push(`- **Summary:** ${gen.summary.slice(0, 200)}${gen.summary.length > 200 ? '…' : ''}`)
      }
      if (hasErrors) {
        lines.push(`- **Errors:**`)
        for (const err of gen.errors) {
          lines.push(`  - \`${err.timestamp}\` ${err.message}`)
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * Write the full report to a file.
   * @param {string} filepath
   * @returns {Promise<void>}
   */
  async saveReport(filepath) {
    const report = this.getFullReport()
    await writeFile(filepath, report, 'utf8')
    log.info('Report saved', { filepath, chars: report.length })
  }

  /**
   * Persist monitor data to disk (fire-and-forget — errors are logged, not thrown).
   * @private
   */
  _persist() {
    saveMonitorData(this.singularityDir, this.data).catch(err => {
      log.error('Failed to persist monitor data', { error: err.message })
    })
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Create a new chain monitor instance with fresh state.
 * For resuming an existing chain, use createChainMonitorAsync() instead.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {ChainMonitor}
 */
export function createChainMonitor(singularityDir) {
  log.info('New chain monitor created', { singularityDir })
  return new ChainMonitor(singularityDir)
}

/**
 * Create a chain monitor, loading any existing data from disk.
 * Use this when resuming a chain after a restart or interruption.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {Promise<ChainMonitor>}
 */
export async function createChainMonitorAsync(singularityDir) {
  const existing = await loadMonitorData(singularityDir)
  log.info('Chain monitor loaded from disk', {
    singularityDir,
    hasExisting: !!existing,
    currentGeneration: existing?.currentGeneration ?? 0
  })
  return new ChainMonitor(singularityDir, existing)
}

/**
 * Format a chain health summary as a readable markdown table.
 * @param {object} health - Output from ChainMonitor.getChainHealth()
 * @returns {string} - Markdown-formatted health report
 */
export function formatHealthReport(health) {
  const statusIcon = health.isActive ? '🟢' : '⚫'
  const statusLabel = health.isActive ? 'Active' : 'Inactive'
  const successPct = Math.round((health.successRate || 0) * 100)
  const avgDurLabel = health.avgDuration !== null
    ? `${Math.round(health.avgDuration / 1000)}s`
    : 'N/A'

  return [
    `## Chain Health ${statusIcon}`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Status | ${statusLabel} |`,
    `| Current Generation | ${health.currentGeneration} |`,
    `| Total Generations | ${health.generations} |`,
    `| Success Rate | ${successPct}% |`,
    `| Avg Duration | ${avgDurLabel} |`,
    `| Total Errors | ${health.errors} |`
  ].join('\n')
}
