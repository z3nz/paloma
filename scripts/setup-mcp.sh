#!/usr/bin/env bash
set -euo pipefail

# Paloma MCP Server Setup
# Detects platform, creates ~/.paloma/ config, sets up Python venv for voice.
# Run: npm run setup (or directly: bash scripts/setup-mcp.sh)

PALOMA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$HOME/.paloma"
SETTINGS_FILE="$CONFIG_DIR/mcp-settings.json"
VENV_DIR="$PALOMA_DIR/kokoro_env"
NODE_MODULES="$PALOMA_DIR/node_modules"

echo "==> Paloma MCP Setup"
echo "    Project: $PALOMA_DIR"
echo "    Config:  $CONFIG_DIR"
echo ""

# --- Ensure ~/.paloma/ exists ---
mkdir -p "$CONFIG_DIR"

# --- Detect platform ---
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      PLATFORM="unknown" ;;
esac
echo "==> Platform: $PLATFORM"

# --- GitHub CLI (gh) ---
if ! command -v gh &>/dev/null; then
  echo "==> Installing GitHub CLI (gh)..."
  case "$PLATFORM" in
    macos)
      if command -v brew &>/dev/null; then
        brew install gh
      else
        echo "    [SKIP] Homebrew not found — install gh manually: https://cli.github.com"
      fi
      ;;
    linux)
      if command -v apt-get &>/dev/null; then
        (type -p wget >/dev/null || sudo apt-get install wget -y) \
          && sudo mkdir -p -m 755 /etc/apt/keyrings \
          && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
          && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
          && sudo apt-get update && sudo apt-get install gh -y
      else
        echo "    [SKIP] No supported package manager — install gh manually: https://cli.github.com"
      fi
      ;;
    *)
      echo "    [SKIP] Unknown platform — install gh manually: https://cli.github.com"
      ;;
  esac
  if command -v gh &>/dev/null; then
    echo "    gh $(gh --version | head -1 | awk '{print $3}') installed"
  fi
else
  echo "==> GitHub CLI: $(gh --version | head -1 | awk '{print $3}')"
fi

# --- Python venv for voice/TTS ---
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3.10 python3; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON_CMD="$cmd"
    break
  fi
done

VOICE_PACKAGES="kokoro sounddevice markdown spacy"

if [ -z "$PYTHON_CMD" ]; then
  echo "    [SKIP] No Python 3 found — voice server will not work"
  echo "    Install Python 3.10+ and re-run this script"
else
  NEED_INSTALL=false

  if [ ! -d "$VENV_DIR" ] || [ ! -f "$VENV_DIR/bin/python" ]; then
    echo "==> Creating Python venv with $PYTHON_CMD..."
    rm -rf "$VENV_DIR"
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    NEED_INSTALL=true
  elif [ ! -f "$VENV_DIR/bin/pip" ]; then
    echo "==> Venv exists but pip is missing — recreating..."
    rm -rf "$VENV_DIR"
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    NEED_INSTALL=true
  else
    # Venv exists with pip — check if all packages are installed
    for pkg in $VOICE_PACKAGES; do
      if ! "$VENV_DIR/bin/pip" show "$pkg" &>/dev/null; then
        echo "==> Missing package: $pkg — will install"
        NEED_INSTALL=true
        break
      fi
    done
  fi

  if [ "$NEED_INSTALL" = true ]; then
    echo "==> Installing voice dependencies..."
    "$VENV_DIR/bin/pip" install --quiet $VOICE_PACKAGES
    echo "    Done."
  else
    echo "==> Python venv OK at $VENV_DIR"
  fi
fi

# --- Generate mcp-settings.json ---
# Preserve existing API keys if the file already exists
BRAVE_KEY=""
CF_TOKEN=""
CF_ZONE=""

if [ -f "$SETTINGS_FILE" ]; then
  echo "==> Found existing $SETTINGS_FILE — preserving API keys"
  # Extract existing keys (simple grep, no jq dependency)
  BRAVE_KEY="$(grep -o '"BRAVE_API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | head -1 | sed 's/.*"BRAVE_API_KEY"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || true)"
  CF_TOKEN="$(grep -o '"CLOUDFLARE_API_TOKEN"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | head -1 | sed 's/.*"CLOUDFLARE_API_TOKEN"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || true)"
  CF_ZONE="$(grep -o '"CLOUDFLARE_ZONE_ID"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | head -1 | sed 's/.*"CLOUDFLARE_ZONE_ID"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || true)"
fi

# Use placeholders if no existing keys
BRAVE_KEY="${BRAVE_KEY:-YOUR_BRAVE_API_KEY}"
CF_TOKEN="${CF_TOKEN:-YOUR_CLOUDFLARE_API_TOKEN}"
CF_ZONE="${CF_ZONE:-YOUR_CLOUDFLARE_ZONE_ID}"

# Extract existing Gmail recipient if set
GMAIL_RECIPIENT=""
if [ -f "$SETTINGS_FILE" ]; then
  GMAIL_RECIPIENT="$(grep -o '"GMAIL_RECIPIENT"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | head -1 | sed 's/.*"GMAIL_RECIPIENT"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || true)"
fi
GMAIL_RECIPIENT="${GMAIL_RECIPIENT:-adamlynchmob@gmail.com}"

# Extract existing Postiz key
POSTIZ_KEY=""
if [ -f "$SETTINGS_FILE" ]; then
  POSTIZ_KEY="$(grep -o '"POSTIZ_API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | head -1 | sed 's/.*"POSTIZ_API_KEY"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || true)"
fi
POSTIZ_KEY="${POSTIZ_KEY:-CONFIGURE_AFTER_DOCKER_SETUP}"

# Check if codex CLI is available
CODEX_BLOCK=""
if command -v codex &>/dev/null; then
  CODEX_BLOCK=',
    "codex": {
      "command": "codex",
      "args": ["mcp-server"]
    }'
fi

cat > "$SETTINGS_FILE" <<ENDJSON
{
  "servers": {
    "brave-search": {
      "command": "node",
      "args": ["$NODE_MODULES/@modelcontextprotocol/server-brave-search/dist/index.js"],
      "env": {
        "BRAVE_API_KEY": "$BRAVE_KEY"
      }
    },
    "git": {
      "command": "node",
      "args": ["$NODE_MODULES/@mseep/git-mcp-server/dist/index.js"]
    },
    "shell": {
      "command": "node",
      "args": ["$NODE_MODULES/@kevinwatt/shell-mcp/build/index.js"]
    },
    "filesystem": {
      "command": "node",
      "args": ["$NODE_MODULES/@modelcontextprotocol/server-filesystem/dist/index.js", "$HOME"]
    },
    "web": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/web.js"]
    },
    "fs-extra": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/fs-extra.js"]
    },
    "exec": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/exec.js"]
    },
    "cloudflare-dns": {
      "command": "node",
      "args": ["$NODE_MODULES/@thelord/mcp-cloudflare/dist/cli.js"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "$CF_TOKEN",
        "CLOUDFLARE_ZONE_ID": "$CF_ZONE"
      }
    },
    "voice": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/voice.js"]
    },
    "memory": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/memory.js"]
    },
    "ollama": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/ollama.js"]
    },
    "gmail": {
      "command": "node",
      "args": ["$PALOMA_DIR/mcp-servers/gmail.js"],
      "env": {
        "GMAIL_RECIPIENT": "$GMAIL_RECIPIENT",
        "GMAIL_SENDER": "adambookpro.paloma@verifesto.com"
      }
    },
    "social-poster": {
      "command": "node",
      "args": ["$PALOMA_DIR/projects/social-poster/server.js"],
      "env": {
        "POSTIZ_API_URL": "http://localhost:4007",
        "POSTIZ_API_KEY": "$POSTIZ_KEY"
      }
    }$CODEX_BLOCK
  }
}
ENDJSON

echo "==> Wrote $SETTINGS_FILE"

# --- Ensure .paloma/mcp.json exists (permissions/auto-execute) ---
MCP_JSON="$PALOMA_DIR/.paloma/mcp.json"
if [ ! -f "$MCP_JSON" ]; then
  cat > "$MCP_JSON" <<'ENDJSON'
{
  "enabled": [
    "filesystem", "git", "shell", "web", "fs-extra",
    "voice", "memory", "codex", "brave-search", "exec", "cloudflare-dns"
  ],
  "autoExecute": [
    "filesystem",
    "brave-search",
    { "server": "shell", "tools": ["shell_find", "shell_grep", "shell_ls", "shell_cat", "shell_pwd", "shell_echo", "shell_date", "shell_uptime", "shell_free", "shell_df", "shell_w", "shell_ps"] },
    { "server": "git", "tools": ["git_diff", "git_log", "git_status", "git_show", "git_branch"] },
    "voice",
    "memory",
    "fs-extra"
  ]
}
ENDJSON
  echo "==> Created $MCP_JSON (permissions)"
else
  echo "==> $MCP_JSON already exists"
fi

# --- Git hook: pre-commit DNA validation ---
# src/prompts/base.js and phases.js are template literals — unescaped backticks
# cause SyntaxError that crashes the bridge AND the Vite build.
PRECOMMIT_FILE="$PALOMA_DIR/.git/hooks/pre-commit"
cat > "$PRECOMMIT_FILE" <<'ENDHOOK'
#!/bin/bash
# Paloma pre-commit hook: validate DNA files and their consumers.
STAGED=$(git diff --cached --name-only)
if echo "$STAGED" | grep -qE '^(src/prompts/(base|phases)\.js|bridge/pillar-manager\.js)$'; then
  echo "[pre-commit] DNA/bridge files changed — validating..."
  node scripts/validate-dna.js
  if [ $? -ne 0 ]; then
    echo ""
    echo "[pre-commit] ❌ BLOCKED: DNA validation failed."
    echo "             Fix the errors above before committing."
    exit 1
  fi
fi
exit 0
ENDHOOK
chmod +x "$PRECOMMIT_FILE"
echo "==> Installed pre-commit hook (DNA validation)"

# --- Git hook: auto-sync Claude Code memory on Paloma commits ---
HOOK_FILE="$PALOMA_DIR/.git/hooks/post-commit"
cat > "$HOOK_FILE" <<'ENDHOOK'
#!/bin/bash
MEMORY_DIR="$HOME/.claude/projects/-home-adam-paloma/memory"
if [ -d "$MEMORY_DIR/.git" ]; then
  cd "$MEMORY_DIR"
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')" --quiet
    git push --quiet 2>/dev/null &
  fi
fi
ENDHOOK
chmod +x "$HOOK_FILE"
echo "==> Installed post-commit hook (memory auto-sync)"

# --- Summary ---
echo ""
echo "==> Setup complete!"
echo ""
echo "    MCP servers configured:"
echo "      - filesystem (file operations)"
echo "      - git (version control)"
echo "      - shell (system queries)"
echo "      - web (fetch URLs, download files)"
echo "      - fs-extra (delete, copy)"
echo "      - exec (bash execution)"
echo "      - memory (persistent semantic memory)"
echo "      - voice (Kokoro TTS)"
echo "      - brave-search (web search)"
echo "      - ollama (local AI models)"
echo "      - cloudflare-dns (DNS management)"
echo "      - gmail (email send/receive)"
echo "      - social-poster (cross-platform social media)"
if command -v codex &>/dev/null; then
  echo "      - codex (OpenAI Codex MCP)"
fi
echo ""

# Check for placeholder keys
if [ "$BRAVE_KEY" = "YOUR_BRAVE_API_KEY" ]; then
  echo "    [!] Set your Brave API key in $SETTINGS_FILE"
fi
if [ "$CF_TOKEN" = "YOUR_CLOUDFLARE_API_TOKEN" ]; then
  echo "    [!] Set your Cloudflare credentials in $SETTINGS_FILE"
fi
echo ""
echo "    Run: npm start"
