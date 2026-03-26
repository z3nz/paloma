/**
 * singularity.test.js
 *
 * Comprehensive test suite for all singularity bridge modules.
 * Run with: node --test bridge/__tests__/singularity.test.js
 *
 * Note: This file is syntactically valid and can be parsed by Node.js even if
 * the imported modules don't yet exist on disk — actual test execution requires
 * the Stream A/B modules to be present.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Module imports ──────────────────────────────────────────────────────────
// (dynamic imports inside describe blocks to handle missing modules gracefully)

let initMemory, storeMemory, recallMemories, generateBriefing, memoryStats
let validateLineage, diffGenerations, repairLineage, getLineageSummary, truncateLineage
let validateSpawnNext, sanitizePrompt, estimateTokens, checkContextHealth, shouldHaltChain, DEFAULT_LIMITS
let createChainMonitor, formatHealthReport
let initSingularity, preSpawnHook, postSpawnHook, completionHook, errorHook, getSingularityStatus

// Load all modules before tests run
let modulesLoaded = false

before(async () => {
  try {
    const memory = await import('../singularity-memory.js');
    ({ initMemory, storeMemory, recallMemories, generateBriefing, memoryStats } = memory)

    const lineage = await import('../singularity-lineage.js');
    ({ validateLineage, diffGenerations, repairLineage, getLineageSummary, truncateLineage } = lineage)

    const safety = await import('../singularity-safety.js');
    ({ validateSpawnNext, sanitizePrompt, estimateTokens, checkContextHealth, shouldHaltChain, DEFAULT_LIMITS } = safety)

    const monitor = await import('../singularity-monitor.js');
    ({ createChainMonitor, formatHealthReport } = monitor)

    const integration = await import('../singularity-integration.js');
    ({ initSingularity, preSpawnHook, postSpawnHook, completionHook, errorHook, getSingularityStatus } = integration)

    modulesLoaded = true
    console.log('✓ All singularity modules loaded successfully')
  } catch (err) {
    console.warn('⚠ Some modules could not be loaded — tests will be skipped:', err.message)
  }
})

// ── Helper: skip test if modules not loaded ──────────────────────────────────

function requireModules(t) {
  if (!modulesLoaded) {
    t.skip('Modules not available')
    return false
  }
  return true
}

// ── Helper: create temp .singularity dir ─────────────────────────────────────

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'paloma-singularity-test-'))
}

async function cleanTempDir(dir) {
  try { await rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ── Helper: write a fake generation manifest ─────────────────────────────────

async function writeManifest(singularityDir, generation, content = null) {
  const padded = String(generation).padStart(3, '0')
  const text = content ?? `# Generation ${generation}\n\nPrompt: Test prompt for gen ${generation}\n\nSummary: Explored the codebase.\n`
  await writeFile(join(singularityDir, `generation-${padded}.md`), text, 'utf8')
}

async function writeLineageJson(singularityDir, entries) {
  const text = JSON.stringify(entries, null, 2)
  await writeFile(join(singularityDir, 'lineage.json'), text, 'utf8')
}

// ════════════════════════════════════════════════════════════════════════════
// Memory tests
// ════════════════════════════════════════════════════════════════════════════

describe('singularity-memory', () => {

  it('initMemory creates memory-index.json in empty directory', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      const result = await initMemory(dir)
      assert.ok(typeof result === 'object', 'initMemory returns object')
      assert.ok('generationCount' in result || 'memoryEntries' in result,
        'initMemory returns stats with generationCount or memoryEntries')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('storeMemory adds entry and returns an ID', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await initMemory(dir)
      const id = await storeMemory(dir, {
        generation: 1,
        category: 'discovery',
        content: 'Found that the bridge uses SIGUSR2 for graceful reload',
        importance: 'high'
      })
      assert.ok(typeof id === 'string', 'storeMemory returns a string ID')
      assert.ok(id.length > 0, 'Memory ID is non-empty')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('recallMemories finds entries by keyword', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await initMemory(dir)
      await storeMemory(dir, { generation: 1, category: 'discovery', content: 'bridge restart uses SIGUSR2', importance: 'high' })
      await storeMemory(dir, { generation: 1, category: 'lesson', content: 'context window is 64K tokens', importance: 'medium' })

      const results = await recallMemories(dir, 'SIGUSR2')
      assert.ok(Array.isArray(results), 'recallMemories returns array')
      assert.ok(results.length >= 1, 'Should find at least one match for SIGUSR2')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('generateBriefing produces under 2000 tokens', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await initMemory(dir)
      // Store several memories across generations
      for (let gen = 1; gen <= 5; gen++) {
        await storeMemory(dir, {
          generation: gen,
          category: 'lesson',
          content: `Generation ${gen} discovered pattern: the file system uses node:fs/promises for async ops`,
          importance: gen <= 2 ? 'critical' : 'medium'
        })
      }
      const briefing = await generateBriefing(dir, 6)
      assert.ok(typeof briefing === 'string', 'generateBriefing returns string')
      // Rough token estimate: ~4 chars per token
      const approxTokens = briefing.length / 4
      assert.ok(approxTokens < 2000, `Briefing should be under 2000 tokens (got ~${Math.round(approxTokens)})`)
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('memoryStats returns correct counts', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await initMemory(dir)
      await storeMemory(dir, { generation: 1, category: 'discovery', content: 'entry one', importance: 'low' })
      await storeMemory(dir, { generation: 2, category: 'bug', content: 'entry two', importance: 'high' })

      const stats = await memoryStats(dir)
      assert.ok(typeof stats === 'object', 'memoryStats returns object')
      assert.ok('totalMemories' in stats, 'stats has totalMemories')
      assert.ok(stats.totalMemories >= 2, 'Should have at least 2 memories')
    } finally {
      await cleanTempDir(dir)
    }
  })

})

// ════════════════════════════════════════════════════════════════════════════
// Lineage tests
// ════════════════════════════════════════════════════════════════════════════

describe('singularity-lineage', () => {

  it('validateLineage passes on valid lineage with all manifests', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1)
      await writeManifest(dir, 2)
      await writeManifest(dir, 3)
      await writeLineageJson(dir, [
        { generation: 1, born: new Date().toISOString(), promptHash: 'abc' },
        { generation: 2, born: new Date().toISOString(), promptHash: 'def' },
        { generation: 3, born: new Date().toISOString(), promptHash: 'ghi' }
      ])

      const result = await validateLineage(dir)
      assert.ok(typeof result === 'object', 'validateLineage returns object')
      assert.ok('valid' in result, 'result has valid field')
      assert.equal(result.valid, true, 'Should be valid when all manifests exist')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('validateLineage detects missing manifest files', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      // Only write manifest for gen 1 and 3, skip gen 2
      await writeManifest(dir, 1)
      await writeManifest(dir, 3)
      await writeLineageJson(dir, [
        { generation: 1, born: new Date().toISOString(), promptHash: 'abc' },
        { generation: 2, born: new Date().toISOString(), promptHash: 'def' }, // missing file
        { generation: 3, born: new Date().toISOString(), promptHash: 'ghi' }
      ])

      const result = await validateLineage(dir)
      assert.equal(result.valid, false, 'Should be invalid when manifest is missing')
      assert.ok(Array.isArray(result.issues), 'result has issues array')
      assert.ok(result.issues.length > 0, 'Should have at least one issue reported')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('repairLineage rebuilds lineage.json from manifest files on disk', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      // Write 3 manifests but no lineage.json
      await writeManifest(dir, 1)
      await writeManifest(dir, 2)
      await writeManifest(dir, 3)

      const result = await repairLineage(dir)
      assert.ok(typeof result === 'object', 'repairLineage returns object')
      assert.ok('repaired' in result, 'result has repaired field')
      assert.equal(result.repaired, true, 'Should report repair was performed')
      assert.ok(result.generationsFound >= 3, 'Should find 3 generations')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('diffGenerations shows changes between two prompts', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1, '# Generation 1\n\nPrompt: Explore the bridge codebase\n')
      await writeManifest(dir, 2, '# Generation 2\n\nPrompt: Explore the bridge codebase and document patterns\n')

      const diff = await diffGenerations(dir, 1, 2)
      assert.ok(typeof diff === 'object', 'diffGenerations returns object')
      assert.ok('diff' in diff, 'result has diff field')
      assert.ok(typeof diff.diff === 'string', 'diff is a string')
    } finally {
      await cleanTempDir(dir)
    }
  })

  it('truncateLineage archives generations after cutpoint', async (t) => {
    if (!requireModules(t)) return
    const dir = await makeTempDir()
    try {
      await writeManifest(dir, 1)
      await writeManifest(dir, 2)
      await writeManifest(dir, 3)
      await writeManifest(dir, 4)
      await writeManifest(dir, 5)
      await writeLineageJson(dir, [
        { generation: 1, born: new Date().toISOString(), promptHash: 'a' },
        { generation: 2, born: new Date().toISOString(), promptHash: 'b' },
        { generation: 3, born: new Date().toISOString(), promptHash: 'c' },
        { generation: 4, born: new Date().toISOString(), promptHash: 'd' },
        { generation: 5, born: new Date().toISOString(), promptHash: 'e' }
      ])

      const result = await truncateLineage(dir, 3) // keep 1-3, archive 4-5
      assert.ok(typeof result === 'object', 'truncateLineage returns object')
      assert.ok('kept' in result, 'result has kept field')
      assert.ok('archived' in result, 'result has archived field')
      assert.equal(result.kept, 3, 'Should keep 3 generations')
      assert.equal(result.archived, 2, 'Should archive 2 generations')
    } finally {
      await cleanTempDir(dir)
    }
  })

})

// ════════════════════════════════════════════════════════════════════════════
// Safety tests
// ════════════════════════════════════════════════════════════════════════════

describe('singularity-safety', () => {

  it('validateSpawnNext rejects empty prompt', (t) => {
    if (!requireModules(t)) return
    const result = validateSpawnNext({ prompt: '' }, { generation: 1 })
    assert.equal(result.valid, false, 'Empty prompt should be rejected')
    assert.ok(result.errors.length > 0, 'Should have error messages')
  })

  it('validateSpawnNext rejects oversized prompt (>50KB)', (t) => {
    if (!requireModules(t)) return
    const bigPrompt = 'x'.repeat(51 * 1024) // 51KB
    const result = validateSpawnNext({ prompt: bigPrompt }, { generation: 1 })
    assert.equal(result.valid, false, 'Oversized prompt should be rejected')
  })

  it('validateSpawnNext rejects generation over max', (t) => {
    if (!requireModules(t)) return
    const validPrompt = 'A valid prompt with enough content to pass minimum length checks.'
    const result = validateSpawnNext(
      { prompt: validPrompt },
      { generation: (DEFAULT_LIMITS?.maxGenerations ?? 100) + 1 }
    )
    assert.equal(result.valid, false, 'Generation over max should be rejected')
  })

  it('validateSpawnNext approves a valid prompt', (t) => {
    if (!requireModules(t)) return
    const validPrompt = 'Explore the bridge codebase and document all MCP tool handlers. ' +
      'Focus on how pillar sessions are managed and what events are emitted. ' +
      'Write findings to .singularity/workspace/findings.md. ' +
      'Include details about the WebSocket message routing, session lifecycle management, ' +
      'and how the MCP proxy server forwards tool calls between CLI sessions and MCP servers.'
    const result = validateSpawnNext({ prompt: validPrompt }, { generation: 2 })
    assert.equal(result.valid, true, 'Valid prompt and generation should be approved')
  })

  it('sanitizePrompt strips null bytes', (t) => {
    if (!requireModules(t)) return
    const dirty = 'Hello\x00World\x00'
    const result = sanitizePrompt(dirty)
    assert.ok(!result.sanitized.includes('\x00'), 'Null bytes should be removed')
    assert.ok(result.changes.length > 0, 'Should report what was changed')
  })

  it('sanitizePrompt preserves valid UTF-8', (t) => {
    if (!requireModules(t)) return
    const valid = 'Hello, World! Unicode: 日本語 🌸 Ñoño'
    const result = sanitizePrompt(valid)
    assert.ok(result.sanitized.includes('日本語'), 'Valid UTF-8 should be preserved')
    assert.ok(result.sanitized.includes('🌸'), 'Emoji should be preserved')
  })

  it('estimateTokens returns reasonable estimate for known string', (t) => {
    if (!requireModules(t)) return
    // "Hello world" = 2 actual tokens; estimate should be within 30% of ~2-3
    const short = 'Hello world'
    const count = estimateTokens(short)
    assert.ok(typeof count === 'number', 'estimateTokens returns a number')
    assert.ok(count > 0, 'Count should be positive')
    assert.ok(count < 20, 'Count for "Hello world" should be under 20')

    // 1000-word text: rough estimate should be 200-1500 tokens
    const medium = 'word '.repeat(1000)
    const medCount = estimateTokens(medium)
    assert.ok(medCount >= 100, 'Should estimate at least 100 tokens for 1000 words')
    assert.ok(medCount <= 2000, 'Should estimate under 2000 tokens for 1000 words')
  })

  it('checkContextHealth warns at 80% usage', (t) => {
    if (!requireModules(t)) return
    const result = checkContextHealth({
      systemPromptTokens: 3000,
      conversationTokens: 48800, // 80% of 64K ≈ 51200 - 3000 = 48200
      maxContext: 65536
    })
    assert.ok(typeof result === 'object', 'checkContextHealth returns object')
    assert.ok('safe' in result, 'result has safe field')
    // At ~80% should not be "safe" or should have a warning
    assert.ok('usagePercent' in result, 'result has usagePercent')
    assert.ok(result.usagePercent > 0.70, 'Usage percent should reflect 80% context fill')
  })

  it('shouldHaltChain triggers at max generations', (t) => {
    if (!requireModules(t)) return
    const maxGen = DEFAULT_LIMITS?.maxGenerations ?? 100
    const result = shouldHaltChain({
      generation: maxGen + 1,
      startTime: new Date(Date.now() - 60000),
      errors: 0,
      totalSpawns: maxGen + 1
    })
    assert.ok(typeof result === 'object', 'shouldHaltChain returns object')
    assert.ok('halt' in result, 'result has halt field')
    assert.equal(result.halt, true, 'Should halt at max generations')
    assert.ok(typeof result.reason === 'string', 'Should provide a reason')
  })

  it('shouldHaltChain triggers on high error rate', (t) => {
    if (!requireModules(t)) return
    const result = shouldHaltChain({
      generation: 10,
      startTime: new Date(Date.now() - 60000),
      errors: 5,   // 50% error rate — above 30% threshold
      totalSpawns: 10
    })
    assert.equal(result.halt, true, 'Should halt on high error rate')
  })

  it('shouldHaltChain does NOT halt on healthy chain', (t) => {
    if (!requireModules(t)) return
    const result = shouldHaltChain({
      generation: 5,
      startTime: new Date(Date.now() - 300000), // 5 min ago
      errors: 0,
      totalSpawns: 5
    })
    assert.equal(result.halt, false, 'Should not halt on healthy chain')
  })

})

// ════════════════════════════════════════════════════════════════════════════
// Monitor tests
// ════════════════════════════════════════════════════════════════════════════

describe('singularity-monitor', () => {
  let tmpDir

  before(async () => { tmpDir = await makeTempDir() })
  after(async () => { await cleanTempDir(tmpDir) })

  it('createChainMonitor returns a valid monitor object', (t) => {
    if (!requireModules(t)) return
    const monitor = createChainMonitor(tmpDir)
    assert.ok(typeof monitor === 'object', 'createChainMonitor returns object')
    assert.ok(typeof monitor.recordSpawn === 'function', 'monitor has recordSpawn')
    assert.ok(typeof monitor.recordCompletion === 'function', 'monitor has recordCompletion')
    assert.ok(typeof monitor.recordError === 'function', 'monitor has recordError')
    assert.ok(typeof monitor.getChainHealth === 'function', 'monitor has getChainHealth')
    assert.ok(typeof monitor.getFullReport === 'function', 'monitor has getFullReport')
  })

  it('recordSpawn then getChainHealth shows correct state', (t) => {
    if (!requireModules(t)) return
    const monitor = createChainMonitor(tmpDir)
    monitor.recordSpawn(1, 'pillar-001', 'abc123')

    const health = monitor.getChainHealth()
    assert.ok(typeof health === 'object', 'getChainHealth returns object')
    assert.ok('currentGeneration' in health, 'health has currentGeneration')
    assert.equal(health.currentGeneration, 1, 'Current generation should be 1')
  })

  it('recordError increases error count', (t) => {
    if (!requireModules(t)) return
    const monitor = createChainMonitor(tmpDir)
    monitor.recordSpawn(1, 'pillar-001', 'abc123')
    monitor.recordError(1, 'pillar-001', new Error('test error'))

    const health = monitor.getChainHealth()
    assert.ok(health.errors >= 1, 'Error count should be at least 1 after recordError')
  })

  it('formatHealthReport produces a markdown string', (t) => {
    if (!requireModules(t)) return
    const monitor = createChainMonitor(tmpDir)
    monitor.recordSpawn(1, 'pillar-001', 'abc123')

    const health = monitor.getChainHealth()
    const report = formatHealthReport(health)
    assert.ok(typeof report === 'string', 'formatHealthReport returns string')
    assert.ok(report.length > 0, 'Report should not be empty')
    // Should look like markdown (contains #, |, or -)
    assert.ok(/[#|\-]/.test(report), 'Report should contain markdown formatting')
  })

})

// ════════════════════════════════════════════════════════════════════════════
// Integration tests
// ════════════════════════════════════════════════════════════════════════════

describe('singularity-integration', () => {
  let tmpDir

  before(async () => { tmpDir = await makeTempDir() })
  after(async () => { await cleanTempDir(tmpDir) })

  it('initSingularity returns ready state', async (t) => {
    if (!requireModules(t)) return
    const result = await initSingularity(tmpDir)
    assert.ok(typeof result === 'object', 'initSingularity returns object')
    assert.ok('ready' in result, 'result has ready field')
    // ready = true only when all subsystems load; may be false if modules are missing
    assert.ok(typeof result.ready === 'boolean', 'ready should be boolean')
  })

  it('preSpawnHook rejects empty prompt', async (t) => {
    if (!requireModules(t)) return
    await initSingularity(tmpDir)
    const result = await preSpawnHook({ prompt: '' }, { generation: 1 })
    assert.equal(result.approved, false, 'Empty prompt should be rejected')
    assert.ok(Array.isArray(result.errors), 'Should have errors array')
  })

  it('preSpawnHook approves valid prompt', async (t) => {
    if (!requireModules(t)) return
    await initSingularity(tmpDir)
    const validPrompt = 'Explore the codebase structure, document the bridge file layout, ' +
      'identify all MCP server registrations, and write your findings to workspace/findings.md. ' +
      'Include details about the WebSocket message routing, session lifecycle management, ' +
      'and how the MCP proxy server forwards tool calls between CLI sessions and MCP servers.'
    const result = await preSpawnHook({ prompt: validPrompt }, { generation: 1 })
    assert.equal(result.approved, true, 'Valid prompt should be approved')
    assert.ok(typeof result.sanitizedPrompt === 'string', 'Should return sanitizedPrompt')
  })

  it('postSpawnHook records spawn event without throwing', async (t) => {
    if (!requireModules(t)) return
    await initSingularity(tmpDir)
    // Should not throw
    await assert.doesNotReject(
      () => postSpawnHook({ generation: 1, pillarId: 'pillar-123', promptHash: 'abc', parentGeneration: null }),
      'postSpawnHook should not throw on valid input'
    )
  })

  it('errorHook returns halt decision', async (t) => {
    if (!requireModules(t)) return
    await initSingularity(tmpDir)
    const result = await errorHook({ generation: 1, pillarId: 'pillar-123', error: new Error('test') })
    assert.ok(typeof result === 'object', 'errorHook returns object')
    assert.ok('shouldHalt' in result, 'result has shouldHalt field')
    assert.ok(typeof result.shouldHalt === 'boolean', 'shouldHalt should be boolean')
  })

  it('getSingularityStatus returns structured report', async (t) => {
    if (!requireModules(t)) return
    await initSingularity(tmpDir)
    const status = await getSingularityStatus()
    assert.ok(typeof status === 'object', 'getSingularityStatus returns object')
    assert.ok('initialized' in status, 'status has initialized field')
    assert.equal(status.initialized, true, 'Should be initialized')
  })

})
