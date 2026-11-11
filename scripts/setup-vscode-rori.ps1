# Simplest Rori in Cursor/VS Code: install extension + set API key (llm-adaptor MSI).
param(
    [string]$ApiKey = $env:LLM_PLATFORM_OPENAI_API_KEY,
    [string]$BridgeUrl = "http://100.79.204.29:5080/v1"
)

$ErrorActionPreference = 'Stop'
if (-not $ApiKey) {
    $ApiKey = Read-Host "LLM_PLATFORM_OPENAI_API_KEY (from llm-adaptor api.env on MSI)"
}
if (-not $ApiKey) { throw "API key required" }

$repo = Split-Path $PSScriptRoot -Parent
$extDir = Join-Path $repo 'vscode-extension\rori-ai'
$ver = (Get-Content (Join-Path $extDir 'package.json') -Raw | ConvertFrom-Json).version

function Install-LocalExtension([string]$TargetRoot) {
    $dest = Join-Path $TargetRoot "WilliamTrung.rori-ai-$ver"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item $extDir $dest -Recurse -Force
    Write-Host "Installed: $dest"
}

$cursorExt = Join-Path $env:USERPROFILE '.cursor\extensions'
$codeExt = Join-Path $env:USERPROFILE '.vscode\extensions'
if (Test-Path (Split-Path $cursorExt)) { Install-LocalExtension $cursorExt }
elseif (Test-Path (Split-Path $codeExt)) { Install-LocalExtension $codeExt }
else { throw "Cursor or VS Code extensions folder not found" }

[Environment]::SetEnvironmentVariable('LLM_PLATFORM_OPENAI_API_KEY', $ApiKey, 'User')
$base = $BridgeUrl.TrimEnd('/')
if (-not $base.EndsWith('/v1')) { $base += '/v1' }
[Environment]::SetEnvironmentVariable('LLM_BRIDGE_BASE_URL', $base, 'User')

$settingsPath = Join-Path $env:APPDATA 'Cursor\User\settings.json'
if (-not (Test-Path $settingsPath)) {
    $settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
}
$settingsObj = @{}
if (Test-Path $settingsPath) {
    try { $settingsObj = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable } catch {
        $settingsObj = @{}
    }
}
if (-not $settingsObj) { $settingsObj = @{} }
$settingsObj['rori-ai.apiKey'] = $ApiKey
$settingsObj['rori-ai.bridgeUrl'] = $base
$settingsObj['rori-ai.model'] = 'rori/gemini-web'
($settingsObj | ConvertTo-Json -Depth 10) | Set-Content $settingsPath -Encoding UTF8
Write-Host "Settings: $settingsPath"

Write-Host ""
Write-Host "Done. 1) Developer: Reload Window  2) Rori AI icon in sidebar (Ctrl+Shift+R)"
