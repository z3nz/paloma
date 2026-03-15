# Ollama Fine-Tuning Pipeline (MLX QLoRA)

Fine-tune Qwen 2.5 Coder on Apple Silicon using MLX QLoRA, then convert to GGUF and import into Ollama.

## Prerequisites

### Hardware
- Apple Silicon Mac (M1/M2/M3/M4)
- Minimum 32GB unified memory (64GB+ recommended for 32B model)

### Software
```bash
# MLX and mlx-lm (Apple's ML framework)
pip3 install mlx mlx-lm

# Verify MLX installation
python3 -c "import mlx; print(mlx.__version__)"

# llama.cpp (auto-cloned by convert.sh if not present)
# Only needed for GGUF conversion step
```

### Training Data
Curated JSONL files in `.paloma/ollama-training/data/`:
- `train.jsonl` — Training split (required)
- `valid.jsonl` — Validation split (optional, for eval during training)
- `test.jsonl` — Test split (for post-training evaluation)

Generate these with:
```bash
# Extract high-scoring eval responses
node scripts/ollama-eval/data-collector.js extract --min-score 4

# Generate Claude gold answers for failed tasks
node scripts/ollama-eval/data-collector.js generate-gold --max-score 2

# Review and approve candidates
node scripts/ollama-eval/data-curator.js

# Split into train/test/valid
node scripts/ollama-eval/data-collector.js split
```

Data format (MLX chat format):
```jsonl
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

## Usage

### Step 1: Train
```bash
./train.sh [version] [iterations]
./train.sh ft-v1 1000
```

This will:
1. Quantize the base Qwen model to 4-bit MLX format (first run only, ~10 min)
2. Run QLoRA fine-tuning with the specified iterations
3. Save adapter weights to `.paloma/ollama-training/models/{version}/adapter`

### Step 2: Convert & Create Ollama Model
```bash
./convert.sh [version]
./convert.sh ft-v1
```

This will:
1. Fuse the LoRA adapter into the base model
2. Convert to GGUF format (Q4_K_M quantization)
3. Create Ollama model named `paloma-coder:{version}`

### Step 3: Evaluate
```bash
# Run eval suite against the fine-tuned model
node scripts/ollama-eval/runner.js --model paloma-coder:ft-v1 --category all

# Compare against stock baseline
node scripts/ollama-eval/reporter.js --compare paloma-coder:ft-v1,qwen2.5-coder:32b
```

## Improvement Levels

This pipeline is L3 (QLoRA fine-tuning). Only use after exhausting cheaper improvements:

| Level | Method | Cost | Reversibility |
|-------|--------|------|---------------|
| L0 | System prompt tuning | Free | Fully reversible |
| L1 | Few-shot examples | Free | Fully reversible |
| L2 | Parameter tuning (temp, top_p) | Free | Fully reversible |
| **L3** | **QLoRA fine-tuning** | **Compute time** | **New model version** |

## Sacred Rule

The stock `qwen2.5-coder:32b` is NEVER modified. All fine-tuned models are derivatives named `paloma-coder:{version}`. Every evaluation includes the stock baseline for comparison.

## Disk Space

Expect these sizes during the pipeline:
- MLX base model (4-bit quantized): ~18 GB
- Fused model: ~18 GB (temporary, can delete after GGUF conversion)
- GGUF file: ~18 GB (temporary, can delete after `ollama create`)
- LoRA adapter: ~100 MB
- Ollama model: ~18 GB (stored in Ollama's registry)

**Peak usage: ~54 GB** (base + fused + GGUF during conversion)

## File Layout

```
scripts/ollama-finetune/
├── train.sh           # QLoRA training wrapper
├── convert.sh         # Fuse → GGUF → Ollama
├── README.md          # This file
├── mlx-base/          # Quantized base model (gitignored)
├── fused-*/           # Fused models (gitignored, temporary)
├── llama.cpp/         # GGUF converter (gitignored)
└── *.gguf             # GGUF files (gitignored, temporary)

.paloma/ollama-training/
├── data/              # Training data (JSONL)
├── models/            # Adapter weights per version
├── prompts/           # Modelfile versions
├── evals/             # Eval task definitions
└── results/           # Eval run results
```
