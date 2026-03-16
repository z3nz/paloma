/**
 * Paloma Supervisor — top-level process manager.
 *
 * Replaces concurrently + bridge/run.js. Manages the full lifecycle:
 *   1. Builds frontend (vite build)
 *   2. Spawns static-server.js to serve dist/ on :5173
 *   3. Forks bridge/index.js with IPC channel on :19191
 *   4. Auto-restarts bridge every 30 minutes with graceful idle checking
 *
 * Process tree:
 *   paloma-supervisor.js (PID 1 — never dies)
 *   ├── npm run build (runs before each bridge start)
 *   ├── static-server.js (serves dist/ on :5173, restarted after rebuild)
 *   └── bridge/index.js (restarted every 30 min)
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
const RESTART_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const IDLE_CHECK_TIMEOUT_MS = 10_000        // 10s to respond to idle check
const IDLE_RETRY_DELAY_MS = 30_000          // 30s between idle retries
const IDLE_MAX_RETRIES = 10                 // 5 min grace period (10 × 30s)
const CRASH_RESPAWN_DELAY_MS = 1000         // 1s delay after unexpected crash

let staticServer = null
let bridge = null
let restartTimer = null
let restartInProgress = false
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

    if (code === RESTART_CODE && !restartInProgress) {
      // External restart (SIGUSR1 / git hook) — rebuild and respawn
      log('Bridge exited with restart code (external trigger) — rebuilding...')
      clearRestartTimer()
      try {
        buildFrontend()
        spawnStaticServer()
      } catch (err) {
        logError(`Rebuild failed: ${err.message}`)
      }
      spawnBridge()
      scheduleRestart()
    } else if (code === RESTART_CODE && restartInProgress) {
      // Expected exit during our restart cycle — handled by restartCycle()
      return
    } else if (code !== 0) {
      // Unexpected crash — respawn without rebuilding
      logError(`Bridge crashed (code ${code}) — respawning in ${CRASH_RESPAWN_DELAY_MS}ms...`)
      setTimeout(() => {
        if (!shuttingDown) {
          spawnBridge()
          scheduleRestart()
        }
      }, CRASH_RESPAWN_DELAY_MS)
    } else {
      // Graceful shutdown (code 0) — don't respawn
      log('Bridge exited gracefully (code 0).')
    }
  })
}

// ── Idle Check via IPC ───────────────────────────────────────────────

function checkBridgeIdle() {
  return new Promise((resolve) => {
    if (!bridge || !bridge.connected) {
      resolve(0) // No bridge or disconnected — treat as idle
      return
    }

    const timeout = setTimeout(() => {
      bridge.removeListener('message', handler)
      log('Idle check timed out — assuming busy')
      resolve(1) // Assume busy on timeout
    }, IDLE_CHECK_TIMEOUT_MS)

    function handler(msg) {
      if (msg?.type === 'idle_status') {
        clearTimeout(timeout)
        bridge.removeListener('message', handler)
        resolve(msg.active)
      }
    }

    bridge.on('message', handler)
    bridge.send({ type: 'idle_check' })
  })
}

// ── Restart Cycle ────────────────────────────────────────────────────

async function restartCycle() {
  if (restartInProgress || shuttingDown) return
  restartInProgress = true

  log('30-minute restart cycle starting...')

  // Check if bridge is idle, with retries
  let active = await checkBridgeIdle()

  if (active > 0) {
    log(`Bridge has ${active} active session(s) — waiting for idle (5 min grace)...`)

    for (let attempt = 1; attempt <= IDLE_MAX_RETRIES; attempt++) {
      await sleep(IDLE_RETRY_DELAY_MS)
      if (shuttingDown) { restartInProgress = false; return }

      active = await checkBridgeIdle()
      if (active === 0) {
        log('Bridge is now idle.')
        break
      }
      log(`Retry ${attempt}/${IDLE_MAX_RETRIES}: still ${active} active session(s)...`)
    }

    if (active > 0) {
      log(`Grace period expired — proceeding with restart (${active} session(s) still active)`)
    }
  } else {
    log('Bridge is idle.')
  }

  if (shuttingDown) { restartInProgress = false; return }

  // Tell bridge to notify browsers and shut down
  if (bridge && bridge.connected) {
    log('Sending prepare_restart to bridge...')
    bridge.send({ type: 'prepare_restart' })

    // Wait for bridge to exit (it exits with code 75 after 3s)
    await waitForBridgeExit()
  }

  // Rebuild frontend
  try {
    buildFrontend()
  } catch (err) {
    logError(`Frontend build failed: ${err.message}`)
    // Continue anyway — serve the old build
  }

  // Restart static server (picks up new dist/)
  spawnStaticServer()

  // Restart bridge
  spawnBridge()

  restartInProgress = false
  scheduleRestart()

  log('Restart cycle complete.')
}

function waitForBridgeExit() {
  return new Promise((resolve) => {
    if (!bridge) { resolve(); return }

    const timeout = setTimeout(() => {
      log('Bridge did not exit within 10s — force killing...')
      if (bridge) bridge.kill('SIGKILL')
      resolve()
    }, 10_000)

    bridge.on('close', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

// ── Timer Management ─────────────────────────────────────────────────

function scheduleRestart() {
  clearRestartTimer()
  restartTimer = setTimeout(() => restartCycle(), RESTART_INTERVAL_MS)
  const nextRestart = new Date(Date.now() + RESTART_INTERVAL_MS).toLocaleTimeString()
  log(`Next restart at ${nextRestart}`)
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
}

// ── Shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  log(`${signal} received — shutting down...`)
  clearRestartTimer()

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

// ── Utilities ────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  log('Paloma Supervisor starting...')

  // Step 1: Build frontend
  buildFrontend()

  // Step 2: Spawn static server
  spawnStaticServer()

  // Step 3: Fork bridge with IPC
  spawnBridge()

  // Step 4: Schedule first restart
  scheduleRestart()

  log('All processes running.')
}

main()
