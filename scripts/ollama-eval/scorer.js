// Scoring module for Ollama eval system.
// Modes: exact_match, contains, code_execution, claude_judge
// Automated checks are tried first; claude_judge is the fallback for subjective tasks.

import { execFile } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// --- Main scorer entry point ---

export async function scoreResponse(task, response) {
  const mode = task.scoring || 'claude_judge'

  switch (mode) {
    case 'exact_match':
      return scoreExactMatch(task, response)
    case 'contains':
      return scoreContains(task, response)
    case 'code_execution':
      return scoreCodeExecution(task, response)
    case 'claude_judge':
      return scoreClaudeJudge(task, response)
    default:
      return { score: 0, mode: 'unknown', rationale: `Unknown scoring mode: ${mode}` }
  }
}

// --- Exact Match ---

function scoreExactMatch(task, response) {
  const expected = (task.expected || '').trim()
  const actual = response.trim()
  const match = actual === expected

  return {
    score: match ? 5 : 1,
    mode: 'exact_match',
    rationale: match
      ? 'Exact match with expected output.'
      : `Expected: "${truncate(expected, 100)}" Got: "${truncate(actual, 100)}"`
  }
}

// --- Contains ---

function scoreContains(task, response) {
  const expected = task.expected || ''
  const targets = Array.isArray(expected) ? expected : [expected]
  const actual = response.trim()

  const matched = targets.filter(t => actual.includes(t.trim()))
  const ratio = matched.length / targets.length

  let score
  if (ratio === 1) score = 5
  else if (ratio >= 0.75) score = 4
  else if (ratio >= 0.5) score = 3
  else if (ratio > 0) score = 2
  else score = 1

  return {
    score,
    mode: 'contains',
    rationale: `Matched ${matched.length}/${targets.length} expected substrings.`
  }
}

// --- Code Execution ---

async function scoreCodeExecution(task, response) {
  const codeBlock = extractCodeBlock(response)
  if (!codeBlock) {
    return {
      score: 1,
      mode: 'code_execution',
      rationale: 'No code block found in response.'
    }
  }

  const lang = codeBlock.lang || detectLanguage(codeBlock.code)
  const result = await executeCode(lang, codeBlock.code, task.expected_output)

  return {
    score: result.score,
    mode: 'code_execution',
    rationale: result.rationale
  }
}

function extractCodeBlock(text) {
  // Match fenced code blocks: ```lang\ncode\n```
  const match = text.match(/```(\w*)\n([\s\S]*?)```/)
  if (match) {
    return { lang: match[1].toLowerCase(), code: match[2].trim() }
  }
  // Fallback: treat entire response as code if no fence found
  if (text.includes('def ') || text.includes('function ') || text.includes('fn ')) {
    return { lang: '', code: text.trim() }
  }
  return null
}

function detectLanguage(code) {
  if (code.includes('def ') && code.includes(':')) return 'python'
  if (code.includes('function ') || code.includes('=>') || code.includes('const ')) return 'javascript'
  if (code.includes('fn ') && code.includes('->')) return 'rust'
  return 'python' // default
}

async function executeCode(lang, code, expectedOutput) {
  const runners = {
    python: { cmd: 'python3', ext: '.py' },
    javascript: { cmd: 'node', ext: '.js' },
    js: { cmd: 'node', ext: '.js' },
    typescript: { cmd: 'npx', ext: '.ts', args: ['tsx'] },
    ts: { cmd: 'npx', ext: '.ts', args: ['tsx'] }
  }

  const runner = runners[lang]
  if (!runner) {
    return { score: 3, rationale: `Cannot execute ${lang} code. Skipping execution check.` }
  }

  const tmpFile = join(tmpdir(), `eval-${randomUUID()}${runner.ext}`)

  try {
    await writeFile(tmpFile, code, 'utf-8')

    const cmdArgs = [...(runner.args || []), tmpFile]
    const output = await runProcess(runner.cmd, cmdArgs, 30_000)

    if (output.error) {
      return {
        score: 1,
        rationale: `Code execution failed: ${truncate(output.stderr || output.error, 200)}`
      }
    }

    const stdout = output.stdout.trim()

    if (!expectedOutput) {
      // No expected output specified — code ran successfully, that's a pass
      return {
        score: 4,
        rationale: `Code executed successfully. Output: ${truncate(stdout, 200)}`
      }
    }

    const expected = expectedOutput.trim()
    if (stdout === expected) {
      return { score: 5, rationale: 'Code output matches expected exactly.' }
    }

    // Fuzzy match: normalize whitespace
    if (stdout.replace(/\s+/g, ' ') === expected.replace(/\s+/g, ' ')) {
      return { score: 4, rationale: 'Code output matches expected (whitespace-normalized).' }
    }

    return {
      score: 2,
      rationale: `Output mismatch. Expected: "${truncate(expected, 100)}" Got: "${truncate(stdout, 100)}"`
    }
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

function runProcess(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const proc = execFile(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NODE_NO_WARNINGS: '1' }
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message, stdout: stdout || '', stderr: stderr || '' })
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' })
      }
    })
  })
}

// --- Claude-as-Judge ---

async function scoreClaudeJudge(task, response) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      score: 0,
      mode: 'claude_judge',
      rationale: 'ANTHROPIC_API_KEY not set. Cannot use Claude-as-judge scoring.'
    }
  }

  const rubric = task.rubric || 'Rate the response quality from 1 (poor) to 5 (excellent). Consider correctness, completeness, and clarity.'

  const judgePrompt = `You are an expert code evaluator. Score the following AI response to a coding task.

## Task
${task.prompt}

${task.system ? `## System Prompt Given\n${task.system}\n` : ''}
## AI Response
${response}

## Scoring Rubric
${rubric}

## Instructions
Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{"score": <1-5>, "rationale": "<brief explanation>"}`

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: judgePrompt }]
      })
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        score: 0,
        mode: 'claude_judge',
        rationale: `Claude API error ${res.status}: ${truncate(errText, 200)}`
      }
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    // Parse JSON from response — handle possible markdown wrapping
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    return {
      score: Math.max(1, Math.min(5, Math.round(parsed.score))),
      mode: 'claude_judge',
      rationale: parsed.rationale || 'No rationale provided.'
    }
  } catch (err) {
    return {
      score: 0,
      mode: 'claude_judge',
      rationale: `Claude judge failed: ${err.message}`
    }
  }
}

// --- Helpers ---

function truncate(str, maxLen) {
  if (!str) return ''
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
}
