# Universal Installer for Paloma

**Created:** 2026-03-21
**Status:** Active
**Scope:** One-command installer (`curl | bash`) + CLI wrapper + diagnostics — zero prereqs beyond curl and git

## Goal

Make Paloma installable on any Linux/macOS/WSL2 machine with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/adam/paloma/main/install.sh | bash
```

This installs a self-contained Node.js runtime, clones the repo, runs setup, and provides a `paloma` CLI for lifecycle management. No system Node.js required. No system pollution — everything lives in `~/.paloma/`.

## Scout Research

Full findings: `.paloma/docs/scout-universal-installer-20260321.md`

**Key decision: Shell Script Installer (Strategy A, scored 9.1/10)**
- Proven pattern (Ollama, nvm, Bun)
- Supports Paloma's multi-process architecture (12+ child Node.js processes)
- Git-based updates via `git pull`
- Auditable — users can read the script before running

## Decisions (from Scout's 8 Open Questions)

| # | Question | Decision |
|---|----------|----------|
| 1 | Git clone vs tarball | Git clone (Phase 1). Tarball in Phase 3 via GitHub Releases. |
| 2 | Node.js version | Pin to Node.js 22 LTS. `NODE_VERSION` variable at top of install script. |
| 3 | Repository URL | GitHub HTTPS. User needs repo access for Phase 1. |
| 4 | Service default | Interactive: ask. Non-interactive (`--yes`): no service. `--service`: yes. |
| 5 | Multi-user | Per-user only (`~/.paloma/`). No system-wide install. |
| 6 | Telemetry | None. Zero. |
| 7 | Version scheme | Semver from 0.1.0. Git tags. `paloma version` reads package.json. |
| 8 | first-run.sh coexistence | New installer replaces `first-run.sh` for end users. `first-run.sh` stays for devs who clone manually. |

## Directory Layout

```
~/.paloma/
├── bin/
│   └── paloma              # CLI wrapper (symlinked to /usr/local/bin or PATH-injected)
├── node/                   # Isolated Node.js 22 LTS runtime
│   ├── bin/node
│   ├── bin/npm
│   └── ...
├── app/                    # Paloma source (git clone)
│   ├── bridge/
│   ├── src/
│   ├── mcp-servers/
│   ├── scripts/
│   ├── package.json
│   └── ...
├── kokoro_env/             # Python venv for voice TTS (optional, Phase 2)
├── mcp-settings.json       # MCP config (user API keys — preserved across updates)
├── mcp.json                # Permission/auto-execute rules
├── memory/                 # Semantic memory storage
└── install-metadata.json   # Installer version, date, method, Node.js version
```

## Design Principles

- **Everything in `~/.paloma/`** — clean, predictable, no system pollution
- **Idempotent** — re-running updates, never breaks
- **Fail gracefully** — clear error messages, never leave half-installed state (temp dir with cleanup trap)
- **Preserve user config** — API keys, memory, mcp.json survive updates
- **Detect, don't assume** — check what's available, guide what's missing
- **`main()` function wrapper** — prevents partial-download execution (Ollama pattern)

## Phases

### Phase 1: MVP (build now) — WU-1 through WU-4
- `install.sh` — the main installer script
- `scripts/paloma-cli.sh` — the `paloma` CLI wrapper
- `scripts/paloma-doctor.js` — diagnostics script
- `package.json` version bump to 0.1.0

### Phase 2: Service + Voice (build after Phase 1)
- systemd user unit file template
- launchd plist template
- `scripts/setup-voice.sh` — Kokoro TTS venv setup (extracted from setup-mcp.sh)
- WSL2 detection and special handling

### Phase 3: Distribution (future — noted only)
- Homebrew formula
- GitHub Releases with versioned tarballs
- Nix flake
- `paloma update` switches from `git pull` to tag-based releases

---

## Work Units

#### WU-1: Create the install.sh installer script
- **Feature:** Main Installer
- **Status:** ready
- **Files:** install.sh
- **Scope:** Create the top-level installer script that lives at the repo root. This is the `curl | bash` entry point. It must:
  1. Wrap everything in a `main()` function (prevents partial-download execution)
  2. Detect OS (`uname -s` → linux/darwin) and architecture (`uname -m` → x64/arm64)
  3. Detect WSL2 (`grep -qi microsoft /proc/version`)
  4. Check prerequisites: `curl` (required), `git` (required). Print install guidance if missing.
  5. Parse flags: `--yes` (non-interactive), `--service` (install systemd/launchd service), `--help`
  6. Create `~/.paloma/` directory structure (`bin/`, `node/`, `app/`)
  7. Download Node.js 22 LTS binary from `nodejs.org/dist/` into `~/.paloma/node/` (tar.xz for linux, tar.gz for darwin). Use `NODE_VERSION` variable at top of script, easy to bump. Strip-components=1 to flatten.
  8. If `~/.paloma/app/` exists and is a git repo, do `git pull --ff-only` (update path). Otherwise `git clone --depth=1` the repo into `~/.paloma/app/`.
  9. Run `~/.paloma/node/bin/npm install` inside `~/.paloma/app/` (using the managed Node.js, not system)
  10. Run `bash ~/.paloma/app/scripts/setup-mcp.sh` (generates mcp-settings.json, preserves existing API keys)
  11. Copy `~/.paloma/app/scripts/paloma-cli.sh` to `~/.paloma/bin/paloma` and `chmod +x`
  12. Symlink `~/.paloma/bin/paloma` to `/usr/local/bin/paloma` (with `sudo` if needed), OR fall back to PATH injection in shell profile if symlink fails
  13. Shell profile PATH injection: detect profile file (`.bashrc`, `.zshrc`, `.bash_profile`, `.zprofile`, `.profile`), idempotently append `export PATH="$HOME/.paloma/bin:$PATH"` (check with grep before appending)
  14. Write `~/.paloma/install-metadata.json` with `{ "version": "0.1.0", "date": "...", "method": "git-clone", "nodeVersion": "22.x.x", "os": "...", "arch": "..." }`
  15. Detect and report AI backend availability (claude, codex, copilot/gh, gemini, ollama) — informational only, not blocking
  16. Use a temp directory with `trap cleanup EXIT` for downloads — never leave partial files on failure
  17. Print colored success message with next steps: `paloma start`, backend install commands for any missing backends
  18. All echo output uses color codes (green check, red x, yellow warning, cyan info) — similar style to existing `first-run.sh`
- **Acceptance:** Running `bash install.sh` on a clean machine (with curl+git) installs Paloma into `~/.paloma/`, the `paloma` command is available, and `paloma start` launches the bridge. Re-running the script updates an existing installation without losing config. Running on a machine missing curl or git prints clear guidance and exits non-zero.

#### WU-2: Create the paloma CLI wrapper script
- **Feature:** CLI Wrapper
- **Status:** ready
- **Files:** scripts/paloma-cli.sh
- **Scope:** Create the `paloma` command — a bash script that serves as the user-facing CLI for managing Paloma. It gets copied to `~/.paloma/bin/paloma` by the installer. Commands:
  - `paloma start [--no-browser]` — Start Paloma (runs `paloma-supervisor.js` via managed Node.js). Default opens browser to `http://localhost:19191`.
  - `paloma stop` — Stop Paloma (reads PID from `/tmp/paloma-bridge.pid`, sends SIGTERM, waits up to 5s, then SIGKILL)
  - `paloma restart` — Stop then Start
  - `paloma update` — `cd ~/.paloma/app && git pull --ff-only && npm install && bash scripts/setup-mcp.sh && npx vite build`. Print "Restart with: paloma restart" at end.
  - `paloma doctor` — Run `paloma-doctor.js` (WU-3)
  - `paloma setup [voice|mcp]` — `voice` runs `setup-voice.sh` (Phase 2, print "coming soon" for now), `mcp` (or no arg) runs `setup-mcp.sh`
  - `paloma uninstall` — Confirm prompt (skip with `--yes`), stop Paloma, remove systemd/launchd service files, remove `/usr/local/bin/paloma` symlink (sudo), remove `~/.paloma/`, remove PATH lines from shell profiles
  - `paloma version` — Read version from `~/.paloma/app/package.json` using node -e, also print Node.js version and install date from metadata
  - `paloma help` — Print usage with all commands
  - Default (no args) → `paloma start`
  - Variables at top: `PALOMA_HOME="${PALOMA_HOME:-$HOME/.paloma}"`, `PALOMA_APP`, `PALOMA_NODE`, `PALOMA_NPM`. Export `PATH` to include managed Node.js bin.
  - `set -euo pipefail` at top
- **Acceptance:** Each command works as described. `paloma` with no args starts Paloma. `paloma help` shows all commands. `paloma version` prints version info. `paloma update` pulls latest and rebuilds. `paloma uninstall` cleanly removes everything.

#### WU-3: Create paloma-doctor.js diagnostics script
- **Feature:** Diagnostics
- **Status:** ready
- **Files:** scripts/paloma-doctor.js
- **Scope:** Create a Node.js diagnostics script that checks system health and prints a report. Checks:
  1. **Node.js version** — Is managed Node.js present? Version matches expected? (read from install-metadata.json)
  2. **npm packages** — Does `node_modules/` exist? Run `npm ls --depth=0` to check for missing deps.
  3. **Ports** — Are 19191 and 19192 available? If occupied, show PID of what's using them (via `lsof` or `ss`)
  4. **AI Backends** — Detect each: `claude --version`, `codex --version`, `gh copilot --version`, `gemini --version`, `ollama --version`. Show version if found, install command if not.
  5. **MCP Config** — Does `~/.paloma/mcp-settings.json` exist? Are there placeholder API keys still set?
  6. **Python/Voice** — Is Python 3.10+ available? Does `kokoro_env/` exist? Is it functional?
  7. **Git repo** — Is `~/.paloma/app/` a git repo? Current branch? Commits behind origin?
  8. **Disk space** — How much space does `~/.paloma/` use? Is there enough free disk space?
  9. **OS/Platform** — Print OS, arch, WSL2 status, kernel version
  10. **Install metadata** — Print install date, method, version from `install-metadata.json`
  - Output format: Colored lines with checkmark/x/warning prefix, grouped by category. Summary at end with overall health status.
  - Exit code 0 if all critical checks pass, 1 if any critical check fails.
  - Uses ES modules (`import`), runs under managed Node.js.
  - No external dependencies — use `child_process.execSync` for shell commands, `fs` for file checks, `os` for platform info.
- **Acceptance:** `paloma doctor` prints a full diagnostic report. All checks run without error. Missing optional components show as warnings, missing critical components show as errors. Exit code reflects health status.

#### WU-4: Bump package.json version to 0.1.0
- **Feature:** Version Bump
- **Status:** ready
- **Files:** package.json
- **Scope:** Update `package.json` version from `"0.0.0"` to `"0.1.0"`. This marks the first installable release of Paloma. Also add a `"bin"` field pointing to `scripts/paloma-cli.sh` for future npm-based discovery (not used by installer, but good metadata). Add `paloma-doctor` script alias: `"doctor": "node scripts/paloma-doctor.js"`.
- **Acceptance:** `package.json` shows version `0.1.0`. `npm run doctor` runs the diagnostics script.

---

## Dependency Graph

```
WU-4 (version bump)     — no deps, can run in parallel
WU-3 (doctor)           — no deps, can run in parallel
WU-2 (CLI wrapper)      — no deps, can run in parallel
WU-1 (install.sh)       — references WU-2 output (paloma-cli.sh path), but only copies the file
                           references WU-3 indirectly (doctor runs via CLI)
```

All four work units are **file-disjoint** and can be built in parallel:
- WU-1 touches `install.sh`
- WU-2 touches `scripts/paloma-cli.sh`
- WU-3 touches `scripts/paloma-doctor.js`
- WU-4 touches `package.json`

WU-1 references WU-2's output path (`scripts/paloma-cli.sh`) but does not modify it — it just copies it during install. So they can be forged independently and integration-tested together.

## Testing Strategy

After all work units are built:
1. Run `bash install.sh` on the development machine — verify it installs into `~/.paloma/` without conflicting with the existing dev setup
2. Run `paloma doctor` — verify all checks pass
3. Run `paloma version` — verify it shows 0.1.0
4. Run `paloma start` — verify Paloma launches
5. Run `paloma stop` — verify clean shutdown
6. Run `paloma update` — verify it pulls and rebuilds
7. Re-run `bash install.sh` — verify idempotent update (no breakage, config preserved)

## Phase 2 Notes (Service + Voice)

After Phase 1 ships, add:
- **WU-5:** systemd user unit template (`~/.config/systemd/user/paloma.service`) + launchd plist (`~/Library/LaunchAgents/dev.paloma.bridge.plist`). The `--service` flag in install.sh and `paloma setup service` command trigger this.
- **WU-6:** `scripts/setup-voice.sh` — extract voice/TTS venv setup from `setup-mcp.sh` into its own script. Detect Python 3.10+, create venv in `~/.paloma/kokoro_env/`, install packages. `paloma setup voice` calls this.
- **WU-7:** WSL2-specific handling — detect WSL2, handle systemd availability (check `/etc/wsl.conf`), audio passthrough via PulseAudio/WSLg.

## Phase 3 Notes (Distribution)

Future work, not planned in detail:
- Homebrew formula (`brew install paloma`)
- GitHub Releases with versioned tarballs (switch `paloma update` to tag-based)
- Nix flake for Nix users
- Go/Rust binary wrapper (Phase 4 if user base grows)
