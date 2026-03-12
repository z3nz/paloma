#!/usr/bin/env node

// Ollama Eval Runner — loads eval tasks, sends to Ollama via direct HTTP,
// collects responses, scores them, and writes structured results.
//
// Usage:
//   node scripts/ollama-eval/runner.js --model qwen2.5-coder:32b --category all
//   node scripts/ollama-eval/runner.js --model paloma-coder:v1 --category tool-use

import {
  ollamaChat,
  loadEvalTasks,
  writeJsonFile,
  resultFileName,
  formatDuration,
  parseArgs,
  RESULTS_DIR
} from './utils.js'
import { scoreResponse } from './scorer.js'
import { join } from 'node:path'

const args = parseArgs(process.argv)
const model = args.model || 'qwen2.5-coder:32b'
const category = args.category || 'all'

async function main() {
  console.log(`\n🔬 Ollama Eval Runner`)
  console.log(`   Model:    ${model}`)
  console.log(`   Category: ${category}`)
  console.log('')

  const tasks = await loadEvalTasks(category)
  if (tasks.length === 0) {
    console.error('No eval tasks found. Check .paloma/ollama-training/evals/ directory.')
    process.exit(1)
  }

  console.log(`   Tasks:    ${tasks.length}`)
  console.log(`   Timeout:  120s per task`)
  console.log('─'.repeat(60))

  const results = []
  let completed = 0
  let skipped = 0
  let totalScore = 0

  for (const task of tasks) {
    const taskLabel = `[${task.id || task.category}]`
    process.stdout.write(`  ${taskLabel} ...`)

    const startTime = Date.now()

    try {
      // Build messages
      const messages = []
      if (task.system) {
        messages.push({ role: 'system', content: task.system })
      }
      messages.push({ role: 'user', content: task.prompt })

      // Send to Ollama
      const ollamaResponse = await ollamaChat({
        model,
        messages,
        options: task.options || {}
      })

      const timingMs = Date.now() - startTime

      // Score the response
      const scoreResult = await scoreResponse(task, ollamaResponse.content)

      const result = {
        taskId: task.id || `${task.category}-unknown`,
        category: task.category,
        model,
        prompt: task.prompt,
        response: ollamaResponse.content,
        score: scoreResult.score,
        timing_ms: timingMs,
        scorer_mode: scoreResult.mode,
        judge_rationale: scoreResult.rationale || null
      }

      results.push(result)
      completed++
      totalScore += scoreResult.score

      const scoreStr = `${scoreResult.score}/5`
      const timeStr = formatDuration(timingMs)
      process.stdout.write(`\r  ${taskLabel} ${scoreStr} (${timeStr}) [${scoreResult.mode}]\n`)

    } catch (err) {
      const timingMs = Date.now() - startTime
      const isTimeout = err.name === 'AbortError' || err.message.includes('abort')

      const result = {
        taskId: task.id || `${task.category}-unknown`,
        category: task.category,
        model,
        prompt: task.prompt,
        response: null,
        score: 0,
        timing_ms: timingMs,
        scorer_mode: 'error',
        judge_rationale: isTimeout
          ? `Timed out after ${formatDuration(timingMs)}`
          : `Error: ${err.message}`
      }

      results.push(result)
      skipped++

      const reason = isTimeout ? 'TIMEOUT' : 'ERROR'
      process.stdout.write(`\r  ${taskLabel} ${reason} (${formatDuration(timingMs)})\n`)
    }
  }

  // Write results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = resultFileName(model, timestamp)
  const filePath = join(RESULTS_DIR, fileName)
  
  const output = {
    meta: {
      model,
      category,
      timestamp: new Date().toISOString(),
      taskCount: tasks.length,
      completed,
      skipped,
      averageScore: completed > 0 ? +(totalScore / completed).toFixed(2) : 0
    },
    results
  }

  await writeJsonFile(filePath, output)

  // Summary
  console.log('─'.repeat(60))
  console.log(`\n📊 Results Summary`)
  console.log(`   Completed: ${completed}/${tasks.length}`)
  console.log(`   Skipped:   ${skipped}`)
  console.log(`   Avg Score: ${output.meta.averageScore}/5`)
  console.log(`   Written:   ${filePath}`)

  // Per-category breakdown
  const byCategory = {}
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, sum: 0, count: 0 }
    byCategory[r.category].total++
    if (r.score > 0) {
      byCategory[r.category].sum += r.score
      byCategory[r.category].count++
    }
  }

  console.log('\n   Per-Category:')
  for (const [cat, data] of Object.entries(byCategory).sort()) {
    const avg = data.count > 0 ? (data.sum / data.count).toFixed(2) : 'N/A'
    console.log(`     ${cat}: ${avg}/5 (${data.count}/${data.total} scored)`)
  }

  console.log('')
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
