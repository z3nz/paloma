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
 * Canonical Ollama model set — ensured on every machine at bridge startup.
 * Pull missing, remove superseded. Background pulls don't block startup.
 */
const PREFERRED_MODELS = [
  'gemma4:26b',               // native tool calling architecture (Apr 2026) — zero dropped calls
  'qwen3.5:35b',              // best large model — MLX-accelerated on Apple Silicon
  'qwen3.5:9b',               // best small/worker model
  'nomic-embed-text:latest',  // required for memory MCP server embeddings
]

const SUPERSEDED_MODELS = [
  'qwen3.5:27b',          // redundant between 35b and 9b
  'qwen3:32b',            // superseded by qwen3.5:35b
  'qwen3:8b',             // superseded by qwen3.5:9b
  'qwen3-coder:30b',      // superseded by qwen3-coder:30b-a3b-q8_0 (same model, better quant)
  'qwen2.5-coder:32b',    // superseded by qwen3.5 family
  'qwen2.5-coder:7b',     // superseded by qwen3.5:9b
]

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
    this.usageTracker = null // Set by bridge after construction
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

    // Generate machine profile after checks
    await this._generateMachineProfile()

    // Ensure canonical Ollama model set: remove superseded, pull missing
    // Fire-and-forget so bridge starts immediately — model management runs in background
    this.ensureOllamaModels().catch(e => log.warn(`ensureOllamaModels error: ${e.message}`))

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
        } else if (await this._hasGhAuthToken()) {
          this.status.copilot = { available: true, reason: 'GitHub auth token available', lastCheck: now }
        } else if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
          this.status.copilot = { available: true, reason: 'token env var set', lastCheck: now }
        } else {
          this.status.copilot = { available: false, reason: 'not authenticated (run: copilot login)', lastCheck: now }
        }
      } catch {
        // Config not found — check env var fallback
        if (await this._hasGhAuthToken()) {
          this.status.copilot = { available: true, reason: 'GitHub auth token available', lastCheck: now }
        } else if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
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
      const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        this.status.ollama = { available: false, reason: `API returned ${response.status}`, lastCheck: now, models: [] }
        return
      }

      const data = await response.json()
      const models = (data.models || []).map(m => m.name || m.model)

      // Mark available if Ollama is reachable regardless of model count.
      // ensureOllamaModels will pull any missing preferred models in the background.
      const reason = models.length > 0 ? `${models.length} model(s) available` : 'running (no models yet)'
      this.status.ollama = { available: true, reason, lastCheck: now, models }
    } catch {
      this.status.ollama = { available: false, reason: 'service not running', lastCheck: now, models: [] }
    }
  }

  /**
   * Ensure the canonical Ollama model set is installed.
   * Everything runs in the background via setImmediate — bridge starts immediately.
   * Deletions of superseded models and pulls of missing models are fully non-blocking.
   */
  async ensureOllamaModels() {
    if (!this.status.ollama?.available) return

    const base = process.env.OLLAMA_HOST || 'http://localhost:11434'

    // Remove superseded models in background — runs after bridge is up
    setImmediate(async () => {
      const installed = [...(this.status.ollama.models || [])]
      for (const model of SUPERSEDED_MODELS) {
        if (!installed.includes(model)) continue
        try {
          const res = await fetch(`${base}/api/delete`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
            signal: AbortSignal.timeout(10000)
          })
          if (res.ok) {
            log.info(`[ollama] Removed superseded model: ${model}`)
            const idx = this.status.ollama.models.indexOf(model)
            if (idx !== -1) this.status.ollama.models.splice(idx, 1)
          } else {
            log.warn(`[ollama] Could not remove ${model}: ${res.status}`)
          }
        } catch (e) {
          log.warn(`[ollama] Failed to remove ${model}: ${e.message}`)
        }
      }
    })

    // Pull missing preferred models in background — large models take minutes
    const currentInstalled = this.status.ollama.models
    const missing = PREFERRED_MODELS.filter(m => !currentInstalled.includes(m))
    if (missing.length === 0) return

    log.info(`Background pull queued for: ${missing.join(', ')}`)

    // Sequential pulls to avoid saturating bandwidth — fully non-blocking
    setImmediate(async () => {
      const base2 = process.env.OLLAMA_HOST || 'http://localhost:11434'
      for (const model of missing) {
        try {
          // Always re-check before pulling — startup list may be stale if Ollama was slow at boot.
          // If we can't get a fresh list, SKIP this model — never pull speculatively.
          let confirmed = false
          try {
            const freshRes = await fetch(`${base2}/api/tags`, { signal: AbortSignal.timeout(15000) })
            if (freshRes.ok) {
              const freshData = await freshRes.json()
              const nowInstalled = (freshData.models || []).map(m => m.name || m.model)
              if (nowInstalled.includes(model)) {
                log.info(`[ollama] ${model} already installed, skipping pull`)
                if (!this.status.ollama.models.includes(model)) this.status.ollama.models.push(model)
                continue
              }
              confirmed = true // list fetched successfully, model genuinely missing
            }
          } catch {
            log.warn(`[ollama] Could not verify model list before pulling ${model} — skipping to avoid spurious download`)
            continue
          }
          if (!confirmed) {
            log.warn(`[ollama] Ollama returned non-ok status for /api/tags — skipping pull of ${model}`)
            continue
          }

          log.info(`[ollama] Pulling ${model} in background...`)
          const res = await fetch(`${base2}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true })
            // No timeout — large models can take 30+ minutes on slow connections
          })
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            log.warn(`[ollama] Pull failed for ${model}: ${res.status} ${body.slice(0, 200)}`)
            continue
          }

          // Consume NDJSON stream — each chunk is a progress event
          let success = false
          let lastStatus = ''
          const decoder = new TextDecoder()
          for await (const chunk of res.body) {
            const text = decoder.decode(chunk, { stream: true })
            for (const line of text.split('\n')) {
              if (!line.trim()) continue
              try {
                const evt = JSON.parse(line)
                if (evt.status && evt.status !== lastStatus) {
                  lastStatus = evt.status
                  if (evt.total && evt.completed) {
                    const pct = Math.round((evt.completed / evt.total) * 100)
                    log.info(`[ollama] ${model}: ${evt.status} ${pct}%`)
                  } else {
                    log.info(`[ollama] ${model}: ${evt.status}`)
                  }
                }
                if (evt.status === 'success') success = true
              } catch { /* non-JSON line, ignore */ }
            }
          }

          if (success) {
            log.info(`[ollama] ✓ ${model} pulled successfully`)
            if (!this.status.ollama.models.includes(model)) this.status.ollama.models.push(model)
            await this._generateMachineProfile()
          } else {
            log.warn(`[ollama] Pull stream ended without success for ${model}`)
          }
        } catch (e) {
          log.warn(`[ollama] Error pulling ${model}: ${e.message}`)
        }
      }
    })
  }

  async _hasGhAuthToken() {
    try {
      const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10000 })
      return Boolean(stdout.trim())
    } catch {
      return false
    }
  }

  /**
   * Returns whether a backend is currently considered available.
   */
  isAvailable(backend) {
    return this.status[backend]?.available ?? false
  }

  /**
   * Returns whether a backend is available AND not usage-limited.
   * This is the primary check for backend selection.
   */
  isEffectivelyAvailable(backend) {
    if (!this.isAvailable(backend)) return false
    if (this.usageTracker?.isUsageLimited(backend)) return false
    return true
  }

  /**
   * Walk the fallback chain and return the first available backend
   * that isn't the given one and isn't usage-limited. Returns null if nothing is available.
   */
  getFallback(backend) {
    for (const candidate of FALLBACK_CHAIN) {
      if (candidate !== backend && this.isEffectivelyAvailable(candidate)) {
        return candidate
      }
    }
    // Last resort: any available backend even if usage-limited (except the original)
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
      // Include usage-limited status
      if (this.usageTracker) {
        summary[backend].usageLimited = this.usageTracker.isUsageLimited(backend)
        summary[backend].effectivelyAvailable = this.isEffectivelyAvailable(backend)
      }
    }
    return summary
  }
}
