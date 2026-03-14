#!/usr/bin/env node

// Interactive Training Data Curator
// Review eval-extracted candidates and approve/reject for training.
//
// Usage:
//   node scripts/ollama-eval/data-curator.js
//   node scripts/ollama-eval/data-curator.js --file path/to/candidates.jsonl

import { createInterface } from 'node:readline'
import { join } from 'node:path'
import {
  parseArgs,
  readJsonlFile,
  writeJsonlFile,
  DATA_DIR
} from './utils.js'

const args = parseArgs(process.argv)
const CANDIDATES_FILE = args.file || join(DATA_DIR, 'candidates.jsonl')
const APPROVED_FILE = join(DATA_DIR, 'approved.jsonl')

async function main() {
  console.log('\n📋 Training Data Curator\n')

  const candidates = await readJsonlFile(CANDIDATES_FILE)
  if (candidates.length === 0) {
    console.log('No candidates found. Run data-collector.js extract first.')
    return
  }

  // Load existing approved to avoid re-reviewing
  const existingApproved = await readJsonlFile(APPROVED_FILE)
  const approvedKeys = new Set(
    existingApproved.map(a => `${a.metadata?.taskId}::${a.metadata?.source}`)
  )

  // Filter out already-approved
  const toReview = candidates.filter(c => {
    const key = `${c.metadata?.taskId}::${c.metadata?.source}`
    return !approvedKeys.has(key)
  })

  if (toReview.length === 0) {
    console.log(`All ${candidates.length} candidates already reviewed.`)
    console.log(`Approved: ${existingApproved.length}`)
    return
  }

  console.log(`   Total candidates: ${candidates.length}`)
  console.log(`   Already reviewed: ${candidates.length - toReview.length}`)
  console.log(`   To review:        ${toReview.length}`)
  console.log('')
  console.log('   Commands: [a]ccept  [r]eject  [s]kip  [q]uit')
  console.log('─'.repeat(60))

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const prompt = (q) => new Promise(resolve => rl.question(q, resolve))

  const newlyApproved = []
  let reviewed = 0

  for (let i = 0; i < toReview.length; i++) {
    const item = toReview[i]
    const meta = item.metadata || {}

    console.log(`\n[${i + 1}/${toReview.length}] Task: ${meta.taskId || 'unknown'}`)
    console.log(`   Category: ${meta.category || 'unknown'}`)
    console.log(`   Source:   ${meta.source || 'unknown'}`)
    console.log(`   Score:    ${meta.score || 'N/A'}/5`)
    console.log(`   Model:    ${meta.model || 'unknown'}`)
    console.log('')

    // Show user prompt (truncated)
    const userMsg = item.messages?.find(m => m.role === 'user')
    if (userMsg) {
      const promptText = userMsg.content.length > 300
        ? userMsg.content.slice(0, 300) + '...'
        : userMsg.content
      console.log('   Prompt:')
      for (const line of promptText.split('\n')) {
        console.log(`      ${line}`)
      }
    }

    // Show assistant response (truncated)
    const assistantMsg = item.messages?.find(m => m.role === 'assistant')
    if (assistantMsg) {
      const responseText = assistantMsg.content.length > 500
        ? assistantMsg.content.slice(0, 500) + '...'
        : assistantMsg.content
      console.log('\n   Response:')
      for (const line of responseText.split('\n')) {
        console.log(`      ${line}`)
      }
    }

    console.log('')
    const answer = await prompt('   [a]ccept / [r]eject / [s]kip / [q]uit > ')
    const cmd = answer.trim().toLowerCase()

    if (cmd === 'a' || cmd === 'accept') {
      newlyApproved.push(item)
      reviewed++
      console.log('   Accepted')
    } else if (cmd === 'r' || cmd === 'reject') {
      reviewed++
      console.log('   Rejected')
    } else if (cmd === 'q' || cmd === 'quit') {
      console.log('\n   Quitting...')
      break
    } else {
      // skip
      console.log('   Skipped')
    }
  }

  // Merge newly approved with existing
  if (newlyApproved.length > 0) {
    const allApproved = [...existingApproved, ...newlyApproved]
    await writeJsonlFile(APPROVED_FILE, allApproved)
    console.log(`\n   Newly approved: ${newlyApproved.length}`)
    console.log(`   Total approved: ${allApproved.length}`)
    console.log(`   Written: ${APPROVED_FILE}`)
  } else {
    console.log('\n   No new approvals.')
  }

  console.log(`   Reviewed: ${reviewed}/${toReview.length}`)
  console.log('')

  rl.close()
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
