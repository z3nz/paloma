#!/usr/bin/env bash
set -euo pipefail

bash scripts/paloma-sync.sh
npm install
bash scripts/setup-mcp.sh
npx concurrently -k -n vite,bridge -c cyan,magenta "vite" "node bridge/run.js"