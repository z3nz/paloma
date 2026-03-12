/**
 * Startup UX — Banner, progress, summary, and shutdown visuals.
 *
 * All terminal visual output lives here. Uses raw ANSI escape codes
 * (zero dependencies). TTY-aware: animated spinners when running
 * standalone, static step log when piped through concurrently.
 */

// ── Colors ──────────────────────────────────────────────────────────
const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  blue:     '\x1b[34m',
  magenta:  '\x1b[35m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  bmagenta: '\x1b[95m',
  bcyan:    '\x1b[96m',
  bwhite:   '\x1b[97m',
}

const col = (color, text) => `${color}${text}${C.reset}`

// ── Banner ──────────────────────────────────────────────────────────

const BANNER = `
${C.bmagenta}██████╗  █████╗ ██╗      ██████╗ ███╗   ███╗ █████╗${C.reset}
${C.bmagenta}██╔══██╗██╔══██╗██║     ██╔═══██╗████╗ ████║██╔══██╗${C.reset}
${C.bmagenta}██████╔╝███████║██║     ██║   ██║██╔████╔██║███████║${C.reset}
${C.bmagenta}██╔═══╝ ██╔══██║██║     ██║   ██║██║╚██╔╝██║██╔══██║${C.reset}
${C.bmagenta}██║     ██║  ██║███████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║${C.reset}
${C.bmagenta}╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝${C.reset}
${C.dim}                 AI Development Partner${C.reset}`

export function printBanner() {
  console.log(BANNER)
  console.log()
}

// ── Step Logger ─────────────────────────────────────────────────────

export function stepOk(label, detail = '') {
  const det = detail ? col(C.dim, ` ${detail}`) : ''
  console.log(`  ${col(C.green, '✔')} ${label}${det}`)
}

export function stepFail(label, detail = '') {
  const det = detail ? col(C.dim, ` ${detail}`) : ''
  console.log(`  ${col(C.red, '✖')} ${label}${det}`)
}

export function stepInfo(label, detail = '') {
  const det = detail ? col(C.dim, ` ${detail}`) : ''
  console.log(`  ${col(C.cyan, '●')} ${label}${det}`)
}

export function stepWarn(label, detail = '') {
  const det = detail ? col(C.dim, ` ${detail}`) : ''
  console.log(`  ${col(C.yellow, '▲')} ${label}${det}`)
}

// ── Startup Summary ─────────────────────────────────────────────────

export function printSummary({ serverCount, toolCount, failedCount, wsPort, proxyPort, emailWatcher, startTime }) {
  console.log()

  if (failedCount === 0) {
    stepOk(col(C.bold, 'All systems nominal'), `${serverCount} servers · ${toolCount} tools`)
  } else {
    stepWarn(col(C.bold, `${serverCount - failedCount}/${serverCount} servers ready`), `${toolCount} tools · ${failedCount} failed`)
  }

  stepOk('WebSocket bridge', col(C.bcyan, `ws://localhost:${wsPort}`))
  stepOk('MCP proxy', col(C.bcyan, `localhost:${proxyPort}`))

  if (emailWatcher) {
    stepOk('Email watcher', 'polling every 30s')
  } else {
    stepWarn('Email watcher', 'Gmail not configured')
  }

  if (startTime) {
    const elapsed = Date.now() - startTime
    console.log(`\n  ${col(C.dim, `Ready in ${elapsed}ms`)}`)
  }

  console.log()
}

// ── Shutdown ────────────────────────────────────────────────────────

export function printShutdown() {
  console.log()
  console.log(`  ${col(C.bmagenta, '◆')} ${col(C.dim, 'Paloma shutting down...')}`)
  console.log()
}
