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

function start () {
  const child = spawn('node', [join(__dirname, 'index.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
  })

  child.on('close', (code) => {
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

  // Forward signals to child
  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
}

start()
