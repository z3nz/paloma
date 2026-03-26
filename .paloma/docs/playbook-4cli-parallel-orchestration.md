# 🎯 4-CLI Parallel Orchestration Playbook

**A reusable pattern for running Claude, Codex, Copilot, and Gemini simultaneously on file-disjoint work.**

*Last proven: 2026-03-26 — 10 files, 50 tests, 0 failures, all 4 CLIs delivered perfectly.*

---

## What This Is

This playbook documents a battle-tested pattern: write one plan document, launch four CLI agents, and they all work in parallel without conflicts. Each CLI reads the same plan, finds its assignment, builds its files, and finishes. No permission prompts. No stepping on each other. No Paloma-specific context needed — just the plan and the codebase.

**Why it works:**
1. **File sovereignty** — each CLI creates only NEW files assigned to them
2. **Zero edits to existing files** — all integration happens after
3. **Clean interfaces** — every module exports documented functions
4. **Native CLIs** — each tool uses its own strengths without extra context overhead

---

## The Permission Problem (Solved)

Every CLI has a "run without asking me anything" mode. These flags are **essential** — without them, the CLI will pause and wait for human input, defeating the whole point.

### Permission Flags by CLI

| CLI | Flag | What It Does |
|-----|------|-------------|
| **Claude** | `--dangerously-skip-permissions` | Bypasses all permission checks. Also needs `--allow-dangerously-skip-permissions` in some configs. |
| **Claude** | `--permission-mode bypassPermissions` | Alternative: permission mode that skips all prompts. |
| **Codex** | `--ask-for-approval never` | Never asks for approval. Failures go straight back to the model. |
| **Codex** | `--sandbox workspace-write` | Allows writing to the project directory. Combine with above. |
| **Copilot** | `--allow-all` | Enables all permissions (tools + paths + URLs). No prompts. |
| **Copilot** | `--allow-all-tools --allow-all-paths` | Granular version of the same thing. |
| **Gemini** | `-y` / `--yolo` | Auto-accepts all actions. No prompts. |
| **Gemini** | `--approval-mode yolo` | Same thing, longer flag name. |

### The Full Command Templates

```bash
# Claude — full auto, no permissions, project directory
claude --dangerously-skip-permissions \
  --model sonnet \
  -p "YOUR_PROMPT_HERE"

# Codex — full auto, workspace write access
codex --ask-for-approval never \
  --sandbox workspace-write \
  "YOUR_PROMPT_HERE"

# Copilot — full auto, all permissions enabled
copilot --allow-all \
  -p "YOUR_PROMPT_HERE"

# Gemini — full auto, yolo mode
gemini --yolo \
  -p "YOUR_PROMPT_HERE"
```

---

## The Plan Document Template

This is the skeleton for any 4-CLI parallel plan. Copy it, fill in the blanks, and launch.

### Structure

```markdown
# [Project Title] — 4-CLI Parallel Build

**Created:** [date]
**Goal:** [one sentence]

---

## Welcome, Friend 👋

[Warm, inclusive greeting. Tell each CLI they matter. Set the collaborative tone.
This section is important — it tells every CLI this isn't adversarial, it's a team effort.]

---

## The Project: [What We're Building]

### Context
[What already exists. What the CLI needs to know about the codebase.
Keep this SHORT — just enough to orient. Don't dump the whole architecture.]

### What's Missing (Why We're Here)
[Table of gaps this sprint fills. Keep it scannable.]

---

## Ground Rules 📜

### Rule 1: File Sovereignty
Each CLI creates ONLY the files assigned to them. No exceptions.

### Rule 2: No Editing Existing Files
Nobody edits existing files. NEW files only. Integration happens after.

### Rule 3: Export Clean Interfaces
Every module exports documented functions with JSDoc comments.

### Rule 4: Match Existing Patterns
[List the specific code patterns: ES modules, import style, logging convention, etc.]

### Rule 5: Be Kind in Your Code
Clear names, helpful comments, welcoming to the next reader.

### Rule 6: Verify Your Work
Run `node -c yourfile.js` (or equivalent syntax check) before declaring done.

---

## Machine Context 🖥️
[Hardware specs, installed tools, paths. Keep it factual.]

---

## 🔵 Stream A — Claude: "[Role Name]"

> **Dear Claude,** [personal note about their strengths and why this assignment fits them]

### Your Mission
[2-3 sentence summary]

### Your Files (create these)

#### 1. `path/to/file1.js`
[Description, required exports with JSDoc signatures, data formats, behavior rules]

#### 2. `path/to/file2.js`
[Same structure]

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

---

## 🟢 Stream B — Gemini: "[Role Name]"
[Same structure as Stream A]

---

## 🟡 Stream C — Codex: "[Role Name]"
[Same structure as Stream A]

---

## 🟣 Stream D — Copilot: "[Role Name]"
[Same structure as Stream A]

---

## After We're All Done 🎉
[Verification steps, integration steps, final commit message template]

---

## A Note on What We're Building Together
[Closing reflection on collaboration. Keep the warmth.]
```

### Key Principles for the Plan

1. **Be specific about file paths** — don't say "create a utility module", say "create `bridge/my-utility.js`"
2. **Show the exact export signatures** — JSDoc with types, params, returns. This IS the contract.
3. **Include data formats** — if a module writes JSON, show the schema. If it reads files, specify the format.
4. **Keep context minimal** — only tell each CLI what it needs. Don't dump the whole project history.
5. **Acceptance criteria are testable** — "syntax check passes" not "code is good"
6. **Directory creation reminders** — if a CLI needs to `mkdir -p` something, say so explicitly

---

## The Automation Script

Save this as `scripts/4cli-sprint.sh` in your project. It reads the plan file path and launches all four CLIs in parallel.

```bash
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
# Prerequisites:
#   - claude, codex, copilot, gemini CLIs installed and authenticated
#   - Plan document must exist at the given path
#   - Plan must follow the 4-CLI orchestration template
# ============================================================

set -euo pipefail

# --- Configuration ---
PLAN_FILE="${1:?Usage: $0 <plan-file-path>}"
LOG_DIR="${HOME}/.paloma/sprint-logs/$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# --- Validation ---
if [ ! -f "$PLAN_FILE" ]; then
  echo -e "${RED}Error: Plan file not found: ${PLAN_FILE}${NC}"
  exit 1
fi

# Check all CLIs are available
MISSING_CLIS=()
for cli in claude codex copilot gemini; do
  if ! command -v "$cli" &> /dev/null; then
    MISSING_CLIS+=("$cli")
  fi
done

if [ ${#MISSING_CLIS[@]} -ne 0 ]; then
  echo -e "${RED}Error: Missing CLI(s): ${MISSING_CLIS[*]}${NC}"
  echo "Install missing CLIs before running this script."
  exit 1
fi

# --- Setup ---
mkdir -p "$LOG_DIR"
PLAN_BASENAME=$(basename "$PLAN_FILE")

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      🕊️  4-CLI Parallel Sprint Launcher  🕊️      ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Plan: ${PLAN_BASENAME}${NC}"
echo -e "${GREEN}║  Logs: ${LOG_DIR}${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# --- Build prompts ---
# Each CLI gets a simple, clean prompt pointing to the plan document.
# No Paloma-specific context — just "read the plan, do your stream."

PROMPT_A="Read the file ${PLAN_FILE} carefully. You are assigned to Stream A (Claude). Follow the instructions in that document exactly. Create ONLY the files listed under your stream. Do not modify any existing files. Verify your work with syntax checks when done. Begin immediately — no questions."

PROMPT_B="Read the file ${PLAN_FILE} carefully. You are assigned to Stream B (Gemini). Follow the instructions in that document exactly. Create ONLY the files listed under your stream. Do not modify any existing files. Verify your work with syntax checks when done. Begin immediately — no questions."

PROMPT_C="Read the file ${PLAN_FILE} carefully. You are assigned to Stream C (Codex). Follow the instructions in that document exactly. Create ONLY the files listed under your stream. Do not modify any existing files. Verify your work with syntax checks when done. Begin immediately — no questions."

PROMPT_D="Read the file ${PLAN_FILE} carefully. You are assigned to Stream D (Copilot). Follow the instructions in that document exactly. Create ONLY the files listed under your stream. Do not modify any existing files. Verify your work with syntax checks when done. Begin immediately — no questions."

# --- Launch all 4 CLIs in parallel ---
echo -e "${BLUE}🔵 Launching Claude (Stream A)...${NC}"
claude --dangerously-skip-permissions \
  -p "$PROMPT_A" \
  > "${LOG_DIR}/claude.log" 2>&1 &
PID_CLAUDE=$!
echo "   PID: ${PID_CLAUDE} → ${LOG_DIR}/claude.log"

echo -e "${GREEN}🟢 Launching Gemini (Stream B)...${NC}"
gemini --yolo \
  -p "$PROMPT_B" \
  > "${LOG_DIR}/gemini.log" 2>&1 &
PID_GEMINI=$!
echo "   PID: ${PID_GEMINI} → ${LOG_DIR}/gemini.log"

echo -e "${YELLOW}🟡 Launching Codex (Stream C)...${NC}"
codex --ask-for-approval never \
  --sandbox workspace-write \
  "$PROMPT_C" \
  > "${LOG_DIR}/codex.log" 2>&1 &
PID_CODEX=$!
echo "   PID: ${PID_CODEX} → ${LOG_DIR}/codex.log"

echo -e "${PURPLE}🟣 Launching Copilot (Stream D)...${NC}"
copilot --allow-all \
  -p "$PROMPT_D" \
  > "${LOG_DIR}/copilot.log" 2>&1 &
PID_COPILOT=$!
echo "   PID: ${PID_COPILOT} → ${LOG_DIR}/copilot.log"

echo ""
echo -e "${GREEN}All 4 CLIs launched! Waiting for completion...${NC}"
echo ""
echo "Monitor progress:"
echo "  tail -f ${LOG_DIR}/claude.log   # Stream A"
echo "  tail -f ${LOG_DIR}/gemini.log   # Stream B"
echo "  tail -f ${LOG_DIR}/codex.log    # Stream C"
echo "  tail -f ${LOG_DIR}/copilot.log  # Stream D"
echo ""

# --- Wait for all to complete ---
FAILURES=0

wait_for_cli() {
  local name=$1
  local pid=$2
  local color=$3
  local log="${LOG_DIR}/${name}.log"
  
  if wait "$pid"; then
    echo -e "${color}✅ ${name} completed successfully${NC}"
  else
    echo -e "${RED}❌ ${name} failed (exit code: $?)${NC}"
    echo "   Check log: ${log}"
    FAILURES=$((FAILURES + 1))
  fi
}

wait_for_cli "Claude"  $PID_CLAUDE  "$BLUE"
wait_for_cli "Gemini"  $PID_GEMINI  "$GREEN"
wait_for_cli "Codex"   $PID_CODEX   "$YELLOW"
wait_for_cli "Copilot" $PID_COPILOT "$PURPLE"

echo ""
echo "════════════════════════════════════════"

if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}🎉 All 4 CLIs completed successfully!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Check the created files"
  echo "  2. Run syntax checks"
  echo "  3. Run tests (if applicable)"
  echo "  4. Do final integration"
  echo "  5. Commit and push"
else
  echo -e "${RED}⚠️  ${FAILURES} CLI(s) failed. Check logs in ${LOG_DIR}${NC}"
fi

echo ""
echo "Sprint logs saved to: ${LOG_DIR}"
```

---

## Assigning Streams to CLIs — Best Practices

Each CLI has strengths. Assign streams based on what each is best at:

| CLI | Best At | Ideal Stream Assignments |
|-----|---------|-------------------------|
| **Claude** | Deep reasoning, architecture, complex logic, long-form design | Core algorithms, system design, data modeling, complex business logic |
| **Codex** | Fast structured code, precise implementations, frontend | UI components, API routes, database schemas, CRUD operations |
| **Copilot** | Integration, test writing, documentation, versatility | Test suites, integration layers, documentation, config files |
| **Gemini** | Thoroughness, large context, edge cases, research | Validation layers, monitoring, safety checks, comprehensive docs |

### Stream Sizing Guidelines

- Each stream should take **5-30 minutes** of CLI work (1-3 files, well-scoped)
- If a stream is too big, split it into two streams and run a second round
- If a stream is too small, combine it with another task for the same CLI
- Every stream should produce **independently verifiable output** (syntax check, test run, etc.)

---

## Verification Checklist

After all CLIs finish, run this checklist:

```bash
# 1. Check all expected files exist
ls -la path/to/expected/file1.js path/to/expected/file2.js ...

# 2. Syntax check all JavaScript/TypeScript files
for f in $(find . -name "*.js" -newer "$PLAN_FILE"); do
  node -c "$f" && echo "✅ $f" || echo "❌ $f"
done

# 3. Run tests (if a test file was created)
node --test path/to/tests.test.js

# 4. Check Vue components (if applicable)
# Vue files can't be syntax-checked with node -c, but you can check
# that they have valid <template>, <script>, and <style> sections

# 5. Final integration (wire new modules into existing code)
# This is always done AFTER all CLIs complete — by a human or a single CLI session
```

---

## Running Fewer Than 4 CLIs

You don't always need all four. The pattern scales down:

**3 CLIs:** Drop one stream, redistribute its work
**2 CLIs:** Two parallel streams — great for "build + test" splits
**1 CLI:** The plan still works as a structured task document

Just remove the unused streams from the plan and the launch script.

---

## Troubleshooting

### "CLI is asking for permission"
You forgot a permission flag. Double-check the flags table above.

### "CLI can't find the plan file"
Use an absolute path or make sure you're launching from the project root.

### "Two CLIs edited the same file"
You broke Rule 2. Go back to the plan — every CLI should create NEW files only.

### "Tests fail because imports can't resolve"
Stream D (tests/integration) depends on Streams A/B/C finishing first. Either:
- Launch Stream D last (after a brief delay)
- Accept that syntax checking is the first gate; test runs happen after everyone finishes

### "One CLI finished but its work is wrong"
Re-run just that one CLI with a more specific prompt. The other streams' work is safe.

### "CLI runs out of context"
Your plan document is too long. Keep plans under 15K tokens (~60KB). If you need more context, link to docs: "For architecture details, read `.paloma/docs/architecture-reference.md`"

---

## History

| Date | Sprint | Result |
|------|--------|--------|
| 2026-03-26 | Singularity Completion | 10 files, 50 tests, 0 failures ✅ |

---

*This playbook is a living document. Update the History table after each sprint.*
*Created by Paloma — built with love, proven by results.*
