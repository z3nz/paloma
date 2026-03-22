#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  Paloma Universal Installer                                         ║
# ║                                                                     ║
# ║  One command to install Paloma on any Linux/macOS/WSL2 machine.     ║
# ║  No prerequisites beyond curl and git.                              ║
# ║                                                                     ║
# ║  Usage:                                                             ║
# ║    curl -fsSL https://raw.githubusercontent.com/adam/paloma/main/install.sh | bash  ║
# ║    bash install.sh [--yes] [--service] [--help]                     ║
# ╚══════════════════════════════════════════════════════════════════════╝

main() {

set -euo pipefail

# ─────────────────────────────────────────────────────────
# Configuration — bump these when upgrading
# ─────────────────────────────────────────────────────────

NODE_VERSION="22.14.0"
PALOMA_VERSION="0.1.0"
PALOMA_REPO="https://github.com/adam/paloma.git"

PALOMA_HOME="${PALOMA_HOME:-$HOME/.paloma}"
PALOMA_APP="$PALOMA_HOME/app"
PALOMA_NODE_DIR="$PALOMA_HOME/node"
PALOMA_BIN_DIR="$PALOMA_HOME/bin"

# ─────────────────────────────────────────────────────────
# Flags
# ─────────────────────────────────────────────────────────

FLAG_YES=false
FLAG_SERVICE=false
FLAG_SUDO=false
FLAG_HELP=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y)     FLAG_YES=true ;;
    --service|-s) FLAG_SERVICE=true ;;
    --sudo)       FLAG_SUDO=true ;;
    --help|-h)    FLAG_HELP=true ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: install.sh [--yes] [--service] [--sudo] [--help]"
      exit 1
      ;;
  esac
done

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

ok()      { echo -e "  ${C_GREEN}✔${C_RESET} $1"; }
warn()    { echo -e "  ${C_YELLOW}▲${C_RESET} $1"; }
fail()    { echo -e "  ${C_RED}✖${C_RESET} $1"; }
info()    { echo -e "  ${C_CYAN}●${C_RESET} $1"; }
step()    { echo -e "\n${C_MAGENTA}${C_BOLD}  [$1/$TOTAL_STEPS] $2${C_RESET}"; }

TOTAL_STEPS=7

# ─────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────

if [ "$FLAG_HELP" = true ]; then
  echo -e "
${C_MAGENTA}${C_BOLD}  Paloma Universal Installer${C_RESET}

${C_BOLD}  USAGE${C_RESET}
    curl -fsSL <url>/install.sh | bash
    bash install.sh [options]

${C_BOLD}  OPTIONS${C_RESET}
    ${C_CYAN}--yes, -y${C_RESET}        Non-interactive mode (accept all defaults)
    ${C_CYAN}--service, -s${C_RESET}    Install as a system service (systemd/launchd)
    ${C_CYAN}--sudo${C_RESET}           Use sudo to symlink CLI to /usr/local/bin
    ${C_CYAN}--help, -h${C_RESET}       Show this help message

${C_BOLD}  WHAT IT DOES${C_RESET}
    1. Detects your OS and architecture
    2. Downloads Node.js ${NODE_VERSION} LTS into ~/.paloma/node/
    3. Clones the Paloma repository into ~/.paloma/app/
    4. Installs npm dependencies
    5. Runs MCP setup (generates config files)
    6. Installs the 'paloma' CLI command
    7. Reports available AI backends

${C_BOLD}  ENVIRONMENT${C_RESET}
    ${C_DIM}PALOMA_HOME${C_RESET}    Override install directory (default: ~/.paloma)

${C_BOLD}  AFTER INSTALL${C_RESET}
    paloma            Start Paloma and open browser
    paloma doctor     Run diagnostics
    paloma help       Show all commands
"
  exit 0
fi

# ─────────────────────────────────────────────────────────
# Temp directory with cleanup trap
# ─────────────────────────────────────────────────────────

TEMP_DIR=""

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

TEMP_DIR="$(mktemp -d)"

# ─────────────────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────────────────

echo -e "
${C_MAGENTA}${C_BOLD}  ╔═══════════════════════════════════════╗${C_RESET}
${C_MAGENTA}${C_BOLD}  ║       Paloma Universal Installer      ║${C_RESET}
${C_MAGENTA}${C_BOLD}  ║           v${PALOMA_VERSION}                       ║${C_RESET}
${C_MAGENTA}${C_BOLD}  ╚═══════════════════════════════════════╝${C_RESET}
"

# ─────────────────────────────────────────────────────────
# Detect existing installation
# ─────────────────────────────────────────────────────────

IS_UPDATE=false
if [ -d "$PALOMA_APP" ] && [ -f "$PALOMA_APP/package.json" ]; then
  IS_UPDATE=true
  info "Existing installation detected at ${C_CYAN}${PALOMA_HOME}${C_RESET}"
  info "Running in ${C_CYAN}update mode${C_RESET} — your config will be preserved."
  echo ""
fi

# ═════════════════════════════════════════════════════════
# STEP 1: Detect OS and Architecture
# ═════════════════════════════════════════════════════════

step 1 "Detecting platform..."

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)   OS_NAME="linux" ;;
  Darwin)  OS_NAME="darwin" ;;
  *)
    fail "Unsupported operating system: $OS"
    fail "Paloma supports Linux, macOS, and WSL2."
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)   ARCH_NAME="x64" ;;
  aarch64|arm64)   ARCH_NAME="arm64" ;;
  *)
    fail "Unsupported architecture: $ARCH"
    fail "Paloma supports x64 and arm64."
    exit 1
    ;;
esac

# WSL2 detection
IS_WSL=false
if [ "$OS_NAME" = "linux" ] && [ -f /proc/version ]; then
  if grep -qi microsoft /proc/version 2>/dev/null; then
    IS_WSL=true
  fi
fi

ok "OS: ${OS_NAME} (${ARCH_NAME})"
if [ "$IS_WSL" = true ]; then
  ok "WSL2 detected"
fi

# ═════════════════════════════════════════════════════════
# STEP 2: Check prerequisites
# ═════════════════════════════════════════════════════════

step 2 "Checking prerequisites..."

MISSING_PREREQS=false

# curl
if command -v curl &>/dev/null; then
  ok "curl found"
else
  fail "curl is required but not found"
  if [ "$OS_NAME" = "linux" ]; then
    info "Install with: ${C_CYAN}sudo apt install curl${C_RESET}  (Debian/Ubuntu)"
    info "          or: ${C_CYAN}sudo dnf install curl${C_RESET}  (Fedora/RHEL)"
  elif [ "$OS_NAME" = "darwin" ]; then
    info "curl should be pre-installed on macOS. Try: ${C_CYAN}xcode-select --install${C_RESET}"
  fi
  MISSING_PREREQS=true
fi

# git
if command -v git &>/dev/null; then
  ok "git found ($(git --version | head -1))"
else
  fail "git is required but not found"
  if [ "$OS_NAME" = "linux" ]; then
    info "Install with: ${C_CYAN}sudo apt install git${C_RESET}  (Debian/Ubuntu)"
    info "          or: ${C_CYAN}sudo dnf install git${C_RESET}  (Fedora/RHEL)"
  elif [ "$OS_NAME" = "darwin" ]; then
    info "Install with: ${C_CYAN}xcode-select --install${C_RESET}"
  fi
  MISSING_PREREQS=true
fi

if [ "$MISSING_PREREQS" = true ]; then
  echo ""
  fail "Missing prerequisites. Install them and re-run this script."
  exit 1
fi

# ═════════════════════════════════════════════════════════
# STEP 3: Download Node.js
# ═════════════════════════════════════════════════════════

step 3 "Setting up Node.js ${NODE_VERSION}..."

# Check if managed Node.js already exists and matches version
NEED_NODE=true
if [ -x "$PALOMA_NODE_DIR/bin/node" ]; then
  EXISTING_NODE_VERSION="$("$PALOMA_NODE_DIR/bin/node" --version 2>/dev/null || echo "")"
  if [ "$EXISTING_NODE_VERSION" = "v${NODE_VERSION}" ]; then
    ok "Node.js v${NODE_VERSION} already installed"
    NEED_NODE=false
  else
    info "Upgrading Node.js from ${EXISTING_NODE_VERSION:-unknown} to v${NODE_VERSION}"
  fi
fi

if [ "$NEED_NODE" = true ]; then
  # Determine download URL
  if [ "$OS_NAME" = "linux" ]; then
    NODE_PKG="node-v${NODE_VERSION}-linux-${ARCH_NAME}.tar.xz"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_PKG}"
  elif [ "$OS_NAME" = "darwin" ]; then
    NODE_PKG="node-v${NODE_VERSION}-darwin-${ARCH_NAME}.tar.gz"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_PKG}"
  fi

  info "Downloading from nodejs.org..."
  node_archive="$TEMP_DIR/$NODE_PKG"

  if ! curl -fSL --progress-bar "$NODE_URL" -o "$node_archive"; then
    fail "Failed to download Node.js from $NODE_URL"
    fail "Check your internet connection and try again."
    exit 1
  fi

  # Create/clean the node directory
  mkdir -p "$PALOMA_NODE_DIR"
  rm -rf "${PALOMA_NODE_DIR:?}/"*

  info "Extracting..."
  if [[ "$NODE_PKG" == *.tar.xz ]]; then
    tar -xJf "$node_archive" -C "$PALOMA_NODE_DIR" --strip-components=1
  else
    tar -xzf "$node_archive" -C "$PALOMA_NODE_DIR" --strip-components=1
  fi

  # Verify
  if [ -x "$PALOMA_NODE_DIR/bin/node" ]; then
    installed_version="$("$PALOMA_NODE_DIR/bin/node" --version)"
    ok "Node.js ${installed_version} installed"
  else
    fail "Node.js extraction failed — binary not found"
    exit 1
  fi

  # Clean up archive
  rm -f "$node_archive"
fi

# Export managed Node.js to PATH for the rest of this script
export PATH="$PALOMA_NODE_DIR/bin:$PATH"

# ═════════════════════════════════════════════════════════
# STEP 4: Clone or update repository
# ═════════════════════════════════════════════════════════

step 4 "Setting up Paloma source code..."

mkdir -p "$PALOMA_HOME"

if [ "$IS_UPDATE" = true ]; then
  info "Updating existing installation..."
  cd "$PALOMA_APP"

  # Stash any local changes (shouldn't happen, but be safe)
  if ! git diff --quiet 2>/dev/null; then
    warn "Local changes detected — stashing before update"
    git stash --quiet 2>/dev/null || true
  fi

  if git pull --ff-only 2>/dev/null; then
    ok "Repository updated"
  else
    warn "Fast-forward pull failed — trying full pull"
    if git pull --rebase 2>/dev/null; then
      ok "Repository updated (with rebase)"
    else
      fail "Could not update repository. You may need to resolve conflicts manually."
      fail "Directory: $PALOMA_APP"
      exit 1
    fi
  fi
else
  info "Cloning Paloma repository..."
  if git clone --depth=1 "$PALOMA_REPO" "$PALOMA_APP" 2>/dev/null; then
    ok "Repository cloned"
  else
    fail "Failed to clone repository from $PALOMA_REPO"
    fail "Check your internet connection and repository access."
    exit 1
  fi
fi

# ═════════════════════════════════════════════════════════
# STEP 5: Install dependencies
# ═════════════════════════════════════════════════════════

step 5 "Installing dependencies..."

cd "$PALOMA_APP"

info "Running npm install (this may take a minute)..."
if "$PALOMA_NODE_DIR/bin/npm" install --loglevel=warn 2>&1 | tail -5; then
  ok "Dependencies installed"
else
  fail "npm install failed"
  fail "Try running manually: cd $PALOMA_APP && $PALOMA_NODE_DIR/bin/npm install"
  exit 1
fi

# Run MCP setup if the script exists
if [ -f "$PALOMA_APP/scripts/setup-mcp.sh" ]; then
  info "Running MCP setup..."
  if bash "$PALOMA_APP/scripts/setup-mcp.sh" 2>/dev/null; then
    ok "MCP configuration generated"
  else
    warn "MCP setup had issues — run 'paloma setup mcp' later to fix"
  fi
fi

# Build frontend
info "Building frontend..."
if "$PALOMA_NODE_DIR/bin/npx" vite build 2>/dev/null; then
  ok "Frontend built"
else
  warn "Frontend build failed — Paloma will build on first start"
fi

# ═════════════════════════════════════════════════════════
# STEP 6: Install CLI command
# ═════════════════════════════════════════════════════════

step 6 "Installing paloma CLI..."

# Create bin directory and copy CLI
mkdir -p "$PALOMA_BIN_DIR"
cp "$PALOMA_APP/scripts/paloma-cli.sh" "$PALOMA_BIN_DIR/paloma"
chmod +x "$PALOMA_BIN_DIR/paloma"
ok "CLI installed to ${C_CYAN}${PALOMA_BIN_DIR}/paloma${C_RESET}"

# Try to symlink to /usr/local/bin for system-wide access
# Default: silent-fail, no sudo prompt. Use --sudo to opt in.
SYMLINK_OK=false
if [ -d "/usr/local/bin" ]; then
  if [ -w "/usr/local/bin" ]; then
    ln -sf "$PALOMA_BIN_DIR/paloma" /usr/local/bin/paloma
    SYMLINK_OK=true
  elif [ "$FLAG_SUDO" = true ] && command -v sudo &>/dev/null; then
    info "Creating system symlink with sudo..."
    if sudo ln -sf "$PALOMA_BIN_DIR/paloma" /usr/local/bin/paloma 2>/dev/null; then
      SYMLINK_OK=true
    fi
  fi
fi

if [ "$SYMLINK_OK" = true ]; then
  ok "Symlinked to ${C_CYAN}/usr/local/bin/paloma${C_RESET}"
else
  info "Could not create /usr/local/bin symlink — adding to PATH instead"
fi

# PATH injection — ensure ~/.paloma/bin is in PATH via shell profile
PATH_LINE='export PATH="$HOME/.paloma/bin:$PATH"'
PROFILE_UPDATED=false

inject_path() {
  local profile_file="$1"
  if [ -f "$profile_file" ]; then
    if ! grep -qF '.paloma/bin' "$profile_file" 2>/dev/null; then
      echo "" >> "$profile_file"
      echo "# Paloma CLI" >> "$profile_file"
      echo "$PATH_LINE" >> "$profile_file"
      ok "Added PATH to ${C_CYAN}${profile_file}${C_RESET}"
      PROFILE_UPDATED=true
      return 0
    else
      ok "PATH already configured in ${C_CYAN}${profile_file}${C_RESET}"
      PROFILE_UPDATED=true
      return 0
    fi
  fi
  return 1
}

# Detect and update the right shell profile
CURRENT_SHELL="$(basename "${SHELL:-/bin/bash}")"
case "$CURRENT_SHELL" in
  zsh)
    inject_path "$HOME/.zshrc" || inject_path "$HOME/.zprofile" || true
    ;;
  bash)
    # On macOS, bash reads .bash_profile; on Linux, .bashrc
    if [ "$OS_NAME" = "darwin" ]; then
      inject_path "$HOME/.bash_profile" || inject_path "$HOME/.bashrc" || inject_path "$HOME/.profile" || true
    else
      inject_path "$HOME/.bashrc" || inject_path "$HOME/.bash_profile" || inject_path "$HOME/.profile" || true
    fi
    ;;
  *)
    inject_path "$HOME/.profile" || true
    ;;
esac

# ═════════════════════════════════════════════════════════
# STEP 7: Write metadata & detect backends
# ═════════════════════════════════════════════════════════

step 7 "Finalizing installation..."

# Write install metadata
cat > "$PALOMA_HOME/install-metadata.json" << METADATA_EOF
{
  "version": "${PALOMA_VERSION}",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "method": "$([ "$IS_UPDATE" = true ] && echo 'update' || echo 'git-clone')",
  "nodeVersion": "${NODE_VERSION}",
  "os": "${OS_NAME}",
  "arch": "${ARCH_NAME}",
  "wsl": ${IS_WSL},
  "home": "${PALOMA_HOME}"
}
METADATA_EOF

ok "Install metadata written"

# Detect AI backends
echo ""
info "${C_BOLD}AI Backend Detection:${C_RESET}"

BACKENDS_FOUND=0

check_backend() {
  local name="$1"
  local cmd="$2"
  local install_hint="$3"

  if eval "$cmd" &>/dev/null; then
    local version
    version="$(eval "$cmd" 2>/dev/null | head -1)"
    ok "${name}: ${C_DIM}${version}${C_RESET}"
    BACKENDS_FOUND=$((BACKENDS_FOUND + 1))
  else
    warn "${name}: not found"
    info "  Install: ${C_CYAN}${install_hint}${C_RESET}"
  fi
}

check_backend "Claude CLI"      "claude --version"         "npm install -g @anthropic-ai/claude-code"
check_backend "Codex CLI"       "codex --version"          "npm install -g @openai/codex"
check_backend "GitHub Copilot"  "gh copilot --version"     "gh extension install github/gh-copilot"
check_backend "Gemini CLI"      "gemini --version"         "npm install -g @google/gemini-cli"
check_backend "Ollama"          "ollama --version"         "curl -fsSL https://ollama.com/install.sh | sh"

if [ "$BACKENDS_FOUND" -eq 0 ]; then
  echo ""
  warn "No AI backends detected. Install at least one to use Paloma."
  info "Recommended: ${C_CYAN}npm install -g @anthropic-ai/claude-code${C_RESET}"
fi

# ═════════════════════════════════════════════════════════
# Service installation (Phase 2 — placeholder)
# ═════════════════════════════════════════════════════════

if [ "$FLAG_SERVICE" = true ]; then
  echo ""
  warn "Service installation is coming in Phase 2."
  info "For now, start Paloma manually with: ${C_CYAN}paloma start${C_RESET}"
fi

# ═════════════════════════════════════════════════════════
# Success!
# ═════════════════════════════════════════════════════════

echo -e "
${C_GREEN}${C_BOLD}  ╔═══════════════════════════════════════╗${C_RESET}
${C_GREEN}${C_BOLD}  ║     Paloma installed successfully!    ║${C_RESET}
${C_GREEN}${C_BOLD}  ╚═══════════════════════════════════════╝${C_RESET}
"

if [ "$IS_UPDATE" = true ]; then
  ok "Paloma has been updated to v${PALOMA_VERSION}"
  info "Restart with: ${C_CYAN}paloma restart${C_RESET}"
else
  ok "Paloma v${PALOMA_VERSION} is ready"
  echo ""
  info "${C_BOLD}Next steps:${C_RESET}"
  echo ""

  if [ "$PROFILE_UPDATED" = true ] && [ "$SYMLINK_OK" = false ]; then
    echo -e "  ${C_DIM}1.${C_RESET} Reload your shell:   ${C_CYAN}source ~/.bashrc${C_RESET}  ${C_DIM}(or restart your terminal)${C_RESET}"
    echo -e "  ${C_DIM}2.${C_RESET} Start Paloma:        ${C_CYAN}paloma${C_RESET}"
    echo -e "  ${C_DIM}3.${C_RESET} Run diagnostics:     ${C_CYAN}paloma doctor${C_RESET}"
  else
    echo -e "  ${C_DIM}1.${C_RESET} Start Paloma:        ${C_CYAN}paloma${C_RESET}"
    echo -e "  ${C_DIM}2.${C_RESET} Run diagnostics:     ${C_CYAN}paloma doctor${C_RESET}"
  fi

  if [ "$BACKENDS_FOUND" -eq 0 ]; then
    echo -e "  ${C_DIM}3.${C_RESET} Install a backend:   ${C_CYAN}npm install -g @anthropic-ai/claude-code${C_RESET}"
  fi
fi

echo ""
info "Home directory: ${C_CYAN}${PALOMA_HOME}${C_RESET}"
info "Documentation: ${C_CYAN}paloma help${C_RESET}"
echo ""

}

# Wrap everything in main() to prevent partial-download execution
main "$@"
