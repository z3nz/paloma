#!/usr/bin/env node

/**
 * Ollama Eval MCP Server — wraps the eval, prompt evolution, and training data
 * workflows as MCP tools so Claude (Flow) can trigger the feedback loop conversationally.
 *
 * Scripts are spawned as subprocesses since they auto-execute main() on import.
 *
 * Tools:
 *   - ollama_eval_run: Run eval suite against a model
 *   - ollama_eval_compare: Compare two or more model versions
 *   - ollama_prompt_create: Create new model from a Modelfile
 *   - ollama_prompt_history: List all model versions with scores
 *   - ollama_data_stats: Show training data stats and fine-tuning readiness
 *   - ollama_train_start: Kick off MLX fine-tuning (background, long-running)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const SCRIPTS_DIR = resolve(PROJECT_ROOT, 'scripts', 'ollama-eval')
const FINETUNE_DIR = resolve(PROJECT_ROOT, 'scripts', 'ollama-finetune')
const TRAINING_DIR = resolve(PROJECT_ROOT, '.paloma', 'ollama-training')
const RESULTS_DIR = join(TRAINING_DIR, 'results')
const DATA_DIR = join(TRAINING_DIR, 'data')
const EVALS_DIR = join(TRAINING_DIR, 'evals')
const PROMPTS_DIR = join(TRAINING_DIR, 'prompts')

// ─── Subprocess Helper ───────────────────────────────────────────────────────

/**
 * Spawn a Node.js script as a child process and capture its output.
 * Returns { stdout, stderr } on success; throws on non-zero exit.
 */
function runScript (scriptPath, args = [], { timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', chunk => { stdout += chunk.toString() })
    proc.stderr.on('data', chunk => { stderr += chunk.toString() })

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Script exited with code ${code}`))
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      }
    })

    proc.on('error', err => {
      reject(new Error(`Failed to spawn script: ${err.message}`))
    })
  })
}

/**
 * Clean carriage-return progress output from subprocess stdout.
 * Runner.js overwrites lines with \r for progress — strip the overwritten text.
 */
function cleanProgressOutput (text) {
  return text.replace(/[^\n]*\r/g, '')
}

// ─── File Helpers ────────────────────────────────────────────────────────────

async function countJsonlLines (filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw.trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

async function countEvalTasks () {
  const categories = {}
  try {
    const entries = await readdir(EVALS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const files = await readdir(join(EVALS_DIR, entry.name))
        categories[entry.name] = files.filter(f => f.endsWith('.json')).length
      }
    }
  } catch {
    // EVALS_DIR doesn't exist yet
  }
  return categories
}

async function listResultFiles () {
  try {
    const files = await readdir(RESULTS_DIR)
    return files.filter(f => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'ollama-eval', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ollama_eval_run',
      description:
        'Run the eval suite against an Ollama model. Scores all tasks and writes results ' +
        'to .paloma/ollama-training/results/. Long-running: 5-60 minutes depending on task count.',
      inputSchema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Ollama model name (e.g., "qwen2.5-coder:32b", "paloma-coder:v1")'
          },
          category: {
            type: 'string',
            description: 'Eval category to run: "all", "tool-use", "instruction-following", "code-gen", "bug-finding", "code-review", "paloma-specific"',
            default: 'all'
          }
        },
        required: ['model']
      }
    },
    {
      name: 'ollama_eval_compare',
      description:
        'Compare eval results between two or more model versions. Returns a markdown table ' +
        'with per-category scores and delta analysis. Models are matched against result filenames.',
      inputSchema: {
        type: 'object',
        properties: {
          models: {
            type: 'string',
            description: 'Comma-separated model keys to compare (e.g., "stock,v1,v2"). Keys are matched against result filenames.'
          }
        },
        required: ['models']
      }
    },
    {
      name: 'ollama_prompt_create',
      description:
        'Create a new Ollama model version from a Modelfile. Specify a version that maps to ' +
        'an existing Modelfile.{version} in the prompts directory, or provide modelfile_content ' +
        'to write the Modelfile first.',
      inputSchema: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            description: 'Version identifier (e.g., "v1", "v2"). Maps to paloma-coder:{version} in Ollama.'
          },
          modelfile_content: {
            type: 'string',
            description: 'Optional: raw Modelfile content. If provided, writes to Modelfile.{version} before creating the model.'
          }
        },
        required: ['version']
      }
    },
    {
      name: 'ollama_prompt_history',
      description: 'Show the version history of all prompt-tuned models with their metadata, lineage, and eval scores.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'ollama_data_stats',
      description:
        'Show training data statistics: eval task counts by category, result file count, ' +
        'training data pipeline status (candidates/approved/splits), and fine-tuning readiness assessment.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'ollama_train_start',
      description:
        'Start MLX QLoRA fine-tuning as a background process. Returns immediately with PID. ' +
        'Fine-tuning takes hours. Requires scripts/ollama-finetune/train.sh (WU-6).',
      inputSchema: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            description: 'Version identifier for the fine-tuned model (e.g., "ft-v1")'
          },
          iters: {
            type: 'number',
            description: 'Number of training iterations (default: 1000)',
            default: 1000
          }
        },
        required: ['version']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'ollama_eval_run': return await handleEvalRun(args)
      case 'ollama_eval_compare': return await handleEvalCompare(args)
      case 'ollama_prompt_create': return await handlePromptCreate(args)
      case 'ollama_prompt_history': return await handlePromptHistory()
      case 'ollama_data_stats': return await handleDataStats()
      case 'ollama_train_start': return await handleTrainStart(args)
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleEvalRun ({ model, category = 'all' }) {
  const scriptPath = join(SCRIPTS_DIR, 'runner.js')

  console.error(`[ollama-eval] Running evals: model=${model}, category=${category}`)

  const { stdout } = await runScript(scriptPath, ['--model', model, '--category', category], {
    timeoutMs: 3_600_000 // 60 min — full suite can take a while
  })

  return {
    content: [{ type: 'text', text: cleanProgressOutput(stdout) || 'Eval run completed (no output captured).' }]
  }
}

async function handleEvalCompare ({ models }) {
  const scriptPath = join(SCRIPTS_DIR, 'reporter.js')

  console.error(`[ollama-eval] Comparing models: ${models}`)

  const { stdout } = await runScript(scriptPath, ['--compare', models], {
    timeoutMs: 60_000 // 1 min — reporter is fast, just reads files
  })

  return {
    content: [{ type: 'text', text: stdout || 'No comparison output generated.' }]
  }
}

async function handlePromptCreate ({ version, modelfile_content }) {
  // If modelfile_content provided, write it to the prompts directory first
  if (modelfile_content) {
    const modelfilePath = join(PROMPTS_DIR, `Modelfile.${version}`)
    await mkdir(PROMPTS_DIR, { recursive: true })
    await writeFile(modelfilePath, modelfile_content, 'utf-8')
    console.error(`[ollama-eval] Wrote Modelfile.${version}`)
  }

  const scriptPath = join(SCRIPTS_DIR, 'prompt-engine.js')

  console.error(`[ollama-eval] Creating model version: ${version}`)

  const { stdout } = await runScript(scriptPath, ['create', '--version', version], {
    timeoutMs: 300_000 // 5 min — ollama create can be slow
  })

  return {
    content: [{ type: 'text', text: stdout || `Model paloma-coder:${version} created.` }]
  }
}

async function handlePromptHistory () {
  const scriptPath = join(SCRIPTS_DIR, 'prompt-engine.js')

  const { stdout } = await runScript(scriptPath, ['history'], {
    timeoutMs: 10_000
  })

  return {
    content: [{ type: 'text', text: stdout || 'No version history available.' }]
  }
}

async function handleDataStats () {
  // Eval tasks by category
  const evalCategories = await countEvalTasks()
  const totalEvalTasks = Object.values(evalCategories).reduce((s, n) => s + n, 0)

  // Result files
  const resultFiles = await listResultFiles()

  // Training data pipeline
  const candidates = await countJsonlLines(join(DATA_DIR, 'candidates.jsonl'))
  const approved = await countJsonlLines(join(DATA_DIR, 'approved.jsonl'))
  const train = await countJsonlLines(join(DATA_DIR, 'train.jsonl'))
  const test = await countJsonlLines(join(DATA_DIR, 'test.jsonl'))
  const valid = await countJsonlLines(join(DATA_DIR, 'valid.jsonl'))

  // Readiness assessment
  const trainScriptExists = existsSync(join(FINETUNE_DIR, 'train.sh'))
  const readiness = []

  if (totalEvalTasks >= 50) readiness.push(`✓ Eval tasks: ${totalEvalTasks}`)
  else readiness.push(`⚠ Need 50+ eval tasks (have ${totalEvalTasks})`)

  if (resultFiles.length > 0) readiness.push(`✓ Eval results: ${resultFiles.length} file(s)`)
  else readiness.push('⚠ No eval results yet — run baseline first')

  if (approved >= 500) readiness.push(`✓ Approved training data: ${approved} (ready for fine-tuning)`)
  else if (approved > 0) readiness.push(`⚠ Approved training data: ${approved} (need 500+ for fine-tuning)`)
  else if (candidates > 0) readiness.push(`⚠ ${candidates} candidate(s) awaiting curation`)
  else readiness.push('⚠ No training data yet — run extract after evals')

  if (trainScriptExists) readiness.push('✓ Fine-tuning scripts available')
  else readiness.push('⚠ Fine-tuning scripts not yet built (WU-6)')

  const stats = {
    evalTasks: { total: totalEvalTasks, byCategory: evalCategories },
    results: { files: resultFiles.length, latest: resultFiles[resultFiles.length - 1] || null },
    trainingData: { candidates, approved, train, test, valid },
    readiness
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
  }
}

async function handleTrainStart ({ version, iters = 1000 }) {
  const trainScript = join(FINETUNE_DIR, 'train.sh')

  if (!existsSync(trainScript)) {
    return {
      content: [{
        type: 'text',
        text: 'Fine-tuning scripts not yet available (WU-6 not implemented).\nBuild scripts/ollama-finetune/train.sh first.'
      }],
      isError: true
    }
  }

  console.error(`[ollama-eval] Starting fine-tuning: version=${version}, iters=${iters}`)

  // Spawn as detached process — return immediately, don't wait for completion
  const proc = spawn('bash', [trainScript, version, String(iters)], {
    cwd: FINETUNE_DIR,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  })
  proc.unref()

  return {
    content: [{
      type: 'text',
      text: [
        'Fine-tuning started in background.',
        `  Version: ${version}`,
        `  Iterations: ${iters}`,
        `  PID: ${proc.pid}`,
        '',
        'This will take a long time. Run ollama_eval_run against the',
        'fine-tuned model when complete to measure improvement.'
      ].join('\n')
    }]
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main () {
  console.error('[ollama-eval] Starting Ollama Eval MCP Server...')
  console.error(`[ollama-eval] Scripts: ${SCRIPTS_DIR}`)
  console.error(`[ollama-eval] Training data: ${TRAINING_DIR}`)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[ollama-eval] Ollama Eval MCP Server running')
}

main().catch(err => {
  console.error('[ollama-eval] Fatal:', err)
  process.exit(1)
})
