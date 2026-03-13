$ErrorActionPreference = 'Stop'

function Write-Log($message) { Write-Host "  [paloma-sync] $message" }
function Write-Ok($message) { Write-Host "  [OK] $message" }
function Write-Warn($message) { Write-Host "  [WARN] $message" }
function Write-Fail($message) { Write-Host "  [FAIL] $message" }

$unmerged = git diff --name-only --diff-filter=U 2>$null
if ($LASTEXITCODE -ne 0) { $unmerged = @() }

if ($unmerged) {
  Write-Warn 'Unmerged files detected from a previous merge:'
  $unmerged | ForEach-Object { Write-Host "     $_" }
  $resolveNeeded = $true
} else {
  Write-Log 'Fetching from origin...'
  git fetch origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Warn 'Fetch failed (offline?)'
    exit 0
  }

  $local = git rev-parse HEAD 2>$null
  $remote = git rev-parse origin/main 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $remote) { $remote = $local }

  if ($local -eq $remote) {
    Write-Ok 'Already up to date'
    exit 0
  }

  git merge --ff-only origin/main 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok 'Fast-forwarded to origin/main'
    exit 0
  }

  Write-Log 'Branches diverged, attempting merge...'
  git merge origin/main --no-edit 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok 'Merged origin/main successfully'
    exit 0
  }

  $unmerged = git diff --name-only --diff-filter=U 2>$null
  if (-not $unmerged) {
    Write-Fail 'Merge failed for unknown reason'
    exit 1
  }

  Write-Warn 'Merge conflicts in:'
  $unmerged | ForEach-Object { Write-Host "     $_" }
  $resolveNeeded = $true
}

if ($resolveNeeded) {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Fail 'Claude CLI not found — resolve conflicts manually'
    exit 1
  }

  Write-Log 'Spawning Claude to resolve merge conflicts...'
  $fileList = ((git diff --name-only --diff-filter=U 2>$null) -join ', ')
  $prompt = @"
You are resolving git merge conflicts in the Paloma repository.

The following files have merge conflicts: $fileList

For each conflicted file:
1. Read the file to see the conflict markers (<<<<<<< HEAD, =======, >>>>>>>)
2. Understand what BOTH sides changed — HEAD is the local work, the other side is from origin/main
3. Resolve the conflict by keeping the best of both sides. If one side has newer features/fixes that the other doesn't, keep those. If both sides changed the same thing differently, merge them intelligently.
4. Remove ALL conflict markers (<<<<<<< HEAD, =======, >>>>>>>) — the file must be valid after resolution
5. Write the resolved file

After resolving ALL files, run these git commands:
- git add each resolved file
- git commit with message "chore: auto-resolve merge conflicts (paloma-sync)"

Be thorough — check that no conflict markers remain in any file.
"@

  claude -p --model sonnet $prompt
  if ($LASTEXITCODE -ne 0) {
    Write-Fail 'Claude could not complete conflict resolution'
    exit 1
  }

  $remaining = git diff --name-only --diff-filter=U 2>$null
  if ($remaining) {
    Write-Fail 'Claude could not resolve all conflicts. Remaining:'
    $remaining | ForEach-Object { Write-Host "     $_" }
    exit 1
  }

  Write-Ok 'Merge conflicts resolved automatically'
}