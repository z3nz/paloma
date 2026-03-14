# Ollama Self-Improving Feedback Loop

> **Goal:** Build a complete system where Claude (via Paloma) can evaluate, coach, and iteratively improve the local Ollama qwen2.5-coder:32b model through prompt tuning, training data collection, and eventually MLX QLoRA fine-tuning.
> **Status:** Active — Charted, ready for Forge
> **Created:** 2026-03-12
> **Pipeline:** ~~Scout~~ → **Chart** → Forge → Polish → Ship

---

## Research References

- **Scout findings:** `.paloma/docs/scout-ollama-feedback-loop-20260312.md`
- **Existing Ollama MCP server:** `mcp-servers/ollama.js` (5 tools: chat, generate, embed, list_models, pull_model)
- **Existing OllamaManager:** `bridge/ollama-manager.js` (streaming sessions with tool calling support)

---

## Architectural Decisions

### AD-1: Eval suite as standalone Node.js scripts
The eval runner, scorer, and reporter are standalone scripts in `scripts/ollama-eval/` — NOT MCP tools initially. This keeps them simple to develop and test. WU-7 wraps them as MCP tools later.

**Why:** MCP tools add protocol overhead. Scripts are easier to iterate on, can be run directly from the command line, and don't require the bridge to be running.

### AD-2: Claude-as-judge via Ollama MCP tool
Scoring uses the existing `ollama_chat` MCP tool (for automated checks) plus a Claude judge path (for open-ended tasks). The scorer calls Claude via the Anthropic API directly (using `ANTHROPIC_API_KEY` from env), not through the bridge.

**Why:** The eval runner needs to score without going through the bridge's pillar/session system. Direct API call is simpler and avoids circular dependencies. Automated checks (regex match, code execution) are tried first — Claude-as-judge is the fallback for subjective tasks.

### AD-3: Flat file storage (JSON/JSONL)
All eval tasks, results, training data, and prompt versions live in `.paloma/ollama-training/` as JSON/JSONL files. No database.

**Why:** Scout recommended this. Small dataset (<1000 evals, <5000 training examples initially). Files travel with git. Easy to inspect, diff, and curate manually.

### AD-4: Modelfile versioning with metadata
Each Modelfile version includes a header comment with version number, date, target weaknesses, and parent version. Models are named `paloma-coder:vN`.

**Why:** Need clear lineage tracking to know what changed between versions and measure improvement attributable to specific changes.

### AD-5: Improvement levels (L0→L3) are sequential gates
L0 (system prompt) → L1 (few-shot) → L2 (parameters) → L3 (QLoRA). Each level must plateau on evals before escalating to the next.

**Why:** Scout finding: prompt tuning is free, fast, and reversible. Fine-tuning is expensive and irreversible per run. Exhaust cheap improvements first.

### AD-6: Stock model is sacred
The base `qwen2.5-coder:32b` is NEVER modified. All improvements create derivative models (`paloma-coder:v1`, `v2`, etc.). Every eval run always includes the stock baseline for comparison.

**Why:** Prevents regression blindness. If a fine-tuned model scores lower than stock on any category, that's an immediate red flag.

---

## Work Units

### WU-1: Eval Runner Infrastructure
**Description:** Build the core eval execution engine — loads eval tasks from JSON files, sends them to Ollama, collects responses, and passes them to the scorer.

**Dependencies:** None

**Files to create:**
- `scripts/ollama-eval/runner.js` — Main runner: loads tasks, calls Ollama API, collects responses, invokes scorer, writes results
- `scripts/ollama-eval/scorer.js` — Scoring module: automated checks (exact_match, contains, code_execution) + Claude-as-judge fallback
- `scripts/ollama-eval/reporter.js` — Reads result files, generates markdown comparison tables (model-vs-model, category breakdown)
- `scripts/ollama-eval/utils.js` — Shared utilities: Ollama API client (direct HTTP, not MCP), file I/O helpers, timeout handling

**Design details:**

Runner flow:
```
1. Load eval tasks from .paloma/ollama-training/evals/{category}/*.json
2. For each task:
   a. Send (system + prompt) to Ollama via /api/chat (non-streaming, direct HTTP)
   b. Capture response text + timing metadata
   c. Score response using scorer.js
   d. Record { taskId, model, response, score, timing, judgeRationale }
3. Write results to .paloma/ollama-training/results/{model}--{timestamp}.json
```

Scorer modes:
- `exact_match` — response must exactly match expected (after trim)
- `contains` — response must contain expected substring
- `code_execution` — extract code block, run in sandboxed subprocess, check output
- `claude_judge` — send (task + response + rubric) to Claude API, get 1-5 score + rationale

CLI interface:
```bash
node scripts/ollama-eval/runner.js --model qwen2.5-coder:32b --category all
node scripts/ollama-eval/runner.js --model paloma-coder:v1 --category tool-use
node scripts/ollama-eval/reporter.js --compare stock,v1,v2
```

**Acceptance criteria:**
- [x] Runner loads tasks from JSON, sends to Ollama, writes structured results
- [x] Scorer handles all 4 modes (exact_match, contains, code_execution, claude_judge)
- [x] Reporter generates a markdown comparison table from result files
- [x] `--model` and `--category` flags work for targeted runs
- [x] Timeout handling: 120s per task, graceful skip on timeout
- [x] Results JSON includes: taskId, category, model, response, score (1-5), timing_ms, scorer_mode, judge_rationale (if applicable)

**Implementation Notes (WU-1):**
- All 4 files created in `scripts/ollama-eval/`: `utils.js`, `scorer.js`, `runner.js`, `reporter.js`
- Direct HTTP to Ollama at `localhost:11434/api/chat` (non-streaming), configurable via `OLLAMA_HOST` env
- `AbortController`-based 120s timeout per task with graceful skip
- Scorer: `exact_match` (trimmed comparison), `contains` (supports array of substrings with partial scoring), `code_execution` (extracts fenced code blocks, runs Python/JS/TS in sandboxed subprocess with 30s timeout), `claude_judge` (Anthropic API with `claude-sonnet-4-20250514`, structured JSON response)
- Reporter: `--compare` generates markdown tables with per-category averages + delta analysis; `--latest` and `--file` for single reports; weakest-task and error sections
- Results format: `{ meta: { model, category, timestamp, taskCount, completed, skipped, averageScore }, results: [{ taskId, category, model, prompt, response, score, timing_ms, scorer_mode, judge_rationale }] }`
- Verified: all files parse clean (`node --check`), runner discovers eval tasks, reporter reads and formats results correctly

---

### WU-2: Eval Task Sets
**Description:** Create the initial eval task library — 75-90 tasks across 6 categories that test the capabilities we actually care about for a coding assistant.

**Dependencies:** None (file-disjoint with WU-1 — can run in parallel)

**Files to create:**
- `.paloma/ollama-training/evals/tool-use/` — 15 tasks
- `.paloma/ollama-training/evals/instruction-following/` — 12 tasks
- `.paloma/ollama-training/evals/code-gen/` — 20 tasks
- `.paloma/ollama-training/evals/bug-finding/` — 12 tasks
- `.paloma/ollama-training/evals/code-review/` — 10 tasks
- `.paloma/ollama-training/evals/paloma-specific/` — 10 tasks

**Task JSON format:**
```json
{
  "id": "tool-use-001",
  "category": "tool-use",
  "difficulty": "medium",
  "prompt": "Given these tools: [read_file, write_file, search_files]. Find all TypeScript files containing 'useState' and list their paths.",
  "system": "You are a coding assistant with access to the following tools...",
  "tools": [...],
  "scoring": "claude_judge",
  "rubric": "1=wrong tools or bad args, 2=right tools wrong order, 3=correct but verbose, 4=correct and concise, 5=perfect",
  "weight": 1,
  "tags": ["tool-selection", "file-search"]
}
```

**Category design (from Scout findings — targeting known weaknesses):**

| Category | Count | Focus | Scoring |
|----------|-------|-------|---------|
| tool-use | 15 | Correct tool selection, argument format, multi-step chains | claude_judge |
| instruction-following | 12 | System prompt adherence, output format, conciseness | claude_judge + contains |
| code-gen | 20 | Python/JS/Rust algorithms, data structures, API usage | code_execution + claude_judge |
| bug-finding | 12 | Concurrency bugs, off-by-one, type errors, logic errors | claude_judge |
| code-review | 10 | Diffs with issues — find problems, suggest fixes | claude_judge |
| paloma-specific | 10 | Vue 3 composables, MCP tool patterns, bridge patterns | claude_judge |

**Acceptance criteria:**
- [x] 75+ eval tasks across 6 categories
- [x] Each task has valid JSON with all required fields (id, category, prompt, scoring, rubric)
- [x] Tool-use tasks include realistic tool definitions matching Paloma's MCP tools
- [x] Code-gen tasks include expected output for code_execution scoring
- [x] Bug-finding tasks include real buggy code (not toy examples)
- [x] Paloma-specific tasks reference actual patterns from this codebase (composables, bridge, MCP)

**Implementation Notes (WU-2):**
Built by Forge on 2026-03-12. 79 total eval tasks created:

| Category | Count | Scoring Mix | Difficulty Mix |
|----------|-------|-------------|----------------|
| tool-use | 15 | claude_judge (15) | 3 easy, 7 medium, 5 hard |
| instruction-following | 12 | claude_judge (10), contains (2) | 2 easy, 6 medium, 4 hard |
| code-gen | 20 | code_execution (14), claude_judge (6) | 3 easy, 8 medium, 9 hard |
| bug-finding | 12 | claude_judge (12) | 5 medium, 7 hard |
| code-review | 10 | claude_judge (10) | 5 medium, 5 hard |
| paloma-specific | 10 | claude_judge (10) | 4 medium, 6 hard |

Key design decisions:
- Tool-use tasks include full inputSchema definitions and 1-2 distractor tools per task
- Code-gen tasks cover JS (10), Python (6), Rust (4) with expected_output for executable tasks
- Bug-finding bugs are production-grade: stale closures, promise branching, race conditions, memory leaks
- Paloma-specific tasks grounded in REAL codebase patterns (HMR singleton refs, MCP SDK, PillarManager lifecycle, bridge WebSocket routing, shallowReactive session state, stream buffering race condition)
- Paloma-specific tasks have weight=2 (double weight) since most relevant to our use case

---

### WU-3: Baseline Eval Run + Results Storage
**Description:** Run the full eval suite against the stock qwen2.5-coder:32b model. Establish the baseline scores that all future improvements are measured against.

**Dependencies:** WU-1, WU-2

**Files to create:**
- `.paloma/ollama-training/results/stock-qwen25-coder-32b--baseline.json` — Full results
- `.paloma/ollama-training/results/SUMMARY.md` — Human-readable baseline report

**This is an execution task, not a code task.** Forge runs the eval suite and records results. The SUMMARY.md becomes the reference point for all future work.

**Acceptance criteria:**
- [ ] Full eval suite run against stock qwen2.5-coder:32b completes
- [ ] Results file contains scores for every task
- [ ] SUMMARY.md has per-category averages and overall score
- [ ] Top 5 weakness patterns identified and documented in SUMMARY.md
- [ ] Results are deterministic enough to be meaningful (run 2x, scores within ±0.3)

---

### WU-4: Prompt Evolution Engine
**Description:** Build the Modelfile versioning system and A/B comparison tooling. This is how we create, track, and evaluate prompt-tuned model versions (L0-L2).

**Dependencies:** WU-1, WU-3 (needs eval runner + baseline to measure against)

**Files to create:**
- `scripts/ollama-eval/prompt-engine.js` — Create/manage Modelfile versions, trigger `ollama create`, run eval comparison
- `.paloma/ollama-training/prompts/Modelfile.stock` — Reference: stock config (no customization)
- `.paloma/ollama-training/prompts/Modelfile.v1` — First prompt-tuned version (targeting top weaknesses from baseline)

**Design details:**

Modelfile header format:
```
# Version: v1
# Parent: stock
# Date: 2026-03-12
# Targets: instruction-following, verbosity
# Changes: Added explicit conciseness rules, output format constraints

FROM qwen2.5-coder:32b
SYSTEM """..."""
PARAMETER temperature 0.3
PARAMETER num_ctx 32768
```

prompt-engine.js commands:
```bash
# Create new model version from Modelfile
node scripts/ollama-eval/prompt-engine.js create --version v1

# Run evals on new version and compare to baseline
node scripts/ollama-eval/prompt-engine.js eval --version v1 --compare stock

# Show version history
node scripts/ollama-eval/prompt-engine.js history
```

`create` command:
1. Read `Modelfile.vN` from prompts dir
2. Run `ollama create paloma-coder:vN -f Modelfile.vN`
3. Verify model exists with `ollama list`
4. Log creation in `.paloma/ollama-training/prompts/VERSION_LOG.md`

`eval` command:
1. Run eval suite against `paloma-coder:vN`
2. Run eval suite against comparison model (default: stock)
3. Generate comparison report

**Acceptance criteria:**
- [x] `create` command produces a working Ollama model from a Modelfile
- [x] `eval` command runs the suite and produces a side-by-side comparison
- [x] VERSION_LOG.md tracks all versions with metadata (date, parent, targets, results summary)
- [x] Modelfile.v1 exists and targets the top 2-3 weaknesses from baseline
- [ ] v1 model evals show measurable improvement on targeted categories _(requires WU-3 baseline + Ollama running)_

**Implementation Notes (WU-4):**
Built by Forge on 2026-03-14. 1 file created + 2 Modelfiles + prompts directory.

**Files created:**
- `scripts/ollama-eval/prompt-engine.js` — CLI with 3 commands: `create`, `eval`, `history`
- `.paloma/ollama-training/prompts/Modelfile.stock` — Stock baseline reference (FROM qwen2.5-coder:32b, temp 0.3, ctx 32768)
- `.paloma/ollama-training/prompts/Modelfile.v1` — First prompt-tuned version targeting instruction-following, tool-use, and conciseness

**Design decisions:**
- Subprocess-based: `eval` command spawns runner.js and reporter.js as child processes (both auto-execute `main()` on import, can't be imported directly). Uses `spawn` with `stdio: 'inherit'` for real-time streaming.
- `create` command uses `execFile('ollama', ['create', ...])` with 5-minute timeout, then verifies with `ollama list`
- Version resolution: `stock` → `qwen2.5-coder:32b`, `v1` → `paloma-coder:v1`, fully-qualified names pass through
- Slug resolution for reporter comparison: matches result filenames which use `--` for `:` and `/` separators
- VERSION_LOG.md auto-created with markdown header on first version, appended with structured entries
- `updateVersionLogWithScores()` exported for future MCP tool (WU-7) to update eval results in the log
- Modelfile.v1 system prompt: structured rules for response discipline, code quality, tool usage, output format, and system prompt adherence. Added `repeat_penalty: 1.1` and `top_p: 0.9` parameters.
- Modelfile header parser extracts Version, Parent, Date, Targets, Changes from `# Key: value` comments

**Verified:**
- `node --check` — parses clean
- No-args → usage help
- `history` with no VERSION_LOG → graceful "no history yet" message
- `create` with missing `--version` → clear error
- `create --version nonexistent` → clear "Modelfile not found" error with path
- `eval` with missing `--version` → clear error with usage hint

---

### WU-5: Training Data Collection Pipeline
**Description:** Build infrastructure to capture, curate, and format high-quality exchanges for future fine-tuning. Collects from eval runs (good responses) and manual curation.

**Dependencies:** WU-1 (uses eval result format)

**Files to create:**
- `scripts/ollama-eval/data-collector.js` — Extract good examples from eval results, convert to training format
- `scripts/ollama-eval/data-curator.js` — Interactive CLI for reviewing/approving training examples
- `.paloma/ollama-training/data/README.md` — Format spec and curation guidelines

**Design details:**

Training data format (MLX-compatible JSONL):
```jsonl
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

Data sources:
1. **Eval results scored 4-5:** Auto-extracted as candidate training data
2. **Claude-generated gold answers:** For tasks where Ollama scored poorly, Claude generates the ideal response
3. **Manual additions:** Adam or Flow can add examples directly

data-collector.js:
```bash
# Extract training candidates from eval results
node scripts/ollama-eval/data-collector.js extract --min-score 4

# Generate gold answers for failed tasks using Claude
node scripts/ollama-eval/data-collector.js generate-gold --max-score 2

# Split into train/test/valid (80/10/10)
node scripts/ollama-eval/data-collector.js split
```

Output:
- `.paloma/ollama-training/data/candidates.jsonl` — Unreviewed candidates
- `.paloma/ollama-training/data/approved.jsonl` — Curated, approved examples
- `.paloma/ollama-training/data/train.jsonl` — Training split
- `.paloma/ollama-training/data/test.jsonl` — Test split
- `.paloma/ollama-training/data/valid.jsonl` — Validation split

**Acceptance criteria:**
- [x] `extract` command pulls high-scoring responses from eval results into JSONL
- [x] `generate-gold` command uses Claude API to create ideal responses for low-scoring tasks
- [x] `split` command produces train/test/valid JSONL files in correct MLX format
- [x] Data format matches MLX `chat` format exactly (verified by inspection)
- [x] README.md documents the format, curation process, and quality bar

**Implementation Notes (WU-5):**
Built by Forge on 2026-03-14. All 3 files created + utils.js extended:

**Files created:**
- `scripts/ollama-eval/data-collector.js` — CLI with 3 commands: `extract`, `generate-gold`, `split`
- `scripts/ollama-eval/data-curator.js` — Interactive stdin-based review CLI
- `.paloma/ollama-training/data/README.md` — Format spec, curation process, quality bar

**Files modified:**
- `scripts/ollama-eval/utils.js` — Added `DATA_DIR` export, `readJsonlFile()`, `writeJsonlFile()` shared utilities

**Design decisions:**
- Extract looks up original eval tasks by taskId to recover system prompts (runner results don't store them)
- Deduplication by `taskId::source` key — keeps highest-scoring version when duplicates exist
- `generate-gold` merges new gold responses into existing candidates.jsonl (read-merge-write, not append)
- Split strips metadata from JSONL for MLX-clean format (messages-only); candidates/approved retain metadata
- Claude gold generation uses `claude-sonnet-4-20250514` (per AD-2), prompts Claude to respond as-if-assistant (no meta-commentary)
- Curator skips already-approved items, tracks progress, merges newly approved with existing approved.jsonl
- Graceful handling: missing API key → clear error message; no result files → informative guidance; ENOENT on JSONL → empty array

**Verified:**
- All 3 scripts parse clean (`node --check`)
- `extract --min-score 4` correctly extracts 1 candidate from existing baseline result (instruction-following-001, score 5)
- `split` produces MLX-clean JSONL with metadata stripped
- `generate-gold` without `ANTHROPIC_API_KEY` fails gracefully with clear message
- No-args invocation shows usage help

---

### WU-6: MLX Fine-Tuning Pipeline
**Description:** Build the end-to-end fine-tuning pipeline: MLX QLoRA training → GGUF conversion → Ollama model creation. This is L3 — only used after prompt tuning plateaus.

**Dependencies:** WU-5 (needs curated training data), WU-4 (needs eval comparison tooling)

**Files to create:**
- `scripts/ollama-finetune/train.sh` — QLoRA training via MLX (shell script wrapping Python commands)
- `scripts/ollama-finetune/convert.sh` — Fuse adapter → convert to GGUF → `ollama create`
- `scripts/ollama-finetune/README.md` — Prerequisites, setup, and usage guide
- `.paloma/ollama-training/models/.gitkeep` — Directory for adapter artifacts (gitignored except .gitkeep)

**Design details:**

train.sh flow:
```bash
#!/bin/bash
# Usage: ./train.sh [version] [iters]
# Example: ./train.sh ft-v1 1000

VERSION=${1:-ft-v1}
ITERS=${2:-1000}
DATA_DIR=../../.paloma/ollama-training/data
OUTPUT_DIR=../../.paloma/ollama-training/models/$VERSION

# 1. Quantize base model (if not already done)
python -m mlx_lm.convert --hf-path Qwen/Qwen2.5-Coder-32B-Instruct -q --q-bits 4 --mlx-path ./mlx-base

# 2. QLoRA fine-tune
python -m mlx_lm.lora \
  --model ./mlx-base \
  --train --data $DATA_DIR \
  --iters $ITERS \
  --batch-size 4 \
  --lora-layers 16 \
  --save-every 200 \
  --adapter-path $OUTPUT_DIR/adapter
```

convert.sh flow:
```bash
#!/bin/bash
# Usage: ./convert.sh [version]

VERSION=${1:-ft-v1}
ADAPTER=../../.paloma/ollama-training/models/$VERSION/adapter

# 1. Fuse adapter into base
python -m mlx_lm.fuse --model ./mlx-base --adapter-path $ADAPTER --save-path ./fused-$VERSION

# 2. Convert to GGUF (requires llama.cpp)
python llama.cpp/convert_hf_to_gguf.py ./fused-$VERSION --outfile paloma-coder-$VERSION.gguf --outtype q4_K_M

# 3. Create Ollama model
cat > Modelfile.$VERSION << 'MODELFILE'
FROM ./paloma-coder-$VERSION.gguf
SYSTEM """..."""
PARAMETER temperature 0.3
PARAMETER num_ctx 32768
MODELFILE

ollama create paloma-coder:$VERSION -f Modelfile.$VERSION
```

**Acceptance criteria:**
- [ ] train.sh runs QLoRA training on sample data without errors (test with small iter count)
- [ ] convert.sh produces a working GGUF and imports it into Ollama
- [ ] The fine-tuned model can respond to basic prompts via `ollama run`
- [ ] README.md documents all prerequisites (mlx-lm, llama.cpp, disk space)
- [ ] `.gitignore` updated to exclude large model files (adapters, GGUF, mlx-base)

---

### WU-7: MCP Automation Tools
**Description:** Wrap the eval and prompt evolution workflows as MCP tools so Claude (Flow) can trigger the feedback loop conversationally: "improve the local model" → full cycle runs.

**Dependencies:** WU-1, WU-4, WU-5 (wraps these as MCP tools)

**Files to create:**
- `mcp-servers/ollama-eval.js` — New MCP server exposing eval/improvement tools

**MCP tools to expose:**
| Tool | Description |
|------|-------------|
| `ollama_eval_run` | Run eval suite against a model. Args: `model`, `category` (optional). Returns: summary scores |
| `ollama_eval_compare` | Compare two model versions. Args: `model_a`, `model_b`. Returns: side-by-side scores |
| `ollama_prompt_create` | Create new model from a Modelfile. Args: `version`, `modelfile_content`. Returns: success/fail |
| `ollama_prompt_history` | List all model versions with scores. Returns: version timeline |
| `ollama_data_stats` | Show training data stats. Returns: counts, category breakdown, readiness for fine-tuning |
| `ollama_train_start` | Kick off MLX fine-tuning. Args: `version`, `iters`. Returns: status (long-running) |

**Design details:**

The MCP server imports and wraps the scripts from `scripts/ollama-eval/`:
```js
import { runEvals } from '../scripts/ollama-eval/runner.js'
import { compareModels } from '../scripts/ollama-eval/reporter.js'
import { createModel } from '../scripts/ollama-eval/prompt-engine.js'
```

This server gets registered in `mcp-settings.json` alongside the existing `ollama` server.

**Acceptance criteria:**
- [ ] MCP server starts and registers all 6 tools
- [ ] `ollama_eval_run` returns structured scores matching the CLI output
- [ ] `ollama_eval_compare` returns a comparison table
- [ ] `ollama_prompt_create` creates a working Ollama model
- [ ] All tools accessible from Claude via the bridge MCP proxy
- [ ] Server registered in `mcp-settings.json`

---

## Dependency Graph

```
WU-1 (Eval Runner) ──────┬──→ WU-3 (Baseline Run) ──→ WU-4 (Prompt Engine)
                          │                                    │
WU-2 (Eval Tasks) ───────┘                                    ├──→ WU-6 (Fine-Tuning)
                                                               │
WU-5 (Data Pipeline) ─── depends on WU-1 ─────────────────────┘
                                                               
WU-7 (MCP Tools) ─── depends on WU-1, WU-4, WU-5
```

**Parallel dispatch opportunities:**
- **Round 1:** WU-1 + WU-2 (file-disjoint, no dependencies)
- **Round 2:** WU-3 + WU-5 (WU-3 needs WU-1+WU-2; WU-5 needs WU-1 only — but WU-3 is an execution task, short)
- **Round 3:** WU-4 (needs baseline from WU-3)
- **Round 4:** WU-6 + WU-7 (file-disjoint, both depend on earlier WUs)

---

## Success Criteria

1. **Measurable:** Eval suite produces reproducible scores (±0.3 variance across runs)
2. **Improving:** Prompt-tuned model scores >10% better than stock on targeted categories
3. **Automated:** Full eval cycle triggerable via single MCP tool call
4. **Sustainable:** Training data pipeline captures and curates examples automatically
5. **Traceable:** Every model version has documented lineage (parent, changes, scores)
6. **Safe:** Stock model scores always included as baseline; regression detection built in

---

## Risk Mitigations (from Scout)

| Risk | Mitigation |
|------|-----------|
| Fine-tuning degrades general capability | Always compare against stock baseline on full eval suite (AD-6) |
| Eval suite too narrow | 6 diverse categories including Paloma-specific tasks |
| MLX → GGUF conversion quality loss | Compare MLX inference vs Ollama inference before committing |
| Training data too small | Start with prompt tuning (L0-L2); fine-tune only with 500+ curated examples (AD-5) |
| Ollama task timeouts | 120s timeout per eval task, graceful skip (WU-1 acceptance criteria) |
| Claude API costs for judging | Automated checks first, Claude-as-judge only for subjective tasks (AD-2) |

---

*This plan is charted and ready for Forge. The pipeline is: WU-1+WU-2 (parallel) → WU-3+WU-5 → WU-4 → WU-6+WU-7 (parallel).*
