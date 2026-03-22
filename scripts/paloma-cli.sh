#!/usr/bin/env bash
set -euo pipefail

# ╔══════════════════════════════════════════════════════════════════╗
# ║  Paloma CLI — Lifecycle management for Paloma                    ║
# ║                                                                  ║
# ║  Usage:  paloma [command] [options]                              ║
# ║  Run 'paloma help' for all commands.                             ║
# ╚══════════════════════════════════════════════════════════════════╝

# ─────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────

PALOMA_HOME="${PALOMA_HOME:-$HOME/.paloma}"
PALOMA_APP="$PALOMA_HOME/app"
PALOMA_NODE="$PALOMA_HOME/node/bin/node"
PALOMA_NPM="$PALOMA_HOME/node/bin/npm"
PALOMA_PID_FILE="/tmp/paloma-bridge.pid"
PALOMA_LOG_FILE="/tmp/paloma-bridge.log"

# Add managed Node.js to PATH so child processes find it
if [ -d "$PALOMA_HOME/node/bin" ]; then
  export PATH="$PALOMA_HOME/node/bin:$PATH"
fi

# ─────────────────────────────────────────────────────────
# Colors & Output Helpers
# ─────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_DIM='\033[2m'
  C_MAGENTA='\033[95m'
  C_CYAN='\033[96m'
  C_GREEN='\033[32m'
  C_YELLOW='\033[33m'
  C_RED='\033[31m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_MAGENTA='' C_CYAN=''
  C_GREEN='' C_YELLOW='' C_RED=''
fi

ok()   { echo -e "  ${C_GREEN}✔${C_RESET} $1"; }
warn() { echo -e "  ${C_YELLOW}▲${C_RESET} $1"; }
fail() { echo -e "  ${C_RED}✖${C_RESET} $1"; }
info() { echo -e "  ${C_CYAN}●${C_RESET} $1"; }

# ─────────────────────────────────────────────────────────
# Resolve app directory
# ─────────────────────────────────────────────────────────
# Works whether run from ~/.paloma/bin/paloma or from the repo directly

resolve_app_dir() {
  if [ -d "$PALOMA_APP" ] && [ -f "$PALOMA_APP/package.json" ]; then
    echo "$PALOMA_APP"
    return
  fi

  # Fallback: if run from within the repo, use the repo root
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local repo_root="$script_dir/.."
  if [ -f "$repo_root/package.json" ] && [ -d "$repo_root/bridge" ]; then
    echo "$(cd "$repo_root" && pwd)"
    return
  fi

  fail "Cannot find Paloma app directory."
  fail "Expected at: $PALOMA_APP"
  fail "Re-run the installer or set PALOMA_HOME."
  exit 1
}

resolve_node() {
  if [ -x "$PALOMA_NODE" ]; then
    echo "$PALOMA_NODE"
  elif command -v node &>/dev/null; then
    echo "node"
  else
    fail "Node.js not found. Run the Paloma installer or install Node.js."
    exit 1
  fi
}

resolve_npm() {
  if [ -x "$PALOMA_NPM" ]; then
    echo "$PALOMA_NPM"
  elif command -v npm &>/dev/null; then
    echo "npm"
  else
    fail "npm not found. Run the Paloma installer or install Node.js."
    exit 1
  fi
}

# ─────────────────────────────────────────────────────────
# Open browser (cross-platform)
# ─────────────────────────────────────────────────────────

open_browser() {
  local url="$1"
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" &>/dev/null &
  elif command -v open &>/dev/null; then
    open "$url"
  elif command -v wslview &>/dev/null; then
    wslview "$url" &>/dev/null &
  else
    info "Open in your browser: ${C_CYAN}${url}${C_RESET}"
    return
  fi
  info "Opened ${C_CYAN}${url}${C_RESET} in browser"
}

# ─────────────────────────────────────────────────────────
# paloma start [--no-browser]
# ─────────────────────────────────────────────────────────

cmd_start() {
  local no_browser=false
  for arg in "$@"; do
    case "$arg" in
      --no-browser) no_browser=true ;;
    esac
  done

  local app_dir
  app_dir="$(resolve_app_dir)"
  local node_bin
  node_bin="$(resolve_node)"

  # Check if already running
  if [ -f "$PALOMA_PID_FILE" ]; then
    local pid
    pid="$(cat "$PALOMA_PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      warn "Paloma is already running (PID $pid)"
      info "Stop with: ${C_CYAN}paloma stop${C_RESET}"
      if [ "$no_browser" = false ]; then
        open_browser "http://localhost:19191"
      fi
      return 0
    fi
    # Stale PID file — clean it up
    rm -f "$PALOMA_PID_FILE"
  fi

  echo -e "\n${C_MAGENTA}${C_BOLD}  Starting Paloma...${C_RESET}\n"

  cd "$app_dir"

  # Prefer supervisor if it exists, fall back to npm start
  if [ -f "$app_dir/scripts/paloma-supervisor.js" ]; then
    info "Starting via supervisor..."
    nohup "$node_bin" "$app_dir/scripts/paloma-supervisor.js" \
      >> "$PALOMA_LOG_FILE" 2>&1 &
    local sup_pid=$!
    # Give the supervisor a moment to start and write the PID file
    sleep 2

    if kill -0 "$sup_pid" 2>/dev/null; then
      ok "Paloma started (supervisor PID $sup_pid)"
    else
      fail "Paloma failed to start. Check logs: ${C_CYAN}paloma logs${C_RESET}"
      return 1
    fi
  else
    info "Supervisor not found — starting via npm start..."
    local npm_bin
    npm_bin="$(resolve_npm)"
    nohup "$npm_bin" start >> "$PALOMA_LOG_FILE" 2>&1 &
    sleep 2
    ok "Paloma started via npm"
  fi

  info "Bridge:    ${C_CYAN}http://localhost:19191${C_RESET}"
  info "MCP Proxy: ${C_CYAN}http://localhost:19192${C_RESET}"
  info "Logs:      ${C_CYAN}paloma logs${C_RESET}"

  if [ "$no_browser" = false ]; then
    open_browser "http://localhost:19191"
  fi

  echo ""
}

# ─────────────────────────────────────────────────────────
# paloma stop
# ─────────────────────────────────────────────────────────

cmd_stop() {
  echo -e "\n${C_MAGENTA}${C_BOLD}  Stopping Paloma...${C_RESET}\n"

  if [ ! -f "$PALOMA_PID_FILE" ]; then
    warn "No PID file found at $PALOMA_PID_FILE"
    warn "Paloma may not be running."
    return 0
  fi

  local pid
  pid="$(cat "$PALOMA_PID_FILE" 2>/dev/null || true)"

  if [ -z "$pid" ]; then
    warn "PID file is empty — cleaning up."
    rm -f "$PALOMA_PID_FILE"
    return 0
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    warn "Process $pid is not running — cleaning up stale PID file."
    rm -f "$PALOMA_PID_FILE"
    return 0
  fi

  info "Sending SIGTERM to PID $pid..."
  kill "$pid" 2>/dev/null || true

  # Wait up to 5 seconds for graceful shutdown
  local waited=0
  while [ $waited -lt 5 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      ok "Paloma stopped gracefully."
      rm -f "$PALOMA_PID_FILE"
      echo ""
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  # Still running — force kill
  warn "Process did not stop after 5s — sending SIGKILL..."
  kill -9 "$pid" 2>/dev/null || true
  sleep 1

  if ! kill -0 "$pid" 2>/dev/null; then
    ok "Paloma force-stopped."
  else
    fail "Could not stop process $pid. You may need to kill it manually."
  fi

  rm -f "$PALOMA_PID_FILE"
  echo ""
}

# ─────────────────────────────────────────────────────────
# paloma restart
# ─────────────────────────────────────────────────────────

cmd_restart() {
  cmd_stop
  cmd_start "$@"
}

# ─────────────────────────────────────────────────────────
# paloma update
# ─────────────────────────────────────────────────────────

cmd_update() {
  local app_dir
  app_dir="$(resolve_app_dir)"
  local npm_bin
  npm_bin="$(resolve_npm)"

  echo -e "\n${C_MAGENTA}${C_BOLD}  Updating Paloma...${C_RESET}\n"

  cd "$app_dir"

  info "Pulling latest changes..."
  if git pull --ff-only; then
    ok "Git pull complete"
  else
    fail "Git pull failed. You may have local changes — resolve and retry."
    exit 1
  fi

  info "Installing dependencies..."
  "$npm_bin" install --loglevel=warn 2>&1 | tail -5
  ok "Dependencies installed"

  if [ -f "$app_dir/scripts/setup-mcp.sh" ]; then
    info "Running MCP setup..."
    bash "$app_dir/scripts/setup-mcp.sh"
    ok "MCP setup complete"
  fi

  info "Building frontend..."
  "$npm_bin" exec vite build
  ok "Frontend built"

  echo ""
  ok "Update complete!"
  info "Restart with: ${C_CYAN}paloma restart${C_RESET}"
  echo ""
}

# ─────────────────────────────────────────────────────────
# paloma doctor
# ─────────────────────────────────────────────────────────

cmd_doctor() {
  local app_dir
  app_dir="$(resolve_app_dir)"
  local node_bin
  node_bin="$(resolve_node)"

  if [ -f "$app_dir/scripts/paloma-doctor.js" ]; then
    "$node_bin" "$app_dir/scripts/paloma-doctor.js"
  else
    fail "paloma-doctor.js not found at $app_dir/scripts/"
    fail "Your installation may be incomplete. Try: paloma update"
    exit 1
  fi
}

# ─────────────────────────────────────────────────────────
# paloma setup [mcp|voice]
# ─────────────────────────────────────────────────────────

cmd_setup() {
  local subcommand="${1:-mcp}"
  local app_dir
  app_dir="$(resolve_app_dir)"

  case "$subcommand" in
    mcp)
      if [ -f "$app_dir/scripts/setup-mcp.sh" ]; then
        info "Running MCP setup..."
        bash "$app_dir/scripts/setup-mcp.sh"
        ok "MCP setup complete"
      else
        fail "setup-mcp.sh not found"
        exit 1
      fi
      ;;
    voice)
      echo ""
      info "Voice setup is coming soon — Phase 2"
      info "For now, see the Paloma docs for manual voice setup."
      echo ""
      ;;
    *)
      fail "Unknown setup target: $subcommand"
      info "Available: ${C_CYAN}paloma setup mcp${C_RESET}, ${C_CYAN}paloma setup voice${C_RESET}"
      exit 1
      ;;
  esac
}

# ─────────────────────────────────────────────────────────
# paloma uninstall [--yes]
# ─────────────────────────────────────────────────────────

cmd_uninstall() {
  local skip_confirm=false
  for arg in "$@"; do
    case "$arg" in
      --yes|-y) skip_confirm=true ;;
    esac
  done

  echo -e "\n${C_RED}${C_BOLD}  Uninstall Paloma${C_RESET}\n"
  warn "This will remove:"
  echo -e "    - ${C_DIM}$PALOMA_HOME/${C_RESET} (app, node, config, memory)"
  echo -e "    - ${C_DIM}/usr/local/bin/paloma${C_RESET} symlink"
  echo -e "    - ${C_DIM}systemd/launchd service files${C_RESET} (if present)"
  echo ""

  if [ "$skip_confirm" = false ]; then
    echo -ne "  ${C_YELLOW}Are you sure? [y/N]${C_RESET} "
    read -r response
    case "$response" in
      [yY]|[yY][eE][sS]) ;;
      *)
        info "Uninstall cancelled."
        return 0
        ;;
    esac
  fi

  echo ""

  # Stop Paloma if running
  if [ -f "$PALOMA_PID_FILE" ]; then
    info "Stopping Paloma..."
    cmd_stop
  fi

  # Remove systemd user service (Linux)
  local systemd_service="$HOME/.config/systemd/user/paloma.service"
  if [ -f "$systemd_service" ]; then
    info "Removing systemd service..."
    systemctl --user stop paloma 2>/dev/null || true
    systemctl --user disable paloma 2>/dev/null || true
    rm -f "$systemd_service"
    systemctl --user daemon-reload 2>/dev/null || true
    ok "Systemd service removed"
  fi

  # Remove launchd plist (macOS)
  local launchd_plist="$HOME/Library/LaunchAgents/dev.paloma.bridge.plist"
  if [ -f "$launchd_plist" ]; then
    info "Removing launchd service..."
    launchctl unload "$launchd_plist" 2>/dev/null || true
    rm -f "$launchd_plist"
    ok "Launchd service removed"
  fi

  # Remove /usr/local/bin symlink
  if [ -L "/usr/local/bin/paloma" ]; then
    info "Removing /usr/local/bin/paloma symlink (may need sudo)..."
    if sudo rm -f /usr/local/bin/paloma 2>/dev/null; then
      ok "Symlink removed"
    else
      warn "Could not remove /usr/local/bin/paloma — remove it manually with sudo"
    fi
  fi

  # Remove ~/.paloma/
  if [ -d "$PALOMA_HOME" ]; then
    info "Removing $PALOMA_HOME/..."
    rm -rf "$PALOMA_HOME"
    ok "Paloma home directory removed"
  fi

  # Clean up PID and log files
  rm -f "$PALOMA_PID_FILE" "$PALOMA_LOG_FILE"

  echo ""
  ok "Paloma has been uninstalled."
  echo ""
  warn "You may want to remove the PATH entry from your shell profile:"
  echo -e "    ${C_DIM}Check ~/.bashrc, ~/.zshrc, ~/.bash_profile, or ~/.profile${C_RESET}"
  echo -e "    ${C_DIM}Remove the line: export PATH=\"\$HOME/.paloma/bin:\$PATH\"${C_RESET}"
  echo ""
}

# ─────────────────────────────────────────────────────────
# paloma version
# ─────────────────────────────────────────────────────────

cmd_version() {
  local app_dir
  app_dir="$(resolve_app_dir)"
  local node_bin
  node_bin="$(resolve_node)"

  echo ""
  # Read version from package.json
  local version
  version="$("$node_bin" -e "console.log(require('$app_dir/package.json').version)" 2>/dev/null || echo "unknown")"
  echo -e "  ${C_MAGENTA}${C_BOLD}Paloma${C_RESET} v${version}"

  # Node.js version
  local node_version
  node_version="$("$node_bin" --version 2>/dev/null || echo "unknown")"
  echo -e "  ${C_DIM}Node.js:${C_RESET}  $node_version"

  # OS info
  local os_info
  os_info="$(uname -srm 2>/dev/null || echo "unknown")"
  echo -e "  ${C_DIM}OS:${C_RESET}       $os_info"

  # Install metadata (if installed via installer)
  local metadata_file="$PALOMA_HOME/install-metadata.json"
  if [ -f "$metadata_file" ]; then
    local install_date
    install_date="$("$node_bin" -e "console.log(require('$metadata_file').date || 'unknown')" 2>/dev/null || echo "unknown")"
    local install_method
    install_method="$("$node_bin" -e "console.log(require('$metadata_file').method || 'unknown')" 2>/dev/null || echo "unknown")"
    echo -e "  ${C_DIM}Installed:${C_RESET} $install_date ($install_method)"
  fi

  # Git info if available
  if [ -d "$app_dir/.git" ]; then
    local git_branch
    git_branch="$(cd "$app_dir" && git branch --show-current 2>/dev/null || echo "unknown")"
    local git_commit
    git_commit="$(cd "$app_dir" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
    echo -e "  ${C_DIM}Branch:${C_RESET}   $git_branch ($git_commit)"
  fi

  echo ""
}

# ─────────────────────────────────────────────────────────
# paloma logs
# ─────────────────────────────────────────────────────────

cmd_logs() {
  echo ""
  if [ -f "$PALOMA_LOG_FILE" ]; then
    info "Last 50 lines of ${C_CYAN}${PALOMA_LOG_FILE}${C_RESET}:"
    echo ""
    tail -50 "$PALOMA_LOG_FILE"
  else
    warn "No log file found at $PALOMA_LOG_FILE"
    echo ""
    info "Paloma logs are written to $PALOMA_LOG_FILE when started via ${C_CYAN}paloma start${C_RESET}."
    info "If you started Paloma with ${C_CYAN}npm start${C_RESET}, logs go to stdout."
  fi
  echo ""
}

# ─────────────────────────────────────────────────────────
# paloma help
# ─────────────────────────────────────────────────────────

cmd_help() {
  echo -e "
${C_MAGENTA}${C_BOLD}  Paloma${C_RESET} — AI Development Partner

${C_BOLD}  USAGE${C_RESET}
    paloma [command] [options]

${C_BOLD}  COMMANDS${C_RESET}
    ${C_CYAN}start${C_RESET} [--no-browser]    Start Paloma (default command)
    ${C_CYAN}stop${C_RESET}                    Stop Paloma gracefully
    ${C_CYAN}restart${C_RESET}                 Stop and start Paloma
    ${C_CYAN}update${C_RESET}                  Pull latest code and rebuild
    ${C_CYAN}doctor${C_RESET}                  Run diagnostics and health checks
    ${C_CYAN}setup${C_RESET} [mcp|voice]       Run setup scripts (default: mcp)
    ${C_CYAN}version${C_RESET}                 Show version and system info
    ${C_CYAN}logs${C_RESET}                    Show recent bridge logs
    ${C_CYAN}uninstall${C_RESET} [--yes]       Remove Paloma completely
    ${C_CYAN}help${C_RESET}                    Show this help message

${C_BOLD}  EXAMPLES${C_RESET}
    paloma                     Start Paloma and open browser
    paloma start --no-browser  Start without opening browser
    paloma doctor              Check system health
    paloma update              Update to latest version
    paloma uninstall --yes     Uninstall without confirmation

${C_BOLD}  ENVIRONMENT${C_RESET}
    ${C_DIM}PALOMA_HOME${C_RESET}    Base directory (default: ~/.paloma)

${C_BOLD}  FILES${C_RESET}
    ${C_DIM}~/.paloma/app/${C_RESET}           Paloma source code
    ${C_DIM}~/.paloma/node/${C_RESET}          Managed Node.js runtime
    ${C_DIM}~/.paloma/bin/paloma${C_RESET}     This CLI script
    ${C_DIM}~/.paloma/mcp-settings.json${C_RESET}  MCP server configuration
"
}

# ─────────────────────────────────────────────────────────
# Main — Route to command
# ─────────────────────────────────────────────────────────

main() {
  local command="${1:-start}"
  shift 2>/dev/null || true

  case "$command" in
    start)      cmd_start "$@" ;;
    stop)       cmd_stop ;;
    restart)    cmd_restart "$@" ;;
    update)     cmd_update ;;
    doctor)     cmd_doctor ;;
    setup)      cmd_setup "$@" ;;
    uninstall)  cmd_uninstall "$@" ;;
    version)    cmd_version ;;
    -v|--version) cmd_version ;;
    logs)       cmd_logs ;;
    help)       cmd_help ;;
    -h|--help)  cmd_help ;;
    *)
      fail "Unknown command: $command"
      echo ""
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
