#!/bin/bash
# QLoRA Fine-Tuning via MLX
#
# Usage: ./train.sh [version] [iters]
# Example: ./train.sh ft-v1 1000
#
# Prerequisites:
#   pip install mlx-lm
#   Curated training data in .paloma/ollama-training/data/train.jsonl
#
# This script:
#   1. Quantizes the base Qwen model to 4-bit (if not already done)
#   2. Runs QLoRA fine-tuning with the specified iterations
#   3. Saves adapter weights to .paloma/ollama-training/models/{version}/adapter

set -euo pipefail

# Activate MLX virtual environment if it exists
MLX_VENV="$(cd "$(dirname "$0")/../.." && pwd)/mlx_env"
if [ -d "$MLX_VENV" ]; then
  source "$MLX_VENV/bin/activate"
fi

VERSION="${1:-ft-v1}"
ITERS="${2:-1000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$PROJECT_DIR/.paloma/ollama-training/data"
OUTPUT_DIR="$PROJECT_DIR/.paloma/ollama-training/models/$VERSION"
MLX_BASE="$SCRIPT_DIR/mlx-base"

# Validate training data exists
if [ ! -f "$DATA_DIR/train.jsonl" ]; then
  echo "ERROR: No training data found at $DATA_DIR/train.jsonl"
  echo "Run: node scripts/ollama-eval/data-collector.js split"
  exit 1
fi

TRAIN_COUNT=$(wc -l < "$DATA_DIR/train.jsonl")
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  MLX QLoRA Fine-Tuning                       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Version:    $VERSION"
echo "  Iterations: $ITERS"
echo "  Train data: $TRAIN_COUNT examples"
echo "  Output:     $OUTPUT_DIR/adapter"
echo ""

# Step 1: Quantize base model (if not already done)
if [ ! -d "$MLX_BASE" ]; then
  echo "Step 1: Quantizing base model to 4-bit MLX format..."
  echo "  This downloads ~20GB and takes ~10 minutes."
  echo ""
  python3 -m mlx_lm.convert \
    --hf-path Qwen/Qwen2.5-Coder-32B-Instruct \
    -q --q-bits 4 \
    --mlx-path "$MLX_BASE"
  echo ""
  echo "  ✓ Base model quantized to $MLX_BASE"
else
  echo "Step 1: Base model already quantized at $MLX_BASE ✓"
fi

echo ""

# Step 2: QLoRA fine-tune
echo "Step 2: Starting QLoRA training ($ITERS iterations)..."
echo ""
mkdir -p "$OUTPUT_DIR/adapter"

python3 -m mlx_lm.lora \
  --model "$MLX_BASE" \
  --train \
  --data "$DATA_DIR" \
  --iters "$ITERS" \
  --batch-size 4 \
  --lora-layers 16 \
  --save-every 200 \
  --adapter-path "$OUTPUT_DIR/adapter"

echo ""
echo "  ✓ Training complete!"
echo "  Adapter saved to: $OUTPUT_DIR/adapter"
echo ""
echo "Next: Run convert.sh $VERSION to create an Ollama model"
