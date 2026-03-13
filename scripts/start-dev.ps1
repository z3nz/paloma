$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'paloma-sync.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-mcp.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npx concurrently -k -n vite,bridge -c cyan,magenta "vite" "node bridge/run.js"
exit $LASTEXITCODE