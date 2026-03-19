import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const FALLBACK_CHAIN = ['claude', 'copilot', 'gemini', 'codex', 'ollama']

/**
 * Probes each AI backend's readiness at bridge startup and caches results.
 *
 * Health is checked once at startup. Runtime failures (from PillarManager's
 * fast-fail detection) update the cache via markUnhealthy().
 */
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
  }

  /**
   * Run all four backend probes. Returns a summary object.
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

    return this.getSummary()
  }

  async checkClaude() {
    const now = new Date().toISOString()
    try {
      // Check binary exists
      await execFileAsync('which', ['claude'])

      // Check auth status
      const { stdout } = await execFileAsync('claude', ['auth', 'status', '--json'], { timeout: 10000 })
      const authData = JSON.parse(stdout.trim())

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

      // Codex needs OPENAI_API_KEY env var
      if (process.env.OPENAI_API_KEY) {
        this.status.codex = { available: true, reason: 'API key set', lastCheck: now }
      } else {
        this.status.codex = { available: false, reason: 'OPENAI_API_KEY not set', lastCheck: now }
      }
    } catch {
      this.status.codex = { available: false, reason: 'binary not found', lastCheck: now }
    }
  }

  async checkCopilot() {
    const now = new Date().toISOString()
    try {
      await execFileAsync('which', ['copilot'])

      // Check GitHub auth (Copilot uses gh auth)
      await execFileAsync('gh', ['auth', 'status'], { timeout: 10000 })
      this.status.copilot = { available: true, reason: 'gh authenticated', lastCheck: now }
    } catch (e) {
      const reason = e.code === 'ENOENT' || e.message?.includes('not found')
        ? 'binary not found'
        : `gh auth failed: ${e.message}`
      this.status.copilot = { available: false, reason, lastCheck: now }
    }
  }

  async checkGemini() {
    const now = new Date().toISOString()
    try {
      await execFileAsync('which', ['gemini'])

      // Gemini CLI needs GEMINI_API_KEY env var for subprocess use
      if (process.env.GEMINI_API_KEY) {
        this.status.gemini = { available: true, reason: 'API key set', lastCheck: now }
      } else {
        this.status.gemini = { available: false, reason: 'GEMINI_API_KEY not set', lastCheck: now }
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
      console.warn(`[health] Marked ${backend} as unhealthy: ${reason}`)
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
    }
    return summary
  }
}
