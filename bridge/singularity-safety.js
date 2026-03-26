/**
 * Singularity Safety Module
 *
 * Input validation, prompt sanitization, and circuit breaker for Quinn
 * singularity chains. Guards the spawn_next pipeline from bad inputs,
 * runaway loops, and context overflow.
 *
 * All functions are synchronous for low-latency use in the spawn hot path.
 */

import { createLogger } from './logger.js'

const log = createLogger('singularity-safety')

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default safety limits for the singularity system.
 * These can be overridden per-call via the limits parameter.
 */
export const DEFAULT_LIMITS = {
  maxPromptBytes: 50 * 1024,         // 50KB max prompt
  maxPromptTokens: 12000,            // ~12K tokens max prompt
  minPromptTokens: 50,               // Must have some substance
  maxGenerations: 100,               // Hard cap on generation chain
  maxDurationMinutes: 120,           // 2 hour max for a chain
  maxErrorRate: 0.3,                 // 30% error rate triggers halt
  contextWarningThreshold: 0.8,      // Warn at 80% context usage
  contextCriticalThreshold: 0.95,    // Critical at 95%
}

// Control characters to strip (keep: tab \x09, LF \x0a, CR \x0d)
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Estimate token count for a string.
 * Uses ~4 chars per token heuristic — accurate enough for safety gating.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0
  return Math.ceil(text.length / 4)
}

/**
 * Sanitize a prompt string — strip dangerous content, normalize encoding,
 * and enforce size limits.
 * @param {string} prompt
 * @param {object} options - { maxBytes?, maxTokenEstimate?, stripControlChars? }
 * @returns {{ sanitized: string, changes: string[], originalSize: number, sanitizedSize: number }}
 */
export function sanitizePrompt(prompt, options = {}) {
  const {
    maxBytes = DEFAULT_LIMITS.maxPromptBytes,
    maxTokenEstimate = DEFAULT_LIMITS.maxPromptTokens,
    stripControlChars = true
  } = options

  const changes = []
  let sanitized = String(prompt)
  const originalSize = Buffer.byteLength(sanitized, 'utf8')

  // Strip null bytes
  if (sanitized.includes('\0')) {
    sanitized = sanitized.replace(/\0/g, '')
    changes.push('Stripped null bytes')
  }

  // Strip other dangerous control characters (preserve tab, LF, CR)
  if (stripControlChars) {
    const stripped = sanitized.replace(CONTROL_CHAR_RE, '')
    if (stripped !== sanitized) {
      sanitized = stripped
      changes.push('Stripped control characters')
    }
  }

  // Normalize CRLF/CR → LF
  const normalized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (normalized !== sanitized) {
    sanitized = normalized
    changes.push('Normalized line endings')
  }

  // Enforce byte limit — truncate carefully to avoid cutting mid-character
  const byteLen = Buffer.byteLength(sanitized, 'utf8')
  if (byteLen > maxBytes) {
    const buf = Buffer.from(sanitized, 'utf8').slice(0, maxBytes)
    // Remove potential partial multi-byte character at the cut point
    sanitized = buf.toString('utf8').replace(/\uFFFD$/, '')
    changes.push(`Truncated to ${maxBytes} bytes (was ${byteLen})`)
  }

  // Enforce token estimate limit
  const tokens = estimateTokens(sanitized)
  if (tokens > maxTokenEstimate) {
    sanitized = sanitized.slice(0, maxTokenEstimate * 4)
    changes.push(`Truncated to ~${maxTokenEstimate} tokens`)
  }

  const sanitizedSize = Buffer.byteLength(sanitized, 'utf8')
  return { sanitized, changes, originalSize, sanitizedSize }
}

/**
 * Compute word-level Jaccard similarity between two strings (0–1).
 * Used to detect near-duplicate prompts that could indicate a loop.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function computeWordSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return union === 0 ? 0 : intersection / union
}

/**
 * Validate a spawn_next request before it executes.
 * All validation is synchronous for use in the spawn hot path.
 *
 * The params object may optionally include previousPrompt for loop detection.
 *
 * @param {object} params - { prompt: string, state_summary?: string, task_for_next?: string, previousPrompt?: string }
 * @param {object} context - { generation: number, maxGenerations?: number }
 * @returns {{ valid: boolean, errors: string[], warnings: string[], sanitizedPrompt?: string }}
 */
export function validateSpawnNext(params, context) {
  const { prompt, state_summary, task_for_next, previousPrompt } = params
  const { generation, maxGenerations = DEFAULT_LIMITS.maxGenerations } = context

  const errors = []
  const warnings = []

  // ── Rule 1: prompt must be a non-empty string ────────────────────────────
  if (!prompt || typeof prompt !== 'string') {
    errors.push('prompt must be a non-empty string')
    // Can't continue validating without a prompt
    return { valid: false, errors, warnings }
  }

  // ── Rule 2: prompt length (min/max tokens) ───────────────────────────────
  const promptTokens = estimateTokens(prompt)
  if (promptTokens < DEFAULT_LIMITS.minPromptTokens) {
    errors.push(
      `prompt too short: ~${promptTokens} tokens (min ${DEFAULT_LIMITS.minPromptTokens})`
    )
  }
  if (promptTokens > DEFAULT_LIMITS.maxPromptTokens) {
    errors.push(
      `prompt too long: ~${promptTokens} tokens (max ${DEFAULT_LIMITS.maxPromptTokens})`
    )
  }

  // ── Rule 3: no null bytes or invalid encoding ────────────────────────────
  if (prompt.includes('\0')) {
    errors.push('prompt contains null bytes')
  }
  // Check round-trip encoding to detect invalid UTF-8 sequences
  try {
    const roundTripped = Buffer.from(prompt, 'utf8').toString('utf8')
    // If the original lacked the replacement char but the round-trip has it,
    // there was invalid UTF-8 that got replaced
    if (!prompt.includes('\uFFFD') && roundTripped.includes('\uFFFD')) {
      errors.push('prompt contains invalid UTF-8 sequences')
    }
  } catch {
    errors.push('prompt encoding validation failed')
  }

  // ── Rule 4: loop detection ───────────────────────────────────────────────
  if (previousPrompt && typeof previousPrompt === 'string' && previousPrompt.length > 0) {
    if (prompt.trim() === previousPrompt.trim()) {
      errors.push('prompt is identical to previous generation prompt (loop detected)')
    } else if (prompt.length > 200) {
      const similarity = computeWordSimilarity(prompt, previousPrompt)
      if (similarity > 0.95) {
        warnings.push(
          `prompt is nearly identical to previous generation (${Math.round(similarity * 100)}% word similarity)`
        )
      }
    }
  }

  // ── Rule 5: generation bounds ────────────────────────────────────────────
  if (!Number.isInteger(generation) || generation < 1) {
    errors.push(`generation must be a positive integer, got: ${JSON.stringify(generation)}`)
  } else if (generation >= maxGenerations) {
    errors.push(`generation ${generation} has reached the maximum limit of ${maxGenerations}`)
  } else if (generation >= Math.floor(maxGenerations * 0.8)) {
    warnings.push(
      `approaching max generations (${generation}/${maxGenerations})`
    )
  }

  // ── Rule 6: state_summary size limit (5000 tokens) ──────────────────────
  if (state_summary != null) {
    const summaryTokens = estimateTokens(String(state_summary))
    if (summaryTokens > 5000) {
      errors.push(`state_summary too long: ~${summaryTokens} tokens (max 5000)`)
    }
  }

  // ── Rule 7: task_for_next size limit (2000 tokens) ──────────────────────
  if (task_for_next != null) {
    const taskTokens = estimateTokens(String(task_for_next))
    if (taskTokens > 2000) {
      errors.push(`task_for_next too long: ~${taskTokens} tokens (max 2000)`)
    }
  }

  const valid = errors.length === 0

  if (valid) {
    log.info('spawn_next validated', { generation, promptTokens, warnings: warnings.length })
  } else {
    log.warn('spawn_next validation failed', { generation, errors: errors.length, firstError: errors[0] })
  }

  const result = { valid, errors, warnings }
  if (valid) {
    // Return sanitized version so callers don't need to sanitize separately
    result.sanitizedPrompt = sanitizePrompt(prompt).sanitized
  }
  return result
}

/**
 * Check if context is approaching overflow given current token usage.
 * @param {object} usage - { systemPromptTokens: number, conversationTokens: number, maxContext: number }
 * @returns {{ safe: boolean, usagePercent: number, remainingTokens: number, recommendation: string }}
 */
export function checkContextHealth(usage) {
  const {
    systemPromptTokens = 0,
    conversationTokens = 0,
    maxContext
  } = usage

  if (!maxContext || maxContext <= 0) {
    return {
      safe: true,
      usagePercent: 0,
      remainingTokens: Infinity,
      recommendation: 'maxContext not provided — cannot assess context health.'
    }
  }

  const totalUsed = systemPromptTokens + conversationTokens
  const usagePercent = totalUsed / maxContext
  const remainingTokens = Math.max(0, maxContext - totalUsed)

  let safe = true
  let recommendation

  if (usagePercent >= DEFAULT_LIMITS.contextCriticalThreshold) {
    safe = false
    recommendation = `CRITICAL: Context at ${Math.round(usagePercent * 100)}% (${remainingTokens} tokens remaining). Handoff to next generation immediately.`
    log.warn('Context at critical level', {
      usagePercent: Math.round(usagePercent * 100),
      remainingTokens
    })
  } else if (usagePercent >= DEFAULT_LIMITS.contextWarningThreshold) {
    recommendation = `WARNING: Context at ${Math.round(usagePercent * 100)}% (${remainingTokens} tokens remaining). Consider handoff soon.`
    log.info('Context approaching limit', {
      usagePercent: Math.round(usagePercent * 100),
      remainingTokens
    })
  } else {
    recommendation = `Context usage is healthy: ${Math.round(usagePercent * 100)}% used (${remainingTokens} tokens remaining).`
  }

  return { safe, usagePercent, remainingTokens, recommendation }
}

/**
 * Circuit breaker — decide whether to halt the generation chain.
 * Considers generation count, elapsed time, and error rate.
 * @param {object} chainState - { generation: number, startTime: Date|string, errors: number, totalSpawns: number }
 * @param {object} limits - { maxGenerations?, maxDurationMinutes?, maxErrorRate? }
 * @returns {{ halt: boolean, reason?: string }}
 */
export function shouldHaltChain(chainState, limits = {}) {
  const {
    maxGenerations = DEFAULT_LIMITS.maxGenerations,
    maxDurationMinutes = DEFAULT_LIMITS.maxDurationMinutes,
    maxErrorRate = DEFAULT_LIMITS.maxErrorRate
  } = limits

  const { generation, startTime, errors = 0, totalSpawns = 0 } = chainState

  // ── Check: max generations hard cap ─────────────────────────────────────
  if (generation >= maxGenerations) {
    const reason = `Max generations reached: ${generation}/${maxGenerations}`
    log.warn('Circuit breaker triggered: max generations', { generation, maxGenerations })
    return { halt: true, reason }
  }

  // ── Check: max chain duration ────────────────────────────────────────────
  if (startTime) {
    const startMs = startTime instanceof Date
      ? startTime.getTime()
      : new Date(startTime).getTime()

    if (!isNaN(startMs)) {
      const elapsedMinutes = (Date.now() - startMs) / 60000
      if (elapsedMinutes >= maxDurationMinutes) {
        const reason = `Max duration exceeded: ${Math.round(elapsedMinutes)}min (limit ${maxDurationMinutes}min)`
        log.warn('Circuit breaker triggered: max duration', {
          elapsedMinutes: Math.round(elapsedMinutes),
          maxDurationMinutes
        })
        return { halt: true, reason }
      }
    }
  }

  // ── Check: error rate ────────────────────────────────────────────────────
  if (totalSpawns > 0) {
    const errorRate = errors / totalSpawns
    if (errorRate >= maxErrorRate) {
      const reason = `Error rate too high: ${Math.round(errorRate * 100)}% (limit ${Math.round(maxErrorRate * 100)}%)`
      log.warn('Circuit breaker triggered: error rate', {
        errors,
        totalSpawns,
        errorRate: Math.round(errorRate * 100)
      })
      return { halt: true, reason }
    }
  }

  return { halt: false }
}
