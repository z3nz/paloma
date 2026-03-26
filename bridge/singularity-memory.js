/**
 * Singularity Memory System
 *
 * Cross-generation persistent memory for Quinn singularity chains.
 * Stores, indexes, and recalls learnings across generations so no
 * generation has to rediscover what a predecessor already knew.
 *
 * Memory index lives at: .singularity/memory-index.json
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createLogger } from './logger.js'

const log = createLogger('singularity-memory')

const MEMORY_INDEX_FILE = 'memory-index.json'

const IMPORTANCE_ORDER = ['low', 'medium', 'high', 'critical']
const VALID_CATEGORIES = ['discovery', 'lesson', 'decision', 'bug', 'pattern', 'question', 'goal']

// ~1875 tokens at 4 chars/token, leaves buffer to stay under 2000 tokens
const MAX_BRIEFING_CHARS = 7500

// Importance multipliers for relevance scoring
const IMPORTANCE_BOOST = { low: 1.0, medium: 1.1, high: 1.25, critical: 1.5 }

/**
 * Ensure the singularity directory exists.
 * @param {string} singularityDir
 */
async function ensureDir(singularityDir) {
  if (!existsSync(singularityDir)) {
    await mkdir(singularityDir, { recursive: true })
  }
}

/**
 * Load the memory index from disk. Returns a fresh index if not found.
 * @param {string} singularityDir
 * @returns {Promise<object>}
 */
async function loadMemoryIndex(singularityDir) {
  const indexPath = join(singularityDir, MEMORY_INDEX_FILE)
  try {
    const raw = await readFile(indexPath, 'utf8')
    const parsed = JSON.parse(raw)
    // Ensure entries array exists (defensive)
    if (!Array.isArray(parsed.entries)) parsed.entries = []
    return parsed
  } catch {
    return { version: 1, entries: [] }
  }
}

/**
 * Save the memory index to disk.
 * @param {string} singularityDir
 * @param {object} index
 */
async function saveMemoryIndex(singularityDir, index) {
  const indexPath = join(singularityDir, MEMORY_INDEX_FILE)
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8')
}

/**
 * Count existing generation manifest files in the singularity directory.
 * @param {string} singularityDir
 * @returns {Promise<number>}
 */
async function countGenerations(singularityDir) {
  try {
    const files = await readdir(singularityDir)
    return files.filter(f => /^generation-\d+\.md$/.test(f)).length
  } catch {
    return 0
  }
}

/**
 * Score relevance of a memory entry against a set of query keywords.
 * Uses word overlap with importance weighting.
 * @param {object} entry
 * @param {string[]} queryWords
 * @returns {number} relevance score 0–1.5
 */
function scoreRelevance(entry, queryWords) {
  if (queryWords.length === 0) return 0
  const contentWords = new Set(
    entry.content.toLowerCase().split(/\W+/).filter(w => w.length > 2)
  )
  const matches = queryWords.filter(w => contentWords.has(w)).length
  const baseScore = matches / queryWords.length
  const boost = IMPORTANCE_BOOST[entry.importance] || 1.0
  return baseScore * boost
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Initialize the memory system. Scans .singularity/ for existing manifests
 * and returns a summary of the current state.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {Promise<{ generationCount: number, memoryEntries: number }>}
 */
export async function initMemory(singularityDir) {
  await ensureDir(singularityDir)
  const index = await loadMemoryIndex(singularityDir)
  const generationCount = await countGenerations(singularityDir)
  const memoryEntries = index.entries.length

  log.info('Memory system initialized', { singularityDir, generationCount, memoryEntries })
  return { generationCount, memoryEntries }
}

/**
 * Store a new memory entry from a generation's work.
 * @param {string} singularityDir
 * @param {object} entry - { generation: number, category: string, content: string, importance: 'low'|'medium'|'high'|'critical' }
 * @returns {Promise<string>} - Memory entry ID
 */
export async function storeMemory(singularityDir, entry) {
  const { generation, category, content, importance = 'medium' } = entry

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Memory entry must have a non-empty content string')
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Valid: ${VALID_CATEGORIES.join(', ')}`)
  }
  if (!IMPORTANCE_ORDER.includes(importance)) {
    throw new Error(`Invalid importance "${importance}". Valid: ${IMPORTANCE_ORDER.join(', ')}`)
  }

  await ensureDir(singularityDir)
  const index = await loadMemoryIndex(singularityDir)

  const seqNum = String(index.entries.length + 1).padStart(3, '0')
  const id = `mem-${seqNum}-${randomUUID().slice(0, 8)}`

  const newEntry = {
    id,
    generation: Number(generation),
    category,
    content: content.trim(),
    importance,
    timestamp: new Date().toISOString()
  }

  index.entries.push(newEntry)
  await saveMemoryIndex(singularityDir, index)

  log.info('Memory stored', { id, generation, category, importance })
  return id
}

/**
 * Recall memories relevant to a query using keyword-based matching.
 * @param {string} singularityDir
 * @param {string} query - Natural language query
 * @param {object} options - { limit?: number, minImportance?: string, generation?: number }
 * @returns {Promise<Array<{ id, generation, category, content, importance, relevanceScore }>>}
 */
export async function recallMemories(singularityDir, query, options = {}) {
  const { limit = 10, minImportance = 'low', generation } = options

  const index = await loadMemoryIndex(singularityDir)
  const minLevel = IMPORTANCE_ORDER.indexOf(minImportance)

  // Tokenize query — skip short words (stop-word-ish)
  const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2)

  let entries = index.entries.filter(entry => {
    if (IMPORTANCE_ORDER.indexOf(entry.importance) < minLevel) return false
    if (generation !== undefined && entry.generation !== Number(generation)) return false
    return true
  })

  // Score and sort: relevance desc, then importance desc
  const scored = entries.map(entry => ({
    ...entry,
    relevanceScore: Math.round(scoreRelevance(entry, queryWords) * 1000) / 1000
  }))

  scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
    return IMPORTANCE_ORDER.indexOf(b.importance) - IMPORTANCE_ORDER.indexOf(a.importance)
  })

  const results = scored.slice(0, limit)
  log.info('Memories recalled', { query: query.slice(0, 60), count: results.length, total: entries.length })
  return results
}

/**
 * Generate a compact memory briefing for injection into a new generation's prompt.
 * Summarizes the most important learnings from all prior generations.
 * Output stays under ~2000 tokens.
 * @param {string} singularityDir
 * @param {number} forGeneration - The generation number this briefing is for
 * @returns {Promise<string>} - Markdown-formatted briefing
 */
export async function generateBriefing(singularityDir, forGeneration) {
  const index = await loadMemoryIndex(singularityDir)

  // Only memories from generations before this one
  const priorEntries = index.entries.filter(e => e.generation < forGeneration)

  if (priorEntries.length === 0) {
    return `## Memory Briefing — Generation ${forGeneration}\n\n_No memories from prior generations._\n`
  }

  // Sort by importance desc, then recency desc
  const sorted = [...priorEntries].sort((a, b) => {
    const importanceDiff =
      IMPORTANCE_ORDER.indexOf(b.importance) - IMPORTANCE_ORDER.indexOf(a.importance)
    if (importanceDiff !== 0) return importanceDiff
    return new Date(b.timestamp) - new Date(a.timestamp)
  })

  // Build output respecting the character budget
  const header = [
    `## Memory Briefing — Generation ${forGeneration}`,
    ``,
    `_${priorEntries.length} memories from generations 1–${forGeneration - 1}_`,
    ``
  ].join('\n')

  let charCount = header.length
  const sections = []

  // Group by category, emit categories that have entries
  const byCategory = {}
  for (const entry of sorted) {
    if (!byCategory[entry.category]) byCategory[entry.category] = []
    byCategory[entry.category].push(entry)
  }

  for (const cat of VALID_CATEGORIES) {
    const catEntries = byCategory[cat]
    if (!catEntries || catEntries.length === 0) continue

    const catHeader = `\n### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n`
    if (charCount + catHeader.length > MAX_BRIEFING_CHARS) break
    charCount += catHeader.length

    const lines = [catHeader]
    for (const entry of catEntries) {
      const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' }[entry.importance] || ''
      const line = `- ${icon} **[Gen ${entry.generation}]** ${entry.content}\n`
      if (charCount + line.length > MAX_BRIEFING_CHARS) break
      lines.push(line)
      charCount += line.length
    }
    sections.push(lines.join(''))
  }

  const briefing = header + sections.join('')
  log.info('Briefing generated', {
    forGeneration,
    chars: briefing.length,
    estimatedTokens: Math.round(briefing.length / 4),
    entriesIncluded: priorEntries.length
  })
  return briefing
}

/**
 * Get memory statistics across all stored entries.
 * @param {string} singularityDir
 * @returns {Promise<{ totalMemories, byCategory, byImportance, byGeneration, oldestGeneration, newestGeneration }>}
 */
export async function memoryStats(singularityDir) {
  const index = await loadMemoryIndex(singularityDir)
  const entries = index.entries

  const byCategory = {}
  const byImportance = {}
  const byGeneration = {}

  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1
    byImportance[entry.importance] = (byImportance[entry.importance] || 0) + 1
    byGeneration[entry.generation] = (byGeneration[entry.generation] || 0) + 1
  }

  const generationNums = Object.keys(byGeneration).map(Number)
  const oldestGeneration = generationNums.length > 0 ? Math.min(...generationNums) : null
  const newestGeneration = generationNums.length > 0 ? Math.max(...generationNums) : null

  log.info('Memory stats retrieved', { total: entries.length, oldestGeneration, newestGeneration })
  return {
    totalMemories: entries.length,
    byCategory,
    byImportance,
    byGeneration,
    oldestGeneration,
    newestGeneration
  }
}
