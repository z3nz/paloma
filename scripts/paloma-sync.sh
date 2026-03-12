#!/usr/bin/env bash
#
# paloma-sync.sh — Smart git sync with auto merge-conflict resolution.
#
# Tries to pull from origin. If merge conflicts arise, spawns a Claude
# CLI session to resolve them automatically. Used by both `npm start`
# and the Claude Code SessionStart hook.
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# ── Colors ──────────────────────────────────────────────────────────
R='\033[31m' G='\033[32m' Y='\033[33m' C='\033[36m' M='\033[95m' D='\033[2m' B='\033[1m' X='\033[0m'

log()  { echo -e "  ${M}◆${X} ${D}[paloma-sync]${X} $*"; }
ok()   { echo -e "  ${G}✔${X} $*"; }
warn() { echo -e "  ${Y}▲${X} $*"; }
fail() { echo -e "  ${R}✖${X} $*"; }

# ── Check for existing unmerged files ───────────────────────────────
unmerged=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

if [ -n "$unmerged" ]; then
  warn "Unmerged files detected from a previous merge:"
  echo "$unmerged" | while read -r f; do echo "     $f"; done
  resolve_needed=true
else
  # ── Fetch + pull ────────────────────────────────────────────────
  log "Fetching from origin..."
  git fetch origin 2>/dev/null || { warn "Fetch failed (offline?)"; exit 0; }

  # Check if we're behind
  LOCAL=$(git rev-parse HEAD 2>/dev/null)
  REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL")

  if [ "$LOCAL" = "$REMOTE" ]; then
    ok "Already up to date"
    exit 0
  fi

  # Try fast-forward first
  if git merge --ff-only origin/main 2>/dev/null; then
    ok "Fast-forwarded to origin/main"
    exit 0
  fi

  # Fast-forward failed — try regular merge
  log "Branches diverged, attempting merge..."
  if git merge origin/main --no-edit 2>/dev/null; then
    ok "Merged origin/main successfully"
    exit 0
  fi

  # Merge created conflicts
  unmerged=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
  if [ -z "$unmerged" ]; then
    fail "Merge failed for unknown reason"
    exit 1
  fi

  warn "Merge conflicts in:"
  echo "$unmerged" | while read -r f; do echo "     $f"; done
  resolve_needed=true
fi

# ── Auto-resolve via Claude CLI ─────────────────────────────────────
if [ "${resolve_needed:-false}" = "true" ]; then
  # Check if claude CLI is available
  if ! command -v claude &>/dev/null; then
    fail "Claude CLI not found — resolve conflicts manually"
    exit 1
  fi

  log "Spawning Claude to resolve merge conflicts..."

  # Build the file list for the prompt
  file_list=$(git diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ', ' | sed 's/,$//')

  claude -p --model sonnet "$(cat <<PROMPT
You are resolving git merge conflicts in the Paloma repository.

The following files have merge conflicts: ${file_list}

For each conflicted file:
1. Read the file to see the conflict markers (<<<<<<< HEAD, =======, >>>>>>>)
2. Understand what BOTH sides changed — HEAD is the local work, the other side is from origin/main
3. Resolve the conflict by keeping the best of both sides. If one side has newer features/fixes that the other doesn't, keep those. If both sides changed the same thing differently, merge them intelligently.
4. Remove ALL conflict markers (<<<<<<< HEAD, =======, >>>>>>>) — the file must be valid after resolution
5. Write the resolved file

After resolving ALL files, run these git commands:
- git add each resolved file
- git commit with message "chore: auto-resolve merge conflicts (paloma-sync)"

Be thorough — check that no conflict markers remain in any file.
PROMPT
)"

  # Verify resolution
  remaining=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
  if [ -n "$remaining" ]; then
    fail "Claude couldn't resolve all conflicts. Remaining:"
    echo "$remaining" | while read -r f; do echo "     $f"; done
    exit 1
  fi

  ok "Merge conflicts resolved automatically"
fi
