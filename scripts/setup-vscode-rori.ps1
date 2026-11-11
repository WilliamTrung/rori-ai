# Install Rori AI VS Code/Cursor extension + BYOK + optional Command Code IDE ext.
param(
    [string]$BridgeUrl = $env:LLM_BRIDGE_BASE_URL,
    [string]$ApiKey = $env:LLM_PLATFORM_OPENAI_API_KEY
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$extDir = Join-Path $repo 'vscode-extension\rori-ai'

if ($BridgeUrl -and $ApiKey) {
    & powershell -NoProfile -File (Join-Path $repo 'scripts\setup-rori-bridge.ps1') -BaseUrl $BridgeUrl -ApiKey $ApiKey
}

function Install-LocalExtension([string]$TargetRoot) {
    $dest = Join-Path $TargetRoot 'WilliamTrung.rori-ai-0.1.0'
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item $extDir $dest -Recurse -Force
    Write-Host "Installed extension folder: $dest"
}

$cursor = Get-Command cursor -ErrorAction SilentlyContinue
$code = Get-Command code -ErrorAction SilentlyContinue
$installed = $false

$cursorExt = Join-Path $env:USERPROFILE '.cursor\extensions'
$codeExt = Join-Path $env:USERPROFILE '.vscode\extensions'
if (Test-Path (Split-Path $cursorExt)) { Install-LocalExtension $cursorExt; $installed = $true }
elseif (Test-Path (Split-Path $codeExt)) { Install-LocalExtension $codeExt; $installed = $true }

if ($cursor) {
    Write-Host "Optional Command Code IDE panel (may need CC account):"
    & cursor --install-extension CommandCode.commandcode-vscode 2>&1 | Write-Host
}
elseif ($code) {
    & code --install-extension CommandCode.commandcode-vscode 2>&1 | Write-Host
}

$settingsPath = Join-Path $env:APPDATA 'Cursor\User\settings.json'
if (-not (Test-Path $settingsPath)) {
    $settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
}
if ((Test-Path $settingsPath) -and $ApiKey -and $BridgeUrl) {
    $json = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if (-not $json.PSObject.Properties['rori-ai.bridgeUrl']) {
        $json | Add-Member -NotePropertyName 'rori-ai.bridgeUrl' -NotePropertyValue $BridgeUrl.TrimEnd('/') -Force
    }
    if (-not $json.PSObject.Properties['rori-ai.apiKey']) {
        $json | Add-Member -NotePropertyName 'rori-ai.apiKey' -NotePropertyValue $ApiKey -Force
    }
    $json | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
    Write-Host "Updated $settingsPath (rori-ai.bridgeUrl, rori-ai.apiKey)"
}

if ($installed) {
    Write-Host "Reload window: Developer: Reload Window. Open Rori from activity bar or Ctrl+Shift+R."
}
