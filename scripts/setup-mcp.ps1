$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigDir = Join-Path $HOME '.paloma'
$SettingsFile = Join-Path $ConfigDir 'mcp-settings.json'
$VenvDir = Join-Path $ProjectRoot 'kokoro_env'
$NodeModules = Join-Path $ProjectRoot 'node_modules'
$RequirementsFile = Join-Path $ProjectRoot 'requirements.txt'
$McpJson = Join-Path $ProjectRoot '.paloma\mcp.json'
$HookFile = Join-Path $ProjectRoot '.git\hooks\post-commit'

function Write-Step($message) {
  Write-Host ('==> ' + $message)
}

function Write-Warn($message) {
  Write-Host ('    [WARN] ' + $message)
}

function Get-CommandPathOrNull($name) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Test-PythonPackageInstalled($pythonExe, $packageName) {
  $process = Start-Process -FilePath $pythonExe -ArgumentList '-m', 'pip', 'show', $packageName -Wait -PassThru -NoNewWindow
  return $process.ExitCode -eq 0
}

function Get-JsonValue($path, $propertyName) {
  if (-not (Test-Path $path)) { return $null }

  try {
    $json = Get-Content $path -Raw | ConvertFrom-Json
    if ($json.PSObject.Properties.Name -contains 'servers') {
      foreach ($server in $json.servers.PSObject.Properties.Value) {
        if ($server.env -and $server.env.PSObject.Properties.Name -contains $propertyName) {
          return $server.env.$propertyName
        }
      }
    }
  } catch {
    return $null
  }

  return $null
}

Write-Step 'Paloma MCP Setup'
Write-Host ('    Project: ' + $ProjectRoot)
Write-Host ('    Config:  ' + $ConfigDir)
Write-Host ''

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

$pythonCommand = $null
foreach ($candidate in @('python', 'py')) {
  if (Get-Command $candidate -ErrorAction SilentlyContinue) {
    $pythonCommand = $candidate
    break
  }
}

$voicePackages = @('kokoro', 'sounddevice', 'markdown')
$venvPython = Join-Path $VenvDir 'Scripts\python.exe'
$venvPip = Join-Path $VenvDir 'Scripts\pip.exe'

if (-not $pythonCommand) {
  Write-Host '    [SKIP] No Python 3 found - voice server will not work'
  Write-Host '    Install Python 3.10+ and re-run this script'
} else {
  $needInstall = $false

  if (-not (Test-Path $venvPython)) {
    Write-Step ('Creating Python venv with ' + $pythonCommand)
    if (Test-Path $VenvDir) {
      Remove-Item -Recurse -Force $VenvDir
    }
    & $pythonCommand -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python venv.' }
    $needInstall = $true
  } elseif (-not (Test-Path $venvPip)) {
    Write-Step 'Venv exists but pip is missing - recreating'
    Remove-Item -Recurse -Force $VenvDir
    & $pythonCommand -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw 'Failed to recreate Python venv.' }
    $needInstall = $true
  } else {
    foreach ($pkg in $voicePackages) {
      if (-not (Test-PythonPackageInstalled $venvPython $pkg)) {
        Write-Step ('Missing package: ' + $pkg + ' - will install')
        $needInstall = $true
        break
      }
    }
  }

  if ($needInstall) {
    Write-Step 'Installing voice dependencies'
    if (Test-Path $RequirementsFile) {
      & $venvPython -m pip install --quiet -r $RequirementsFile
    } else {
      & $venvPython -m pip install --quiet $voicePackages
    }

    if ($LASTEXITCODE -eq 0) {
      Write-Host '    Done.'
    } else {
      Write-Warn 'Voice dependency install failed. Paloma will still run, but voice/TTS will not be available until the Python deps install successfully.'
    }
  } else {
    Write-Step ('Python venv OK at ' + $VenvDir)
  }
}

$braveKey = Get-JsonValue $SettingsFile 'BRAVE_API_KEY'
$cfToken = Get-JsonValue $SettingsFile 'CLOUDFLARE_API_TOKEN'
$cfZone = Get-JsonValue $SettingsFile 'CLOUDFLARE_ZONE_ID'
$gmailRecipient = Get-JsonValue $SettingsFile 'GMAIL_RECIPIENT'

if (-not $braveKey) { $braveKey = 'YOUR_BRAVE_API_KEY' }
if (-not $cfToken) { $cfToken = 'YOUR_CLOUDFLARE_API_TOKEN' }
if (-not $cfZone) { $cfZone = 'YOUR_CLOUDFLARE_ZONE_ID' }
if (-not $gmailRecipient) { $gmailRecipient = 'adamlynchmob@gmail.com' }

$servers = [ordered]@{}
$servers['brave-search'] = @{
  command = 'node'
  args = @("$NodeModules/@modelcontextprotocol/server-brave-search/dist/index.js")
  env = @{ BRAVE_API_KEY = $braveKey }
}
$servers['git'] = @{
  command = 'node'
  args = @("$NodeModules/@mseep/git-mcp-server/dist/index.js")
}
$servers['shell'] = @{
  command = 'node'
  args = @("$NodeModules/@kevinwatt/shell-mcp/build/index.js")
}
$servers['filesystem'] = @{
  command = 'node'
  args = @("$NodeModules/@modelcontextprotocol/server-filesystem/dist/index.js", $HOME)
}
$servers['web'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/web.js")
}
$servers['fs-extra'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/fs-extra.js")
}
$servers['exec'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/exec.js")
}
$servers['cloudflare-dns'] = @{
  command = 'node'
  args = @("$NodeModules/@thelord/mcp-cloudflare/dist/cli.js")
  env = @{
    CLOUDFLARE_API_TOKEN = $cfToken
    CLOUDFLARE_ZONE_ID = $cfZone
  }
}
$servers['voice'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/voice.js")
}
$servers['memory'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/memory.js")
}
$servers['ollama'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/ollama.js")
}
$servers['gmail'] = @{
  command = 'node'
  args = @("$ProjectRoot/mcp-servers/gmail.js")
  env = @{
    GMAIL_RECIPIENT = $gmailRecipient
    GMAIL_SENDER = 'paloma@verifesto.com'
  }
}

if (Get-CommandPathOrNull 'codex') {
  $servers['codex'] = @{
    command = 'codex'
    args = @('mcp-server')
  }
}

$settingsContent = @{ servers = $servers } | ConvertTo-Json -Depth 8
Set-Content -Path $SettingsFile -Value $settingsContent -Encoding utf8
Write-Step ('Wrote ' + $SettingsFile)

if (-not (Test-Path $McpJson)) {
  $mcpJsonContent = @{
    enabled = @('filesystem', 'git', 'shell', 'web', 'fs-extra', 'voice', 'memory', 'codex', 'brave-search', 'exec', 'cloudflare-dns')
    autoExecute = @(
      'filesystem',
      'brave-search',
      @{ server = 'shell'; tools = @('shell_find', 'shell_grep', 'shell_ls', 'shell_cat', 'shell_pwd', 'shell_echo', 'shell_date', 'shell_uptime', 'shell_free', 'shell_df', 'shell_w', 'shell_ps') },
      @{ server = 'git'; tools = @('git_diff', 'git_log', 'git_status', 'git_show', 'git_branch') },
      'voice',
      'memory',
      'fs-extra'
    )
  } | ConvertTo-Json -Depth 8

  Set-Content -Path $McpJson -Value $mcpJsonContent -Encoding utf8
  Write-Step ('Created ' + $McpJson + ' (permissions)')
} else {
  Write-Step ($McpJson + ' already exists')
}

$hookLines = @(
  '#!/bin/bash',
  'MEMORY_DIR="$HOME/.claude/projects/-home-adam-paloma/memory"',
  'if [ -d "$MEMORY_DIR/.git" ]; then',
  '  cd "$MEMORY_DIR"',
  '  if [ -n "$(git status --porcelain)" ]; then',
  '    git add -A',
  '    git commit -m "sync: $(date ''+%Y-%m-%d %H:%M:%S'')" --quiet',
  '    git push --quiet 2>/dev/null &',
  '  fi',
  'fi'
)
Set-Content -Path $HookFile -Value $hookLines -Encoding ascii
Write-Step 'Installed post-commit hook (memory auto-sync)'

Write-Host ''
Write-Step 'Setup complete!'
Write-Host ''
Write-Host '    MCP servers configured:'
Write-Host '      - filesystem (file operations)'
Write-Host '      - git (version control)'
Write-Host '      - shell (system queries)'
Write-Host '      - web (fetch URLs, download files)'
Write-Host '      - fs-extra (delete, copy)'
Write-Host '      - exec (command execution)'
Write-Host '      - memory (persistent semantic memory)'
Write-Host '      - voice (Kokoro TTS)'
Write-Host '      - brave-search (web search)'
Write-Host '      - ollama (local AI models)'
Write-Host '      - cloudflare-dns (DNS management)'
Write-Host '      - gmail (email send/receive)'
if (Get-CommandPathOrNull 'codex') {
  Write-Host '      - codex (OpenAI Codex MCP)'
}
Write-Host ''
if ($braveKey -eq 'YOUR_BRAVE_API_KEY') {
  Write-Host ('    [!] Set your Brave API key in ' + $SettingsFile)
}
if ($cfToken -eq 'YOUR_CLOUDFLARE_API_TOKEN') {
  Write-Host ('    [!] Set your Cloudflare credentials in ' + $SettingsFile)
}
Write-Host ''
Write-Host '    Run: npm start'
