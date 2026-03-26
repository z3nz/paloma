/**
 * @file bridge/singularity-safety.js
 * @description Safety validation, prompt sanitization, and context monitoring for singularity operations.
 * Part of the Paloma Singularity Completion Sprint (Stream B - Gemini).
 */

import { Buffer } from 'node:buffer';

/**
 * Default safety limits for the singularity.
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
  maxStateSummaryTokens: 5000,       // Max tokens for state summary
  maxTaskForNextTokens: 2000,        // Max tokens for task for next
};

/**
 * Estimate token count for a string (rough: ~4 chars per token for English).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  // Standard heuristic for English models
  return Math.ceil(text.length / 4);
}

/**
 * Sanitize a prompt string — strip dangerous content, validate encoding, enforce size limits.
 * @param {string} prompt
 * @param {object} options - { maxBytes?: number, maxTokenEstimate?: number, stripControlChars?: boolean }
 * @returns {{ sanitized: string, changes: string[], originalSize: number, sanitizedSize: number }}
 */
export function sanitizePrompt(prompt, options = {}) {
  const {
    maxBytes = DEFAULT_LIMITS.maxPromptBytes,
    maxTokenEstimate = DEFAULT_LIMITS.maxPromptTokens,
    stripControlChars = true
  } = options;

  let sanitized = prompt || '';
  const changes = [];
  const originalSize = Buffer.byteLength(sanitized, 'utf8');

  // 1. Validate UTF-8 and remove null bytes
  if (sanitized.includes('\u0000')) {
    sanitized = sanitized.replace(/\0/g, '');
    changes.push('Removed null bytes');
  }

  // 2. Strip control characters (except common whitespace like \n, \r, \t)
  if (stripControlChars) {
    const beforeLength = sanitized.length;
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (sanitized.length < beforeLength) {
      changes.push('Stripped non-whitespace control characters');
    }
  }

  // 3. Enforce token limit (heuristic-based)
  const tokens = estimateTokens(sanitized);
  if (tokens > maxTokenEstimate) {
    const targetLength = maxTokenEstimate * 4;
    sanitized = sanitized.slice(0, targetLength);
    changes.push(`Truncated to ~${maxTokenEstimate} tokens (${sanitized.length} chars)`);
  }

  // 4. Enforce byte limit
  let byteSize = Buffer.byteLength(sanitized, 'utf8');
  if (byteSize > maxBytes) {
    // Truncate until under byte limit while remaining valid UTF-8
    let buf = Buffer.from(sanitized, 'utf8').subarray(0, maxBytes);
    sanitized = buf.toString('utf8');
    // toString might leave a partial character at the end, so we clean it up
    // by checking if the last char is valid or a replacement char
    if (sanitized.endsWith('\uFFFD')) {
      sanitized = sanitized.slice(0, -1);
    }
    changes.push(`Truncated to ${maxBytes} bytes`);
    byteSize = Buffer.byteLength(sanitized, 'utf8');
  }

  return {
    sanitized,
    changes,
    originalSize,
    sanitizedSize: byteSize
  };
}

/**
 * Validate a spawn_next request before it executes.
 * @param {object} params - { prompt: string, state_summary?: string, task_for_next?: string }
 * @param {object} context - { generation: number, maxGenerations?: number, previousPrompt?: string }
 * @returns {{ valid: boolean, errors: string[], warnings: string[], sanitizedPrompt?: string }}
 */
export function validateSpawnNext(params, context) {
  const errors = [];
  const warnings = [];
  const { prompt, state_summary, task_for_next } = params;
  const { generation, maxGenerations = DEFAULT_LIMITS.maxGenerations, previousPrompt } = context;

  // 1. Prompt must be a non-empty string
  if (!prompt || typeof prompt !== 'string') {
    errors.push('Prompt must be a non-empty string');
  } else {
    // 2. Prompt must be between minPromptTokens and maxPromptTokens
    const tokens = estimateTokens(prompt);
    if (tokens < DEFAULT_LIMITS.minPromptTokens) {
      errors.push(`Prompt is too short (${tokens} tokens). Minimum is ${DEFAULT_LIMITS.minPromptTokens}.`);
    }
    if (tokens > DEFAULT_LIMITS.maxPromptTokens) {
      errors.push(`Prompt is too long (~${tokens} tokens). Maximum is ${DEFAULT_LIMITS.maxPromptTokens}.`);
    }

    // 3. Prompt must not contain null bytes
    if (prompt.includes('\0')) {
      errors.push('Prompt contains null bytes');
    }

    // 4. Prompt must not be identical to previous generation's prompt
    if (previousPrompt && prompt.trim() === previousPrompt.trim()) {
      errors.push('Prompt is identical to previous generation (possible infinite loop)');
    }
  }

  // 5. Generation must be positive integer, less than maxGenerations
  if (typeof generation !== 'number' || generation <= 0 || !Number.isInteger(generation)) {
    errors.push(`Invalid generation number: ${generation}`);
  } else if (generation >= maxGenerations) {
    errors.push(`Maximum generation reached: ${generation} >= ${maxGenerations}`);
  }

  // 6. State summary length check
  if (state_summary) {
    const summaryTokens = estimateTokens(state_summary);
    if (summaryTokens > DEFAULT_LIMITS.maxStateSummaryTokens) {
      errors.push(`State summary is too long (~${summaryTokens} tokens). Maximum is ${DEFAULT_LIMITS.maxStateSummaryTokens}.`);
    }
  }

  // 7. Task for next length check
  if (task_for_next) {
    const taskTokens = estimateTokens(task_for_next);
    if (taskTokens > DEFAULT_LIMITS.maxTaskForNextTokens) {
      errors.push(`Task for next is too long (~${taskTokens} tokens). Maximum is ${DEFAULT_LIMITS.maxTaskForNextTokens}.`);
    }
  }

  let sanitizedPrompt = prompt;
  if (errors.length === 0 && prompt) {
    const result = sanitizePrompt(prompt);
    sanitizedPrompt = result.sanitized;
    if (result.changes.length > 0) {
      warnings.push(...result.changes);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedPrompt
  };
}

/**
 * Check if context is approaching overflow given current usage.
 * @param {object} usage - { systemPromptTokens: number, conversationTokens: number, maxContext: number }
 * @returns {{ safe: boolean, usagePercent: number, remainingTokens: number, recommendation: string }}
 */
export function checkContextHealth(usage) {
  const { systemPromptTokens = 0, conversationTokens = 0, maxContext } = usage;
  if (!maxContext) {
    return { safe: true, usagePercent: 0, remainingTokens: 0, recommendation: 'No maxContext provided for check' };
  }

  const totalUsed = systemPromptTokens + conversationTokens;
  const usagePercent = totalUsed / maxContext;
  const remainingTokens = maxContext - totalUsed;
  const safe = usagePercent < DEFAULT_LIMITS.contextCriticalThreshold;

  let recommendation = 'Context usage is within safe limits.';
  if (usagePercent >= DEFAULT_LIMITS.contextCriticalThreshold) {
    recommendation = 'CRITICAL: Context near limit. Immediate truncation or handoff required.';
  } else if (usagePercent >= DEFAULT_LIMITS.contextWarningThreshold) {
    recommendation = 'WARNING: Context usage high. Consider summarizing or ending session soon.';
  }

  return {
    safe,
    usagePercent,
    remainingTokens,
    recommendation
  };
}

/**
 * Circuit breaker — should we halt the generation chain?
 * Considers: generation count, time elapsed, error rate, resource usage.
 * @param {object} chainState - { generation: number, startTime: Date, errors: number, totalSpawns: number }
 * @param {object} limits - { maxGenerations?: number, maxDurationMinutes?: number, maxErrorRate?: number }
 * @returns {{ halt: boolean, reason?: string }}
 */
export function shouldHaltChain(chainState, limits = {}) {
  const { generation, startTime, errors = 0, totalSpawns = 0 } = chainState;
  const {
    maxGenerations = DEFAULT_LIMITS.maxGenerations,
    maxDurationMinutes = DEFAULT_LIMITS.maxDurationMinutes,
    maxErrorRate = DEFAULT_LIMITS.maxErrorRate
  } = limits;

  // 1. Max generations check
  if (generation >= maxGenerations) {
    return { halt: true, reason: `Reached maximum generation limit (${maxGenerations})` };
  }

  // 2. Duration check
  if (startTime) {
    const elapsedMinutes = (Date.now() - new Date(startTime).getTime()) / (1000 * 60);
    if (elapsedMinutes > maxDurationMinutes) {
      return { halt: true, reason: `Chain duration exceeds limit (${elapsedMinutes.toFixed(1)}m > ${maxDurationMinutes}m)` };
    }
  }

  // 3. Error rate check
  if (totalSpawns > 2) { // Only check after a few spawns to avoid early noise
    const errorRate = errors / totalSpawns;
    if (errorRate > maxErrorRate) {
      return { halt: true, reason: `Error rate too high (${(errorRate * 100).toFixed(1)}% > ${(maxErrorRate * 100).toFixed(1)}%)` };
    }
  }

  return { halt: false };
}

// Simple self-test if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[singularity-safety] Running self-test...');
  
  const p1 = "This is a valid prompt that is long enough to pass the minimum token check and has some substance. It needs to be at least 200 characters long to reach 50 tokens based on our simple heuristic of 4 characters per token. So I am adding more text to this prompt to ensure it is sufficiently substantial for the singularity process. This should now definitely pass the validation check.";
  const v1 = validateSpawnNext({ prompt: p1 }, { generation: 1 });
  console.log('Valid test:', v1.valid ? 'PASS' : 'FAIL', v1.errors);

  const v2 = validateSpawnNext({ prompt: "" }, { generation: 1 });
  console.log('Empty prompt test:', !v2.valid ? 'PASS' : 'FAIL', v2.errors);

  const v3 = validateSpawnNext({ prompt: p1 }, { generation: 101 });
  console.log('Max gen test:', !v3.valid ? 'PASS' : 'FAIL', v3.errors);

  const s1 = sanitizePrompt("Hello\0World\x01!", { stripControlChars: true });
  console.log('Sanitize test:', s1.sanitized === "HelloWorld!" ? 'PASS' : 'FAIL', `"${s1.sanitized}"`);
  
  const h1 = checkContextHealth({ systemPromptTokens: 1000, conversationTokens: 31000, maxContext: 32000 });
  console.log('Health critical test:', !h1.safe ? 'PASS' : 'FAIL', h1.recommendation);
}
