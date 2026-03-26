/**
 * Singularity Test Suite — comprehensive tests for all singularity modules.
 *
 * Uses Node.js built-in test runner (node:test). No external dependencies.
 * Run with: node --test bridge/__tests__/singularity.test.js
 *
 * Created during the 4-CLI Singularity Sprint (Stream D — Copilot).
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Stream A — Memory & Lineage
import { initMemory, storeMemory, recallMemories, generateBriefing, memoryStats } from '../singularity-memory.js'
import { validateLineage, diffGenerations, repairLineage, getLineageSummary, truncateLineage } from '../singularity-lineage.js'

// Stream B — Safety & Monitor
import { validateSpawnNext, sanitizePrompt, estimateTokens, checkContextHealth, shouldHaltChain, DEFAULT_LIMITS } from '../singularity-safety.js'
import { createChainMonitor, formatHealthReport } from '../singularity-monitor.js'

// Stream D — Integration
import { initSingularity, preSpawnHook, postSpawnHook, completionHook, errorHook, getSingularityStatus } from '../singularity-integration.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory for test fixtures. */
async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'singularity-test-'))
}

/** Write a minimal generation manifest for testing. */
async function writeManifest(dir, gen, { summary = 'Test summary', taskForNext = 'Keep going', prompt = 'Do your best' } = {}) {
  const padded = String(gen).padStart(3, '0')
  const content = `# Generation ${gen}

**Born:** 2026-03-26T12:00:00Z
**Ended:** 2026-03-26T12:05:00Z
**Model:** qwen3-coder:30b
**Session:** test-session-${gen}

## Summary

${summary}

## Task Passed Forward

${taskForNext}

## Prompt Written for Next Generation

\`\`\`
${prompt}
\`\`\`
`
  await writeFile(join(dir, `generation-${padded}.md`), content, 'utf-8')
}

/** Write a lineage.json for testing. */
async function writeLineage(dir, entries) {
  await writeFile(join(dir, 'lineage.json'), JSON.stringify(entries, null, 2), 'utf-8')
}

// ============================================================================
// MEMORY TESTS (Stream A — singularity-memory.js)
// ============================================================================

describe('singularity-memory', () => {
  let tempDir

  before(async () => {
    tempDir = await makeTempDir()
  })

  after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('initMemory with empty directory returns zero counts', async () => {
    const result = await initMemory(tempDir)
    assert.equal(result.generationCount, 0)
    assert.equal(result.memoryEntries, 0)
  })

  it('storeMemory adds entry and returns ID', async () => {
    const id = await storeMemory(tempDir, {
      generation: 1,
      category: 'discovery',
      content: 'The bridge uses port 19191 for WebSocket',
      importance: 'high'
    })

    assert.ok(id.startsWith('mem-'), `Expected ID to start with "mem-", got "${id}"`)
    assert.equal(typeof id, 'string')

    // Verify it's persisted
    const raw = await readFile(join(tempDir, 'memory-index.json'), 'utf-8')
    const index = JSON.parse(raw)
    assert.ok(index.entries.some(e => e.id === id))
  })

  it('storeMemory rejects invalid category', async () => {
    await assert.rejects(
      () => storeMemory(tempDir, { generation: 1, category: 'invalid', content: 'test', importance: 'low' }),
      /Invalid category/
    )
  })

  it('storeMemory rejects invalid importance', async () => {
    await assert.rejects(
      () => storeMemory(tempDir, { generation: 1, category: 'lesson', content: 'test', importance: 'mega' }),
      /Invalid importance/
    )
  })

  it('storeMemory rejects non-positive generation', async () => {
    await assert.rejects(
      () => storeMemory(tempDir, { generation: 0, category: 'lesson', content: 'test', importance: 'low' }),
      /positive integer/
    )
  })

  it('recallMemories finds relevant entries by keyword', async () => {
    // Store a few entries
    await storeMemory(tempDir, { generation: 1, category: 'lesson', content: 'Vue composables use ref() for reactivity', importance: 'medium' })
    await storeMemory(tempDir, { generation: 2, category: 'decision', content: 'WebSocket messages use JSON encoding', importance: 'high' })

    const results = await recallMemories(tempDir, 'Vue reactivity')
    assert.ok(results.length > 0, 'Expected at least one result for "Vue reactivity"')
    // The Vue entry should score higher
    const vueResult = results.find(r => r.content.includes('Vue'))
    assert.ok(vueResult, 'Expected to find the Vue-related memory')
    assert.ok(vueResult.relevanceScore > 0, 'Expected positive relevance score')
  })

  it('recallMemories respects minImportance filter', async () => {
    const results = await recallMemories(tempDir, 'bridge WebSocket port', { minImportance: 'high' })
    for (const r of results) {
      assert.ok(['high', 'critical'].includes(r.importance), `Expected high+ importance, got "${r.importance}"`)
    }
  })

  it('generateBriefing produces output under 2000 tokens', async () => {
    const briefing = await generateBriefing(tempDir, 5)
    assert.ok(typeof briefing === 'string')
    assert.ok(briefing.length > 0, 'Briefing should not be empty')
    const tokenEstimate = Math.ceil(briefing.length / 4)
    assert.ok(tokenEstimate <= 2000, `Briefing should be under 2000 tokens, got ~${tokenEstimate}`)
  })

  it('generateBriefing for generation 1 gives first-gen message', async () => {
    const freshDir = await makeTempDir()
    try {
      await initMemory(freshDir)
      const briefing = await generateBriefing(freshDir, 1)
      assert.ok(briefing.includes('Generation 1'), 'Should mention generation 1')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  it('memoryStats returns correct counts', async () => {
    const stats = await memoryStats(tempDir)
    assert.ok(stats.totalMemories >= 3, `Expected at least 3 memories, got ${stats.totalMemories}`)
    assert.ok(typeof stats.byCategory === 'object')
    assert.ok(typeof stats.byImportance === 'object')
    assert.ok(typeof stats.byGeneration === 'object')
    assert.ok(typeof stats.oldestGeneration === 'number')
    assert.ok(typeof stats.newestGeneration === 'number')
  })
})

// ============================================================================
// LINEAGE TESTS (Stream A — singularity-lineage.js)
// ============================================================================

describe('singularity-lineage', () => {
  let tempDir

  before(async () => {
    tempDir = await makeTempDir()
  })

  after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('validateLineage passes on empty directory', async () => {
    const emptyDir = await makeTempDir()
    try {
      const result = await validateLineage(emptyDir)
      assert.equal(result.valid, true)
      assert.equal(result.generationCount, 0)
      assert.deepEqual(result.issues, [])
    } finally {
      await rm(emptyDir, { recursive: true, force: true })
    }
  })

  it('validateLineage passes on valid lineage', async () => {
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1)
      await writeManifest(dir, 2)
      await writeLineage(dir, [
        { gen: 1, born: '2026-03-26T12:00:00Z', summary: 'Gen 1', promptHash: 'abc' },
        { gen: 2, born: '2026-03-26T12:05:00Z', summary: 'Gen 2', promptHash: 'def' }
      ])

      const result = await validateLineage(dir)
      assert.equal(result.valid, true)
      assert.equal(result.generationCount, 2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('validateLineage detects missing manifests', async () => {
    const dir = await makeTempDir()
    try {
      // Lineage says gen 1 and 2 exist, but only gen 1 manifest is on disk
      await writeManifest(dir, 1)
      await writeLineage(dir, [
        { gen: 1, born: '2026-03-26T12:00:00Z', summary: 'Gen 1', promptHash: 'abc' },
        { gen: 2, born: '2026-03-26T12:05:00Z', summary: 'Gen 2', promptHash: 'def' }
      ])

      const result = await validateLineage(dir)
      assert.equal(result.valid, false)
      assert.ok(result.issues.some(i => i.includes('gen 2')), 'Should detect missing manifest for gen 2')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('repairLineage rebuilds from manifest files', async () => {
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1, { summary: 'Explored the codebase' })
      await writeManifest(dir, 2, { summary: 'Built memory system' })
      // No lineage.json — repair should create it

      const result = await repairLineage(dir)
      assert.equal(result.repaired, true)
      assert.equal(result.generationsFound, 2)
      assert.equal(result.lineageEntries, 2)

      // Verify lineage.json was created
      const raw = await readFile(join(dir, 'lineage.json'), 'utf-8')
      const lineage = JSON.parse(raw)
      assert.equal(lineage.length, 2)
      assert.equal(lineage[0].gen, 1)
      assert.equal(lineage[1].gen, 2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('diffGenerations shows changes between two prompts', async () => {
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1, { prompt: 'Explore the codebase and learn' })
      await writeManifest(dir, 2, { prompt: 'Explore the codebase and build the memory system' })

      const diff = await diffGenerations(dir, 1, 2)
      assert.ok(diff.genA.summary, 'genA should have summary')
      assert.ok(diff.genB.summary, 'genB should have summary')
      assert.ok(typeof diff.genA.tokenEstimate === 'number')
      assert.ok(typeof diff.genB.tokenEstimate === 'number')
      assert.ok(typeof diff.diff === 'string')
      assert.ok(typeof diff.evolutionNotes === 'string')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('diffGenerations throws for missing manifest', async () => {
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1)
      await assert.rejects(
        () => diffGenerations(dir, 1, 99),
        /not found/
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('getLineageSummary returns compact entries', async () => {
    const dir = await makeTempDir()
    try {
      await writeLineage(dir, [
        { gen: 1, born: '2026-03-26T12:00:00Z', summary: 'Gen 1 summary', promptHash: 'abc123' },
        { gen: 2, born: '2026-03-26T12:05:00Z', summary: 'Gen 2 summary', promptHash: 'def456' }
      ])

      const summary = await getLineageSummary(dir)
      assert.equal(summary.length, 2)
      assert.equal(summary[0].generation, 1)
      assert.equal(summary[1].generation, 2)
      assert.ok(summary[0].promptHash)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('truncateLineage archives generations after cutpoint', async () => {
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1)
      await writeManifest(dir, 2)
      await writeManifest(dir, 3)
      await writeLineage(dir, [
        { gen: 1, summary: 'Gen 1' },
        { gen: 2, summary: 'Gen 2' },
        { gen: 3, summary: 'Gen 3' }
      ])

      const result = await truncateLineage(dir, 1)
      assert.equal(result.kept, 1)
      assert.equal(result.archived, 2)

      // Verify lineage only contains gen 1
      const raw = await readFile(join(dir, 'lineage.json'), 'utf-8')
      const lineage = JSON.parse(raw)
      assert.equal(lineage.length, 1)
      assert.equal(lineage[0].gen, 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('truncateLineage rejects non-positive generation', async () => {
    await assert.rejects(
      () => truncateLineage(tempDir, 0),
      /positive integer/
    )
  })
})

// ============================================================================
// SAFETY TESTS (Stream B — singularity-safety.js)
// ============================================================================

describe('singularity-safety', () => {
  it('validateSpawnNext rejects empty prompt', () => {
    const result = validateSpawnNext({ prompt: '' }, { generation: 1 })
    assert.equal(result.valid, false)
    assert.ok(result.errors.length > 0)
  })

  it('validateSpawnNext rejects missing prompt', () => {
    const result = validateSpawnNext({}, { generation: 1 })
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => /prompt/i.test(e)))
  })

  it('validateSpawnNext rejects oversized prompt (>50KB)', () => {
    const bigPrompt = 'x'.repeat(51 * 1024) // 51KB
    const result = validateSpawnNext({ prompt: bigPrompt }, { generation: 1 })
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => /too long|size|bytes|large|limit|token/i.test(e)))
  })

  it('validateSpawnNext rejects generation over max', () => {
    const result = validateSpawnNext(
      { prompt: 'A valid prompt with enough content to pass the minimum token check.' },
      { generation: 101, maxGenerations: 100 }
    )
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => /generation/i.test(e)))
  })

  it('validateSpawnNext approves valid input', () => {
    // Prompt needs ≥200 chars to reach 50 tokens (4 chars/token heuristic)
    const validPrompt = 'Explore the Paloma codebase thoroughly. Focus on the bridge layer and understand how pillar sessions are managed. Document all findings in the .singularity directory. Pay special attention to the WebSocket protocol and the MCP tool routing. This is a comprehensive exploration task.'
    const result = validateSpawnNext(
      { prompt: validPrompt },
      { generation: 5, maxGenerations: 100 }
    )
    assert.equal(result.valid, true, `Expected valid but got errors: ${result.errors.join('; ')}`)
    assert.equal(result.errors.length, 0)
  })

  it('sanitizePrompt strips null bytes', () => {
    const result = sanitizePrompt('Hello\x00World\x00Test')
    assert.ok(!result.sanitized.includes('\x00'), 'Should not contain null bytes')
    assert.ok(result.changes.length > 0, 'Should report changes')
  })

  it('sanitizePrompt preserves valid UTF-8', () => {
    const validText = 'Hello world! 🕊️ Paloma — résumé, naïve, café'
    const result = sanitizePrompt(validText)
    assert.equal(result.sanitized, validText)
  })

  it('estimateTokens returns reasonable estimate for known string', () => {
    const text = 'The quick brown fox jumps over the lazy dog'  // 44 chars
    const tokens = estimateTokens(text)
    assert.ok(tokens >= 5, `Expected at least 5 tokens, got ${tokens}`)
    assert.ok(tokens <= 30, `Expected at most 30 tokens, got ${tokens}`)
  })

  it('estimateTokens handles empty string', () => {
    const tokens = estimateTokens('')
    assert.equal(tokens, 0)
  })

  it('checkContextHealth marks unsafe at critical threshold (95%)', () => {
    // safe = false only when usagePercent >= contextCriticalThreshold (0.95)
    const criticalResult = checkContextHealth({
      systemPromptTokens: 3000,
      conversationTokens: 60000,
      maxContext: 65536
    })
    // 63000/65536 ≈ 96.1% — above critical threshold
    assert.equal(criticalResult.safe, false)
    assert.ok(criticalResult.usagePercent > 0.9)
    assert.ok(criticalResult.recommendation.toLowerCase().includes('critical'))
  })

  it('checkContextHealth warns at 80% usage', () => {
    const warningResult = checkContextHealth({
      systemPromptTokens: 3000,
      conversationTokens: 52000,
      maxContext: 65536
    })
    // 55000/65536 ≈ 83.9% — above warning, below critical
    assert.equal(warningResult.safe, true) // safe is true until critical threshold
    assert.ok(warningResult.usagePercent > 0.8)
    assert.ok(warningResult.recommendation.toLowerCase().includes('warning'))
  })

  it('checkContextHealth reports safe for low usage', () => {
    const result = checkContextHealth({
      systemPromptTokens: 1000,
      conversationTokens: 5000,
      maxContext: 65536
    })
    assert.equal(result.safe, true)
    assert.ok(result.usagePercent < 80)
  })

  it('shouldHaltChain triggers at max generations', () => {
    const result = shouldHaltChain(
      { generation: 101, startTime: new Date(), errors: 0, totalSpawns: 101 },
      { maxGenerations: 100 }
    )
    assert.equal(result.halt, true)
    assert.ok(result.reason, 'Should provide a reason')
  })

  it('shouldHaltChain triggers on high error rate', () => {
    const result = shouldHaltChain(
      { generation: 10, startTime: new Date(), errors: 5, totalSpawns: 10 },
      { maxErrorRate: 0.3 }
    )
    assert.equal(result.halt, true)
    assert.ok(result.reason.toLowerCase().includes('error'))
  })

  it('shouldHaltChain allows healthy chain', () => {
    const result = shouldHaltChain(
      { generation: 5, startTime: new Date(), errors: 0, totalSpawns: 5 },
      { maxGenerations: 100, maxErrorRate: 0.3 }
    )
    assert.equal(result.halt, false)
  })

  it('DEFAULT_LIMITS has expected keys', () => {
    assert.ok(DEFAULT_LIMITS.maxPromptBytes > 0)
    assert.ok(DEFAULT_LIMITS.maxPromptTokens > 0)
    assert.ok(DEFAULT_LIMITS.minPromptTokens > 0)
    assert.ok(DEFAULT_LIMITS.maxGenerations > 0)
    assert.ok(DEFAULT_LIMITS.maxDurationMinutes > 0)
    assert.ok(DEFAULT_LIMITS.maxErrorRate > 0 && DEFAULT_LIMITS.maxErrorRate < 1)
    assert.ok(DEFAULT_LIMITS.contextWarningThreshold > 0)
    assert.ok(DEFAULT_LIMITS.contextCriticalThreshold > DEFAULT_LIMITS.contextWarningThreshold)
  })
})

// ============================================================================
// MONITOR TESTS (Stream B — singularity-monitor.js)
// ============================================================================

describe('singularity-monitor', () => {
  let tempDir

  before(async () => {
    tempDir = await makeTempDir()
  })

  after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('createChainMonitor returns valid monitor object', () => {
    const monitor = createChainMonitor(tempDir)
    assert.ok(monitor, 'Monitor should be truthy')
    assert.equal(typeof monitor.recordSpawn, 'function')
    assert.equal(typeof monitor.recordCompletion, 'function')
    assert.equal(typeof monitor.recordError, 'function')
    assert.equal(typeof monitor.recordHandoff, 'function')
    assert.equal(typeof monitor.getChainHealth, 'function')
    assert.equal(typeof monitor.getFullReport, 'function')
  })

  it('recordSpawn then getChainHealth shows correct state', async () => {
    const monitor = createChainMonitor(tempDir)
    await monitor.recordSpawn(1, 'pillar-abc', 'hash123')

    const health = monitor.getChainHealth()
    assert.ok(health.currentGeneration >= 1)
    assert.equal(health.isActive, true)
  })

  it('recordCompletion updates generation data', async () => {
    const monitor = createChainMonitor(tempDir)
    await monitor.recordSpawn(1, 'pillar-abc', 'hash123')
    await monitor.recordCompletion(1, 'pillar-abc', 45000, 'Explored the codebase')

    const health = monitor.getChainHealth()
    assert.ok(health.successRate > 0, 'Success rate should be positive after completion')
  })

  it('recordError increases error count', async () => {
    const monitor = createChainMonitor(tempDir)
    await monitor.recordSpawn(1, 'pillar-abc', 'hash123')
    await monitor.recordError(1, 'pillar-abc', 'Connection timeout')

    const health = monitor.getChainHealth()
    assert.ok(health.errors >= 1, `Expected at least 1 error, got ${health.errors}`)
  })

  it('recordHandoff tracks generation transitions', async () => {
    const monitor = createChainMonitor(tempDir)
    await monitor.recordSpawn(1, 'pillar-abc', 'hash1')
    await monitor.recordCompletion(1, 'pillar-abc', 30000, 'Done')
    await monitor.recordHandoff(1, 2, 500)
    await monitor.recordSpawn(2, 'pillar-def', 'hash2')

    const health = monitor.getChainHealth()
    assert.ok(health.currentGeneration >= 2)
  })

  it('formatHealthReport produces markdown string', async () => {
    const monitor = createChainMonitor(tempDir)
    await monitor.recordSpawn(1, 'pillar-abc', 'hash123')
    await monitor.recordCompletion(1, 'pillar-abc', 45000, 'Explored')

    const health = monitor.getChainHealth()
    const report = formatHealthReport(health)
    assert.equal(typeof report, 'string')
    assert.ok(report.length > 0, 'Report should not be empty')
  })

  it('getFullReport produces comprehensive report', async () => {
    const monitor = createChainMonitor(tempDir)
    await monitor.recordSpawn(1, 'pillar-abc', 'hash123')
    await monitor.recordCompletion(1, 'pillar-abc', 45000, 'Done')

    const report = monitor.getFullReport()
    assert.equal(typeof report, 'string')
    assert.ok(report.length > 0)
  })
})

// ============================================================================
// INTEGRATION TESTS (Stream D — singularity-integration.js)
// ============================================================================

describe('singularity-integration', () => {
  let tempDir

  before(async () => {
    tempDir = await makeTempDir()
    // Create .singularity dir structure that initSingularity expects
    await mkdir(join(tempDir, '.singularity'), { recursive: true })
  })

  after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('initSingularity returns ready state', async () => {
    const result = await initSingularity(tempDir)
    assert.equal(result.ready, true)
    assert.ok(result.memory, 'Should include memory status')
    assert.ok(result.monitor, 'Should include monitor')
  })

  it('preSpawnHook rejects invalid input', async () => {
    // Re-init to ensure state is fresh (initSingularity is idempotent)
    await initSingularity(tempDir)

    const result = await preSpawnHook({ prompt: '' }, { generation: 1 })
    assert.equal(result.approved, false)
    assert.ok(result.errors.length > 0)
  })

  it('preSpawnHook approves valid input', async () => {
    await initSingularity(tempDir)

    const result = await preSpawnHook(
      { prompt: 'Explore the Paloma codebase thoroughly. Focus on the bridge layer and understand how pillar sessions are managed. Document all findings in the .singularity directory. Pay special attention to the WebSocket protocol and the MCP tool routing. This is a comprehensive exploration task.' },
      { generation: 2 }
    )
    assert.equal(result.approved, true, `Expected approved but got errors: ${(result.errors || []).join('; ')}`)
    assert.ok(result.sanitizedPrompt, 'Should return sanitized prompt')
  })

  it('preSpawnHook includes memory briefing', async () => {
    await initSingularity(tempDir)

    const result = await preSpawnHook(
      { prompt: 'Build the memory persistence layer for the singularity system. Implement cross-generation storage so that each Quinn generation can learn from its predecessors. Focus on efficient indexing and retrieval patterns for fast memory recall during startup.' },
      { generation: 3 }
    )
    assert.equal(result.approved, true, `Expected approved but got errors: ${(result.errors || []).join('; ')}`)
    // Briefing may be null or a string, depending on whether memories exist
    assert.ok(result.briefing === null || typeof result.briefing === 'string')
  })

  it('postSpawnHook records spawn event', async () => {
    await initSingularity(tempDir)

    // Should not throw
    await postSpawnHook({
      generation: 1,
      pillarId: 'test-pillar-1',
      promptHash: 'abc123',
      parentGeneration: null
    })
  })

  it('completionHook records completion', async () => {
    await initSingularity(tempDir)

    // Should not throw
    await completionHook({
      generation: 1,
      pillarId: 'test-pillar-1',
      durationMs: 45000,
      summary: 'Successfully explored the codebase and discovered the bridge architecture.'
    })
  })

  it('errorHook returns halt decision', async () => {
    await initSingularity(tempDir)

    const result = await errorHook({
      generation: 1,
      pillarId: 'test-pillar-1',
      error: 'Connection timeout during tool execution'
    })

    assert.equal(typeof result.shouldHalt, 'boolean')
  })

  it('getSingularityStatus returns all subsystem statuses', async () => {
    await initSingularity(tempDir)

    const status = await getSingularityStatus()
    assert.ok(status.memory, 'Should include memory status')
    assert.ok(status.lineage, 'Should include lineage status')
    assert.ok(status.monitor, 'Should include monitor status')
    assert.ok(status.safety, 'Should include safety status')
  })
})
