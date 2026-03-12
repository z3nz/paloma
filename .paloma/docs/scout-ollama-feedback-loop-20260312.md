# Scout Findings: Ollama Self-Improving Feedback Loop

> **Date:** 2026-03-12
> **Plan:** `active-20260312-paloma-ollama-feedback-loop.md`
> **Scope:** Communication testing, baseline capabilities, fine-tuning feasibility, eval frameworks

---

## 1. Communication — Verified Working

Claude can talk to Ollama via MCP tools (`ollama_chat`, `ollama_generate`, `ollama_embed`). The full loop works:

- **Single-turn chat:** Claude sends prompt + system message → Ollama responds → Claude receives and evaluates
- **Models available:** qwen2.5-coder:32b (20GB), qwen2.5-coder:7b (4.7GB), nomic-embed-text (0.3GB)
- **Context window:** 32768 tokens default (configurable via `num_ctx`)
- **Latency:** Responses arrive in seconds for moderate prompts; complex tasks (Rust concurrent data structures) can timeout at ~60s
- **Tool calling:** Ollama understands tool-call format when prompted — responded with correct JSON tool calls for multi-step tasks

**Verdict:** Communication layer is solid. Claude can act as coach right now.

---

## 2. Baseline Capabilities — qwen2.5-coder:32b

### Strengths (scored well)

| Task | Result | Notes |
|------|--------|-------|
| **Algorithm implementation** (Sieve of Eratosthenes, Python) | Excellent | Clean, correct, type-hinted, well-documented |
| **System design** (WebSocket rate limiter, Node.js) | Good | Correct sliding window approach, proper error handling |
| **Analytical reasoning** (regex trick question — "find the bug") | Excellent | Correctly identified there IS no bug, didn't hallucinate a problem |
| **Tool-use format** (given tools, plan multi-step task) | Good | Produced correct JSON tool calls in the right order |
| **Bug finding** (connection pool concurrency) | Partial | Found the right area (check-then-act race on maxSize) but used "Thread A/Thread B" framing for single-threaded JS. Missed the deeper bug (pool doesn't track checked-out connections). Fix was over-engineered. |

### Weaknesses Identified

1. **Complex systems code (Rust atomics):** Timed out on lock-free concurrent stack implementation. Either too slow for the complexity or got stuck.
2. **Runtime model confusion:** Applied multi-threaded reasoning to JavaScript (single-threaded event loop). Talked about "Thread A" and "Thread B" in a JS context.
3. **Over-engineering tendency:** Proposed a mutex/promise-chain fix when a simple `activeCount` tracker would suffice.
4. **Verbosity:** Tends to explain extensively even when told to be concise. System prompt adherence is moderate.

### Baseline Scorecard (informal, 5 tests)

| Category | Score | Notes |
|----------|-------|-------|
| Code generation | 4/5 | Clean, correct, well-structured |
| Analytical reasoning | 4/5 | Honest, accurate, doesn't hallucinate |
| Bug finding | 3/5 | Finds the area but misses nuance |
| Complex systems | 2/5 | Struggles or times out on advanced tasks |
| Instruction following | 3/5 | Moderate system prompt adherence |
| Tool-use format | 3/5 | Gets the format right but verbose |

**Overall: Solid coding assistant for standard tasks. Weak on complex systems programming and precise instruction following.**

---

## 3. Fine-Tuning on Apple Silicon — Fully Feasible

### The Pipeline: MLX → GGUF → Ollama

**MLX** is the clear winner for Apple Silicon fine-tuning. The workflow:

```
1. Prepare data (JSONL: train.jsonl, test.jsonl, valid.jsonl)
2. Optionally quantize base model (4-bit for QLoRA)
3. Fine-tune with mlx_lm.lora
4. Fuse adapter into base model
5. Convert to GGUF (llama.cpp convert)
6. ollama create paloma-coder:v1 -f Modelfile
```

### Key Commands

```bash
# Install
pip install mlx-lm

# QLoRA fine-tune (4-bit quantized base)
python -m mlx_lm.convert --hf-path Qwen/Qwen2.5-Coder-32B-Instruct -q --q-bits 4
python -m mlx_lm.lora --model ./mlx_model --train --data ./data --iters 1000

# Fuse adapter
python -m mlx_lm.fuse --model ./mlx_model --adapter-file ./adapters.npz --save-path ./fused --de-quantize

# Convert to GGUF + import to Ollama
# (uses llama.cpp convert_hf_to_gguf.py)
ollama create paloma-coder:v1 -f Modelfile
```

### Memory Requirements for 32B Model

| Method | Estimated Memory | Feasibility on 128GB M5 |
|--------|-----------------|------------------------|
| LoRA (FP16 base) | ~65-70 GB | Yes, tight |
| QLoRA (4-bit base) | ~20-25 GB | Yes, comfortable |
| QLoRA + batch=4 | ~30-35 GB | Yes, comfortable |
| QLoRA + batch=8 | ~40-45 GB | Yes |

**QLoRA is the recommended path.** 4-bit quantized 32B model + LoRA adapters fits comfortably in 128GB with room for the OS and Ollama inference.

### Data Format

MLX supports `chat`, `completions`, `text` formats. For our use case:

```jsonl
{"prompt": "Write a function that...", "completion": "```python\ndef ...\n```"}
```

Split: 80% train, 10% test, 10% valid.

### QLoRA vs LoRA

- QLoRA uses ~50% less memory (4-bit base)
- Quality loss is marginal: 1.530 vs 1.544 validation loss in benchmarks
- MLX auto-detects: point at quantized model → QLoRA happens automatically
- **Recommendation: Always use QLoRA for 32B models**

---

## 4. Ollama Modelfile — Comprehensive Control

Modelfiles give us three levels of improvement before fine-tuning:

### Level 1: System Prompt (No Training)
```
FROM qwen2.5-coder:32b
SYSTEM """You are Paloma's local coding assistant..."""
PARAMETER temperature 0.3
PARAMETER num_ctx 32768
```

### Level 2: Few-Shot Examples (No Training)
```
MESSAGE user Write a Python fizzbuzz
MESSAGE assistant ```python
def fizzbuzz(n):
    ...
```
```

### Level 3: LoRA Adapter (Requires Training)
```
FROM qwen2.5-coder:32b
ADAPTER ./adapters/paloma-coder-v1.gguf
SYSTEM """..."""
```

### Key Parameters
- `temperature` (0.0-2.0, default 0.8) — lower = more deterministic
- `top_k` (default 40) — lower = more focused
- `top_p` (default 0.9) — nucleus sampling
- `repeat_penalty` (default 1.1) — prevents repetition
- `num_ctx` (default 2048!) — MUST set higher for real work
- `stop` — custom stop sequences (one per line)

### Creating Derivative Models
```bash
ollama create paloma-coder:v1 -f ./Modelfile.v1
ollama create paloma-coder:v2 -f ./Modelfile.v2
```

Each version is a separate model in Ollama's library. Easy to A/B test.

---

## 5. Eval Frameworks — Recommended Approach

### Existing Benchmarks (reference)

| Benchmark | What It Tests | Tasks | Notes |
|-----------|--------------|-------|-------|
| **HumanEval** | Function-level code gen | 164 Python problems | Standard, well-known |
| **MBPP** | Basic Python programming | 974 problems | Broader but simpler |
| **BigCodeBench** | Real-world API usage | 1,140 tasks | More practical |
| **LiveCodeBench** | Competition-style | Evolving | Harder, tests reasoning |
| **EvalPlus** | Enhanced HumanEval/MBPP | 80x more test cases | Better signal |

### Recommended: Custom Eval Suite

Rather than using off-the-shelf benchmarks (which test generic Python), we should build evals that test **what we actually need the model to do:**

1. **Tool-use accuracy** — Given tools, does it call the right ones with correct args?
2. **Instruction following** — Does it respect system prompt constraints (conciseness, format)?
3. **Code generation** — Standard algorithm/data structure tasks (Python, JS, Rust)
4. **Bug finding** — Given buggy code, can it find and explain the actual bug?
5. **Code review** — Given a diff, can it identify issues and suggest improvements?
6. **Paloma-specific** — Can it work with Paloma's codebase patterns? (Vue, Node, MCP)

### Eval Design

```
.paloma/ollama-training/evals/
├── tool-use/          # 15-20 tool calling scenarios
├── instruction/       # 10-15 instruction following tests
├── code-gen/          # 20-30 code generation tasks
├── bug-finding/       # 10-15 buggy code samples
├── code-review/       # 10-15 review scenarios
└── paloma-specific/   # 10-15 Paloma codebase tasks
```

Each eval is a JSON file:
```json
{
  "id": "tool-use-001",
  "category": "tool-use",
  "prompt": "...",
  "system": "...",
  "expected": "...",
  "scoring": "exact_match | contains | claude_judge",
  "weight": 1
}
```

### Scoring: Claude-as-Judge

For open-ended tasks (code review, bug finding), use Claude to judge Ollama's output:
1. Send task to Ollama → get response
2. Send (task + Ollama response + rubric) to Claude → get score (1-5)
3. Aggregate scores across all evals

This is the most practical approach. Automated test execution (HumanEval-style) is good for code gen but doesn't cover tool use or review tasks.

---

## 6. Recommended Architecture for the Feedback Loop

```
┌─────────────────────────────────────────────┐
│  Improvement Levels (ascending effort)       │
│                                              │
│  L0: System prompt tuning (Modelfile)        │
│  L1: Few-shot examples (Modelfile MESSAGE)   │
│  L2: Parameter tuning (temperature, etc.)    │
│  L3: QLoRA fine-tuning (MLX → GGUF)         │
└─────────────────────────────────────────────┘

Each level uses the same eval suite to measure improvement.
Start at L0 and only escalate when gains plateau.
```

### Improvement Cycle

```
1. Run eval suite → baseline scores
2. Analyze failures → identify top 3 weakness patterns
3. Apply improvement (prompt edit, few-shot, or training)
4. Create new model version (ollama create paloma-coder:vN)
5. Run eval suite → new scores
6. Compare → if improved, promote; if not, try different approach
7. Repeat
```

### Version Tracking

```
.paloma/ollama-training/
├── evals/              # Eval task definitions
├── results/            # Eval results per model version
│   ├── stock-qwen25-32b.json
│   ├── paloma-coder-v1.json
│   └── paloma-coder-v2.json
├── prompts/            # Modelfile versions
│   ├── Modelfile.v1
│   └── Modelfile.v2
├── data/               # Curated training data
│   ├── train.jsonl
│   ├── test.jsonl
│   └── valid.jsonl
└── models/             # Fine-tuned model artifacts
    └── adapters/
```

---

## 7. Key Decisions for Chart

1. **Start with L0 (prompt tuning) before any fine-tuning.** The baseline weaknesses (instruction following, verbosity, runtime model confusion) are likely addressable with better system prompts and few-shot examples. Cheaper, faster, reversible.

2. **Build the eval suite first.** Can't improve what you can't measure. The eval runner is the foundation everything else depends on.

3. **Claude-as-judge is the right scoring method.** Automated tests work for code gen (run it, check output) but not for tool use or code review. Hybrid approach: automated where possible, Claude-judged elsewhere.

4. **QLoRA via MLX for fine-tuning when we get there.** 128GB M5 handles 32B QLoRA comfortably. The pipeline is well-documented and battle-tested.

5. **Flat file storage** (JSON/JSONL in `.paloma/ollama-training/`) is fine for now. No need for SQLite or MongoDB until we have thousands of eval results.

6. **Always keep the stock model available.** Never modify the base qwen2.5-coder:32b. All improvements are derivative models (paloma-coder:v1, v2, etc.). Stock baseline is sacred.

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Fine-tuning degrades general capability | Always compare against stock baseline on full eval suite |
| Eval suite doesn't capture real usefulness | Include Paloma-specific tasks alongside generic benchmarks |
| MLX → GGUF conversion quality loss | Compare MLX inference vs Ollama inference before committing |
| Training data too small for meaningful fine-tuning | Start with prompt tuning (L0-L2); only fine-tune when we have 500+ curated examples |
| Timeout on complex Ollama tasks | Increase MCP timeout, or use smaller model (7b) for fast iteration |

---

## Summary

**The path is clear.** Everything we need is already in place or readily available:
- Communication: working
- Evaluation: custom suite + Claude-as-judge
- Prompt tuning: Modelfile system (zero training cost)
- Fine-tuning: MLX QLoRA on M5 (proven pipeline)
- Model versioning: Ollama derivative models

**Recommended sequence:** Build eval suite → prompt-tune to plateau → collect training data → QLoRA fine-tune → measure → repeat.

Ready for Chart.
