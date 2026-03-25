import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir, hostname, totalmem, cpus, platform } from 'os'
import { createLogger } from './logger.js'

const execFileAsync = promisify(execFile)
const log = createLogger('health')

const FALLBACK_CHAIN = ['claude', 'copilot', 'gemini', 'codex', 'ollama']

/**
 * Probes each AI backend's readiness at bridge startup and caches results.
 *
 * Health is checked once at startup. Runtime failures (from PillarManager's
 * fast-fail detection) update the cache via markUnhealthy().
 */
const REPROBE_INTERVAL_MS = 5 * 60 * 1000 // Re-check backends every 5 minutes

export class BackendHealth {
  constructor() {
    // backend → { available: bool, reason: string, lastCheck: ISO string, models?: string[] }
    this.status = {
      claude:  { available: false, reason: 'not checked', lastCheck: null },
      codex:   { available: false, reason: 'not checked', lastCheck: null },
      copilot: { available: false, reason: 'not checked', lastCheck: null },
      gemini:  { available: false, reason: 'not checked', lastCheck: null },
      ollama:  { available: false, reason: 'not checked', lastCheck: null, models: [] }
    }
    this._reprobeTimer = null
    this.projectRoot = null
    this.machineProfile = null
    this._geminiRequestsToday = 0
    this._geminiResetDate = ''
  }

  setProjectRoot(root) {
    this.projectRoot = root
  }

  incrementGeminiRequests() {
    const today = new Date().toISOString().split('T')[0]
    if (this._geminiResetDate !== today) {
      this._geminiRequestsToday = 0
      this._geminiResetDate = today
    }
    this._geminiRequestsToday++
  }

  isGeminiApproachingLimit(threshold = 220) {
    return this._geminiRequestsToday >= threshold
  }

  getGeminiUsage() {
    return {
      today: this._geminiRequestsToday,
      limit: 250,
      date: this._geminiResetDate || new Date().toISOString().split('T')[0]
    }
  }

  /**
   * Run all five backend probes. Returns a summary object.
   * Starts periodic re-probes so stale health data gets refreshed.
   */
  async checkAll() {
    // Run all probes in parallel — each catches its own errors
    await Promise.all([
      this.checkClaude(),
      this.checkCodex(),
      this.checkCopilot(),
      this.checkGemini(),
      this.checkOllama()
    ])

    // Start periodic re-probes for backends that were unavailable
    this._startReprobeTimer()

    // WU-2: Generate machine profile after checks
    await this._generateMachineProfile()

    return this.getSummary()
  }

  /**
   * Generates or updates the machine profile JSON file in .paloma/
   */
  async _generateMachineProfile() {
    if (!this.projectRoot) return

    const profilePath = join(this.projectRoot, '.paloma', 'machine-profile.json')
    let preferences = {
      default: 'gemini',
      flow: 'gemini',
      scout: 'gemini',
      chart: 'claude',
      forge: 'gemini',
      polish: 'claude',
      ship: 'gemini',
      subWorker: 'ollama'
    }
    // Preserve user-configured fields that aren't auto-generated
    let emailAlias = null
    let continuityOwner = false

    try {
      if (existsSync(profilePath)) {
        const existing = JSON.parse(await readFile(profilePath, 'utf-8'))
        if (existing.preferences) {
          preferences = { ...preferences, ...existing.preferences }
        }
        if (existing.emailAlias) emailAlias = existing.emailAlias
        if (existing.continuityOwner != null) continuityOwner = existing.continuityOwner
      }
    } catch (e) {
      log.warn(`Error reading existing machine profile: ${e.message}`)
    }

    const backends = {}
    for (const [backend, info] of Object.entries(this.status)) {
      backends[backend] = {
        available: info.available,
        reason: info.reason,
        models: info.models || []
      }
    }

    // Preserve user-set fields (emailAlias, continuityOwner, etc.) from existing profile
    let existingCustomFields = {}
    try {
      if (existsSync(profilePath)) {
        const existing = JSON.parse(await readFile(profilePath, 'utf-8'))
        const { hardware: _h, backends: _b, preferences: _p, ...custom } = existing
        existingCustomFields = custom
      }
    } catch (e) {
      // ignore — we already tried reading above
    }

    const profile = {
      ...existingCustomFields,
      hardware: {
        hostname: hostname(),
        totalMemory: Math.round(totalmem() / (1024 * 1024 * 1024)) + 'GB',
        cpu: cpus()[0]?.model || 'unknown',
        platform: platform()
      },
      backends,
      ...(emailAlias && { emailAlias }),
      ...(continuityOwner != null && { continuityOwner }),
      preferences
    }

    try {
      await writeFile(profilePath, JSON.stringify(profile, null, 2))
      this.machineProfile = profile
    } catch (e) {
      log.error(`Failed to write machine profile: ${e.message}`)
    }
  }

  /**
   * Periodically re-check unavailable backends so they recover
   * when a service comes online after bridge startup.
   */
  _startReprobeTimer() {
    if (this._reprobeTimer) return
    this._reprobeTimer = setInterval(async () => {
      const unavailable = Object.entries(this.status)
        .filter(([, info]) => !info.available)
        .map(([backend]) => backend)
      if (unavailable.length === 0) {
        // All healthy — stop re-probing
        clearInterval(this._reprobeTimer)
        this._reprobeTimer = null
        return
      }
      const probes = unavailable.map(b => {
        const method = 'check' + b.charAt(0).toUpperCase() + b.slice(1)
        return this[method]?.()
      }).filter(Boolean)
      await Promise.all(probes)
      const recovered = unavailable.filter(b => this.status[b]?.available)
      if (recovered.length > 0) {
        log.info(`Backends recovered: ${recovered.join(', ')}`)
        // WU-2: Update machine profile when backends recover
        await this._generateMachineProfile()
      }
    }, REPROBE_INTERVAL_MS)
    this._reprobeTimer.unref()
  }

  async checkClaude() {
    const now = new Date().toISOString()
    try {
      // Check binary exists
      await execFileAsync('which', ['claude'])

      // Check auth status
      const { stdout } = await execFileAsync('claude', ['auth', 'status', '--json'], { timeout: 10000 })
      let authData
      try {
        authData = JSON.parse(stdout.trim())
      } catch (parseErr) {
        log.warn(`Claude auth status returned non-JSON: ${stdout.trim().slice(0, 200)}`)
        this.status.claude = { available: true, reason: 'auth check returned non-JSON (assuming available)', lastCheck: now }
        return
      }

      if (authData.loggedIn || authData.authenticated) {
        this.status.claude = { available: true, reason: 'authenticated', lastCheck: now }
      } else {
        this.status.claude = { available: false, reason: 'not authenticated', lastCheck: now }
      }
    } catch (e) {
      // If `which` fails, binary doesn't exist
      // If auth check fails, might still be usable — mark available with warning
      const reason = e.code === 'ENOENT' || e.message?.includes('not found')
        ? 'binary not found'
        : `auth check failed: ${e.message}`

      // Claude CLI often works even if auth status check errors — be generous
      const binaryExists = reason !== 'binary not found'
      this.status.claude = { available: binaryExists, reason, lastCheck: now }
    }
  }

  async checkCodex() {
    const now = new Date().toISOString()
    try {
      await execFileAsync('which', ['codex'])

      // Check CLI auth status — same pattern as Claude's auth check
      // Note: codex prints status to stderr, not stdout
      try {
        const { stdout, stderr } = await execFileAsync('codex', ['login', 'status'], { timeout: 10000 })
        const output = (stdout + ' ' + stderr).trim().toLowerCase()
        if (output.includes('logged in')) {
          this.status.codex = { available: true, reason: 'CLI authenticated', lastCheck: now }
        } else if (process.env.OPENAI_API_KEY) {
          this.status.codex = { available: true, reason: 'API key set', lastCheck: now }
        } else {
          this.status.codex = { available: false, reason: 'not authenticated (run: codex login)', lastCheck: now }
        }
      } catch {
        // login status command failed — check env var as fallback
        if (process.env.OPENAI_API_KEY) {
          this.status.codex = { available: true, reason: 'API key set', lastCheck: now }
        } else {
          this.status.codex = { available: false, reason: 'auth check failed (run: codex login)', lastCheck: now }
        }
      }
    } catch {
      this.status.codex = { available: false, reason: 'binary not found', lastCheck: now }
    }
  }

  async checkCopilot() {
    const now = new Date().toISOString()
    try {
      await execFileAsync('which', ['copilot'])

      // Check copilot's own config for logged-in users
      // Copilot CLI has its own auth system separate from gh CLI
      try {
        const configPath = join(homedir(), '.copilot', 'config.json')
        const config = JSON.parse(await readFile(configPath, 'utf-8'))
        if (config.logged_in_users?.length > 0) {
          const user = config.last_logged_in_user?.login || config.logged_in_users[0]?.login || 'unknown'
          this.status.copilot = { available: true, reason: `CLI authenticated (${user})`, lastCheck: now }
        } else if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
          this.status.copilot = { available: true, reason: 'token env var set', lastCheck: now }
        } else {
          this.status.copilot = { available: false, reason: 'not authenticated (run: copilot login)', lastCheck: now }
        }
      } catch {
        // Config not found — check env var fallback
        if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
          this.status.copilot = { available: true, reason: 'token env var set', lastCheck: now }
        } else {
          this.status.copilot = { available: false, reason: 'auth check failed (run: copilot login)', lastCheck: now }
        }
      }
    } catch {
      this.status.copilot = { available: false, reason: 'binary not found', lastCheck: now }
    }
  }

  async checkGemini() {
    const now = new Date().toISOString()
    try {
      await execFileAsync('which', ['gemini'])

      // Check Gemini's own OAuth credentials — stored in ~/.gemini/
      // (gemini CLI authenticates via Google OAuth, not API key)
      try {
        const accountsPath = join(homedir(), '.gemini', 'google_accounts.json')
        const accounts = JSON.parse(await readFile(accountsPath, 'utf-8'))
        if (accounts.active) {
          this.status.gemini = { available: true, reason: `CLI authenticated (${accounts.active})`, lastCheck: now }
        } else if (process.env.GEMINI_API_KEY) {
          this.status.gemini = { available: true, reason: 'API key set', lastCheck: now }
        } else {
          this.status.gemini = { available: false, reason: 'not authenticated (run: gemini)', lastCheck: now }
        }
      } catch {
        // OAuth files not found — check env var fallback
        if (process.env.GEMINI_API_KEY) {
          this.status.gemini = { available: true, reason: 'API key set', lastCheck: now }
        } else {
          this.status.gemini = { available: false, reason: 'auth check failed (run: gemini to authenticate)', lastCheck: now }
        }
      }
    } catch {
      this.status.gemini = { available: false, reason: 'binary not found', lastCheck: now }
    }
  }

  async checkOllama() {
    const now = new Date().toISOString()
    try {
      const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) })
      if (!response.ok) {
        this.status.ollama = { available: false, reason: `API returned ${response.status}`, lastCheck: now, models: [] }
        return
      }

      const data = await response.json()
      const models = (data.models || []).map(m => m.name || m.model)

      if (models.length > 0) {
        this.status.ollama = { available: true, reason: `${models.length} model(s) available`, lastCheck: now, models }
      } else {
        this.status.ollama = { available: false, reason: 'no models installed', lastCheck: now, models: [] }
      }
    } catch {
      this.status.ollama = { available: false, reason: 'service not running', lastCheck: now, models: [] }
    }
  }

  /**
   * Returns whether a backend is currently considered available.
   */
  isAvailable(backend) {
    return this.status[backend]?.available ?? false
  }

  /**
   * Walk the fallback chain and return the first available backend
   * that isn't the given one. Returns null if nothing is available.
   */
  getFallback(backend) {
    for (const candidate of FALLBACK_CHAIN) {
      if (candidate !== backend && this.isAvailable(candidate)) {
        return candidate
      }
    }
    return null
  }

  /**
   * Mark a backend as unhealthy after a runtime failure.
   */
  markUnhealthy(backend, reason) {
    if (this.status[backend]) {
      this.status[backend].available = false
      this.status[backend].reason = reason
      this.status[backend].lastCheck = new Date().toISOString()
      log.warn(`Marked ${backend} as unhealthy: ${reason}`)
      // Restart reprobe timer so the backend gets re-checked
      this._startReprobeTimer()
    }
  }

  /**
   * Stop periodic re-probing (for clean shutdown).
   */
  shutdown() {
    if (this._reprobeTimer) {
      clearInterval(this._reprobeTimer)
      this._reprobeTimer = null
    }
  }

  /**
   * Get a summary of all backend health statuses.
   */
  getSummary() {
    const summary = {}
    for (const [backend, info] of Object.entries(this.status)) {
      summary[backend] = { available: info.available, reason: info.reason }
      if (backend === 'ollama' && info.models?.length) {
        summary[backend].models = info.models
      }
      if (backend === 'gemini') {
        summary[backend].usage = this.getGeminiUsage()
      }
    }
    return summary
  }
}
