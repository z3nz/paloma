#!/usr/bin/env bash
#
# paloma-sync.sh — Git sync for Paloma repository.
#
# Fetches from origin and fast-forwards if possible.
# If conflicts arise, reports them and exits — NEVER spawns AI agents.
#
# SAFETY: This script is called from Claude Code SessionStart hooks.
# Spawning `claude` from here would trigger the hook recursively,
# creating an infinite process bomb. This lesson was learned the hard
# way on 2026-03-18 when recursive Claude spawns exhausted system
# resources. See .paloma/lessons/architecture.md for details.
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Recursion guard ─────────────────────────────────────────────────
# Prevent recursive execution if called from within a Claude subprocess
if [ "${PALOMA_SYNC_RUNNING:-}" = "1" ]; then
  exit 0
fi
export PALOMA_SYNC_RUNNING=1

# Lock file to prevent concurrent runs
LOCK_FILE="/tmp/paloma-sync.lock"
if [ -f "$LOCK_FILE" ]; then
  # Check if the lock is stale (older than 60 seconds)
  if [ "$(find "$LOCK_FILE" -mmin +1 2>/dev/null)" ]; then
    rm -f "$LOCK_FILE"
  else
    exit 0
  fi
fi
trap 'rm -f "$LOCK_FILE"' EXIT
echo $$ > "$LOCK_FILE"

# ── Colors ──────────────────────────────────────────────────────────
R='\033[31m' G='\033[32m' Y='\033[33m' C='\033[36m' M='\033[95m' D='\033[2m' B='\033[1m' X='\033[0m'

log()  { echo -e "  ${M}◆${X} ${D}[paloma-sync]${X} $*"; }
ok()   { echo -e "  ${G}✔${X} $*"; }
warn() { echo -e "  ${Y}▲${X} $*"; }
fail() { echo -e "  ${R}✖${X} $*"; }

# ── Check for existing unmerged files ───────────────────────────────
unmerged=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

if [ -n "$unmerged" ]; then
  warn "Unmerged files detected — resolve manually before syncing:"
  echo "$unmerged" | while read -r f; do echo "     $f"; done
  exit 1
fi

# ── Fetch + pull ────────────────────────────────────────────────────
log "Fetching from origin..."
git fetch origin 2>/dev/null || { warn "Fetch failed (offline?)"; exit 0; }

# Check if we're behind
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL")

if [ "$LOCAL" = "$REMOTE" ]; then
  ok "Already up to date"
  exit 0
fi

# Try fast-forward only — never create merge commits automatically
if git merge --ff-only origin/main 2>/dev/null; then
  ok "Fast-forwarded to origin/main"
  exit 0
fi

# Branches diverged — report but do NOT attempt merge
warn "Local branch has diverged from origin/main"
warn "Run 'git merge origin/main' or 'git rebase origin/main' manually"
exit 0
