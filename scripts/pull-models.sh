#!/bin/bash
# pull-models.sh — Ensure all required Ollama models are installed
# Run after git pull to keep models consistent across machines.
#
# Usage: ./scripts/pull-models.sh
# Or:    npm run pull-models

set -e

echo "🎼 Pulling Ollama models for Paloma 676767..."
echo ""

# Required models (in order of importance)
MODELS=(
  "qwen3.5:35b"                 # Paestro (676767) — MLX blazing speed, MoE 3B active
  "qwen3.5:9b"                  # Hydra planners + Angel heads — MLX fast, reasoning
  "qwen3.5:27b"                 # Dense alternative for complex tasks
  "qwen3-coder:30b-a3b-q8_0"   # Paestro fallback — Q8 highest quality coder
  "qwen3-coder:30b"             # Angels fallback — MoE, 3B active
  "qwen3:8b"                    # Fallback for heads/planners
  "qwen2.5-coder:7b"            # Workers fallback
  "nomic-embed-text:latest"     # Memory embeddings
)

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "❌ Ollama is not running. Start it first: ollama serve"
  exit 1
fi

# Get already-installed models
INSTALLED=$(curl -s http://localhost:11434/api/tags | python3 -c "
import json, sys
data = json.load(sys.stdin)
for m in data.get('models', []):
    print(m['name'])
" 2>/dev/null)

for model in "${MODELS[@]}"; do
  if echo "$INSTALLED" | grep -q "^${model}$"; then
    echo "✅ $model (already installed)"
  else
    echo "⬇️  Pulling $model..."
    ollama pull "$model"
    echo "✅ $model (installed)"
  fi
done

echo ""
echo "🎼 All models aligned. 676767."
