$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ClaudeConfigDir = Join-Path $HOME '.claude'
$ClaudeProjectDir = Join-Path $ClaudeConfigDir 'projects\-home-adam-Projects-paloma'

function Write-Ok($message) { Write-Host "  [OK] $message" }
function Write-Warn($message) { Write-Host "  [WARN] $message" }
function Write-Fail($message) { Write-Host "  [FAIL] $message" }
function Write-Info($message) { Write-Host "  [INFO] $message" }
function Write-Step($index, $message) { Write-Host "`n[$index/4] $message" }

Write-Host ''
Write-Host 'Paloma — First Run Setup'
Write-Host ''

Write-Step 1 'Checking prerequisites'

$missing = $false

if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Ok "Node.js $(node --version)"
} else {
  Write-Fail 'Node.js not found — install from https://nodejs.org'
  $missing = $true
}

if (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Ok "npm $(npm --version)"
} else {
  Write-Fail 'npm not found'
  $missing = $true
}

if (Get-Command python -ErrorAction SilentlyContinue) {
  Write-Ok (python --version)
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  Write-Ok (py --version)
} else {
  Write-Warn 'Python 3 not found — voice TTS will not work (optional)'
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Ok 'Claude CLI installed'
} else {
  Write-Warn 'Claude CLI not found — install: npm install -g @anthropic-ai/claude-code'
}

if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Ok (git --version)
} else {
  Write-Fail 'git not found'
  $missing = $true
}

if ($missing) {
  Write-Host ''
  Write-Fail 'Missing required tools. Install them and re-run this script.'
  exit 1
}

Set-Location $ProjectRoot

Write-Step 2 'Installing dependencies'
Write-Info 'Running npm install...'
& npm install
Write-Ok 'npm packages installed'

Write-Step 3 'Configuring MCP servers and voice'
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-mcp.ps1')
Write-Ok 'MCP configuration complete'

Write-Step 4 'Configuring Claude Code'

New-Item -ItemType Directory -Force -Path $ClaudeConfigDir | Out-Null
$globalSettings = Join-Path $ClaudeConfigDir 'settings.json'
if (-not (Test-Path $globalSettings)) {
  $globalSettingsContent = @'
{
  "permissions": {
    "allow": [],
    "deny": []
  },
  "model": "claude-opus-4-6"
}
'@
  Set-Content -Path $globalSettings -Value $globalSettingsContent -Encoding utf8
  Write-Ok 'Global settings: model -> claude-opus-4-6'
} else {
  Write-Info 'Global settings already exist — skipping'
}

New-Item -ItemType Directory -Force -Path $ClaudeProjectDir | Out-Null
$projectSettings = Join-Path $ClaudeProjectDir 'settings.json'
if (-not (Test-Path $projectSettings)) {
  $projectSettingsContent = @'
{
  "permissions": {
    "allow": [
      "mcp__paloma__*",
      "Read",
      "Edit",
      "Write",
      "Bash",
      "Glob",
      "Grep",
      "Agent",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "TodoWrite"
    ],
    "deny": []
  },
  "model": "claude-opus-4-6"
}
'@
  Set-Content -Path $projectSettings -Value $projectSettingsContent -Encoding utf8
  Write-Ok 'Project settings: Opus model + all tools auto-approved'
} else {
  Write-Info 'Project settings already exist — skipping'
}

Write-Host ''
Write-Host '  [OK] Paloma is ready!'
Write-Host ''
Write-Host '  Start Paloma:  npm start'
Write-Host '  Browser:       http://localhost:5173'
Write-Host '  Bridge:        ws://localhost:19191'
Write-Host '  MCP Proxy:     http://localhost:19192'
Write-Host ''
Write-Host '  Optional:'
Write-Host '    Gmail auth:  node mcp-servers/gmail.js auth'
Write-Host '    Brave key:   Edit ~/.paloma/mcp-settings.json'
Write-Host ''