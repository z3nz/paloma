#!/usr/bin/env node
/**
 * Validates Paloma's DNA files and bridge entry point.
 *
 * Catches two classes of bridge-breaking errors:
 *   1. SyntaxError in DNA files (unescaped backticks in template literals)
 *   2. Missing export errors (pillar-manager imports something DNA doesn't export)
 *
 * Called by the pre-commit hook and can be run standalone.
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

// Files that import from DNA — validate their imports resolve
const CONSUMERS = [
  'bridge/pillar-manager.js',
]

let failed = false

// ── Step 1: Validate DNA files parse correctly ──────────────────────

for (const rel of DNA_FILES) {
  const abs = join(ROOT, rel)
  let source
  try {
    source = readFileSync(abs, 'utf8')
  } catch {
    continue
  }

  try {
    await import(abs)
    console.log(`  ✔ ${rel}`)
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`  ✖ ${rel} — SyntaxError: ${err.message}`)

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

      // Scan for common unescaped backtick patterns
      const unescaped = []
      for (let i = 0; i < lines.length; i++) {
        if (/^`[a-zA-Z_]/.test(lines[i])) {
          unescaped.push({ line: i + 1, text: lines[i].trimEnd() })
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
      console.log(`  ⚠ ${rel} — ${err.message} (non-syntax, allowing)`)
    }
  }
}

// ── Step 2: Validate consumer imports resolve ───────────────────────

for (const rel of CONSUMERS) {
  const abs = join(ROOT, rel)
  let source
  try {
    source = readFileSync(abs, 'utf8')
  } catch {
    continue
  }

  // Extract named imports from DNA files
  for (const dnaFile of DNA_FILES) {
    const dnaRel = '../' + dnaFile  // relative from bridge/
    const dnaAbs = join(ROOT, dnaFile)

    // Find import lines that reference this DNA file
    const importRegex = new RegExp(
      `import\\s*\\{([^}]+)\\}\\s*from\\s*['"](?:\\.\\.\\/)?(${dnaFile.replace(/[/.]/g, '\\$&')}|${dnaRel.replace(/[/.]/g, '\\$&')})['"]`
    )
    const match = source.match(importRegex)
    if (!match) continue

    const importedNames = match[1].split(',').map(s => s.trim()).filter(Boolean)

    // Load the DNA module and check each import exists
    let dnaModule
    try {
      dnaModule = await import(dnaAbs)
    } catch {
      // DNA file itself is broken — already caught in step 1
      continue
    }

    for (const name of importedNames) {
      if (!(name in dnaModule)) {
        console.error(`  ✖ ${rel} imports '${name}' from ${dnaFile} — but that export does not exist`)
        console.error(`    Available exports: ${Object.keys(dnaModule).join(', ')}`)
        console.error(`    FIX: Either add 'export const ${name} = ...' to ${dnaFile}, or remove it from the import in ${rel}`)
        failed = true
      }
    }

    if (!failed) {
      console.log(`  ✔ ${rel} → ${dnaFile} imports OK`)
    }
  }
}

// ── Result ──────────────────────────────────────────────────────────

if (failed) {
  console.error('\n  DNA validation FAILED — commit blocked.')
  console.error('  Fix the errors above before committing.\n')
  process.exit(1)
} else {
  console.log('  DNA validation passed.')
}
