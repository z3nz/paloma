#!/usr/bin/env node
/**
 * Validates Paloma's DNA files (src/prompts/base.js, src/prompts/phases.js).
 *
 * These files export template literals. Unescaped backticks inside them
 * cause SyntaxError at import time, which crashes:
 *   - The Vite build (frontend won't compile)
 *   - The bridge (bridge/index.js imports pillar-manager → prompts)
 *   - Everything downstream
 *
 * This script is called by the pre-commit hook and can be run standalone.
 * Exit 0 = clean, Exit 1 = broken.
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DNA_FILES = [
  'src/prompts/base.js',
  'src/prompts/phases.js',
]

let failed = false

for (const rel of DNA_FILES) {
  const abs = join(ROOT, rel)
  let source
  try {
    source = readFileSync(abs, 'utf8')
  } catch {
    // File doesn't exist in this commit — skip
    continue
  }

  // Quick syntactic check: try to evaluate the module source as JS
  // We use dynamic import with a data URI to avoid filesystem caching issues
  try {
    // Node can syntax-check via --check, but for ESM we just try to import
    await import(abs)
    console.log(`  ✔ ${rel}`)
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`  ✖ ${rel} — SyntaxError: ${err.message}`)

      // Try to find the offending line
      const lines = source.split('\n')
      const match = err.message.match(/(\d+):(\d+)/)
      if (match) {
        const lineNum = parseInt(match[1])
        const start = Math.max(0, lineNum - 3)
        const end = Math.min(lines.length, lineNum + 2)
        console.error(`\n    Near line ${lineNum}:`)
        for (let i = start; i < end; i++) {
          const marker = i === lineNum - 1 ? '>>>' : '   '
          console.error(`    ${marker} ${i + 1}: ${lines[i]}`)
        }
      }

      // Extra: scan for common unescaped backtick patterns
      const unescaped = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Line starts with backtick (very likely unescaped inline code)
        if (/^`[a-zA-Z_]/.test(line)) {
          unescaped.push({ line: i + 1, text: line.trimEnd() })
        }
      }
      if (unescaped.length > 0) {
        console.error(`\n    Likely unescaped backticks:`)
        for (const u of unescaped) {
          console.error(`      Line ${u.line}: ${u.text}`)
        }
      }

      console.error(`\n    FIX: Escape all backticks inside template literals: \` → \\\``)
      failed = true
    } else {
      // Non-syntax errors (missing deps, etc.) — don't block commit
      console.log(`  ⚠ ${rel} — ${err.message} (non-syntax, allowing)`)
    }
  }
}

if (failed) {
  console.error('\n  DNA validation FAILED — commit blocked.')
  console.error('  base.js and phases.js are template literals.')
  console.error('  ALL backticks inside them must be escaped: ` → \\`\n')
  process.exit(1)
} else {
  console.log('  DNA validation passed.')
}
