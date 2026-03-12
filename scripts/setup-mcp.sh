#!/usr/bin/env bash
set -euo pipefail

# Paloma MCP Server Setup
# Detects platform, creates ~/.paloma/ config, sets up Python venv for voice.
# Run: npm run setup (or directly: bash scripts/setup-mcp.sh)

PALOMA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MEMORY_REPO="$HOME/paloma-memory"
CONFIG_DIR="$HOME/.paloma"
SETTINGS_FILE="$CONFIG_DIR/mcp-settings.json"
VENV_DIR="$PALOMA_DIR/kokoro_env"

echo "==> Paloma MCP Setup"
echo "    Project: $PALOMA_DIR"
echo "    Config:  $CONFIG_DIR"
echo ""

# --- Ensure ~/.paloma/ exists ---
mkdir -p "$CONFIG_DIR"

# --- Clone paloma-memory repo if not present ---
if [ -d "$MEMORY_REPO" ] && [ -f "$MEMORY_REPO/server.js" ]; then
  echo "==> Memory repo already exists at $MEMORY_REPO"
else
  echo "==> Cloning paloma-memory repo..."
  if git clone git@github.com:z3nz/paloma-memory.git "$MEMORY_REPO" 2>/dev/null; then
    echo "    Done."
  else
    echo "    [WARN] Could not clone paloma-memory — creating local copy"
    mkdir -p "$MEMORY_REPO"
    cp "$PALOMA_DIR/mcp-servers/memory.js" "$MEMORY_REPO/server.js" 2>/dev/null || true
    mkdir -p "$MEMORY_REPO/data"
  fi
fi

# Install memory server dependencies
if [ -f "$MEMORY_REPO/package.json" ] && [ ! -d "$MEMORY_REPO/node_modules" ]; then
  echo "==> Installing memory server dependencies..."
  (cd "$MEMORY_REPO" && npm install --quiet)
  echo "    Done."
fi

# --- Detect platform ---
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      PLATFORM="unknown" ;;
esac
echo "==> Platform: $PLATFORM"

# --- Python venv for voice/TTS ---
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3.10 python3; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON_CMD="$cmd"
    break
  fi
done

if [ -z "$PYTHON_CMD" ]; then
  echo "    [SKIP] No Python 3 found — voice server will not work"
  echo "    Install Python 3.10+ and re-run this script"
else
  if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python" ]; then
    echo "==> Python venv already exists at $VENV_DIR"
  else
    echo "==> Creating Python venv with $PYTHON_CMD..."
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    echo "==> Installing voice dependencies..."
    "$VENV_DIR/bin/pip" install --quiet kokoro sounddevice markdown spacy
    echo "    Done."
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
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "$BRAVE_KEY"
      }
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@mseep/git-mcp-server"]
    },
    "shell": {
      "command": "npx",
      "args": ["-y", "@kevinwatt/shell-mcp"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"]
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
      "command": "npx",
      "args": ["-y", "@thelord/mcp-cloudflare"],
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
      "args": ["$MEMORY_REPO/server.js"]
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
echo "      - cloudflare-dns (DNS management)"
echo "      - gmail (email send/receive)"
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
