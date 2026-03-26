/**
 * Singularity Lineage Tools
 *
 * Validation, diffing, repair, and summarization for Quinn singularity
 * generation chains. Keeps the lineage healthy and provides introspection
 * tools for understanding how Quinn evolves across generations.
 *
 * Reads: .singularity/lineage.json + .singularity/generation-NNN.md manifests
 * Writes: .singularity/lineage.json + .singularity/archive/ (on truncate)
 */

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createLogger } from './logger.js'

const log = createLogger('singularity-lineage')

const LINEAGE_FILE = 'lineage.json'
const ARCHIVE_DIR = 'archive'

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Load lineage.json. Returns [] on missing/corrupt file.
 * @param {string} singularityDir
 * @returns {Promise<Array>}
 */
async function loadLineage(singularityDir) {
  const lineagePath = join(singularityDir, LINEAGE_FILE)
  try {
    const raw = await readFile(lineagePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Save lineage.json to disk.
 * @param {string} singularityDir
 * @param {Array} lineage
 */
async function saveLineage(singularityDir, lineage) {
  const lineagePath = join(singularityDir, LINEAGE_FILE)
  await writeFile(lineagePath, JSON.stringify(lineage, null, 2), 'utf8')
}

/**
 * List all generation manifest files sorted by generation number.
 * @param {string} singularityDir
 * @returns {Promise<Array<{ generation: number, filename: string }>>}
 */
async function listManifests(singularityDir) {
  try {
    const files = await readdir(singularityDir)
    return files
      .filter(f => /^generation-\d+\.md$/.test(f))
      .map(f => ({ generation: parseInt(f.match(/(\d+)/)[1], 10), filename: f }))
      .sort((a, b) => a.generation - b.generation)
  } catch {
    return []
  }
}

/**
 * Read a generation manifest file. Returns null if not found.
 * @param {string} singularityDir
 * @param {number} generation
 * @returns {Promise<string|null>}
 */
async function readManifest(singularityDir, generation) {
  // Zero-padded to 3 digits to match pillar-manager convention
  const filename = `generation-${String(generation).padStart(3, '0')}.md`
  const filePath = join(singularityDir, filename)
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Hash a prompt to a short fingerprint for identity comparison.
 * @param {string} text
 * @returns {string} 12-char hex hash
 */
function hashPrompt(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}

/**
 * Extract the prompt section from a manifest. Falls back to full content.
 * @param {string} content
 * @returns {string}
 */
function extractPrompt(content) {
  const match = content.match(/##\s+(?:Prompt|Next Prompt)\n([\s\S]*?)(?=\n##|$)/i)
  return match ? match[1].trim() : content.trim()
}

/**
 * Extract a summary preview from a manifest. Falls back to first 300 chars.
 * @param {string} content
 * @returns {string}
 */
function extractSummary(content) {
  const match = content.match(/##\s+(?:Summary|State Summary|What I Did)\n([\s\S]*?)(?=\n##|$)/i)
  if (match) return match[1].trim().slice(0, 300)
  // Strip first heading, return first meaningful text
  return content.replace(/^#[^\n]*\n/, '').trim().slice(0, 300)
}

/**
 * Extract born timestamp from manifest frontmatter or content.
 * @param {string} content
 * @returns {string}
 */
function extractBorn(content) {
  // Look for frontmatter-style born field
  const match = content.match(/^(?:born|timestamp|date)[:\s]+([^\n]+)/im)
  if (match) return match[1].trim()
  return new Date().toISOString()
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Validate the entire lineage — check that manifest files exist,
 * lineage.json is well-formed, and generation numbers are contiguous.
 * @param {string} singularityDir
 * @returns {Promise<{ valid: boolean, issues: string[], generationCount: number, gaps: number[] }>}
 */
export async function validateLineage(singularityDir) {
  const issues = []

  const lineage = await loadLineage(singularityDir)
  const manifests = await listManifests(singularityDir)
  const manifestGenerations = new Set(manifests.map(m => m.generation))

  // Check lineage entries have required structure
  for (const entry of lineage) {
    if (typeof entry.generation !== 'number') {
      issues.push(`Lineage entry missing generation number: ${JSON.stringify(entry).slice(0, 80)}`)
    }
  }

  // Check every lineage entry has a corresponding manifest file
  for (const entry of lineage) {
    if (typeof entry.generation === 'number' && !manifestGenerations.has(entry.generation)) {
      issues.push(`Missing manifest file for generation ${entry.generation}`)
    }
  }

  // Find gaps in the generation sequence from manifests on disk
  const allGens = [...manifestGenerations].sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < allGens.length; i++) {
    if (allGens[i] - allGens[i - 1] > 1) {
      for (let g = allGens[i - 1] + 1; g < allGens[i]; g++) {
        gaps.push(g)
      }
    }
  }
  if (gaps.length > 0) {
    issues.push(`Generation gaps detected: ${gaps.join(', ')}`)
  }

  const valid = issues.length === 0
  log.info('Lineage validated', {
    valid,
    issueCount: issues.length,
    generationCount: manifests.length,
    gapCount: gaps.length
  })
  return { valid, issues, generationCount: manifests.length, gaps }
}

/**
 * Diff two generations' prompts to show what evolved between them.
 * Returns a human-readable summary of what changed.
 * @param {string} singularityDir
 * @param {number} genA
 * @param {number} genB
 * @returns {Promise<{ genA: { summary, tokenEstimate }, genB: { summary, tokenEstimate }, diff: string, evolutionNotes: string }>}
 */
export async function diffGenerations(singularityDir, genA, genB) {
  const manifestA = await readManifest(singularityDir, genA)
  const manifestB = await readManifest(singularityDir, genB)

  if (!manifestA) throw new Error(`Generation ${genA} manifest not found`)
  if (!manifestB) throw new Error(`Generation ${genB} manifest not found`)

  const promptA = extractPrompt(manifestA)
  const promptB = extractPrompt(manifestB)
  const summaryA = extractSummary(manifestA)
  const summaryB = extractSummary(manifestB)

  // Simple line-based diff (set operations — not a full Myers diff, but readable)
  const linesA = promptA.split('\n').map(l => l.trim()).filter(Boolean)
  const linesB = promptB.split('\n').map(l => l.trim()).filter(Boolean)
  const setA = new Set(linesA)
  const setB = new Set(linesB)

  const removed = linesA.filter(l => !setB.has(l)).slice(0, 15)
  const added = linesB.filter(l => !setA.has(l)).slice(0, 15)

  const diffParts = [
    `--- Generation ${genA} (${Math.round(promptA.length / 4)} tokens)`,
    `+++ Generation ${genB} (${Math.round(promptB.length / 4)} tokens)`,
    '',
    ...removed.map(l => `- ${l}`),
    removed.length > 0 && added.length > 0 ? '' : null,
    ...added.map(l => `+ ${l}`)
  ].filter(l => l !== null)

  const diff = diffParts.join('\n')

  const evolutionNotes = [
    `Generation ${genB} vs ${genA}:`,
    `  Lines added:   ${added.length}`,
    `  Lines removed: ${removed.length}`,
    `  Token delta:   ${Math.round((promptB.length - promptA.length) / 4)} tokens`,
    `  Prompt hash A: ${hashPrompt(promptA)}`,
    `  Prompt hash B: ${hashPrompt(promptB)}`
  ].join('\n')

  log.info('Generations diffed', { genA, genB, added: added.length, removed: removed.length })
  return {
    genA: { summary: summaryA, tokenEstimate: Math.round(promptA.length / 4) },
    genB: { summary: summaryB, tokenEstimate: Math.round(promptB.length / 4) },
    diff,
    evolutionNotes
  }
}

/**
 * Repair a broken lineage by rebuilding lineage.json from manifest files on disk.
 * Use this when lineage.json is missing, corrupt, or out of sync with manifests.
 * @param {string} singularityDir
 * @returns {Promise<{ repaired: boolean, generationsFound: number, lineageEntries: number }>}
 */
export async function repairLineage(singularityDir) {
  const manifests = await listManifests(singularityDir)

  if (manifests.length === 0) {
    log.warn('No manifests found — nothing to repair from')
    return { repaired: false, generationsFound: 0, lineageEntries: 0 }
  }

  const lineage = []

  for (const { generation } of manifests) {
    const content = await readManifest(singularityDir, generation)
    if (!content) continue

    const prompt = extractPrompt(content)
    const promptHash = hashPrompt(prompt)
    const summary = extractSummary(content)
    const born = extractBorn(content)

    lineage.push({
      generation,
      born,
      promptHash,
      summary: summary.slice(0, 300),
      repairedAt: new Date().toISOString()
    })
  }

  await saveLineage(singularityDir, lineage)

  log.info('Lineage repaired', {
    generationsFound: manifests.length,
    lineageEntries: lineage.length
  })
  return { repaired: true, generationsFound: manifests.length, lineageEntries: lineage.length }
}

/**
 * Get a compact lineage summary suitable for display or logging.
 * Merges data from lineage.json and manifest files on disk.
 * @param {string} singularityDir
 * @returns {Promise<Array<{ generation, born, promptHash, summaryPreview }>>}
 */
export async function getLineageSummary(singularityDir) {
  const lineage = await loadLineage(singularityDir)
  const manifests = await listManifests(singularityDir)

  // Union of all known generations from both sources
  const lineageMap = new Map(lineage.map(e => [e.generation, e]))
  const manifestGens = new Set(manifests.map(m => m.generation))
  const allGens = new Set([...lineageMap.keys(), ...manifestGens])

  const summaries = []

  for (const gen of [...allGens].sort((a, b) => a - b)) {
    const lineageEntry = lineageMap.get(gen) || {}

    // Read manifest if we don't have complete lineage data
    let promptHash = lineageEntry.promptHash
    let summaryPreview = lineageEntry.summary

    if (!promptHash || !summaryPreview) {
      const content = await readManifest(singularityDir, gen)
      if (content) {
        if (!promptHash) promptHash = hashPrompt(extractPrompt(content))
        if (!summaryPreview) summaryPreview = extractSummary(content)
      }
    }

    summaries.push({
      generation: gen,
      born: lineageEntry.born || 'unknown',
      promptHash: promptHash || 'unknown',
      summaryPreview: (summaryPreview || 'No summary available').slice(0, 120)
    })
  }

  log.info('Lineage summary retrieved', { generations: summaries.length })
  return summaries
}

/**
 * Truncate the lineage at a specific generation.
 * Generations after atGeneration are archived (moved to .singularity/archive/).
 * lineage.json is also trimmed to match.
 * @param {string} singularityDir
 * @param {number} atGeneration - Keep this generation and all before it
 * @returns {Promise<{ kept: number, archived: number }>}
 */
export async function truncateLineage(singularityDir, atGeneration) {
  const archivePath = join(singularityDir, ARCHIVE_DIR)
  if (!existsSync(archivePath)) {
    await mkdir(archivePath, { recursive: true })
  }

  const manifests = await listManifests(singularityDir)
  let kept = 0
  let archived = 0

  for (const { generation, filename } of manifests) {
    if (generation <= atGeneration) {
      kept++
      continue
    }
    // Archive: copy to archive dir, then delete from singularity dir
    const srcPath = join(singularityDir, filename)
    const dstPath = join(archivePath, filename)
    try {
      const content = await readFile(srcPath, 'utf8')
      await writeFile(dstPath, content, 'utf8')
      await unlink(srcPath)
      archived++
    } catch (err) {
      log.error('Failed to archive manifest', { filename, error: err.message })
    }
  }

  // Trim lineage.json to match
  const lineage = await loadLineage(singularityDir)
  const trimmed = lineage.filter(e => e.generation <= atGeneration)
  await saveLineage(singularityDir, trimmed)

  log.info('Lineage truncated', { atGeneration, kept, archived })
  return { kept, archived }
}
