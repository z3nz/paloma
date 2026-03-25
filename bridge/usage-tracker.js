import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger.js'

const log = createLogger('usage')

const TRACKING_FILE = 'usage-tracking.json'
const SAVE_DEBOUNCE_MS = 5000

// Default limits — conservative starting points, tuned by Adam over time
const DEFAULT_LIMITS = {
  claude:  { enabled: true, maxSessions: 100, threshold: 0.97, period: 'monthly' },
  copilot: { enabled: true, maxSessions: 300, threshold: 0.97, period: 'monthly' },
  gemini:  { enabled: true, maxRequests: 250, threshold: 0.88, period: 'daily' },
  codex:   { enabled: true, maxSessions: 200, threshold: 0.97, period: 'monthly' },
  ollama:  { enabled: true }  // local — never usage-limited
}

const BACKENDS = ['claude', 'copilot', 'gemini', 'codex', 'ollama']

/**
 * Usage-aware backend cycling system.
 *
 * Tracks session/request counts per backend per billing period.
 * When a backend approaches its usage limit (configurable threshold),
 * it gets auto-disabled so the fallback chain cycles to the next backend.
 * Resets automatically when the billing period rolls over.
 *
 * Persistence: `.paloma/usage-tracking.json`
 * Config: `.paloma/machine-profile.json` → usageLimits section
 */
export class UsageTracker {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this.trackingPath = join(projectRoot, '.paloma', TRACKING_FILE)
    this.profilePath = join(projectRoot, '.paloma', 'machine-profile.json')

    // Runtime state per backend
    this.data = {}
    for (const b of BACKENDS) {
      this.data[b] = this._emptyEntry(b)
    }

    // Merged config (defaults + machine-profile overrides)
    this.limits = { ...DEFAULT_LIMITS }

    this._saveTimer = null
    this._loaded = false
  }

  _emptyEntry(backend) {
    const period = DEFAULT_LIMITS[backend]?.period || 'monthly'
    const { start, end } = this._currentPeriod(period)
    return {
      sessions: 0,
      requests: 0,
      periodStart: start,
      periodEnd: end,
      disabled: false,
      disabledReason: null,
      manualOverride: null, // 'force-on' | 'force-off' | null
      history: []
    }
  }

  _currentPeriod(period) {
    const now = new Date()
    if (period === 'daily') {
      const day = now.toISOString().split('T')[0]
      return { start: day, end: day }
    }
    // Monthly: first to last day of current month
    const year = now.getFullYear()
    const month = now.getMonth()
    const start = new Date(year, month, 1).toISOString().split('T')[0]
    const end = new Date(year, month + 1, 0).toISOString().split('T')[0]
    return { start, end }
  }

  /**
   * Load persisted tracking data and config from disk.
   * Call once at bridge startup after BackendHealth.checkAll().
   */
  async load() {
    // Load limits from machine-profile
    await this._loadLimitsFromProfile()

    // Load tracking data
    try {
      if (existsSync(this.trackingPath)) {
        const raw = await readFile(this.trackingPath, 'utf-8')
        const saved = JSON.parse(raw)
        for (const b of BACKENDS) {
          if (saved[b]) {
            this.data[b] = { ...this._emptyEntry(b), ...saved[b] }
          }
        }
      }
    } catch (e) {
      log.warn('Failed to load tracking data, starting fresh', e.message)
    }

    // Check for period rollovers
    for (const b of BACKENDS) {
      this._checkPeriodRollover(b)
    }

    this._loaded = true
    log.info('Usage tracker loaded', this.getSummary())
  }

  async _loadLimitsFromProfile() {
    try {
      if (existsSync(this.profilePath)) {
        const profile = JSON.parse(await readFile(this.profilePath, 'utf-8'))
        if (profile.usageLimits) {
          for (const b of BACKENDS) {
            if (profile.usageLimits[b]) {
              this.limits[b] = { ...DEFAULT_LIMITS[b], ...profile.usageLimits[b] }
            }
          }
        }
      }
    } catch (e) {
      log.warn('Failed to load usage limits from profile', e.message)
    }
  }

  /**
   * Reset counters if the billing period has rolled over.
   */
  _checkPeriodRollover(backend) {
    const limit = this.limits[backend]
    if (!limit?.period) return

    const { start, end } = this._currentPeriod(limit.period)
    const entry = this.data[backend]

    if (entry.periodStart !== start) {
      // Period rolled over — archive old data to history, reset counters
      if (entry.sessions > 0 || entry.requests > 0) {
        entry.history.push({
          periodStart: entry.periodStart,
          periodEnd: entry.periodEnd,
          sessions: entry.sessions,
          requests: entry.requests
        })
        // Keep only last 6 periods of history
        if (entry.history.length > 6) {
          entry.history = entry.history.slice(-6)
        }
      }

      log.info(`Period rollover for ${backend}: ${entry.periodStart} → ${start}`)
      entry.sessions = 0
      entry.requests = 0
      entry.periodStart = start
      entry.periodEnd = end

      // Clear auto-disable on rollover (but preserve manual overrides)
      if (!entry.manualOverride) {
        entry.disabled = false
        entry.disabledReason = null
      }

      this._scheduleSave()
    }
  }

  /**
   * Record a session spawn for a backend.
   * Called by PillarManager after successfully spawning.
   */
  recordSession(backend) {
    if (!BACKENDS.includes(backend) || backend === 'ollama') return

    this._checkPeriodRollover(backend)
    const entry = this.data[backend]
    entry.sessions++

    // Also record in daily history for the current day
    const today = new Date().toISOString().split('T')[0]
    const dailyIdx = entry.history.findIndex(h => h.periodStart === today && h.periodEnd === today)
    // Don't duplicate into per-day history for monthly backends — that's in the main counter

    this._checkThreshold(backend)
    this._scheduleSave()

    log.info(`Recorded session for ${backend}`, {
      sessions: entry.sessions,
      limit: this.limits[backend]?.maxSessions || 'unlimited'
    })
  }

  /**
   * Record a request for a backend (used for Gemini's daily request counting).
   */
  recordRequest(backend) {
    if (!BACKENDS.includes(backend) || backend === 'ollama') return

    this._checkPeriodRollover(backend)
    this.data[backend].requests++

    this._checkThreshold(backend)
    this._scheduleSave()
  }

  /**
   * Check if a backend has crossed its usage threshold and should be disabled.
   */
  _checkThreshold(backend) {
    const limit = this.limits[backend]
    const entry = this.data[backend]
    if (!limit || entry.manualOverride) return

    let usage = 0
    let max = 0

    if (limit.maxSessions) {
      usage = entry.sessions
      max = limit.maxSessions
    } else if (limit.maxRequests) {
      usage = entry.requests
      max = limit.maxRequests
    } else {
      return // no limit configured
    }

    const ratio = max > 0 ? usage / max : 0
    const threshold = limit.threshold || 0.97

    if (ratio >= threshold && !entry.disabled) {
      entry.disabled = true
      entry.disabledReason = `Usage ${usage}/${max} (${(ratio * 100).toFixed(1)}%) hit ${(threshold * 100).toFixed(0)}% threshold`
      log.warn(`Auto-disabling ${backend}: ${entry.disabledReason}`)
    }
  }

  /**
   * Is this backend currently usage-limited?
   * Checks: manual override → auto-threshold → enabled flag in limits config.
   */
  isUsageLimited(backend) {
    if (backend === 'ollama') return false

    const entry = this.data[backend]
    const limit = this.limits[backend]

    // Manual override takes precedence
    if (entry?.manualOverride === 'force-off') return true
    if (entry?.manualOverride === 'force-on') return false

    // Config-level disable
    if (limit && !limit.enabled) return true

    // Auto-threshold disable
    if (entry?.disabled) return true

    return false
  }

  /**
   * Is this backend enabled at the config level?
   */
  isEnabled(backend) {
    const limit = this.limits[backend]
    if (!limit) return true
    return limit.enabled !== false
  }

  /**
   * Manually toggle a backend on or off.
   * override: 'force-on' | 'force-off' | null (clear override)
   */
  setManualOverride(backend, override) {
    if (!BACKENDS.includes(backend)) return false

    const entry = this.data[backend]
    entry.manualOverride = override

    if (override === 'force-on') {
      entry.disabled = false
      entry.disabledReason = null
      log.info(`Manual override: ${backend} force-enabled`)
    } else if (override === 'force-off') {
      entry.disabled = true
      entry.disabledReason = 'Manually disabled by user'
      log.info(`Manual override: ${backend} force-disabled`)
    } else {
      // Clearing override — re-check threshold
      this._checkThreshold(backend)
      log.info(`Manual override cleared for ${backend}`)
    }

    this._scheduleSave()
    return true
  }

  /**
   * Update the usage limit config for a backend.
   * Persists to machine-profile.json.
   */
  async updateLimits(backend, newLimits) {
    if (!BACKENDS.includes(backend)) return false

    this.limits[backend] = { ...this.limits[backend], ...newLimits }

    // Re-check threshold with new limits
    const entry = this.data[backend]
    if (entry && !entry.manualOverride) {
      entry.disabled = false
      entry.disabledReason = null
      this._checkThreshold(backend)
    }

    // Persist to machine-profile
    await this._saveLimitsToProfile()
    this._scheduleSave()
    return true
  }

  async _saveLimitsToProfile() {
    try {
      let profile = {}
      if (existsSync(this.profilePath)) {
        profile = JSON.parse(await readFile(this.profilePath, 'utf-8'))
      }
      profile.usageLimits = this.limits
      await writeFile(this.profilePath, JSON.stringify(profile, null, 2))
    } catch (e) {
      log.error('Failed to save limits to machine profile', e.message)
    }
  }

  /**
   * Get usage summary for all backends.
   */
  getSummary() {
    const summary = {}
    for (const b of BACKENDS) {
      const entry = this.data[b]
      const limit = this.limits[b]
      const maxVal = limit?.maxSessions || limit?.maxRequests || null
      const currentVal = limit?.maxSessions ? entry.sessions : (limit?.maxRequests ? entry.requests : 0)
      const percentage = maxVal ? ((currentVal / maxVal) * 100).toFixed(1) : null

      summary[b] = {
        sessions: entry.sessions,
        requests: entry.requests,
        periodStart: entry.periodStart,
        periodEnd: entry.periodEnd,
        disabled: entry.disabled,
        disabledReason: entry.disabledReason,
        manualOverride: entry.manualOverride,
        usageLimited: this.isUsageLimited(b),
        limit: maxVal,
        percentage: percentage ? `${percentage}%` : null,
        threshold: limit?.threshold ? `${(limit.threshold * 100).toFixed(0)}%` : null,
        period: limit?.period || null,
        enabled: limit?.enabled !== false
      }
    }
    return summary
  }

  /**
   * Debounced save to disk.
   */
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE_MS)
    if (this._saveTimer.unref) this._saveTimer.unref()
  }

  async _save() {
    try {
      const serializable = {}
      for (const b of BACKENDS) {
        serializable[b] = { ...this.data[b] }
      }
      await writeFile(this.trackingPath, JSON.stringify(serializable, null, 2))
    } catch (e) {
      log.error('Failed to save tracking data', e.message)
    }
  }

  /**
   * Force an immediate save (for clean shutdown).
   */
  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    await this._save()
  }

  /**
   * Clean shutdown.
   */
  async shutdown() {
    await this.flush()
  }
}
