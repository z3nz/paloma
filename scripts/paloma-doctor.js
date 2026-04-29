#!/usr/bin/env node

/**
 * paloma-doctor.js — Paloma diagnostics script
 *
 * Checks system health and prints a colored report.
 * No external dependencies — uses only Node.js built-ins.
 *
 * Usage: node scripts/paloma-doctor.js
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir, platform, arch, release } from 'os'

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const isColorSupported = process.stdout.isTTY !== false && !process.env.NO_COLOR

const c = {
  reset:   isColorSupported ? '\x1b[0m'  : '',
  bold:    isColorSupported ? '\x1b[1m'   : '',
  dim:     isColorSupported ? '\x1b[2m'   : '',
  green:   isColorSupported ? '\x1b[32m'  : '',
  yellow:  isColorSupported ? '\x1b[33m'  : '',
  red:     isColorSupported ? '\x1b[31m'  : '',
  cyan:    isColorSupported ? '\x1b[36m'  : '',
  magenta: isColorSupported ? '\x1b[35m'  : '',
}

const PASS = `${c.green}\u2714${c.reset}`
const WARN = `${c.yellow}\u26A0${c.reset}`
const FAIL = `${c.red}\u2718${c.reset}`

function header(title) {
  console.log()
  console.log(`${c.cyan}${c.bold}── ${title} ──${c.reset}`)
}

function pass(msg) { console.log(`  ${PASS}  ${msg}`); counts.passed++ }
function warn(msg) { console.log(`  ${WARN}  ${c.yellow}${msg}${c.reset}`); counts.warnings++ }
function fail(msg) { console.log(`  ${FAIL}  ${c.red}${msg}${c.reset}`); counts.failures++ }
function info(msg) { console.log(`     ${c.dim}${msg}${c.reset}`) }

const counts = { passed: 0, warnings: 0, failures: 0 }

// ---------------------------------------------------------------------------
// Shell helper — runs a command, returns stdout string or null on failure
// ---------------------------------------------------------------------------

function run(cmd, { timeout = 10000, cwd } = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    }).trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const PALOMA_HOME = process.env.PALOMA_HOME || join(homedir(), '.paloma')
const PALOMA_APP  = join(PALOMA_HOME, 'app')
const PALOMA_NODE = join(PALOMA_HOME, 'node', 'bin', 'node')

// Detect if we're running from a dev checkout (the repo root) vs installed app
const scriptDir = resolve(new URL('.', import.meta.url).pathname)
const repoRoot  = resolve(scriptDir, '..')
const isDevCheckout = existsSync(join(repoRoot, 'bridge', 'index.js')) && existsSync(join(repoRoot, 'package.json'))
const appDir = existsSync(PALOMA_APP) ? PALOMA_APP : (isDevCheckout ? repoRoot : null)

// ---------------------------------------------------------------------------
// Check: OS / Platform
// ---------------------------------------------------------------------------

function checkOsPlatform() {
  header('OS / Platform')

  const os = platform()
  const architecture = arch()
  const kernel = release()
  pass(`OS: ${os} (${architecture})`)
  info(`Kernel: ${kernel}`)

  // WSL2 detection
  const procVersion = run('cat /proc/version 2>/dev/null')
  if (procVersion && /microsoft/i.test(procVersion)) {
    pass('WSL2 detected')
  } else if (os === 'linux') {
    info('Not running under WSL2')
  }

  // Hostname
  const hostname = run('hostname')
  if (hostname) info(`Hostname: ${hostname}`)
}

// ---------------------------------------------------------------------------
// Check: Install Metadata
// ---------------------------------------------------------------------------

function checkInstallMetadata() {
  header('Install Metadata')

  const metaPath = join(PALOMA_HOME, 'install-metadata.json')
  if (!existsSync(metaPath)) {
    warn('No install-metadata.json found (manual/dev install?)')
    return
  }

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    pass(`Installed version: ${meta.version || 'unknown'}`)
    if (meta.date) info(`Install date: ${meta.date}`)
    if (meta.method) info(`Install method: ${meta.method}`)
    if (meta.nodeVersion) info(`Installed Node.js: ${meta.nodeVersion}`)
    if (meta.os) info(`Installed OS: ${meta.os} / ${meta.arch || ''}`)
  } catch (e) {
    warn(`install-metadata.json exists but failed to parse: ${e.message}`)
  }
}

// ---------------------------------------------------------------------------
// Check: Node.js
// ---------------------------------------------------------------------------

function checkNodeJs() {
  header('Node.js')

  // Check managed Node.js
  if (existsSync(PALOMA_NODE)) {
    const version = run(`"${PALOMA_NODE}" --version`)
    if (version) {
      pass(`Managed Node.js: ${version} (${PALOMA_NODE})`)
    } else {
      fail(`Managed Node.js binary exists but failed to run: ${PALOMA_NODE}`)
    }
  } else {
    warn(`Managed Node.js not found at ${PALOMA_NODE}`)
    // Fall back to system Node.js info
    const sysVersion = run('node --version')
    if (sysVersion) {
      pass(`System Node.js: ${sysVersion}`)
    } else {
      fail('No Node.js found (managed or system)')
      info('Install with: curl -fsSL https://raw.githubusercontent.com/z3nz/paloma/main/install.sh | bash')
    }
  }

  // Check running Node.js version
  const major = parseInt(process.versions.node.split('.')[0], 10)
  if (major >= 20) {
    pass(`Running Node.js: v${process.versions.node}`)
  } else {
    warn(`Running Node.js v${process.versions.node} — version 20+ recommended`)
  }
}

// ---------------------------------------------------------------------------
// Check: npm packages
// ---------------------------------------------------------------------------

function checkNpmPackages() {
  header('npm Packages')

  if (!appDir) {
    fail('Cannot locate Paloma app directory')
    return
  }

  const nodeModules = join(appDir, 'node_modules')
  if (!existsSync(nodeModules)) {
    fail('node_modules/ does not exist — run: npm install')
    return
  }

  pass('node_modules/ exists')

  // Check for missing deps
  const npmBin = existsSync(join(PALOMA_HOME, 'node', 'bin', 'npm'))
    ? join(PALOMA_HOME, 'node', 'bin', 'npm')
    : 'npm'

  const lsOutput = run(`"${npmBin}" ls --depth=0 2>&1`, { cwd: appDir })
  if (lsOutput) {
    const missingLines = lsOutput.split('\n').filter(l => /MISSING|ERR!|missing:/i.test(l))
    if (missingLines.length === 0) {
      pass('All dependencies installed')
    } else {
      warn(`Missing dependencies detected (${missingLines.length} issue(s))`)
      for (const line of missingLines.slice(0, 5)) {
        info(line.trim())
      }
      info('Fix with: npm install')
    }
  }
}

// ---------------------------------------------------------------------------
// Check: Ports (19191 and 19192)
// ---------------------------------------------------------------------------

function checkPorts() {
  header('Ports')

  const ports = [
    { port: 19191, name: 'Bridge (WebSocket + HTTP)' },
    { port: 19192, name: 'MCP Proxy (SSE + HTTP)' },
  ]

  for (const { port: p, name } of ports) {
    // Try lsof first, then ss
    let pidLine = run(`lsof -i :${p} -sTCP:LISTEN -P -n 2>/dev/null`)
    let usingSs = false

    if (!pidLine) {
      pidLine = run(`ss -tlnp 'sport = :${p}' 2>/dev/null`)
      usingSs = true
    }

    // Determine if something is listening
    const hasListener = pidLine && pidLine.split('\n').length > 1

    if (hasListener) {
      const isPaloma = /node/i.test(pidLine)
      if (isPaloma) {
        pass(`Port ${p} — ${name} (Paloma is running)`)
        // Show the process line
        const lines = pidLine.split('\n')
        if (lines[1]) info(lines[1].trim())
      } else {
        warn(`Port ${p} — ${name} is occupied by another process`)
        const lines = pidLine.split('\n')
        for (const line of lines.slice(1, 3)) {
          info(line.trim())
        }
      }
    } else {
      pass(`Port ${p} — ${name} is available`)
    }
  }
}

// ---------------------------------------------------------------------------
// Check: AI Backends
// ---------------------------------------------------------------------------

function checkAiBackends() {
  header('AI Backends')

  const backends = [
    {
      name: 'Claude CLI',
      cmd: 'claude --version 2>/dev/null',
      install: 'npm install -g @anthropic-ai/claude-code',
    },
    {
      name: 'Codex CLI',
      cmd: 'codex --version 2>/dev/null',
      install: 'npm install -g @openai/codex',
    },
    {
      name: 'GitHub Copilot',
      cmd: 'which copilot 2>/dev/null || gh copilot --version 2>/dev/null',
      install: 'Install Copilot CLI and run: copilot login',
    },
    {
      name: 'Gemini CLI',
      cmd: 'which gemini 2>/dev/null',
      install: 'npm install -g @google/gemini-cli',
    },
    {
      name: 'Ollama',
      cmd: 'ollama --version 2>/dev/null',
      install: 'curl -fsSL https://ollama.com/install.sh | sh',
    },
  ]

  let found = 0
  for (const backend of backends) {
    const version = run(backend.cmd)
    if (version) {
      pass(`${backend.name}: ${version.split('\n')[0]}`)
      found++
    } else {
      warn(`${backend.name}: not found`)
      info(`Install: ${backend.install}`)
    }
  }

  if (found === 0) {
    warn('No AI backends detected — install at least one to use Paloma')
  }
}

// ---------------------------------------------------------------------------
// Check: MCP Config
// ---------------------------------------------------------------------------

function checkMcpConfig() {
  header('MCP Config')

  const mcpSettingsPath = join(PALOMA_HOME, 'mcp-settings.json')
  if (!existsSync(mcpSettingsPath)) {
    warn('mcp-settings.json not found')
    info(`Expected at: ${mcpSettingsPath}`)
    info('Generate with: bash scripts/setup-mcp.sh')
    return
  }

  pass('mcp-settings.json exists')

  try {
    const raw = readFileSync(mcpSettingsPath, 'utf8')
    const config = JSON.parse(raw)

    // Check for placeholder API keys
    const placeholders = []
    const checkValue = (key, value) => {
      if (typeof value === 'string') {
        const lower = value.toLowerCase()
        if (
          value === '' ||
          lower === 'your_key_here' ||
          lower === 'your-key-here' ||
          lower === 'placeholder' ||
          lower === 'xxx' ||
          lower === 'changeme' ||
          /^sk-[.x]+$/i.test(value)
        ) {
          placeholders.push(key)
        }
      }
    }

    // Walk the config looking for env vars / keys
    const walk = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key
        if (typeof value === 'string' && /key|token|secret|password/i.test(key)) {
          checkValue(fullPath, value)
        } else if (typeof value === 'object') {
          walk(value, fullPath)
        }
      }
    }
    walk(config)

    if (placeholders.length > 0) {
      warn(`Placeholder API keys detected (${placeholders.length}):`)
      for (const p of placeholders) {
        info(`  ${p}`)
      }
      info(`Edit: ${mcpSettingsPath}`)
    } else {
      pass('No placeholder API keys detected')
    }
  } catch (e) {
    warn(`Failed to parse mcp-settings.json: ${e.message}`)
  }

  // Check mcp.json (permissions)
  const mcpJsonCandidates = [
    appDir ? join(appDir, '.paloma', 'mcp.json') : null,
    join(PALOMA_HOME, 'mcp.json')
  ].filter(Boolean)
  const mcpJsonPath = mcpJsonCandidates.find(p => existsSync(p))
  if (mcpJsonPath) {
    pass('mcp.json (permissions) exists')
    info(`Using: ${mcpJsonPath}`)
  } else {
    info('mcp.json (permissions) not found — will use defaults')
  }
}

// ---------------------------------------------------------------------------
// Check: Python / Voice
// ---------------------------------------------------------------------------

function checkPythonVoice() {
  header('Python / Voice (Optional)')

  // Python 3
  const pythonVersion = run('python3 --version 2>&1')
  if (pythonVersion) {
    const match = pythonVersion.match(/(\d+)\.(\d+)/)
    if (match) {
      const major = parseInt(match[1], 10)
      const minor = parseInt(match[2], 10)
      if (major >= 3 && minor >= 10) {
        pass(`Python: ${pythonVersion}`)
      } else {
        warn(`${pythonVersion} — version 3.10+ required for voice`)
      }
    } else {
      pass(`Python: ${pythonVersion}`)
    }
  } else {
    warn('python3 not found — required for voice/TTS')
    info('Install: sudo apt install python3 python3-venv  (or equivalent)')
  }

  // Kokoro venv — check multiple possible locations
  const kokoroLocations = [
    join(PALOMA_HOME, 'kokoro_env'),
    appDir ? join(appDir, 'kokoro_env') : null,
  ].filter(Boolean)

  let kokoroFound = false
  for (const loc of kokoroLocations) {
    if (existsSync(loc)) {
      const pythonBin = join(loc, 'bin', 'python')
      if (existsSync(pythonBin)) {
        pass(`Voice venv: ${loc}`)
      } else {
        warn(`Voice venv directory exists but missing python binary: ${loc}`)
      }
      kokoroFound = true
      break
    }
  }

  if (!kokoroFound) {
    info('Voice TTS venv (kokoro_env/) not found — voice features unavailable')
    info('Setup with: paloma setup voice (coming soon)')
  }
}

// ---------------------------------------------------------------------------
// Check: Git Repository
// ---------------------------------------------------------------------------

function checkGitRepo() {
  header('Git Repository')

  if (!appDir) {
    fail('Cannot locate Paloma app directory')
    return
  }

  const gitDir = join(appDir, '.git')
  if (!existsSync(gitDir)) {
    fail(`${appDir} is not a git repository`)
    return
  }

  pass('Git repository detected')

  // Current branch
  const branch = run('git rev-parse --abbrev-ref HEAD', { cwd: appDir })
  if (branch) {
    pass(`Branch: ${branch}`)
  }

  // Try to fetch and check how far behind
  run('git fetch --quiet 2>&1', { cwd: appDir })

  const behindCount = run('git rev-list --count HEAD..@{u} 2>/dev/null', { cwd: appDir })
  if (behindCount !== null) {
    const n = parseInt(behindCount, 10)
    if (n === 0) {
      pass('Up to date with remote')
    } else {
      warn(`${n} commit(s) behind remote — run: paloma update`)
    }
  } else {
    info('Could not determine remote tracking status')
  }

  // Last commit
  const lastCommit = run('git log -1 --oneline 2>/dev/null', { cwd: appDir })
  if (lastCommit) {
    info(`Last commit: ${lastCommit}`)
  }
}

// ---------------------------------------------------------------------------
// Check: Disk Space
// ---------------------------------------------------------------------------

function checkDiskSpace() {
  header('Disk Space')

  // Size of ~/.paloma/
  if (existsSync(PALOMA_HOME)) {
    const duOutput = run(`du -sh "${PALOMA_HOME}" 2>/dev/null`)
    if (duOutput) {
      const size = duOutput.split(/\s/)[0]
      pass(`${PALOMA_HOME} usage: ${size}`)
    }
  } else {
    info(`${PALOMA_HOME} does not exist yet`)
  }

  // Free disk space on the relevant partition
  const target = appDir || PALOMA_HOME || homedir()
  const dfOutput = run(`df -h "${target}" 2>/dev/null | tail -1`)
  if (dfOutput) {
    const parts = dfOutput.split(/\s+/)
    // df -h output: filesystem size used avail use% mount
    const avail = parts[3]
    const usePercent = parts[4]
    if (avail) {
      const availNum = parseFloat(avail)
      const unit = avail.replace(/[\d.]/g, '').toUpperCase()
      const isLow = (unit === 'M' || (unit === 'G' && availNum < 2))
      if (isLow) {
        warn(`Free disk space: ${avail} (${usePercent} used) — low!`)
      } else {
        pass(`Free disk space: ${avail} (${usePercent} used)`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log()
  console.log(`${c.magenta}${c.bold}  Paloma Doctor${c.reset}`)
  console.log(`${c.dim}  System health diagnostics${c.reset}`)

  checkOsPlatform()
  checkInstallMetadata()
  checkNodeJs()
  checkNpmPackages()
  checkPorts()
  checkAiBackends()
  checkMcpConfig()
  checkPythonVoice()
  checkGitRepo()
  checkDiskSpace()

  // Summary
  console.log()
  console.log(`${c.bold}── Summary ──${c.reset}`)
  const parts = []
  parts.push(`${c.green}${counts.passed} passed${c.reset}`)
  if (counts.warnings > 0) parts.push(`${c.yellow}${counts.warnings} warnings${c.reset}`)
  if (counts.failures > 0) parts.push(`${c.red}${counts.failures} failures${c.reset}`)
  console.log(`  ${parts.join(', ')}`)

  if (counts.failures > 0) {
    console.log()
    console.log(`  ${c.red}Some critical checks failed. Please fix the issues above.${c.reset}`)
    process.exit(1)
  } else if (counts.warnings > 0) {
    console.log()
    console.log(`  ${c.yellow}All critical checks passed, but some optional components need attention.${c.reset}`)
  } else {
    console.log()
    console.log(`  ${c.green}All checks passed! Paloma is healthy.${c.reset}`)
  }

  console.log()
}

main()
