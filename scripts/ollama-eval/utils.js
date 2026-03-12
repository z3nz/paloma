// Shared utilities for the Ollama eval system.
// Ollama HTTP client, file I/O helpers, timeout handling.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
export const PROJECT_ROOT = join(__dirname, '..', '..')
export const TRAINING_DIR = join(PROJECT_ROOT, '.paloma', 'ollama-training')
export const EVALS_DIR = join(TRAINING_DIR, 'evals')
export const RESULTS_DIR = join(TRAINING_DIR, 'results')

const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434'
const DEFAULT_TIMEOUT_MS = 120_000

// --- Ollama HTTP Client ---

export async function ollamaChat({ model, messages, options = {} }) {
  const body = {
    model,
    messages,
    stream: false,
    options: { num_ctx: 32768, ...options }
  }

  const response = await fetchWithTimeout(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, DEFAULT_TIMEOUT_MS)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Ollama API error ${response.status}: ${text || response.statusText}`)
  }

  const data = await response.json()
  return {
    content: data.message?.content || '',
    totalDuration: data.total_duration,
    evalCount: data.eval_count
  }
}

// --- Timeout wrapper ---

export function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

// --- File I/O ---

export async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true })
  }
}

export async function loadJsonFile(filePath) {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}

export async function writeJsonFile(filePath, data) {
  await ensureDir(join(filePath, '..'))
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export async function loadEvalTasks(category = 'all') {
  const tasks = []

  if (category === 'all') {
    const entries = await readdir(EVALS_DIR, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const catTasks = await loadCategoryTasks(entry.name)
        tasks.push(...catTasks)
      }
    }
  } else {
    const catTasks = await loadCategoryTasks(category)
    tasks.push(...catTasks)
  }

  return tasks
}

async function loadCategoryTasks(categoryName) {
  const catDir = join(EVALS_DIR, categoryName)
  const tasks = []

  const files = await readdir(catDir).catch(() => [])
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const task = await loadJsonFile(join(catDir, file))
      task.category = task.category || categoryName
      tasks.push(task)
    } catch (err) {
      console.error(`Failed to load eval task ${file}: ${err.message}`)
    }
  }

  return tasks
}

// --- Result file naming ---

export function resultFileName(model, timestamp) {
  const safeModel = model.replace(/[:/]/g, '--')
  const ts = timestamp || new Date().toISOString().replace(/[:.]/g, '-')
  return `${safeModel}--${ts}.json`
}

// --- CLI argument parsing ---

export function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    }
  }
  return args
}

// --- Formatting ---

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}
