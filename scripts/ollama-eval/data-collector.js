#!/usr/bin/env node

// Training Data Collection Pipeline
// Extracts high-quality responses from eval results,
// generates gold responses via Claude API, and splits data for training.
//
// Usage:
//   node scripts/ollama-eval/data-collector.js extract --min-score 4
//   node scripts/ollama-eval/data-collector.js generate-gold --max-score 2
//   node scripts/ollama-eval/data-collector.js split

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  loadJsonFile,
  loadEvalTasks,
  ensureDir,
  parseArgs,
  readJsonlFile,
  writeJsonlFile,
  RESULTS_DIR,
  DATA_DIR
} from './utils.js'

const args = parseArgs(process.argv)
const command = process.argv[2]

const CANDIDATES_FILE = join(DATA_DIR, 'candidates.jsonl')
const APPROVED_FILE = join(DATA_DIR, 'approved.jsonl')
const TRAIN_FILE = join(DATA_DIR, 'train.jsonl')
const TEST_FILE = join(DATA_DIR, 'test.jsonl')
const VALID_FILE = join(DATA_DIR, 'valid.jsonl')

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

async function main() {
  switch (command) {
    case 'extract':
      await runExtract()
      break
    case 'generate-gold':
      await runGenerateGold()
      break
    case 'split':
      await runSplit()
      break
    default:
      printUsage()
      process.exit(1)
  }
}

function printUsage() {
  console.log('Ollama Training Data Collector\n')
  console.log('Usage:')
  console.log('  extract --min-score 4       Extract high-scoring responses as training candidates')
  console.log('  generate-gold --max-score 2 Generate ideal responses for low-scoring tasks via Claude')
  console.log('  split                       Split approved data into train/test/valid (80/10/10)')
}

// --- Extract ---

async function runExtract() {
  const minScore = parseInt(args['min-score'] || '4', 10)
  console.log(`\n📥 Extracting training candidates (score >= ${minScore})\n`)

  // Load eval tasks for system prompt lookup
  const tasks = await loadEvalTasks('all')
  const taskMap = new Map(tasks.map(t => [t.id, t]))

  // Load all result files
  const resultFiles = await listResultFiles()
  if (resultFiles.length === 0) {
    console.log('No result files found in', RESULTS_DIR)
    console.log('Run the eval suite first: node scripts/ollama-eval/runner.js --model <model>')
    return
  }

  const candidates = []
  let scanned = 0
  let extracted = 0

  for (const file of resultFiles) {
    const data = await loadJsonFile(join(RESULTS_DIR, file))
    for (const result of data.results) {
      scanned++
      if (result.score < minScore || result.score === 0 || !result.response) continue

      const task = taskMap.get(result.taskId)
      const messages = buildMessages(task, result)

      candidates.push({
        messages,
        metadata: {
          taskId: result.taskId,
          category: result.category,
          model: result.model,
          score: result.score,
          source: 'eval-extract',
          resultFile: file
        }
      })
      extracted++
    }
  }

  // Preserve any existing gold responses (source: 'claude-gold') — they'd be lost otherwise
  const existing = await readJsonlFile(CANDIDATES_FILE)
  const existingGold = existing.filter(c => c.metadata?.source === 'claude-gold')
  if (existingGold.length > 0) {
    console.log(`   Preserving ${existingGold.length} existing gold response(s) from generate-gold`)
  }

  // Deduplicate: merge extracted candidates with preserved gold responses
  const deduped = deduplicateCandidates([...candidates, ...existingGold])

  await ensureDir(DATA_DIR)
  await writeJsonlFile(CANDIDATES_FILE, deduped)

  console.log(`   Scanned:      ${scanned} results across ${resultFiles.length} files`)
  console.log(`   Extracted:    ${extracted} (score >= ${minScore})`)
  console.log(`   Deduplicated: ${deduped.length}`)
  console.log(`   Written:      ${CANDIDATES_FILE}`)
  console.log('')
}

// --- Generate Gold ---

async function runGenerateGold() {
  const maxScore = parseInt(args['max-score'] || '2', 10)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Cannot generate gold responses.')
    process.exit(1)
  }

  console.log(`\n🏆 Generating gold responses for weak tasks (score <= ${maxScore})\n`)

  // Load eval tasks for full context
  const tasks = await loadEvalTasks('all')
  const taskMap = new Map(tasks.map(t => [t.id, t]))

  // Find weak results across all result files
  const resultFiles = await listResultFiles()
  const weakResults = []

  for (const file of resultFiles) {
    const data = await loadJsonFile(join(RESULTS_DIR, file))
    for (const result of data.results) {
      if (result.score > 0 && result.score <= maxScore) {
        weakResults.push({ result, file })
      }
    }
  }

  // Deduplicate by taskId — keep worst score
  const seen = new Map()
  for (const { result, file } of weakResults) {
    const key = result.taskId
    if (!seen.has(key) || result.score < seen.get(key).result.score) {
      seen.set(key, { result, file })
    }
  }
  const uniqueWeak = [...seen.values()]

  if (uniqueWeak.length === 0) {
    console.log(`No weak results found (all tasks scored above ${maxScore}).`)
    return
  }

  console.log(`   Found ${uniqueWeak.length} weak tasks to generate gold responses for\n`)

  // Load existing candidates to merge
  const existing = await readJsonlFile(CANDIDATES_FILE)
  const newCandidates = []
  let generated = 0
  let errors = 0

  for (let i = 0; i < uniqueWeak.length; i++) {
    const { result } = uniqueWeak[i]
    const task = taskMap.get(result.taskId)
    const label = `[${i + 1}/${uniqueWeak.length}] ${result.taskId}`

    process.stdout.write(`   ${label} ...`)

    if (!task) {
      process.stdout.write(`\r   ${label} SKIP (task not found in evals)\n`)
      continue
    }

    try {
      const goldResponse = await generateGoldResponse(apiKey, task)
      if (!goldResponse) {
        process.stdout.write(`\r   ${label} SKIP (empty response from Claude)\n`)
        continue
      }
      const messages = buildMessages(task, { prompt: result.prompt, response: goldResponse })

      newCandidates.push({
        messages,
        metadata: {
          taskId: result.taskId,
          category: result.category,
          model: 'claude-gold',
          score: 5,
          source: 'claude-gold',
          originalScore: result.score,
          generatedBy: CLAUDE_MODEL
        }
      })
      generated++
      process.stdout.write(`\r   ${label} done\n`)
    } catch (err) {
      errors++
      process.stdout.write(`\r   ${label} ERROR: ${err.message}\n`)
    }
  }

  // Merge with existing, deduplicate
  const merged = deduplicateCandidates([...existing, ...newCandidates])
  await ensureDir(DATA_DIR)
  await writeJsonlFile(CANDIDATES_FILE, merged)

  console.log(`\n   Generated: ${generated} gold responses`)
  if (errors > 0) console.log(`   Errors:    ${errors}`)
  console.log(`   Total:     ${merged.length} candidates`)
  console.log(`   Written:   ${CANDIDATES_FILE}`)
  console.log('')
}

async function generateGoldResponse(apiKey, task) {
  const systemContext = task.system || 'You are a helpful coding assistant.'
  const toolsSection = task.tools
    ? `\n## Available Tools\n${JSON.stringify(task.tools, null, 2)}\n`
    : ''
  const rubricSection = task.rubric
    ? `\n## Quality Rubric (score 5 = perfect)\n${task.rubric}\n`
    : ''

  const goldPrompt = `You are an expert AI coding assistant. Generate the IDEAL response to this task.

## System Context
${systemContext}

## Task
${task.prompt}
${toolsSection}${rubricSection}
## Instructions
Write the ideal response that would score 5/5 on the rubric. Respond ONLY with the response itself — no meta-commentary, no "here is the ideal response", just the response as if you were the assistant answering the task directly.`

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: goldPrompt }]
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// --- Split ---

async function runSplit() {
  console.log('\n✂️  Splitting data into train/test/valid (80/10/10)\n')

  // Prefer approved.jsonl, fall back to candidates.jsonl
  let sourceFile = APPROVED_FILE
  let items = await readJsonlFile(APPROVED_FILE)

  if (items.length === 0) {
    sourceFile = CANDIDATES_FILE
    items = await readJsonlFile(CANDIDATES_FILE)
  }

  if (items.length === 0) {
    console.log('No data found. Run extract or generate-gold first.')
    return
  }

  console.log(`   Source: ${sourceFile} (${items.length} examples)`)

  // Fisher-Yates shuffle
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }

  // Warn about small datasets
  if (items.length < 10) {
    console.log(`   ⚠ Warning: Only ${items.length} example(s) — test/valid splits may be empty with small datasets`)
  }

  // Split 80/10/10
  const trainEnd = Math.floor(items.length * 0.8)
  const testEnd = trainEnd + Math.floor(items.length * 0.1)

  const train = items.slice(0, trainEnd)
  const test = items.slice(trainEnd, testEnd)
  const valid = items.slice(testEnd)

  // Strip metadata for MLX-clean format
  const stripMeta = (item) => ({ messages: item.messages })

  await ensureDir(DATA_DIR)
  await writeJsonlFile(TRAIN_FILE, train.map(stripMeta))
  await writeJsonlFile(TEST_FILE, test.map(stripMeta))
  await writeJsonlFile(VALID_FILE, valid.map(stripMeta))

  console.log(`   Train: ${train.length} examples → ${TRAIN_FILE}`)
  console.log(`   Test:  ${test.length} examples → ${TEST_FILE}`)
  console.log(`   Valid: ${valid.length} examples → ${VALID_FILE}`)
  console.log('')
}

// --- Helpers ---

function buildMessages(task, result) {
  const messages = []
  const systemContent = task?.system || 'You are a helpful coding assistant.'
  messages.push({ role: 'system', content: systemContent })
  messages.push({ role: 'user', content: result.prompt })
  messages.push({ role: 'assistant', content: result.response })
  return messages
}

function deduplicateCandidates(candidates) {
  const seen = new Map()
  for (const c of candidates) {
    if (!c.metadata) continue // skip malformed items
    const key = `${c.metadata.taskId}::${c.metadata.source}`
    // Keep the highest-scoring version
    if (!seen.has(key) || c.metadata.score > seen.get(key).metadata.score) {
      seen.set(key, c)
    }
  }
  return [...seen.values()]
}

async function listResultFiles() {
  try {
    const files = await readdir(RESULTS_DIR)
    return files.filter(f => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
