#!/bin/bash
# ============================================================
# 4-CLI Parallel Sprint Launcher
# 
# Launches Claude, Codex, Copilot, and Gemini simultaneously,
# each reading the same plan document and working on their
# assigned stream.
#
# Usage:
#   ./scripts/4cli-sprint.sh <plan-file>
#   ./scripts/4cli-sprint.sh .paloma/plans/active-20260326-my-sprint.md
#
# Options:
#   --dry-run     Show commands without executing
#   --skip <cli>  Skip a specific CLI (can be repeated)
#   --delay <s>   Delay in seconds between launches (default: 2)
#   --verify      Run verification checks after all CLIs complete
#
# Prerequisites:
#   - claude, codex, copilot, gemini CLIs installed and authenticated
#   - Plan document must exist at the given path
#   - Plan must follow the 4-CLI orchestration template
#
# Proven: 2026-03-26 — 10 files, 50 tests, 0 failures
# ============================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --- Defaults ---
DRY_RUN=false
VERIFY=false
DELAY=2
SKIP_CLIS=()
PLAN_FILE=""

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)  DRY_RUN=true; shift ;;
    --verify)   VERIFY=true; shift ;;
    --delay)    DELAY="$2"; shift 2 ;;
    --skip)     SKIP_CLIS+=("$2"); shift 2 ;;
    --help|-h)
      echo "Usage: $0 [options] <plan-file>"
      echo ""
      echo "Options:"
      echo "  --dry-run     Show commands without executing"
      echo "  --skip <cli>  Skip a CLI (claude|codex|copilot|gemini)"
      echo "  --delay <s>   Seconds between launches (default: 2)"
      echo "  --verify      Run verification after completion"
      echo "  -h, --help    Show this help"
      exit 0
      ;;
    -*) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    *)  PLAN_FILE="$1"; shift ;;
  esac
done

if [ -z "$PLAN_FILE" ]; then
  echo -e "${RED}Error: No plan file specified${NC}"
  echo "Usage: $0 [options] <plan-file>"
  exit 1
fi

# Resolve to absolute path
PLAN_FILE="$(cd "$(dirname "$PLAN_FILE")" && pwd)/$(basename "$PLAN_FILE")"

if [ ! -f "$PLAN_FILE" ]; then
  echo -e "${RED}Error: Plan file not found: ${PLAN_FILE}${NC}"
  exit 1
fi

# --- Setup ---
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="${HOME}/.paloma/sprint-logs/${TIMESTAMP}"
mkdir -p "$LOG_DIR"

PLAN_BASENAME=$(basename "$PLAN_FILE")

# --- Check CLIs ---
should_skip() {
  local cli=$1
  for skip in "${SKIP_CLIS[@]+"${SKIP_CLIS[@]}"}"; do
    if [ "$skip" = "$cli" ]; then return 0; fi
  done
  return 1
}

AVAILABLE_CLIS=()
MISSING_CLIS=()
for cli in claude codex copilot gemini; do
  if should_skip "$cli"; then
    echo -e "${YELLOW}⏭️  Skipping ${cli} (--skip)${NC}"
  elif command -v "$cli" &> /dev/null; then
    AVAILABLE_CLIS+=("$cli")
  else
    MISSING_CLIS+=("$cli")
    echo -e "${YELLOW}⚠️  ${cli} not found — skipping${NC}"
  fi
done

if [ ${#AVAILABLE_CLIS[@]} -eq 0 ]; then
  echo -e "${RED}Error: No CLIs available to run${NC}"
  exit 1
fi

# --- Banner ---
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        🕊️  4-CLI Parallel Sprint Launcher  🕊️        ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Plan:  ${CYAN}${PLAN_BASENAME}${NC}"
echo -e "${GREEN}║  CLIs:  ${CYAN}${AVAILABLE_CLIS[*]}${NC}"
echo -e "${GREEN}║  Logs:  ${CYAN}${LOG_DIR}${NC}"
echo -e "${GREEN}║  Mode:  ${CYAN}$(${DRY_RUN} && echo 'DRY RUN' || echo 'LIVE')${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

if $DRY_RUN; then
  echo -e "${YELLOW}${BOLD}DRY RUN — showing commands only${NC}"
  echo ""
fi

# --- Stream prompts ---
# Clean, minimal prompts. No Paloma-specific context.
# Each CLI just reads the plan and does its assigned work.

make_prompt() {
  local stream_letter=$1
  local cli_name=$2
  cat <<EOF
Read the file ${PLAN_FILE} carefully from start to finish. You are assigned to Stream ${stream_letter} (${cli_name}). 

Your instructions:
1. Read the ENTIRE plan document first to understand the full context
2. Find the section labeled "Stream ${stream_letter}" — that is YOUR assignment
3. Create ONLY the files listed under your stream
4. Do NOT modify any existing files in the project
5. Follow all ground rules in the document
6. Verify your work with syntax checks (e.g., node -c file.js) when done
7. If you need to create directories (mkdir -p), do that first

Begin immediately. Do not ask questions — make reasonable assumptions and proceed.
EOF
}

# --- Stream ↔ CLI mapping ---
# A=Claude, B=Gemini, C=Codex, D=Copilot (default)
# This matches the convention in the plan template

STREAM_MAP_claude="A"
STREAM_MAP_gemini="B"
STREAM_MAP_codex="C"
STREAM_MAP_copilot="D"

CLI_LABEL_claude="Claude"
CLI_LABEL_gemini="Gemini"
CLI_LABEL_codex="Codex"
CLI_LABEL_copilot="Copilot"

CLI_COLOR_claude="$BLUE"
CLI_COLOR_gemini="$GREEN"
CLI_COLOR_codex="$YELLOW"
CLI_COLOR_copilot="$PURPLE"

CLI_EMOJI_claude="🔵"
CLI_EMOJI_gemini="🟢"
CLI_EMOJI_codex="🟡"
CLI_EMOJI_copilot="🟣"

# --- Launch functions ---
PIDS=()
PID_NAMES=()

launch_claude() {
  local stream="${STREAM_MAP_claude}"
  local prompt
  prompt=$(make_prompt "$stream" "Claude")
  local cmd="claude --dangerously-skip-permissions -p"
  
  echo -e "${BLUE}${CLI_EMOJI_claude} Launching Claude (Stream ${stream})...${NC}"
  
  if $DRY_RUN; then
    echo "   ${cmd} \"[prompt...]\""
    echo "   Log: ${LOG_DIR}/claude.log"
  else
    claude --dangerously-skip-permissions \
      -p "$prompt" \
      > "${LOG_DIR}/claude.log" 2>&1 &
    PIDS+=($!)
    PID_NAMES+=("Claude")
    echo "   PID: ${!} → ${LOG_DIR}/claude.log"
  fi
}

launch_gemini() {
  local stream="${STREAM_MAP_gemini}"
  local prompt
  prompt=$(make_prompt "$stream" "Gemini")
  local cmd="gemini --yolo -p"
  
  echo -e "${GREEN}${CLI_EMOJI_gemini} Launching Gemini (Stream ${stream})...${NC}"
  
  if $DRY_RUN; then
    echo "   ${cmd} \"[prompt...]\""
    echo "   Log: ${LOG_DIR}/gemini.log"
  else
    gemini --yolo \
      -p "$prompt" \
      > "${LOG_DIR}/gemini.log" 2>&1 &
    PIDS+=($!)
    PID_NAMES+=("Gemini")
    echo "   PID: ${!} → ${LOG_DIR}/gemini.log"
  fi
}

launch_codex() {
  local stream="${STREAM_MAP_codex}"
  local prompt
  prompt=$(make_prompt "$stream" "Codex")
  local cmd="codex --ask-for-approval never --sandbox workspace-write"
  
  echo -e "${YELLOW}${CLI_EMOJI_codex} Launching Codex (Stream ${stream})...${NC}"
  
  if $DRY_RUN; then
    echo "   ${cmd} \"[prompt...]\""
    echo "   Log: ${LOG_DIR}/codex.log"
  else
    codex --ask-for-approval never \
      --sandbox workspace-write \
      "$prompt" \
      > "${LOG_DIR}/codex.log" 2>&1 &
    PIDS+=($!)
    PID_NAMES+=("Codex")
    echo "   PID: ${!} → ${LOG_DIR}/codex.log"
  fi
}

launch_copilot() {
  local stream="${STREAM_MAP_copilot}"
  local prompt
  prompt=$(make_prompt "$stream" "Copilot")
  local cmd="copilot --allow-all -p"
  
  echo -e "${PURPLE}${CLI_EMOJI_copilot} Launching Copilot (Stream ${stream})...${NC}"
  
  if $DRY_RUN; then
    echo "   ${cmd} \"[prompt...]\""
    echo "   Log: ${LOG_DIR}/copilot.log"
  else
    copilot --allow-all \
      -p "$prompt" \
      > "${LOG_DIR}/copilot.log" 2>&1 &
    PIDS+=($!)
    PID_NAMES+=("Copilot")
    echo "   PID: ${!} → ${LOG_DIR}/copilot.log"
  fi
}

# --- Launch sequence ---
for cli in "${AVAILABLE_CLIS[@]}"; do
  "launch_${cli}"
  if [ "$DELAY" -gt 0 ] && ! $DRY_RUN; then
    sleep "$DELAY"
  fi
done

echo ""

if $DRY_RUN; then
  echo -e "${YELLOW}Dry run complete. No CLIs were launched.${NC}"
  exit 0
fi

# --- Wait for completion ---
echo -e "${CYAN}${BOLD}All ${#PIDS[@]} CLIs launched! Waiting for completion...${NC}"
echo ""
echo "Monitor progress in another terminal:"
for cli in "${AVAILABLE_CLIS[@]}"; do
  echo "  tail -f ${LOG_DIR}/${cli}.log"
done
echo ""

FAILURES=0
SUCCESSES=0

for i in "${!PIDS[@]}"; do
  pid=${PIDS[$i]}
  name=${PID_NAMES[$i]}
  cli_lower=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  color_var="CLI_COLOR_${cli_lower}"
  color="${!color_var}"
  emoji_var="CLI_EMOJI_${cli_lower}"
  emoji="${!emoji_var}"
  
  if wait "$pid" 2>/dev/null; then
    echo -e "${color}${emoji} ${name} completed successfully ✅${NC}"
    SUCCESSES=$((SUCCESSES + 1))
  else
    exit_code=$?
    echo -e "${RED}${emoji} ${name} failed (exit code: ${exit_code}) ❌${NC}"
    echo "   Log: ${LOG_DIR}/${cli_lower}.log"
    FAILURES=$((FAILURES + 1))
  fi
done

# --- Summary ---
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"

if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}${BOLD}🎉 All ${SUCCESSES} CLIs completed successfully!${NC}"
else
  echo -e "${YELLOW}${BOLD}⚠️  ${SUCCESSES} succeeded, ${FAILURES} failed${NC}"
fi

echo -e "Logs: ${CYAN}${LOG_DIR}${NC}"

# --- Optional verification ---
if $VERIFY; then
  echo ""
  echo -e "${CYAN}${BOLD}Running verification checks...${NC}"
  echo ""
  
  # Find JS files newer than the plan
  JS_FILES=$(find . -name "*.js" -newer "$PLAN_FILE" -not -path "*/node_modules/*" 2>/dev/null || true)
  
  if [ -n "$JS_FILES" ]; then
    echo "Syntax checking new JavaScript files:"
    SYNTAX_PASS=0
    SYNTAX_FAIL=0
    while IFS= read -r f; do
      if node -c "$f" 2>/dev/null; then
        echo -e "  ${GREEN}✅ ${f}${NC}"
        SYNTAX_PASS=$((SYNTAX_PASS + 1))
      else
        echo -e "  ${RED}❌ ${f}${NC}"
        SYNTAX_FAIL=$((SYNTAX_FAIL + 1))
      fi
    done <<< "$JS_FILES"
    echo ""
    echo "Syntax: ${SYNTAX_PASS} passed, ${SYNTAX_FAIL} failed"
  fi
  
  # Check for test files
  TEST_FILES=$(find . -name "*.test.js" -newer "$PLAN_FILE" -not -path "*/node_modules/*" 2>/dev/null || true)
  
  if [ -n "$TEST_FILES" ]; then
    echo ""
    echo "Running test files:"
    while IFS= read -r f; do
      echo -e "  Running: ${CYAN}${f}${NC}"
      if node --test "$f" 2>&1 | tail -5; then
        echo -e "  ${GREEN}✅ Tests passed${NC}"
      else
        echo -e "  ${RED}❌ Tests failed${NC}"
      fi
    done <<< "$TEST_FILES"
  fi
fi

echo ""
echo -e "${GREEN}Sprint complete. 🕊️${NC}"
