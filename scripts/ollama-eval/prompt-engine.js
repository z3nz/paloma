#!/usr/bin/env node

// Ollama Prompt Evolution Engine — creates versioned Modelfiles, runs eval comparisons,
// and tracks the history of prompt-tuned models.
//
// Usage:
//   node scripts/ollama-eval/prompt-engine.js create --version v1
//   node scripts/ollama-eval/prompt-engine.js eval --version v1 --compare stock
//   node scripts/ollama-eval/prompt-engine.js history

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs, ensureDir, TRAINING_DIR, formatDuration } from './utils.js'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = fileURLToPath(new URL('.', import.meta.url))

const PROMPTS_DIR = join(TRAINING_DIR, 'prompts')
const VERSION_LOG = join(PROMPTS_DIR, 'VERSION_LOG.md')

const args = parseArgs(process.argv)
const command = process.argv[2]

async function main() {
  switch (command) {
    case 'create':
      await cmdCreate()
      break
    case 'eval':
      await cmdEval()
      break
    case 'history':
      await cmdHistory()
      break
    default:
      printUsage()
      process.exit(1)
  }
}

// --- CREATE command ---

async function cmdCreate() {
  const version = args.version
  if (!version) {
    console.error('Error: --version is required.\n  Usage: prompt-engine.js create --version v1')
    process.exit(1)
  }

  const modelfilePath = join(PROMPTS_DIR, `Modelfile.${version}`)
  const modelName = resolveModelName(version)

  // 1. Read the Modelfile
  let modelfileContent
  try {
    modelfileContent = await readFile(modelfilePath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Modelfile not found at ${modelfilePath}`)
      console.error(`  Create the file first, then run this command.`)
      process.exit(1)
    }
    throw err
  }

  console.log(`\n🔧 Prompt Engine — Create Model`)
  console.log(`   Version:    ${version}`)
  console.log(`   Model:      ${modelName}`)
  console.log(`   Modelfile:  ${modelfilePath}`)
  console.log('')

  // 2. Parse Modelfile header for metadata
  const metadata = parseModelfileHeader(modelfileContent)

  // 3. Run `ollama create`
  console.log('   Creating model with Ollama...')
  const startTime = Date.now()

  try {
    const { stdout, stderr } = await execFileAsync('ollama', ['create', modelName, '-f', modelfilePath], {
      timeout: 300_000 // 5 min timeout for model creation
    })
    if (stdout) console.log(`   ${stdout.trim()}`)
    if (stderr) console.log(`   ${stderr.trim()}`)
  } catch (err) {
    console.error(`\n   Failed to create model: ${err.message}`)
    if (err.stderr) console.error(`   ${err.stderr.trim()}`)
    process.exit(1)
  }

  const createTime = Date.now() - startTime
  console.log(`   Created in ${formatDuration(createTime)}`)

  // 4. Verify model exists
  console.log('   Verifying model...')
  const verified = await verifyModel(modelName)
  if (!verified) {
    console.error(`   Error: Model "${modelName}" not found after creation.`)
    process.exit(1)
  }
  console.log(`   Verified: ${modelName} exists`)

  // 5. Log to VERSION_LOG.md
  await appendVersionLog({
    version,
    modelName,
    date: new Date().toISOString().split('T')[0],
    parent: metadata.parent || 'unknown',
    targets: metadata.targets || 'unknown',
    changes: metadata.changes || 'No description',
    createTimeMs: createTime
  })

  console.log(`   Logged to VERSION_LOG.md`)
  console.log(`\n   Done. Run evals with:`)
  console.log(`   node scripts/ollama-eval/prompt-engine.js eval --version ${version}\n`)
}

// --- EVAL command ---

async function cmdEval() {
  const version = args.version
  if (!version) {
    console.error('Error: --version is required.\n  Usage: prompt-engine.js eval --version v1 [--compare stock] [--category all]')
    process.exit(1)
  }

  const compareTo = args.compare || null
  const category = args.category || 'all'
  const modelName = resolveModelName(version)

  console.log(`\n🧪 Prompt Engine — Eval`)
  console.log(`   Model:    ${modelName}`)
  console.log(`   Category: ${category}`)
  if (compareTo) console.log(`   Compare:  ${resolveModelName(compareTo)}`)
  console.log('')

  // 1. Run eval suite against the target model
  console.log(`━━━ Running evals: ${modelName} ━━━\n`)
  await runEvalSubprocess(modelName, category)

  // 2. If comparison requested, run evals against the comparison model too
  if (compareTo) {
    const compareModel = resolveModelName(compareTo)

    console.log(`\n━━━ Running evals: ${compareModel} ━━━\n`)
    await runEvalSubprocess(compareModel, category)

    // 3. Generate comparison report
    console.log(`\n━━━ Comparison Report ━━━\n`)

    // Build model keys for reporter: use the version slugs to match result filenames
    const compareArg = `${resolveModelSlug(compareTo)},${resolveModelSlug(version)}`
    await runReporterSubprocess(compareArg)
  }
}

// --- HISTORY command ---

async function cmdHistory() {
  console.log('')

  try {
    const content = await readFile(VERSION_LOG, 'utf-8')
    console.log(content)
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No version history yet. Create a model first:')
      console.log('  node scripts/ollama-eval/prompt-engine.js create --version v1')
    } else {
      throw err
    }
  }
}

// --- Helpers ---

/**
 * Resolve a version string to an Ollama model name.
 * "stock" → "qwen2.5-coder:32b"
 * "v1"   → "paloma-coder:v1"
 * Already fully-qualified names pass through unchanged.
 */
function resolveModelName(version) {
  if (version === 'stock') return 'qwen2.5-coder:32b'
  if (version.includes(':') || version.includes('/')) return version
  return `paloma-coder:${version}`
}

/**
 * Resolve a version string to a slug suitable for matching result filenames.
 * "stock" → "qwen2.5-coder" (result files use -- for : and /)
 * "v1"   → "paloma-coder"
 */
function resolveModelSlug(version) {
  const modelName = resolveModelName(version)
  // Result filenames use -- for : and / (see utils.resultFileName)
  return modelName.replace(/[:/]/g, '--')
}

/**
 * Parse metadata from Modelfile header comments.
 * Looks for lines like: # Version: v1, # Parent: stock, etc.
 */
function parseModelfileHeader(content) {
  const meta = {}
  const lines = content.split('\n')

  for (const line of lines) {
    const match = line.match(/^#\s*(Version|Parent|Date|Targets|Changes):\s*(.+)/i)
    if (match) {
      meta[match[1].toLowerCase()] = match[2].trim()
    }
    // Stop parsing at first non-comment, non-empty line
    if (line.trim() && !line.startsWith('#')) break
  }

  return meta
}

/**
 * Verify a model exists in Ollama's model list.
 */
async function verifyModel(modelName) {
  try {
    const { stdout } = await execFileAsync('ollama', ['list'])
    // ollama list output has model names in the first column
    return stdout.split('\n').some(line => line.trim().startsWith(modelName))
  } catch {
    return false
  }
}

/**
 * Append a version entry to VERSION_LOG.md.
 * Creates the file with header if it doesn't exist.
 */
async function appendVersionLog(entry) {
  await ensureDir(PROMPTS_DIR)

  let content
  try {
    content = await readFile(VERSION_LOG, 'utf-8')
  } catch {
    // Create new log with header
    content = `# Ollama Model Version Log

> Tracks all prompt-tuned model versions, their lineage, and eval results.
> Each entry records what was changed and why.

---

`
  }

  const newEntry = `### ${entry.version} — ${entry.modelName}

- **Date:** ${entry.date}
- **Parent:** ${entry.parent}
- **Targets:** ${entry.targets}
- **Changes:** ${entry.changes}
- **Create Time:** ${formatDuration(entry.createTimeMs)}
- **Eval Results:** _(run \`prompt-engine.js eval --version ${entry.version}\` to populate)_

---

`

  await writeFile(VERSION_LOG, content + newEntry, 'utf-8')
}

/**
 * Update the most recent version entry in VERSION_LOG.md with eval scores.
 */
export async function updateVersionLogWithScores(version, scores) {
  try {
    let content = await readFile(VERSION_LOG, 'utf-8')
    const placeholder = `_(run \`prompt-engine.js eval --version ${version}\` to populate)_`
    const scoreText = `Overall: **${scores.overall}/5** | ${Object.entries(scores.byCategory).map(([cat, avg]) => `${cat}: ${avg}`).join(' | ')}`
    content = content.replace(placeholder, scoreText)
    await writeFile(VERSION_LOG, content, 'utf-8')
  } catch {
    // Non-fatal — log may not exist yet
  }
}

/**
 * Run the eval runner as a subprocess with real-time output.
 */
function runEvalSubprocess(model, category) {
  const runnerPath = resolve(__dirname, 'runner.js')
  return new Promise((resolve, reject) => {
    const child = spawn('node', [runnerPath, '--model', model, '--category', category], {
      stdio: 'inherit'
    })
    child.on('close', code => {
      if (code !== 0) reject(new Error(`Eval runner exited with code ${code}`))
      else resolve()
    })
    child.on('error', reject)
  })
}

/**
 * Run the reporter comparison as a subprocess with real-time output.
 */
function runReporterSubprocess(compareArg) {
  const reporterPath = resolve(__dirname, 'reporter.js')
  return new Promise((resolve, reject) => {
    const child = spawn('node', [reporterPath, '--compare', compareArg], {
      stdio: 'inherit'
    })
    child.on('close', code => {
      if (code !== 0) reject(new Error(`Reporter exited with code ${code}`))
      else resolve()
    })
    child.on('error', reject)
  })
}

function printUsage() {
  console.log(`
Ollama Prompt Evolution Engine

Commands:
  create    Create a new model version from a Modelfile
  eval      Run eval suite against a model version
  history   Show version history

Usage:
  prompt-engine.js create --version v1
  prompt-engine.js eval --version v1 [--compare stock] [--category all]
  prompt-engine.js history

Options:
  --version    Version identifier (e.g., v1, v2, stock)
  --compare    Model version to compare against (default: none)
  --category   Eval category to run (default: all)
`)
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
