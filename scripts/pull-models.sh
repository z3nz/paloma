#!/bin/bash
# pull-models.sh — Manually ensure the canonical Ollama model set is installed.
# NOTE: This script is NOT run on startup — bridge/backend-health.js handles
#       model management automatically in the background on every restart.
#
# Run manually only when you need to force a fresh pull:
#   npm run pull-models

set -e

echo "🎼 Pulling canonical Ollama models for Paloma..."
echo ""

# Canonical preferred models — keep in sync with PREFERRED_MODELS in bridge/backend-health.js
MODELS=(
  "gemma4:26b"              # native tool calling architecture (Apr 2026), zero dropped function calls
  "qwen3.5:35b"             # best large model — MLX-accelerated on Apple Silicon
  "qwen3.5:9b"              # best small/worker model
  "nomic-embed-text:latest" # required for memory MCP server embeddings
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
echo "🎼 All canonical models installed. 676767."
