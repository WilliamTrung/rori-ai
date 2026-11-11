# Install global `rori` CLI (npm bin → Command Code). Idempotent.
# Release build: use scripts/build-rori-installer.ps1 → RoriSetup.exe on GitHub.
$ErrorActionPreference = 'Stop'
$repoRoot = (Join-Path $PSScriptRoot '..' | Resolve-Path).Path
$post = Join-Path $repoRoot 'installer\windows\post-install.ps1'
if (Test-Path $post) {
    $skip = -not $env:LLM_BRIDGE_BASE_URL
    & powershell -NoProfile -ExecutionPolicy Bypass -File $post -InstallRoot $repoRoot $(if ($skip) { '-SkipBridge' })
    exit $LASTEXITCODE
}
$pkg = Join-Path $repoRoot 'packages\rori-cli'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node/npm required. Install Node 22+, then: npm i -g command-code@latest'
}

$cc = Get-Command cmdc -ErrorAction SilentlyContinue
if (-not $cc) {
    Write-Host 'Installing command-code globally...'
    npm i -g command-code@latest
}

Write-Host "Installing rori-cli from $pkg ..."
Push-Location $pkg
npm install --omit=dev 2>&1 | Out-Null
Pop-Location
npm i -g $pkg

# Legacy shim in LocalAppData (optional fallback if npm path missing)
$bin = Join-Path $env:LOCALAPPDATA 'rori-cli'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item (Join-Path $repoRoot 'scripts\rori.cmd') (Join-Path $bin 'rori.cmd') -Force
Copy-Item (Join-Path $repoRoot 'scripts\rori.ps1') (Join-Path $bin 'rori.ps1') -Force

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$bin*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$bin", 'User')
    $env:Path = "$env:Path;$bin"
}

$rori = Get-Command rori -ErrorAction SilentlyContinue
if (-not $rori) {
    $npmBin = npm prefix -g 2>$null
    if ($npmBin) { $env:Path = "$npmBin;$env:Path"; $rori = Get-Command rori -ErrorAction SilentlyContinue }
}

if ($rori) {
    Write-Host "rori: $($rori.Source)"
    & rori --version 2>&1
} else {
    Write-Host 'rori installed; open a new terminal and run: rori --version'
}

Write-Host "BYOK: powershell -NoProfile -File $repoRoot\scripts\setup-rori-bridge.ps1"
Write-Host "Use rori (not cmdc) — e.g. rori --local-only -m rori/gemini-web"
