/**
 * Paloma Supervisor — top-level process manager.
 *
 * Replaces concurrently + bridge/run.js. Manages the full lifecycle:
 *   1. Builds frontend (vite build)
 *   2. Spawns static-server.js to serve dist/ on :5173
 *   3. Forks bridge/index.js with IPC channel on :19191
 *
 * Process tree:
 *   paloma-supervisor.js (PID 1 — never dies)
 *   ├── npm run build (runs before each bridge start)
 *   ├── static-server.js (serves dist/ on :5173, restarted after rebuild)
 *   └── bridge/index.js (restarted on crash or external signal)
 *
 * Exit codes:
 *   75 (EX_TEMPFAIL) — bridge restart signal (used by SIGUSR1 / git hooks)
 *   0 — graceful shutdown, don't respawn
 *   anything else — unexpected crash, respawn after 1s delay
 */

import { execSync, spawn, fork } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BRIDGE_PATH = join(ROOT, 'bridge', 'index.js')
const STATIC_SERVER_PATH = join(__dirname, 'static-server.js')

const RESTART_CODE = 75
const CRASH_RESPAWN_DELAY_MS = 1000         // 1s delay after unexpected crash

let staticServer = null
let bridge = null
let shuttingDown = false

// ── Logging ──────────────────────────────────────────────────────────

function log(msg) {
  console.log(`  \x1b[95m◆\x1b[0m \x1b[2m[supervisor]\x1b[0m ${msg}`)
}

function logError(msg) {
  console.error(`  \x1b[31m✖\x1b[0m \x1b[2m[supervisor]\x1b[0m ${msg}`)
}

// ── Frontend Build ───────────────────────────────────────────────────

function buildFrontend() {
  log('Building frontend...')
  execSync('npx vite build', { stdio: 'inherit', cwd: ROOT })
  log('Frontend build complete.')
}

// ── Static Server ────────────────────────────────────────────────────

function spawnStaticServer() {
  if (staticServer) {
    staticServer.kill('SIGTERM')
    staticServer = null
  }

  staticServer = spawn('node', [STATIC_SERVER_PATH], {
    stdio: 'inherit',
    cwd: ROOT
  })

  staticServer.on('error', (err) => {
    logError(`Static server error: ${err.message}`)
  })

  staticServer.on('close', (code) => {
    if (!shuttingDown) {
      log(`Static server exited (code ${code})`)
    }
    staticServer = null
  })
}

// ── Bridge ───────────────────────────────────────────────────────────

function spawnBridge() {
  // fork() creates an IPC channel automatically
  bridge = fork(BRIDGE_PATH, process.argv.slice(2), {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    cwd: ROOT
  })

  bridge.on('error', (err) => {
    logError(`Bridge error: ${err.message}`)
  })

  bridge.on('close', (code) => {
    bridge = null

    if (shuttingDown) return

    if (code === RESTART_CODE) {
      // External restart (SIGUSR1 / git hook) — rebuild and respawn
      log('Bridge exited with restart code (external trigger) — rebuilding...')
      try {
        buildFrontend()
        spawnStaticServer()
      } catch (err) {
        logError(`Rebuild failed: ${err.message}`)
      }
      spawnBridge()
    } else if (code !== 0) {
      // Unexpected crash — respawn without rebuilding
      logError(`Bridge crashed (code ${code}) — respawning in ${CRASH_RESPAWN_DELAY_MS}ms...`)
      setTimeout(() => {
        if (!shuttingDown) {
          spawnBridge()
        }
      }, CRASH_RESPAWN_DELAY_MS)
    } else {
      // Graceful shutdown (code 0) — don't respawn
      log('Bridge exited gracefully (code 0).')
    }
  })
}

// ── Shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  log(`${signal} received — shutting down...`)

  if (bridge) bridge.kill('SIGTERM')
  if (staticServer) staticServer.kill('SIGTERM')

  // Give children 5s to exit, then force kill
  setTimeout(() => {
    if (bridge) bridge.kill('SIGKILL')
    if (staticServer) staticServer.kill('SIGKILL')
    process.exit(0)
  }, 5000)

  // If both exit quickly, don't wait
  let exited = 0
  const total = (bridge ? 1 : 0) + (staticServer ? 1 : 0)
  if (total === 0) process.exit(0)

  const checkExit = () => {
    exited++
    if (exited >= total) process.exit(0)
  }

  if (bridge) bridge.on('close', checkExit)
  if (staticServer) staticServer.on('close', checkExit)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  log('Paloma Supervisor starting...')

  // Step 1: Build frontend
  buildFrontend()

  // Step 2: Spawn static server
  spawnStaticServer()

  // Step 3: Fork bridge with IPC
  spawnBridge()

  log('All processes running.')
}

main()
