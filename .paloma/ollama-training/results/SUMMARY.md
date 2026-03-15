# Ollama Eval Baseline Summary

> Generated: 2026-03-15
> Eval suite: 79 tasks across 6 categories
> Scoring: automated (exact_match, contains, code_execution) + Claude-as-judge

---

## Models Tested

| Model | Parameters | Quantization | Context | Notes |
|-------|-----------|-------------|---------|-------|
| qwen2.5-coder:32b | 32.5B | Q4_K_M | 32K | Stock baseline (partial: 14 tasks only) |
| qwen3-coder:30b | 30B | Q4_K_M | 32K | Full 79-task run, overall best |
| qwen2.5-coder:7b | 7.6B | Q4_K_M | 32K | Full 79-task run, lightweight worker |

---

## Comparison Table

| Category | qwen2.5-coder:32b | qwen3-coder:30b | qwen2.5-coder:7b |
|----------|-------------------|-----------------|-------------------|
| bug-finding | N/A | 3.42 | 3.17 |
| code-gen | 2.00 | 4.25 | 3.75 |
| code-review | N/A | 3.90 | **2.60** |
| instruction-following | 5.00 | 4.64 | 4.00 |
| paloma-specific | N/A | 4.50 | 3.70 |
| tool-use | N/A | 3.00 | **4.20** |
| **Overall** | **3.50** | **3.92** | **3.63** |
| Tasks | 14/14 | 79/79 | 79/79 |

Note: qwen2.5-coder:32b only ran 14 tasks (instruction-following + code-gen). N/A categories were not tested.

### Key Observations

1. **qwen3-coder:30b is the overall best** at 3.92/5 — the primary model for Paloma's Ollama backend
2. **qwen2.5-coder:7b surprises on tool-use** — scores 4.20 vs 30b's 3.00 (the ONLY category where 7b beats 30b)
3. **7b's critical weakness is code-review** at 2.60/5 — 1.30 points below 30b
4. **7b is viable as a worker model** — 3.63 overall is respectable for a 4x smaller model with 4x less VRAM

---

## Weakness Analysis by Model

### qwen3-coder:30b (Overall: 3.92)

**Weakness #1: Tool-Use (3.00/5)**
8 of 15 tasks scored 2/5. The 30b model consistently:
- Only completes the first step of multi-step tool chains
- Picks suboptimal tools (shell_cat vs read_text_file)
- Never follows up with verification steps
- Outlines full plans but only executes step 1

**Weakness #2: Bug-Finding (3.42/5)**
5 of 12 tasks scored ≤3. Misses framework-specific bugs (Express async error handling), identifies surface symptoms but not root mechanisms.

### qwen2.5-coder:7b (Overall: 3.63)

**Weakness #1: Code-Review (2.60/5) — CRITICAL**
6 of 10 tasks scored ≤2. The 7b model:
- Misses critical security vulnerabilities (cache invalidation, access control flaws)
- Fabricates non-existent issues (SQL injection in parameterized queries)
- Focuses on trivial style issues while missing architectural bugs
- Lacks deep understanding of migration semantics and concurrency patterns

**Weakness #2: Bug-Finding (3.17/5)**
3 tasks scored 1/5 — catastrophic failures:
- Declared code "correctly written" when it had 3 critical memory leak bugs
- Fabricated wrong explanations (claimed correct offset calc was wrong)
- Misses endianness bugs, async error handling patterns

**Weakness #3: Paloma-Specific (3.70/5)**
Decent but below 30b (4.50). Struggles with Paloma's specific patterns at full depth.

**Strength: Tool-Use (4.20/5)**
Surprisingly strong — the ONLY category where 7b beats 30b. Completes multi-step chains more reliably.

---

## Catastrophic Failures (Score 1/5)

| Task | Model | Category | Issue |
|------|-------|----------|-------|
| bug-finding-005 | 7b | bug-finding | Said "no bugs" — missed 3 critical memory leak issues |
| bug-finding-010 | 7b | bug-finding | Fabricated wrong explanation, introduced a NEW bug |
| code-gen-004 | 7b | code-gen | Runtime TypeError in generated code |
| code-gen-009 | 7b | code-gen | Runtime TypeError in route parser |
| code-review-002 | 7b | code-review | Fabricated SQL injection, missed real cache bug |
| bug-finding-011 | 30b | bug-finding | Missed Express 4.x async rejection handling |

---

## Recommendations for Prompt Tuning (L0-L2)

### For qwen3-coder:30b (Modelfile.v1, already created)
1. **Priority 1:** Tool-use completion rules — "Complete ALL steps, don't stop at step 1"
2. **Priority 2:** Tool preference hierarchy — MCP filesystem over shell equivalents
3. **Priority 3:** Verification discipline — "Read after write to verify"

### For qwen2.5-coder:7b (Modelfile.v1-7b, to be created)
1. **Priority 1:** Code-review depth — "Focus on security and architectural bugs, not style"
2. **Priority 2:** Bug analysis accuracy — "Never say 'no bugs found' without exhaustive analysis"
3. **Priority 3:** Avoid fabrication — "Only flag issues you can demonstrate with specific code evidence"

---

## Timing Analysis

| Model | Avg Time/Task | Total Run Time | VRAM Usage |
|-------|-------------|----------------|------------|
| qwen3-coder:30b | ~12s | ~16 min | ~19 GB |
| qwen2.5-coder:7b | ~12s | ~21 min | ~8.2 GB |

The 7b model is slightly slower per-task despite being smaller — likely due to more verbose responses requiring more tokens.

---

## Next Steps

- [x] Complete 7b baseline eval
- [x] Fill in 7b numbers in comparison table
- [ ] Create Modelfile.v1-7b targeting code-review weakness (L0 system prompt)
- [ ] Run eval on v1 (30b) and v1-7b, compare to stock baselines
- [ ] If <10% improvement, escalate to L1 (few-shot examples)
- [ ] Collect high-scoring responses as training candidates for future L3 (QLoRA)
- [ ] Re-run 32b baseline with full 79 tasks when available

---

*This document is the reference point for all future Ollama model improvement work.*
