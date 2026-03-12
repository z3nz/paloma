#!/usr/bin/env bash
set -euo pipefail

# ╔══════════════════════════════════════════════════════════════════╗
# ║  Paloma — First Run Setup                                       ║
# ║  One script to go from fresh clone to fully running.             ║
# ║                                                                  ║
# ║  Usage:  bash scripts/first-run.sh                               ║
# ║  Or:     npm run first-run                                       ║
# ╚══════════════════════════════════════════════════════════════════╝

PALOMA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_PROJECT_DIR="$CLAUDE_CONFIG_DIR/projects/-home-adam-Projects-paloma"

# Colors
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_DIM='\033[2m'
C_MAGENTA='\033[95m'
C_CYAN='\033[96m'
C_GREEN='\033[32m'
C_YELLOW='\033[33m'
C_RED='\033[31m'

ok()   { echo -e "  ${C_GREEN}✔${C_RESET} $1"; }
warn() { echo -e "  ${C_YELLOW}▲${C_RESET} $1"; }
fail() { echo -e "  ${C_RED}✖${C_RESET} $1"; }
info() { echo -e "  ${C_CYAN}●${C_RESET} $1"; }
step() { echo -e "\n${C_MAGENTA}${C_BOLD}[$1/4]${C_RESET} ${C_BOLD}$2${C_RESET}"; }

echo -e "
${C_MAGENTA}██████╗  █████╗ ██╗      ██████╗ ███╗   ███╗ █████╗${C_RESET}
${C_MAGENTA}██╔══██╗██╔══██╗██║     ██╔═══██╗████╗ ████║██╔══██╗${C_RESET}
${C_MAGENTA}██████╔╝███████║██║     ██║   ██║██╔████╔██║███████║${C_RESET}
${C_MAGENTA}██╔═══╝ ██╔══██║██║     ██║   ██║██║╚██╔╝██║██╔══██║${C_RESET}
${C_MAGENTA}██║     ██║  ██║███████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║${C_RESET}
${C_MAGENTA}╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝${C_RESET}
${C_DIM}          First Run — New Machine Setup${C_RESET}
"

# ─────────────────────────────────────────────────────────
# Step 1: Check Prerequisites
# ─────────────────────────────────────────────────────────
step 1 "Checking prerequisites"

MISSING=0

# Node.js
if command -v node &>/dev/null; then
  NODE_VER="$(node --version)"
  ok "Node.js $NODE_VER"
else
  fail "Node.js not found — install from https://nodejs.org"
  MISSING=1
fi

# npm
if command -v npm &>/dev/null; then
  NPM_VER="$(npm --version)"
  ok "npm $NPM_VER"
else
  fail "npm not found"
  MISSING=1
fi

# Python 3
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3.10 python3; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON_CMD="$cmd"
    break
  fi
done
if [ -n "$PYTHON_CMD" ]; then
  PY_VER="$($PYTHON_CMD --version)"
  ok "$PY_VER"
else
  warn "Python 3 not found — voice TTS will not work (optional)"
fi

# Claude CLI
if command -v claude &>/dev/null; then
  ok "Claude CLI installed"
else
  warn "Claude CLI not found — install: npm install -g @anthropic-ai/claude-code"
fi

# Git
if command -v git &>/dev/null; then
  ok "git $(git --version | cut -d' ' -f3)"
else
  fail "git not found"
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  fail "Missing required tools. Install them and re-run this script."
  exit 1
fi

# ─────────────────────────────────────────────────────────
# Step 2: Install Dependencies
# ─────────────────────────────────────────────────────────
step 2 "Installing dependencies"

cd "$PALOMA_DIR"

if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
  info "node_modules exists — running npm install to sync..."
else
  info "Installing npm packages (first time, may take a minute)..."
fi
npm install --loglevel=warn 2>&1 | tail -3
ok "npm packages installed"

# ─────────────────────────────────────────────────────────
# Step 3: MCP & Voice Setup
# ─────────────────────────────────────────────────────────
step 3 "Configuring MCP servers & voice"

bash "$PALOMA_DIR/scripts/setup-mcp.sh"
ok "MCP configuration complete"

# ─────────────────────────────────────────────────────────
# Step 4: Claude Code Configuration
# ─────────────────────────────────────────────────────────
step 4 "Configuring Claude Code"

# Global settings — Opus model default
mkdir -p "$CLAUDE_CONFIG_DIR"
if [ ! -f "$CLAUDE_CONFIG_DIR/settings.json" ]; then
  cat > "$CLAUDE_CONFIG_DIR/settings.json" <<'ENDJSON'
{
  "permissions": {
    "allow": [],
    "deny": []
  },
  "model": "claude-opus-4-6"
}
ENDJSON
  ok "Global settings: model → claude-opus-4-6"
else
  info "Global settings already exist — skipping"
fi

# Project-level settings — full MCP permissions (hog wild mode)
mkdir -p "$CLAUDE_PROJECT_DIR"
if [ ! -f "$CLAUDE_PROJECT_DIR/settings.json" ]; then
  cat > "$CLAUDE_PROJECT_DIR/settings.json" <<'ENDJSON'
{
  "permissions": {
    "allow": [
      "mcp__paloma__*",
      "Read",
      "Edit",
      "Write",
      "Bash",
      "Glob",
      "Grep",
      "Agent",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "TodoWrite"
    ],
    "deny": []
  },
  "model": "claude-opus-4-6"
}
ENDJSON
  ok "Project settings: Opus model + all tools auto-approved"
else
  info "Project settings already exist — skipping"
fi

# ─────────────────────────────────────────────────────────
# Done!
# ─────────────────────────────────────────────────────────
echo ""
echo -e "${C_GREEN}${C_BOLD}  ✔ Paloma is ready!${C_RESET}"
echo ""
echo -e "  ${C_DIM}Start Paloma:${C_RESET}  ${C_CYAN}npm start${C_RESET}"
echo -e "  ${C_DIM}Browser:${C_RESET}       ${C_CYAN}http://localhost:5173${C_RESET}  (opens automatically)"
echo -e "  ${C_DIM}Bridge:${C_RESET}        ${C_CYAN}ws://localhost:19191${C_RESET}"
echo -e "  ${C_DIM}MCP Proxy:${C_RESET}     ${C_CYAN}http://localhost:19192${C_RESET}"
echo ""
echo -e "  ${C_DIM}Optional:${C_RESET}"
echo -e "    Gmail auth:  ${C_CYAN}node mcp-servers/gmail.js auth${C_RESET}"
echo -e "    Brave key:   ${C_CYAN}Edit ~/.paloma/mcp-settings.json${C_RESET}"
echo ""
