# Scout: Epic Terminal Startup Research

**Date:** 2026-03-12
**Scope:** Paloma bridge startup UX — ANSI codes, progress bars, ASCII art, box drawing, concurrently behavior
**Feeds into:** Chart → `active-20260312-paloma-epic-server-startup.md`

---

## 1. ANSI Escape Code Reference

All ANSI codes use the format: `\x1b[{code}m` (where `\x1b` is ESC, decimal 27).
Aliases: `\x1b` = `\033` = `\u001b` — all identical.

**The golden rule:** Always end with `\x1b[0m` (reset) to avoid color bleeding.

### Text Style Codes

| Effect       | Code | Example                          |
|-------------|------|----------------------------------|
| Reset        | 0    | `\x1b[0m`                        |
| Bold         | 1    | `\x1b[1m`                        |
| Dim/Faint    | 2    | `\x1b[2m`                        |
| Italic       | 3    | `\x1b[3m`                        |
| Underline    | 4    | `\x1b[4m`                        |
| Blink        | 5    | `\x1b[5m`                        |
| Reverse/Invert| 7   | `\x1b[7m`                        |
| Strikethrough| 9    | `\x1b[9m`                        |

### Text Color Codes (Foreground)

| Color          | Normal | Bright |
|----------------|--------|--------|
| Black          | 30     | 90     |
| Red            | 31     | 91     |
| Green          | 32     | 92     |
| Yellow         | 33     | 93     |
| Blue           | 34     | 94     |
| Magenta        | 35     | 95     |
| Cyan           | 36     | 96     |
| White          | 37     | 97     |

### Background Color Codes

| Color          | Normal | Bright |
|----------------|--------|--------|
| Black          | 40     | 100    |
| Red            | 41     | 101    |
| Green          | 42     | 102    |
| Yellow         | 43     | 103    |
| Blue           | 44     | 104    |
| Magenta        | 45     | 105    |
| Cyan           | 46     | 106    |
| White          | 47     | 107    |

### 256-Color & True Color

```js
// 256-color (text): \x1b[38;5;{n}m   — n = 0-255
// 256-color (bg):   \x1b[48;5;{n}m
// Truecolor (text): \x1b[38;2;R;G;Bm
// Truecolor (bg):   \x1b[48;2;R;G;Bm

// Examples:
'\x1b[38;5;208m'         // orange (256-color)
'\x1b[38;2;255;165;0m'   // orange (truecolor)
'\x1b[48;2;30;30;50m'    // dark navy background
```

### Ready-to-Use Color Helper (Zero Dependencies)

```js
// bridge/startup.js — color utilities
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  // Normal colors
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  // Bright colors
  bred:    '\x1b[91m',
  bgreen:  '\x1b[92m',
  byellow: '\x1b[93m',
  bblue:   '\x1b[94m',
  bmagenta:'\x1b[95m',
  bcyan:   '\x1b[96m',
  bwhite:  '\x1b[97m',
  // Backgrounds
  bgBlue:  '\x1b[44m',
  bgCyan:  '\x1b[46m',
}

// Helper: wrap text in color + reset
const col = (color, text) => `${color}${text}${C.reset}`

// Usage:
// col(C.cyan, 'hello')   → cyan "hello" then reset
// col(C.bold + C.green, 'OK') → bold green "OK"
```

---

## 2. Progress Bar & Spinner Patterns

### 2a. Basic Spinner (TTY-Only)

```js
const SPINNER_BRAILLE = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
const SPINNER_DOTS    = ['⣾','⣽','⣻','⢿','⡿','⣟','⣯','⣷']
const SPINNER_CLASSIC = ['|','/','-','\\']
const SPINNER_ARROWS  = ['←','↖','↑','↗','→','↘','↓','↙']

class Spinner {
  constructor(label, frames = SPINNER_BRAILLE) {
    this.label = label
    this.frames = frames
    this.i = 0
    this.interval = null
  }

  start() {
    if (!process.stdout.isTTY) {
      // Non-TTY: just print a starting message
      process.stdout.write(`  ${this.label}...\n`)
      return this
    }
    this.interval = setInterval(() => {
      const frame = this.frames[this.i++ % this.frames.length]
      process.stdout.write(`\r\x1b[36m${frame}\x1b[0m ${this.label}`)
    }, 80)
    return this
  }

  succeed(msg) {
    this._stop()
    const text = msg || this.label
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[32m✔\x1b[0m ${text}\n`)
    } else {
      process.stdout.write(`  \x1b[32m✔\x1b[0m ${text}\n`)
    }
  }

  fail(msg) {
    this._stop()
    const text = msg || this.label
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[31m✖\x1b[0m ${text}\n`)
    } else {
      process.stdout.write(`  \x1b[31m✖\x1b[0m ${text}\n`)
    }
  }

  _stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[K') // clear line
    }
  }
}
```

### 2b. Block Progress Bar

```js
function renderBar(pct, width = 20) {
  const filled = Math.round(pct * width)
  const empty  = width - filled
  const bar    = '█'.repeat(filled) + '░'.repeat(empty)
  return `\x1b[32m${bar}\x1b[0m ${Math.round(pct * 100)}%`
}

// TTY-only inline update:
// process.stdout.write(`\r  [${renderBar(0.75)}] Loading...`)
// process.stdout.write('\n') // finalize when done

// Alternative bar chars: ▰▱  ████░░  ■□  ●○
```

### 2c. Multi-Line Parallel Progress (TTY-Only)

**Critical insight**: Moving the cursor up N lines requires full TTY control. This is the most impressive pattern but requires proper isTTY guard.

```js
import { createInterface } from 'readline'

class MultiProgress {
  constructor(tasks) {
    this.tasks = tasks.map(t => ({ label: t, status: 'pending', detail: '' }))
    this.isTTY = process.stdout.isTTY
    if (this.isTTY) {
      // Reserve N lines
      this.tasks.forEach(() => process.stdout.write('\n'))
    }
  }

  update(index, status, detail = '') {
    this.tasks[index].status = status
    this.tasks[index].detail = detail
    if (this.isTTY) this._redraw()
    else this._logLine(index)
  }

  _redraw() {
    // Move cursor up to first task line
    process.stdout.write(`\x1b[${this.tasks.length}A`)
    this.tasks.forEach(task => {
      const icon = task.status === 'done'    ? '\x1b[32m✔\x1b[0m'
                 : task.status === 'error'   ? '\x1b[31m✖\x1b[0m'
                 : task.status === 'running' ? '\x1b[36m⠋\x1b[0m'
                 :                            '\x1b[2m·\x1b[0m'
      const detail = task.detail ? `\x1b[2m ${task.detail}\x1b[0m` : ''
      process.stdout.write(`\r\x1b[K  ${icon} ${task.label}${detail}\n`)
    })
  }

  _logLine(index) {
    const task = this.tasks[index]
    const icon = task.status === 'done'  ? '\x1b[32m✔\x1b[0m'
               : task.status === 'error' ? '\x1b[31m✖\x1b[0m'
               :                          '\x1b[36m→\x1b[0m'
    process.stdout.write(`  ${icon} ${task.label}${task.detail ? ': '+task.detail : ''}\n`)
  }
}
```

### 2d. Static Step Log (Works Everywhere — Including Under concurrently)

This is the **recommended pattern for Paloma** given the concurrently constraint.

```js
function log(icon, color, label, detail = '') {
  const det = detail ? `\x1b[2m ${detail}\x1b[0m` : ''
  process.stdout.write(`  ${color}${icon}\x1b[0m ${label}${det}\n`)
}

const S = {
  ok:      (label, detail) => log('✔', '\x1b[32m', label, detail),
  fail:    (label, detail) => log('✖', '\x1b[31m', label, detail),
  info:    (label, detail) => log('●', '\x1b[36m', label, detail),
  warn:    (label, detail) => log('▲', '\x1b[33m', label, detail),
  running: (label, detail) => log('›', '\x1b[35m', label, detail),
}
```

### 2e. Cursor Control (Node.js built-ins — TTY only)

```js
import readline from 'readline'

// Move cursor to column 0 of current line
readline.cursorTo(process.stdout, 0)

// Clear from cursor to end of line
readline.clearLine(process.stdout, 1)

// Clear entire current line
readline.clearLine(process.stdout, 0)

// Move cursor up N lines
readline.moveCursor(process.stdout, 0, -3)

// ANSI equivalents (raw strings, faster):
'\x1b[K'      // clear from cursor to end of line
'\x1b[2K'     // clear entire line
'\x1b[1A'     // move cursor up 1 line
'\x1b[3A'     // move cursor up 3 lines
'\r'          // carriage return (go to column 0)
'\x1b[H'      // move cursor to top-left (home)
'\x1b[2J'     // clear entire screen
```

---

## 3. ASCII Art Banners for "PALOMA"

### Option 1: ANSI Shadow (Unicode Block Characters — Most Impressive)

The figlet "ANSI Shadow" font. Renders at 52 chars wide, 6 lines tall. Uses Unicode box/block chars — renders beautifully in any modern terminal.

```
██████╗  █████╗ ██╗      ██████╗ ███╗   ███╗ █████╗
██╔══██╗██╔══██╗██║     ██╔═══██╗████╗ ████║██╔══██╗
██████╔╝███████║██║     ██║   ██║██╔████╔██║███████║
██╔═══╝ ██╔══██║██║     ██║   ██║██║╚██╔╝██║██╔══██║
██║     ██║  ██║███████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║
╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝
```

Suggested color: `\x1b[95m` (bright magenta) or `\x1b[96m` (bright cyan)

With tagline:
```
██████╗  █████╗ ██╗      ██████╗ ███╗   ███╗ █████╗
██╔══██╗██╔══██╗██║     ██╔═══██╗████╗ ████║██╔══██╗
██████╔╝███████║██║     ██║   ██║██╔████╔██║███████║
██╔═══╝ ██╔══██║██║     ██║   ██║██║╚██╔╝██║██╔══██║
██║     ██║  ██║███████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║
╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝
                   AI Development Partner
```

### Option 2: NestJS-Inspired Standard ASCII (Pure ASCII — Safe Fallback)

Modeled after the actual NestJS banner.ts we retrieved from source. Pure ASCII — safe for any environment.

```
 _   _             _      ___  __  __    _
| \ | |           | |    |   ||  \/  |  / \
|  \| |  ___  ___ | |_    | | | |\/| | / _ \
| . ` | / _ \/ __|| __|   | | | |  | |/ ___ \
| |\  ||  __/\__ \| |_   _| |_| |  | / /   \ \
\_| \_/ \___||___/ \__| |_____|_|  |_/_/    \_\
```

Suggested color: `\x1b[93m` (bright yellow) or `\x1b[97m` (white)

### Option 3: Minimalist Box Banner (Custom Designed — Guaranteed Accurate)

```
╔══════════════════════════════════════════════════╗
║                                                  ║
║   P  A  L  O  M  A                              ║
║   ─────────────────                              ║
║   AI Development Partner                         ║
║   Bridge v1.0  ·  MCP Orchestrator               ║
║                                                  ║
╚══════════════════════════════════════════════════╝
```

### Option 4: Block Letters (Compact, 3-line — Great for concurrently output)

```
 ██████  ████  █       ███  ██████  ████
 ██  ██  █  █  █      █  █  █  ██  █  ██
 ██████  ████  █████  ████  ██  ██  ████
```

### Option 5: Symbolic / Elegant One-Liner

For contexts where multi-line banners are too large (e.g., under concurrently prefix):

```
◆ PALOMA  ·  AI Development Partner  ·  v1.0
```

With ANSI: `\x1b[95m◆ PALOMA\x1b[0m  \x1b[2m·  AI Development Partner  ·  v1.0\x1b[0m`

---

**Note:** To generate additional styles, visit https://patorjk.com/software/taag/ or install `figlet` locally:
```bash
npx figlet -f "ANSI Shadow" PALOMA
npx figlet -f "Slant" PALOMA
npx figlet -f "Big" PALOMA
```

---

## 4. Box Drawing Character Reference

### Light Lines
```
─  │  ┌  ┐  └  ┘  ├  ┤  ┬  ┴  ┼
```
Full set: `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ╌ ╍ ╎ ╏`

### Heavy Lines
```
━  ┃  ┏  ┓  ┗  ┛  ┣  ┫  ┳  ┻  ╋
```

### Double Lines
```
═  ║  ╔  ╗  ╚  ╝  ╠  ╣  ╦  ╩  ╬
```

### Mixed (Double/Single)
```
╒  ╕  ╘  ╛  ╞  ╡  ╤  ╧  ╪
╓  ╖  ╙  ╜  ╟  ╢  ╥  ╨  ╫
```

### Rounded Corners
```
╭  ╮  ╯  ╰
```
Use case: `╭──────────╮\n│  content │\n╰──────────╯`

### Block Elements
```
█  ▓  ▒  ░   ← fill levels (full, 75%, 50%, 25%)
▀  ▄           ← top-half, bottom-half block
▌  ▐           ← left-half, right-half block
■  □  ●  ○  ◆  ◇  ▶  ▷  ►  ▸
```

### Block Progress Bar Chars
```
█ ▉ ▊ ▋ ▌ ▍ ▎ ▏  ← 8-step fill progression (left to right)
░ ▒ ▓ █             ← shade progression
```

### Status Icons (UTF-8, widely supported)
```
✔  ✖  ●  ○  ▲  △  ◆  ◇  →  ›  »  ·
⚡ 🔌  ⚙  🌐  📦  🔧  💾  🛡  ⏱  ✨
```

---

## 5. Real-World Inspiration: How Frameworks Do It

### NestJS Banner (Actual Source Obtained)

```typescript
// nest-cli/lib/ui/banner.ts — actual source
export const BANNER = `
 _   _             _      ___  _____  _____  _     _____
| \\ | |           | |    |_  |/  ___|/  __ \\| |   |_   _|
|  \\| |  ___  ___ | |_     | |\\ \`--. | /  \\/| |     | |
| . \` | / _ \\/ __|| __|    | | \`--. \\| |    | |     | |
| |\\  ||  __/\\__ \\| |_ /\\__/ //\\__/ /| \\__/\\| |_____| |_
\\_| \\_/ \\___||___/ \\__|\\____/ \\____/  \\____/\\_____/\\___/
`;
```

Then colored: `console.log(colors.red(BANNER))` — simple, bold, single color.

**Key pattern**: Banner → blank line → versioned info line. No fancy animations. Pure static print.

### Vite Startup Pattern

Vite uses a simple sequential log:
```
  VITE v5.4.0  ready in 234 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

**Pattern**: Tight info display. One server URL per line. Timing shown. Pure `console.log` with color.

### Docker Compose Pattern

Docker Compose shows parallel service startup like:
```
 ✔ Container redis    Started    0.8s
 ✔ Container postgres Started    1.2s
 ✔ Container app      Started    2.1s
```

**Pattern**: Each service on its own line, success/fail icon, name left-aligned, timing right-aligned. Written sequentially as each service completes.

### NestJS Application Bootstrap

```
[Nest] LOG  [NestApplication] Nest application successfully started +2ms
```

**Pattern**: Bracket-tagged log level, service name, message, relative timing.

---

## 6. concurrently Compatibility — Critical Findings

### How concurrently Works

Paloma's `npm start` command:
```json
"start": "concurrently -k -n vite,bridge -c cyan,magenta \"vite\" \"node bridge/index.js\""
```

concurrently spawns child processes and **pipes** their stdout/stderr. It captures each line and prepends the colorized name prefix (`[bridge] `) before writing to the parent's stdout.

### Critical Implications

| Feature | Under `concurrently` | Standalone `npm run bridge` |
|---------|---------------------|---------------------------|
| `process.stdout.isTTY` | **`false`** (piped) | **`true`** (direct terminal) |
| ANSI color codes | ✅ Passed through | ✅ Works natively |
| `FORCE_COLOR` | ✅ Set automatically by concurrently | N/A |
| `\r` (carriage return) progress | ❌ Broken — prefix re-added each "line" | ✅ Works |
| Cursor up/down (`\x1b[NA`) | ❌ Broken | ✅ Works |
| Multi-line spinner/progress | ❌ Broken | ✅ Works |
| `clearLine` / `cursorTo` | ❌ Broken | ✅ Works |
| Static colored `console.log` | ✅ Works perfectly | ✅ Works perfectly |

### The `\r` Problem in Detail

Under concurrently, when you write `process.stdout.write('\r[████░░] 50%')`, concurrently intercepts the output and writes `[bridge] \r[████░░] 50%` to the terminal. The `\r` moves the cursor back to column 0 in the parent terminal, overwriting the `[bridge] ` prefix — but then the next write adds a new `[bridge] ` prefix. Result: garbled output.

### TTY Detection Strategy

```js
const IS_TTY = process.stdout.isTTY === true
const HAS_COLOR = IS_TTY || process.env.FORCE_COLOR

// Use IS_TTY to gate interactive progress:
if (IS_TTY) {
  // Spinners, cursor movement, progress bars
} else {
  // Static log lines only
}
```

### Detecting "Are we under concurrently?"

```js
// concurrently sets CONCURRENTLY env var in recent versions
const UNDER_CONCURRENTLY = !!process.env.CONCURRENTLY
// Fallback: pipe detection
const IS_PIPED = !process.stdout.isTTY
```

---

## 7. Recommended Architecture for Paloma

### Design Philosophy

Since the bridge runs under `concurrently` in normal `npm start` usage but can also run standalone via `npm run bridge`, the startup system should:

1. **Always**: Print the banner, structured status log (works everywhere)
2. **When TTY**: Use spinners and inline progress during MCP server loading
3. **Fallback**: Static checkmark log when piped

### Proposed Module: `bridge/startup.js`

```js
// bridge/startup.js
export function printBanner() { ... }
export function createServerProgress(names) { ... }  // returns object with update(name, status, detail)
export function printSummary(results) { ... }
export function printShutdown() { ... }
```

### Startup Flow in `bridge/index.js`

```js
import { printBanner, createServerProgress, printSummary } from './startup.js'

async function main() {
  printBanner()  // Instant: shows PALOMA ASCII art + version

  const servers = await loadConfig()
  const progress = createServerProgress(Object.keys(servers))

  // Hook into McpManager to emit per-server progress:
  const results = await manager.startAll(servers, (name, status, toolCount) => {
    progress.update(name, status, toolCount)
  })

  printSummary(results)  // "✔ 9/9 servers ready · 47 tools · port 19191"

  // ... rest of startup
}
```

### Visual Layout (What it will look like under `npm start`)

```
[bridge]
[bridge] ██████╗  █████╗ ██╗      ██████╗ ███╗   ███╗ █████╗
[bridge] ██╔══██╗██╔══██╗██║     ██╔═══██╗████╗ ████║██╔══██╗
[bridge] ██████╔╝███████║██║     ██║   ██║██╔████╔██║███████║
[bridge] ██╔═══╝ ██╔══██║██║     ██║   ██║██║╚██╔╝██║██╔══██║
[bridge] ██║     ██║  ██║███████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║
[bridge] ╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝
[bridge]                   AI Development Partner  v1.0
[bridge]
[bridge]   ● Starting MCP servers...
[bridge]   ✔ filesystem  9 tools
[bridge]   ✔ git         31 tools
[bridge]   ✔ shell       18 tools
[bridge]   ✔ web         2 tools
[bridge]   ✔ fs-extra    2 tools
[bridge]   ✔ brave-search 2 tools
[bridge]   ✔ voice       1 tool
[bridge]   ✔ memory      6 tools
[bridge]   ✔ gmail       6 tools
[bridge]   ✔ codex       2 tools
[bridge]   ✔ ollama      5 tools
[bridge]
[bridge]   ✔ All systems nominal  ·  11 servers  ·  84 tools  ·  ws://localhost:19191
[bridge]   ✔ MCP proxy ready      ·  localhost:19192
[bridge]   ✔ Email watcher        ·  polling every 30s
[bridge]
```

### Visual Layout (Standalone `npm run bridge` — TTY mode)

When running standalone (IS_TTY = true), the MCP server loading can use an animated spinner showing all servers loading in parallel, then snapping to the completion state. This is bonus polish.

---

## 8. Color Scheme Recommendation for Paloma

Consistent with Paloma's existing identity (magenta sidebar, etc.):

| Element              | Color Code         | Hex Equiv    |
|---------------------|--------------------|-------------|
| Banner title         | `\x1b[95m` bright magenta | #ff79c6  |
| Banner tagline       | `\x1b[2m\x1b[37m` dim white | #888      |
| Success (✔)         | `\x1b[32m` green   | #50fa7b     |
| Error (✖)           | `\x1b[31m` red     | #ff5555     |
| Warning (▲)         | `\x1b[33m` yellow  | #f1fa8c     |
| Info (●)            | `\x1b[36m` cyan    | #8be9fd     |
| Running (›)         | `\x1b[35m` magenta | #ff79c6     |
| Tool count (dim)    | `\x1b[2m` dim      | #888        |
| Server names        | `\x1b[97m` bright white | #fff   |
| Port numbers        | `\x1b[96m` bright cyan | #8be9fd  |
| Separator lines     | `\x1b[2m\x1b[36m` dim cyan | #555  |

---

## 9. Key Files to Modify

Based on source code review:

### `bridge/mcp-manager.js` — Core startup target
- `startAll()` — calls `Promise.allSettled()` in parallel — needs progress callback
- `startServer()` — currently logs plain `console.log` — upgrade to structured log
- `shutdown()` — needs graceful shutdown banner

### `bridge/index.js` — Orchestration point
- `main()` function — add `printBanner()` call at top
- After `manager.startAll()` — add `printSummary()`
- Shutdown handler — add `printShutdown()`

### New file: `bridge/startup.js` — All visual output
- Keep startup UX code isolated from business logic
- Export functions: `printBanner`, `printStep`, `printSummary`, `printShutdown`
- TTY detection happens here, nowhere else

### `package.json` — No changes needed
- `FORCE_COLOR=1` is set automatically by concurrently v9

---

## 10. Open Questions for Chart

1. **Banner choice**: Which ASCII art style? ANSI Shadow is most impressive but 52 chars + `[bridge] ` prefix = 61 chars total. Should we use the minimalist option when under concurrently?

2. **TTY enhancement**: Should the standalone mode (`npm run bridge`) get the animated parallel spinner view? Or keep it simple and consistent?

3. **Email watcher indicator**: The email watcher starts after MCP servers. Should it appear in the startup summary, or separately logged when it first polls?

4. **Pillar session tracking**: The plan mentions progress indicators for active pillars. Should these be part of `startup.js` or a separate `bridge/status.js` that handles runtime status events?

5. **Graceful shutdown**: How fancy? Just a banner line, or a full summary of what was torn down?

6. **MCP startup callback**: `McpManager.startAll()` currently has no progress callbacks. Chart should decide if we modify its signature or wrap it with a proxy/observer approach to avoid touching its contract.

---

## Sources

- NestJS CLI banner.ts (source): https://github.com/nestjs/nest-cli/blob/master/lib/ui/banner.ts
- Node.js TTY documentation: https://nodejs.org/api/tty.html
- ASCII art generator: https://patorjk.com/software/taag/
- ANSI escape codes reference: https://blog.logrocket.com/using-console-colors-node-js/
- concurrently npm: https://www.npmjs.com/package/concurrently
- DigitalOcean spinner tutorial: https://www.digitalocean.com/community/tutorials/nodejs-node-command-line-throbber
