/**
 * Singularity Memory System — cross-generation persistent memory.
 *
 * Each Quinn generation can store learnings (discoveries, lessons, decisions,
 * bugs, patterns, questions, goals) and recall them by keyword relevance.
 * A compact "briefing" can be injected into the next generation's system
 * prompt so it inherits the collective wisdom of all prior generations.
 *
 * Storage: .singularity/memory-index.json
 * Manifests: .singularity/generation-*.md (read-only, indexed at init)
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import crypto from 'node:crypto'

const TAG = '[singularity-memory]'

const VALID_CATEGORIES = new Set([
  'discovery', 'lesson', 'decision', 'bug', 'pattern', 'question', 'goal'
])

const IMPORTANCE_RANK = { low: 1, medium: 2, high: 3, critical: 4 }

const MEMORY_INDEX_FILE = 'memory-index.json'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load the memory index from disk, or return a fresh empty index.
 * @param {string} singularityDir
 * @returns {Promise<{ version: number, entries: Array }>}
 */
async function loadIndex(singularityDir) {
  const indexPath = join(singularityDir, MEMORY_INDEX_FILE)
  try {
    const raw = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.entries)) return parsed
  } catch { /* file doesn't exist or is corrupt — start fresh */ }
  return { version: 1, entries: [] }
}

/**
 * Persist the memory index to disk.
 * @param {string} singularityDir
 * @param {{ version: number, entries: Array }} index
 */
async function saveIndex(singularityDir, index) {
  await mkdir(singularityDir, { recursive: true })
  const indexPath = join(singularityDir, MEMORY_INDEX_FILE)
  await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf-8')
}

/**
 * Generate a short unique ID for a memory entry.
 * @returns {string}
 */
function makeId() {
  return 'mem-' + crypto.randomBytes(4).toString('hex')
}

/**
 * Tokenize a string into lowercase keywords for matching.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  )
}

/**
 * Score how relevant a memory entry is to a query.
 * Returns 0-1 based on keyword overlap.
 * @param {string} content
 * @param {Set<string>} queryTokens
 * @returns {number}
 */
function relevanceScore(content, queryTokens) {
  if (queryTokens.size === 0) return 0
  const contentTokens = tokenize(content)
  let hits = 0
  for (const qt of queryTokens) {
    for (const ct of contentTokens) {
      if (ct.includes(qt) || qt.includes(ct)) { hits++; break }
    }
  }
  return hits / queryTokens.size
}

/**
 * Parse a generation manifest (.md) and extract structured info.
 * @param {string} content - Raw markdown of a manifest file
 * @param {string} filename
 * @returns {{ generation: number, born: string|null, summary: string, taskForNext: string }}
 */
function parseManifest(content, filename) {
  // Extract generation number from filename (generation-001.md → 1)
  const genMatch = filename.match(/generation-(\d+)\.md$/)
  const generation = genMatch ? parseInt(genMatch[1], 10) : 0

  // Extract born date
  const bornMatch = content.match(/\*\*Born:\*\*\s*(.+)/)
  const born = bornMatch ? bornMatch[1].trim() : null

  // Extract summary section
  const summaryMatch = content.match(/## Summary\s*\n\n([\s\S]*?)(?=\n## |$)/)
  const summary = summaryMatch ? summaryMatch[1].trim() : ''

  // Extract task for next
  const taskMatch = content.match(/## Task Passed Forward\s*\n\n([\s\S]*?)(?=\n## |$)/)
  const taskForNext = taskMatch ? taskMatch[1].trim() : ''

  return { generation, born, summary, taskForNext }
}

/**
 * Rough token estimate (~4 chars per token for English).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the memory system. Scans .singularity/ for existing manifests
 * and ensures a memory-index.json exists.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {Promise<{ generationCount: number, memoryEntries: number }>}
 */
export async function initMemory(singularityDir) {
  await mkdir(singularityDir, { recursive: true })

  const index = await loadIndex(singularityDir)

  // Scan for manifest files and auto-index any that aren't already tracked
  let files
  try {
    files = (await readdir(singularityDir)).filter(f => /^generation-\d+\.md$/.test(f)).sort()
  } catch {
    files = []
  }

  const indexedGenerations = new Set(index.entries.map(e => e.generation))
  let newEntries = 0

  for (const file of files) {
    const content = await readFile(join(singularityDir, file), 'utf-8')
    const manifest = parseManifest(content, file)

    if (!indexedGenerations.has(manifest.generation) && manifest.summary) {
      // Auto-create a memory from the manifest summary
      index.entries.push({
        id: makeId(),
        generation: manifest.generation,
        category: 'discovery',
        content: `[Auto-indexed from manifest] ${manifest.summary.slice(0, 500)}`,
        importance: 'medium',
        timestamp: manifest.born || new Date().toISOString()
      })
      newEntries++
    }
  }

  if (newEntries > 0) {
    await saveIndex(singularityDir, index)
    console.log(`${TAG} Auto-indexed ${newEntries} manifest(s) into memory`)
  }

  console.log(`${TAG} Initialized — ${files.length} generation(s), ${index.entries.length} memory entries`)
  return { generationCount: files.length, memoryEntries: index.entries.length }
}

/**
 * Store a new memory entry from a generation's work.
 * @param {string} singularityDir
 * @param {object} entry - { generation: number, category: string, content: string, importance: 'low'|'medium'|'high'|'critical' }
 * @returns {Promise<string>} - Memory entry ID
 */
export async function storeMemory(singularityDir, entry) {
  const { generation, category, content, importance } = entry

  if (!content || typeof content !== 'string') {
    throw new Error('Memory content must be a non-empty string')
  }
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`Invalid category "${category}". Valid: ${[...VALID_CATEGORIES].join(', ')}`)
  }
  if (!IMPORTANCE_RANK[importance]) {
    throw new Error(`Invalid importance "${importance}". Valid: low, medium, high, critical`)
  }
  if (typeof generation !== 'number' || generation < 1) {
    throw new Error('Generation must be a positive integer')
  }

  const index = await loadIndex(singularityDir)
  const id = makeId()

  index.entries.push({
    id,
    generation,
    category,
    content: content.slice(0, 2000), // cap individual memories
    importance,
    timestamp: new Date().toISOString()
  })

  await saveIndex(singularityDir, index)
  console.log(`${TAG} Stored memory ${id} (gen ${generation}, ${category}, ${importance})`)
  return id
}

/**
 * Recall memories relevant to a query (keyword-based matching).
 * @param {string} singularityDir
 * @param {string} query - Natural language query
 * @param {object} options - { limit?: number, minImportance?: string, generation?: number }
 * @returns {Promise<Array<{ id, generation, category, content, importance, relevanceScore }>>}
 */
export async function recallMemories(singularityDir, query, options = {}) {
  const { limit = 10, minImportance, generation } = options
  const index = await loadIndex(singularityDir)
  const queryTokens = tokenize(query)

  let candidates = index.entries

  // Filter by generation if specified
  if (typeof generation === 'number') {
    candidates = candidates.filter(e => e.generation === generation)
  }

  // Filter by minimum importance
  if (minImportance && IMPORTANCE_RANK[minImportance]) {
    const minRank = IMPORTANCE_RANK[minImportance]
    candidates = candidates.filter(e => (IMPORTANCE_RANK[e.importance] || 0) >= minRank)
  }

  // Score and sort by relevance
  const scored = candidates.map(entry => ({
    id: entry.id,
    generation: entry.generation,
    category: entry.category,
    content: entry.content,
    importance: entry.importance,
    relevanceScore: relevanceScore(entry.content + ' ' + entry.category, queryTokens)
  }))

  // Sort by relevance first, then importance as tiebreaker
  scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
    return (IMPORTANCE_RANK[b.importance] || 0) - (IMPORTANCE_RANK[a.importance] || 0)
  })

  return scored.slice(0, limit)
}

/**
 * Generate a compact memory briefing for injection into a new generation's prompt.
 * Summarizes the most important learnings from all prior generations.
 * Should be under 2000 tokens.
 * @param {string} singularityDir
 * @param {number} forGeneration - The generation number this briefing is for
 * @returns {Promise<string>} - Markdown-formatted briefing
 */
export async function generateBriefing(singularityDir, forGeneration) {
  const index = await loadIndex(singularityDir)

  if (index.entries.length === 0) {
    return `## Memory Briefing for Generation ${forGeneration}\n\nYou are the first. No prior memories exist. Explore, discover, and record what you learn for those who come after you.`
  }

  // Gather entries from all prior generations, prioritize by importance
  const prior = index.entries
    .filter(e => e.generation < forGeneration)
    .sort((a, b) => {
      // Critical first, then high, then medium, then low
      const impDiff = (IMPORTANCE_RANK[b.importance] || 0) - (IMPORTANCE_RANK[a.importance] || 0)
      if (impDiff !== 0) return impDiff
      // Within same importance, newer first
      return (b.generation || 0) - (a.generation || 0)
    })

  if (prior.length === 0) {
    return `## Memory Briefing for Generation ${forGeneration}\n\nYou are the first. No prior memories exist. Explore, discover, and record what you learn for those who come after you.`
  }

  // Group by category for organized briefing
  const byCategory = {}
  for (const entry of prior) {
    if (!byCategory[entry.category]) byCategory[entry.category] = []
    byCategory[entry.category].push(entry)
  }

  // Build briefing, respecting token budget
  const TARGET_TOKENS = 1500 // leave some room under 2000
  let briefing = `## Memory Briefing for Generation ${forGeneration}\n\n`
  briefing += `You inherit the collective memory of ${forGeneration - 1} prior generation(s) — ${prior.length} memories across ${Object.keys(byCategory).length} categories.\n\n`

  // Emit critical items first, always
  const critical = prior.filter(e => e.importance === 'critical')
  if (critical.length > 0) {
    briefing += `### Critical\n\n`
    for (const e of critical.slice(0, 5)) {
      briefing += `- **[Gen ${e.generation}]** ${e.content.slice(0, 200)}\n`
    }
    briefing += '\n'
  }

  // Then high-importance by category
  const categoryOrder = ['decision', 'lesson', 'bug', 'discovery', 'pattern', 'goal', 'question']
  for (const cat of categoryOrder) {
    if (estimateTokens(briefing) > TARGET_TOKENS) break
    const entries = (byCategory[cat] || []).filter(e => e.importance !== 'critical')
    if (entries.length === 0) continue

    briefing += `### ${cat.charAt(0).toUpperCase() + cat.slice(1)}s\n\n`
    for (const e of entries.slice(0, 3)) {
      if (estimateTokens(briefing) > TARGET_TOKENS) break
      briefing += `- **[Gen ${e.generation}]** ${e.content.slice(0, 150)}\n`
    }
    briefing += '\n'
  }

  // Trim if we overshot
  if (estimateTokens(briefing) > 2000) {
    const charBudget = 2000 * 4
    briefing = briefing.slice(0, charBudget) + '\n\n*(briefing truncated to fit token budget)*\n'
  }

  console.log(`${TAG} Generated briefing for gen ${forGeneration}: ~${estimateTokens(briefing)} tokens, ${prior.length} memories referenced`)
  return briefing
}

/**
 * Get memory statistics.
 * @param {string} singularityDir
 * @returns {Promise<{ totalMemories: number, byCategory: object, byImportance: object, byGeneration: object, oldestGeneration: number|null, newestGeneration: number|null }>}
 */
export async function memoryStats(singularityDir) {
  const index = await loadIndex(singularityDir)
  const entries = index.entries

  const byCategory = {}
  const byImportance = {}
  const byGeneration = {}
  let oldest = null
  let newest = null

  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1
    byImportance[e.importance] = (byImportance[e.importance] || 0) + 1
    byGeneration[e.generation] = (byGeneration[e.generation] || 0) + 1

    if (oldest === null || e.generation < oldest) oldest = e.generation
    if (newest === null || e.generation > newest) newest = e.generation
  }

  return {
    totalMemories: entries.length,
    byCategory,
    byImportance,
    byGeneration,
    oldestGeneration: oldest,
    newestGeneration: newest
  }
}
