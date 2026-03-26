/**
 * Singularity Lineage Tools — validation, diffing, repair, and querying
 * for the Quinn generational chain.
 *
 * Lineage state lives in two places:
 *   .singularity/lineage.json — array of generation records
 *   .singularity/generation-NNN.md — per-generation manifest files
 *
 * These tools keep the two in sync and provide observability into
 * how the singularity is evolving across generations.
 */

import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import crypto from 'node:crypto'

const TAG = '[singularity-lineage]'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load lineage.json from disk, or return empty array.
 * @param {string} singularityDir
 * @returns {Promise<Array>}
 */
async function loadLineage(singularityDir) {
  const lineagePath = join(singularityDir, 'lineage.json')
  try {
    const raw = await readFile(lineagePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/**
 * Persist lineage array to disk.
 * @param {string} singularityDir
 * @param {Array} lineage
 */
async function saveLineage(singularityDir, lineage) {
  await mkdir(singularityDir, { recursive: true })
  const lineagePath = join(singularityDir, 'lineage.json')
  await writeFile(lineagePath, JSON.stringify(lineage, null, 2) + '\n', 'utf-8')
}

/**
 * List all generation manifest files on disk, sorted by generation number.
 * @param {string} singularityDir
 * @returns {Promise<Array<{ filename: string, generation: number }>>}
 */
async function listManifests(singularityDir) {
  let files
  try {
    files = await readdir(singularityDir)
  } catch { return [] }

  return files
    .filter(f => /^generation-\d+\.md$/.test(f))
    .map(f => ({
      filename: f,
      generation: parseInt(f.match(/generation-(\d+)\.md$/)[1], 10)
    }))
    .sort((a, b) => a.generation - b.generation)
}

/**
 * Parse a generation manifest and extract its key fields.
 * @param {string} content
 * @returns {{ born: string|null, ended: string|null, model: string|null, session: string|null, summary: string, taskForNext: string, promptBlock: string }}
 */
function parseManifest(content) {
  const bornMatch = content.match(/\*\*Born:\*\*\s*(.+)/)
  const endedMatch = content.match(/\*\*Ended:\*\*\s*(.+)/)
  const modelMatch = content.match(/\*\*Model:\*\*\s*(.+)/)
  const sessionMatch = content.match(/\*\*Session:\*\*\s*(.+)/)

  const summaryMatch = content.match(/## Summary\s*\n\n([\s\S]*?)(?=\n## |$)/)
  const taskMatch = content.match(/## Task Passed Forward\s*\n\n([\s\S]*?)(?=\n## |$)/)
  const promptMatch = content.match(/## Prompt Written for Next Generation\s*\n\n```\n([\s\S]*?)\n```/)

  return {
    born: bornMatch ? bornMatch[1].trim() : null,
    ended: endedMatch ? endedMatch[1].trim() : null,
    model: modelMatch ? modelMatch[1].trim() : null,
    session: sessionMatch ? sessionMatch[1].trim() : null,
    summary: summaryMatch ? summaryMatch[1].trim() : '',
    taskForNext: taskMatch ? taskMatch[1].trim() : '',
    promptBlock: promptMatch ? promptMatch[1].trim() : ''
  }
}

/**
 * Simple hash for a prompt string (matches the hash used in pillar-manager).
 * @param {string} text
 * @returns {string}
 */
function simpleHash(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return hash.toString(16)
}

/**
 * SHA-256 short hash (first 12 hex chars).
 * @param {string} text
 * @returns {string}
 */
function sha256Short(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12)
}

/**
 * Rough token estimate (~4 chars per token).
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
 * Validate the entire lineage — check that all manifest files exist,
 * lineage.json is well-formed, and generation numbers are contiguous.
 * @param {string} singularityDir
 * @returns {Promise<{ valid: boolean, issues: string[], generationCount: number, gaps: number[] }>}
 */
export async function validateLineage(singularityDir) {
  const issues = []
  const lineage = await loadLineage(singularityDir)
  const manifests = await listManifests(singularityDir)

  const manifestGens = new Set(manifests.map(m => m.generation))
  const lineageGens = new Set(lineage.map(e => e.gen))

  // Check lineage.json entries
  if (lineage.length === 0 && manifests.length === 0) {
    console.log(`${TAG} Validation: empty lineage (no generations yet)`)
    return { valid: true, issues: [], generationCount: 0, gaps: [] }
  }

  // Check for lineage entries without matching manifests
  for (const entry of lineage) {
    if (!manifestGens.has(entry.gen)) {
      issues.push(`Lineage entry for gen ${entry.gen} has no matching manifest file`)
    }
    if (!entry.gen || typeof entry.gen !== 'number') {
      issues.push(`Lineage entry has invalid generation number: ${JSON.stringify(entry.gen)}`)
    }
  }

  // Check for manifest files not tracked in lineage
  for (const manifest of manifests) {
    if (!lineageGens.has(manifest.generation)) {
      issues.push(`Manifest ${manifest.filename} is not tracked in lineage.json`)
    }
  }

  // Check for duplicate generations in lineage
  const genCounts = {}
  for (const entry of lineage) {
    genCounts[entry.gen] = (genCounts[entry.gen] || 0) + 1
  }
  for (const [gen, count] of Object.entries(genCounts)) {
    if (count > 1) {
      issues.push(`Duplicate lineage entries for generation ${gen} (${count} entries)`)
    }
  }

  // Check for contiguity — find gaps
  const allGens = [...new Set([...manifestGens, ...lineageGens])].sort((a, b) => a - b)
  const gaps = []
  if (allGens.length > 0) {
    for (let g = allGens[0]; g <= allGens[allGens.length - 1]; g++) {
      if (!manifestGens.has(g) && !lineageGens.has(g)) {
        gaps.push(g)
      }
    }
    if (gaps.length > 0) {
      issues.push(`Gap(s) in generation sequence: ${gaps.join(', ')}`)
    }
  }

  const valid = issues.length === 0
  console.log(`${TAG} Validation: ${valid ? 'PASS' : 'FAIL'} — ${allGens.length} generations, ${issues.length} issues`)
  return { valid, issues, generationCount: allGens.length, gaps }
}

/**
 * Diff two generations' prompts and show what evolved.
 * Returns a human-readable summary of changes.
 * @param {string} singularityDir
 * @param {number} genA
 * @param {number} genB
 * @returns {Promise<{ genA: { summary: string, tokenEstimate: number }, genB: { summary: string, tokenEstimate: number }, diff: string, evolutionNotes: string }>}
 */
export async function diffGenerations(singularityDir, genA, genB) {
  const padA = String(genA).padStart(3, '0')
  const padB = String(genB).padStart(3, '0')

  let manifestA, manifestB
  try {
    const rawA = await readFile(join(singularityDir, `generation-${padA}.md`), 'utf-8')
    manifestA = parseManifest(rawA)
  } catch {
    throw new Error(`Manifest for generation ${genA} not found`)
  }

  try {
    const rawB = await readFile(join(singularityDir, `generation-${padB}.md`), 'utf-8')
    manifestB = parseManifest(rawB)
  } catch {
    throw new Error(`Manifest for generation ${genB} not found`)
  }

  // Build a line-by-line diff of the prompt blocks
  const linesA = manifestA.promptBlock.split('\n')
  const linesB = manifestB.promptBlock.split('\n')

  const diffLines = []
  const maxLines = Math.max(linesA.length, linesB.length)

  // Simple line-by-line comparison (not a full LCS diff, but useful for quick review)
  const setA = new Set(linesA.map(l => l.trim()).filter(Boolean))
  const setB = new Set(linesB.map(l => l.trim()).filter(Boolean))

  for (const line of linesB) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!setA.has(trimmed)) {
      diffLines.push(`+ ${trimmed}`)
    }
  }
  for (const line of linesA) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!setB.has(trimmed)) {
      diffLines.push(`- ${trimmed}`)
    }
  }

  const tokensA = estimateTokens(manifestA.promptBlock)
  const tokensB = estimateTokens(manifestB.promptBlock)
  const tokenDelta = tokensB - tokensA

  // Evolution notes
  const notes = []
  if (tokenDelta > 0) notes.push(`Prompt grew by ~${tokenDelta} tokens`)
  else if (tokenDelta < 0) notes.push(`Prompt shrank by ~${Math.abs(tokenDelta)} tokens`)
  else notes.push('Prompt size unchanged')

  if (diffLines.length === 0) notes.push('Prompts are identical in content')
  else notes.push(`${diffLines.filter(l => l.startsWith('+')).length} lines added, ${diffLines.filter(l => l.startsWith('-')).length} lines removed`)

  if (manifestA.taskForNext) notes.push(`Gen ${genA} tasked next with: "${manifestA.taskForNext.slice(0, 100)}"`)
  if (manifestB.taskForNext) notes.push(`Gen ${genB} tasked next with: "${manifestB.taskForNext.slice(0, 100)}"`)

  console.log(`${TAG} Diff gen ${genA} vs ${genB}: ${diffLines.length} changes`)

  return {
    genA: { summary: manifestA.summary.slice(0, 300), tokenEstimate: tokensA },
    genB: { summary: manifestB.summary.slice(0, 300), tokenEstimate: tokensB },
    diff: diffLines.join('\n') || '(no differences)',
    evolutionNotes: notes.join('\n')
  }
}

/**
 * Repair a broken lineage. Rebuilds lineage.json from manifest files on disk.
 * @param {string} singularityDir
 * @returns {Promise<{ repaired: boolean, generationsFound: number, lineageEntries: number }>}
 */
export async function repairLineage(singularityDir) {
  const manifests = await listManifests(singularityDir)

  if (manifests.length === 0) {
    console.log(`${TAG} Repair: no manifests found, writing empty lineage`)
    await saveLineage(singularityDir, [])
    return { repaired: true, generationsFound: 0, lineageEntries: 0 }
  }

  const newLineage = []

  for (const { filename, generation } of manifests) {
    const raw = await readFile(join(singularityDir, filename), 'utf-8')
    const manifest = parseManifest(raw)

    newLineage.push({
      gen: generation,
      born: manifest.born || null,
      ended: manifest.ended || null,
      model: manifest.model || 'unknown',
      pillarId: manifest.session || 'unknown',
      summary: manifest.summary.slice(0, 500),
      taskForNext: manifest.taskForNext.slice(0, 500),
      promptHash: simpleHash(manifest.promptBlock),
      promptLength: manifest.promptBlock.length
    })
  }

  await saveLineage(singularityDir, newLineage)
  console.log(`${TAG} Repair: rebuilt lineage.json from ${manifests.length} manifests`)
  return { repaired: true, generationsFound: manifests.length, lineageEntries: newLineage.length }
}

/**
 * Get a compact lineage summary suitable for display or logging.
 * @param {string} singularityDir
 * @returns {Promise<Array<{ generation: number, born: string|null, promptHash: string, summaryPreview: string }>>}
 */
export async function getLineageSummary(singularityDir) {
  const lineage = await loadLineage(singularityDir)

  return lineage.map(entry => ({
    generation: entry.gen,
    born: entry.born || null,
    promptHash: entry.promptHash || '',
    summaryPreview: (entry.summary || '').slice(0, 120)
  }))
}

/**
 * Truncate the lineage at a specific generation (for recovery from bad handoffs).
 * Moves truncated manifests to .singularity/archive/
 * @param {string} singularityDir
 * @param {number} atGeneration - Keep this gen and all before it
 * @returns {Promise<{ kept: number, archived: number }>}
 */
export async function truncateLineage(singularityDir, atGeneration) {
  if (typeof atGeneration !== 'number' || atGeneration < 1) {
    throw new Error('atGeneration must be a positive integer')
  }

  const lineage = await loadLineage(singularityDir)
  const manifests = await listManifests(singularityDir)

  // Partition lineage entries
  const kept = lineage.filter(e => e.gen <= atGeneration)
  const truncated = lineage.filter(e => e.gen > atGeneration)

  // Ensure archive directory exists
  const archiveDir = join(singularityDir, 'archive')
  await mkdir(archiveDir, { recursive: true })

  // Move manifest files for truncated generations to archive
  let archivedCount = 0
  for (const manifest of manifests) {
    if (manifest.generation > atGeneration) {
      const srcPath = join(singularityDir, manifest.filename)
      const dstPath = join(archiveDir, manifest.filename)
      try {
        await rename(srcPath, dstPath)
        archivedCount++
        console.log(`${TAG} Archived ${manifest.filename}`)
      } catch (e) {
        console.warn(`${TAG} Failed to archive ${manifest.filename}: ${e.message}`)
      }
    }
  }

  // Write truncated lineage
  await saveLineage(singularityDir, kept)

  console.log(`${TAG} Truncated at gen ${atGeneration}: kept ${kept.length}, archived ${truncated.length} entries + ${archivedCount} manifests`)
  return { kept: kept.length, archived: truncated.length }
}
