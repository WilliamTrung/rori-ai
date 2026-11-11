# Rori AI Windows install (Node 22+, command-code, rori-cli, optional BYOK bridge).
param(
    [string]$InstallRoot = $PSScriptRoot,
    [string]$BridgeUrl = $env:LLM_BRIDGE_BASE_URL,
    [string]$ApiKey = $env:LLM_PLATFORM_OPENAI_API_KEY,
    [switch]$Silent,
    [switch]$SkipBridge
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Msg) { Write-Host $Msg }
function Write-Warn([string]$Msg) { Write-Host $Msg -ForegroundColor Yellow }

function Ensure-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        if ($Silent) { throw 'Node.js 22+ is required. Install from https://nodejs.org or: winget install OpenJS.NodeJS.LTS' }
        Write-Warn 'Node.js not found.'
        $ok = Read-Host 'Install Node LTS via winget now? (Y/n)'
        if ($ok -eq '' -or $ok -match '^[Yy]') {
            winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
        } else {
            throw 'Install Node 22+ then re-run the installer.'
        }
    }
    $ver = (node -v).TrimStart('v')
    $major = [int]($ver.Split('.')[0])
    if ($major -lt 22) {
        throw "Node $ver found; Rori requires Node 22+. Upgrade Node.js."
    }
}

function Install-RoriCli([string]$PkgDir) {
    if (-not (Test-Path $PkgDir)) { throw "Missing rori-cli package at $PkgDir" }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm not found after Node install.' }

    Write-Info 'Installing command-code globally...'
    npm i -g command-code@latest 2>&1 | Out-Host

    Write-Info "Installing rori-cli from $PkgDir ..."
    Push-Location $PkgDir
    try {
        if (-not (Test-Path 'node_modules\command-code')) {
            npm install --omit=dev 2>&1 | Out-Host
        }
        npm i -g . 2>&1 | Out-Host
    } finally {
        Pop-Location
    }

    $npmBin = npm prefix -g 2>$null
    if ($npmBin) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -notlike "*$npmBin*") {
            [Environment]::SetEnvironmentVariable('Path', "$userPath;$npmBin", 'User')
            $env:Path = "$env:Path;$npmBin"
        }
    }

    $legacy = Join-Path $env:LOCALAPPDATA 'rori-cli'
    New-Item -ItemType Directory -Force -Path $legacy | Out-Null
    $payloadScripts = Join-Path (Split-Path $InstallRoot -Parent) 'payload\scripts'
    if (-not (Test-Path $payloadScripts)) {
        $payloadScripts = Join-Path $InstallRoot 'payload\scripts'
    }
    if (Test-Path (Join-Path $payloadScripts 'rori.cmd')) {
        Copy-Item (Join-Path $payloadScripts 'rori.cmd') (Join-Path $legacy 'rori.cmd') -Force
        Copy-Item (Join-Path $payloadScripts 'rori.ps1') (Join-Path $legacy 'rori.ps1') -Force
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -notlike "*$legacy*") {
            [Environment]::SetEnvironmentVariable('Path', "$userPath;$legacy", 'User')
        }
    }
}

function Configure-Bridge([string]$SetupScript, [string]$Url, [string]$Key) {
    if ($SkipBridge) { return }
    if (-not $Url) {
        if ($Silent) { return }
        Write-Info 'BYOK bridge (llm-adaptor /v1). Press Enter to skip.'
        $Url = Read-Host 'Bridge base URL (e.g. https://your-host:5080/v1)'
        if (-not $Url) { return }
    }
    if (-not $Key) {
        if ($Silent) { return }
        $Key = Read-Host 'LLM_PLATFORM_OPENAI_API_KEY (Bearer for bridge; Enter to skip)'
        if (-not $Key) { return }
    }
    $env:LLM_BRIDGE_BASE_URL = $Url
    $env:LLM_PLATFORM_OPENAI_API_KEY = $Key
    if (Test-Path $SetupScript) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $SetupScript
    } else {
        Write-Warn "setup-rori-bridge.ps1 not found at $SetupScript"
    }
}

Ensure-Node
$roriCandidates = @(
    (Join-Path $InstallRoot 'payload\rori-cli'),
    (Join-Path $InstallRoot 'packages\rori-cli'),
    (Join-Path $InstallRoot 'rori-cli')
)
$roriPkg = $roriCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $roriPkg) { throw "rori-cli package not found under $InstallRoot" }
Install-RoriCli -PkgDir $roriPkg

$bridgeCandidates = @(
    (Join-Path $InstallRoot 'payload\scripts\setup-rori-bridge.ps1'),
    (Join-Path $InstallRoot 'scripts\setup-rori-bridge.ps1')
)
$setupBridge = $bridgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
Configure-Bridge -SetupScript $setupBridge -Url $BridgeUrl -Key $ApiKey

$rori = Get-Command rori -ErrorAction SilentlyContinue
if (-not $rori) {
    $npmBin = npm prefix -g 2>$null
    if ($npmBin) { $env:Path = "$npmBin;$env:Path"; $rori = Get-Command rori -ErrorAction SilentlyContinue }
}
if ($rori) {
    Write-Info "Installed: $($rori.Source)"
    & rori --version 2>&1 | Out-Host
    Write-Info 'Open a new terminal: rori --local-only --list-models'
} else {
    Write-Warn 'rori not on PATH yet. Open a new terminal and run: rori --version'
}
