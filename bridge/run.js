/**
 * Bridge process wrapper — enables self-restart.
 *
 * Spawns bridge/index.js as a child process. If it exits with code 75
 * (EX_TEMPFAIL — the "restart requested" signal), respawns it.
 * Any other exit code propagates normally (concurrently sees the wrapper
 * as still running during restarts, so -k doesn't kill vite).
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESTART_CODE = 75
const RESTART_DELAY_MS = 1000

let currentChild = null

function start () {
  const child = spawn('node', [join(__dirname, 'index.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
  })
  currentChild = child

  child.on('close', (code) => {
    currentChild = null
    if (code === RESTART_CODE) {
      console.log(`\n  \x1b[95m◆\x1b[0m \x1b[36mRestarting bridge in ${RESTART_DELAY_MS}ms...\x1b[0m\n`)
      setTimeout(start, RESTART_DELAY_MS)
    } else {
      process.exit(code ?? 1)
    }
  })

  child.on('error', (err) => {
    console.error('Failed to start bridge:', err.message)
    process.exit(1)
  })
}

// Forward signals to current child — registered once to prevent listener accumulation.
// If no child exists (during restart delay), exit cleanly.
process.on('SIGINT', () => currentChild ? currentChild.kill('SIGINT') : process.exit(0))
process.on('SIGTERM', () => currentChild ? currentChild.kill('SIGTERM') : process.exit(0))

start()
