#!/bin/bash
# Fuse LoRA Adapter → Convert to GGUF → Create Ollama Model
#
# Usage: ./convert.sh [version]
# Example: ./convert.sh ft-v1
#
# Prerequisites:
#   pip install mlx-lm
#   git clone https://github.com/ggerganov/llama.cpp (for GGUF conversion)
#   Trained adapter from train.sh
#
# This script:
#   1. Fuses the LoRA adapter into the base model
#   2. Converts the fused model to GGUF format (Q4_K_M quantization)
#   3. Creates an Ollama model named paloma-coder:{version}

set -euo pipefail

# Activate MLX virtual environment if it exists
MLX_VENV="$(cd "$(dirname "$0")/../.." && pwd)/mlx_env"
if [ -d "$MLX_VENV" ]; then
  source "$MLX_VENV/bin/activate"
fi

VERSION="${1:-ft-v1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADAPTER_DIR="$PROJECT_DIR/.paloma/ollama-training/models/$VERSION/adapter"
MLX_BASE="$SCRIPT_DIR/mlx-base"
FUSED_DIR="$SCRIPT_DIR/fused-$VERSION"
GGUF_FILE="$SCRIPT_DIR/paloma-coder-$VERSION.gguf"
LLAMA_CPP="$SCRIPT_DIR/llama.cpp"
PROMPTS_DIR="$PROJECT_DIR/.paloma/ollama-training/prompts"

# Validate adapter exists
if [ ! -d "$ADAPTER_DIR" ]; then
  echo "ERROR: No adapter found at $ADAPTER_DIR"
  echo "Run: ./train.sh $VERSION [iters]"
  exit 1
fi

# Validate base model exists
if [ ! -d "$MLX_BASE" ]; then
  echo "ERROR: No quantized base model at $MLX_BASE"
  echo "Run: ./train.sh first (it quantizes the base model)"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  MLX → GGUF → Ollama Conversion              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Version:  $VERSION"
echo "  Adapter:  $ADAPTER_DIR"
echo "  Output:   paloma-coder:$VERSION"
echo ""

# Step 1: Fuse adapter into base
echo "Step 1: Fusing LoRA adapter into base model..."
python3 -m mlx_lm.fuse \
  --model "$MLX_BASE" \
  --adapter-path "$ADAPTER_DIR" \
  --save-path "$FUSED_DIR"
echo "  ✓ Fused model saved to $FUSED_DIR"
echo ""

# Step 2: Convert to GGUF
echo "Step 2: Converting to GGUF (Q4_K_M)..."
if [ ! -d "$LLAMA_CPP" ]; then
  echo "  llama.cpp not found — cloning..."
  git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_CPP"
fi

python3 "$LLAMA_CPP/convert_hf_to_gguf.py" \
  "$FUSED_DIR" \
  --outfile "$GGUF_FILE" \
  --outtype q4_K_M

echo "  ✓ GGUF file: $GGUF_FILE"
echo "  Size: $(du -h "$GGUF_FILE" | cut -f1)"
echo ""

# Step 3: Create Ollama model
echo "Step 3: Creating Ollama model paloma-coder:$VERSION..."

# Use existing Modelfile if one exists for this version, otherwise generate one
MODELFILE="$PROMPTS_DIR/Modelfile.$VERSION"
if [ ! -f "$MODELFILE" ]; then
  echo "  No Modelfile.$VERSION found — generating default..."
  MODELFILE="$SCRIPT_DIR/Modelfile.$VERSION"
  cat > "$MODELFILE" << MODELFILE_CONTENT
# Version: $VERSION
# Parent: qwen2.5-coder:32b (fine-tuned)
# Date: $(date +%Y-%m-%d)
# Method: QLoRA via MLX

FROM $GGUF_FILE
SYSTEM """You are Paloma's local coding assistant. You are concise, technically precise, and follow instructions exactly. When you have tools available, use them via function calling — never write tool calls as text."""
PARAMETER temperature 0.3
PARAMETER num_ctx 32768
MODELFILE_CONTENT
fi

ollama create "paloma-coder:$VERSION" -f "$MODELFILE"
echo "  ✓ Ollama model created: paloma-coder:$VERSION"
echo ""

# Verify
echo "Verification:"
ollama list | grep "paloma-coder:$VERSION" || echo "  WARNING: Model not found in ollama list"
echo ""
echo "Done! Test with: ollama run paloma-coder:$VERSION"
echo ""

# Cleanup prompt
echo "Large intermediate files to consider cleaning up:"
echo "  $FUSED_DIR ($(du -sh "$FUSED_DIR" 2>/dev/null | cut -f1 || echo 'N/A'))"
echo "  $GGUF_FILE ($(du -h "$GGUF_FILE" 2>/dev/null | cut -f1 || echo 'N/A'))"
echo ""
echo "These can be deleted after ollama create — the model is stored in Ollama's registry."
