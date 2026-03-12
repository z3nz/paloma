#!/usr/bin/env node

// Ollama Eval Reporter — reads result files and generates markdown comparison tables.
//
// Usage:
//   node scripts/ollama-eval/reporter.js --compare stock,v1,v2
//   node scripts/ollama-eval/reporter.js --latest
//   node scripts/ollama-eval/reporter.js --file results/model--timestamp.json

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { loadJsonFile, parseArgs, RESULTS_DIR, formatDuration } from './utils.js'

const args = parseArgs(process.argv)

async function main() {
  if (args.compare) {
    await compareModels(args.compare)
  } else if (args.file) {
    await showSingleReport(args.file)
  } else if (args.latest) {
    await showLatest()
  } else {
    console.log('Usage:')
    console.log('  --compare stock,v1,v2   Compare models side-by-side')
    console.log('  --latest                Show the most recent result')
    console.log('  --file <path>           Show a specific result file')
    process.exit(1)
  }
}

// --- Compare multiple models ---

async function compareModels(modelsArg) {
  const modelKeys = modelsArg.split(',').map(s => s.trim())
  const allFiles = await listResultFiles()

  // Find the most recent result file for each model key
  const modelResults = {}
  for (const key of modelKeys) {
    const matching = allFiles.filter(f => f.toLowerCase().includes(key.toLowerCase()))
    if (matching.length === 0) {
      console.error(`No results found matching "${key}"`)
      continue
    }
    // Most recent = last in sorted list (files sort by timestamp)
    const filePath = join(RESULTS_DIR, matching[matching.length - 1])
    modelResults[key] = await loadJsonFile(filePath)
  }

  const keys = Object.keys(modelResults)
  if (keys.length < 2) {
    console.error('Need at least 2 model results to compare.')
    process.exit(1)
  }

  // Collect all categories across all results
  const allCategories = new Set()
  for (const data of Object.values(modelResults)) {
    for (const r of data.results) {
      allCategories.add(r.category)
    }
  }
  const categories = [...allCategories].sort()

  // Build comparison table
  console.log('\n# Ollama Eval Comparison\n')

  // Header
  const header = `| Category | ${keys.join(' | ')} |`
  const separator = `|----------|${keys.map(() => '------').join('|')}|`
  console.log(header)
  console.log(separator)

  // Per-category rows
  const overallScores = Object.fromEntries(keys.map(k => [k, { sum: 0, count: 0 }]))

  for (const cat of categories) {
    const cells = keys.map(key => {
      const data = modelResults[key]
      const catResults = data.results.filter(r => r.category === cat && r.score > 0)
      if (catResults.length === 0) return 'N/A'
      const avg = catResults.reduce((s, r) => s + r.score, 0) / catResults.length
      overallScores[key].sum += avg * catResults.length
      overallScores[key].count += catResults.length
      return avg.toFixed(2)
    })
    console.log(`| ${cat} | ${cells.join(' | ')} |`)
  }

  // Overall row
  const overallCells = keys.map(key => {
    const o = overallScores[key]
    return o.count > 0 ? (o.sum / o.count).toFixed(2) : 'N/A'
  })
  console.log(`| **Overall** | ${overallCells.map(c => `**${c}**`).join(' | ')} |`)

  // Task count row
  const countCells = keys.map(key => {
    const data = modelResults[key]
    return `${data.meta.completed}/${data.meta.taskCount}`
  })
  console.log(`| Tasks (completed/total) | ${countCells.join(' | ')} |`)

  console.log('')

  // Delta analysis (compare each model to the first)
  if (keys.length >= 2) {
    const baseKey = keys[0]
    console.log(`## Deltas vs ${baseKey}\n`)

    for (let i = 1; i < keys.length; i++) {
      const compareKey = keys[i]
      const baseData = modelResults[baseKey]
      const compareData = modelResults[compareKey]

      const improvements = []
      const regressions = []

      for (const cat of categories) {
        const baseAvg = categoryAvg(baseData, cat)
        const compAvg = categoryAvg(compareData, cat)
        if (baseAvg === null || compAvg === null) continue

        const delta = compAvg - baseAvg
        if (delta > 0.1) improvements.push({ cat, delta })
        else if (delta < -0.1) regressions.push({ cat, delta })
      }

      if (improvements.length > 0) {
        console.log(`**${compareKey} improvements:**`)
        for (const { cat, delta } of improvements.sort((a, b) => b.delta - a.delta)) {
          console.log(`  - ${cat}: +${delta.toFixed(2)}`)
        }
      }
      if (regressions.length > 0) {
        console.log(`**${compareKey} regressions:**`)
        for (const { cat, delta } of regressions.sort((a, b) => a.delta - b.delta)) {
          console.log(`  - ${cat}: ${delta.toFixed(2)}`)
        }
      }
      if (improvements.length === 0 && regressions.length === 0) {
        console.log(`**${compareKey}:** No significant changes.`)
      }
      console.log('')
    }
  }
}

// --- Single report ---

async function showSingleReport(filePath) {
  const fullPath = filePath.startsWith('/') ? filePath : join(RESULTS_DIR, filePath)
  const data = await loadJsonFile(fullPath)
  printReport(data)
}

async function showLatest() {
  const files = await listResultFiles()
  if (files.length === 0) {
    console.error('No result files found.')
    process.exit(1)
  }
  const latest = files[files.length - 1]
  console.log(`Latest: ${latest}\n`)
  const data = await loadJsonFile(join(RESULTS_DIR, latest))
  printReport(data)
}

function printReport(data) {
  const { meta, results } = data

  console.log(`\n# Eval Report: ${meta.model}\n`)
  console.log(`- **Date:** ${meta.timestamp}`)
  console.log(`- **Category:** ${meta.category}`)
  console.log(`- **Tasks:** ${meta.completed}/${meta.taskCount} completed`)
  console.log(`- **Average Score:** ${meta.averageScore}/5`)
  console.log('')

  // Per-category breakdown
  const byCategory = {}
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = []
    byCategory[r.category].push(r)
  }

  console.log('| Category | Avg Score | Tasks | Avg Time |')
  console.log('|----------|-----------|-------|----------|')

  for (const [cat, catResults] of Object.entries(byCategory).sort()) {
    const scored = catResults.filter(r => r.score > 0)
    const avg = scored.length > 0
      ? (scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(2)
      : 'N/A'
    const avgTime = catResults.length > 0
      ? formatDuration(catResults.reduce((s, r) => s + r.timing_ms, 0) / catResults.length)
      : 'N/A'
    console.log(`| ${cat} | ${avg}/5 | ${scored.length}/${catResults.length} | ${avgTime} |`)
  }

  // Weakest tasks (score <= 2)
  const weak = results.filter(r => r.score > 0 && r.score <= 2)
  if (weak.length > 0) {
    console.log('\n## Weakest Tasks\n')
    for (const r of weak.sort((a, b) => a.score - b.score)) {
      console.log(`- **${r.taskId}** (${r.category}): ${r.score}/5 — ${r.judge_rationale || 'no rationale'}`)
    }
  }

  // Errors/timeouts
  const errors = results.filter(r => r.scorer_mode === 'error')
  if (errors.length > 0) {
    console.log('\n## Errors/Timeouts\n')
    for (const r of errors) {
      console.log(`- **${r.taskId}**: ${r.judge_rationale}`)
    }
  }

  console.log('')
}

// --- Helpers ---

async function listResultFiles() {
  try {
    const files = await readdir(RESULTS_DIR)
    return files.filter(f => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

function categoryAvg(data, category) {
  const catResults = data.results.filter(r => r.category === category && r.score > 0)
  if (catResults.length === 0) return null
  return catResults.reduce((s, r) => s + r.score, 0) / catResults.length
}

// --- Export for MCP wrapper ---

export { compareModels, showSingleReport, showLatest, listResultFiles }

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
