# Smoke: bridge + extension bundle + optional portfolio via rori agent
param(
    [string]$Workspace = "D:\source\llm-adaptor",
    [switch]$SkipAgent
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'setup-vscode-rori.ps1') | Out-Host

$settings = Get-Content (Join-Path $env:APPDATA 'Code\User\settings.json') -Raw | ConvertFrom-Json
$key = $settings.'rori-ai.apiKey'
$base = ($settings.'rori-ai.bridgeUrl').TrimEnd('/')

Write-Host "Extension activate sanity (constructor order)..."
node -e @"
class RoriChatSession {
  constructor() {
    this._webviews = new Set();
    this.reset();
  }
  reset() {
    for (const w of this._webviews) {}
  }
}
new RoriChatSession();
console.log('constructor ok');
"@

Write-Host "Bridge chat smoke..."
$body = @{
    model = 'rori/gemini-web'
    messages = @(
        @{ role = 'user'; content = 'Reply with exactly: RORI_SMOKE_OK' }
    )
} | ConvertTo-Json -Depth 5
$resp = Invoke-RestMethod -Uri "$base/chat/completions" -Method Post -Headers @{
    Authorization = "Bearer $key"
    'Content-Type' = 'application/json'
} -Body $body -TimeoutSec 120
$content = $resp.choices[0].message.content
if ($content -notmatch 'RORI_SMOKE_OK') {
    throw "Unexpected bridge reply: $content"
}
Write-Host "Bridge OK: $content"

if (-not $SkipAgent) {
    $outDir = Join-Path $Workspace '.ignore\vscode-rori-test'
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $prompt = @"
Create a single-page technical portfolio HTML at $outDir\index.html .
Dark theme, responsive. Sections: hero name William, skills, projects placeholder, contact footer.
Use write_file tool. No external assets required.
"@
    Write-Host "Agent portfolio write -> $outDir"
    Push-Location $Workspace
    try {
        $escaped = $prompt -replace '"', '\"'
        rori $prompt
    } finally { Pop-Location }
    $index = Join-Path $outDir 'index.html'
    if (-not (Test-Path $index)) { throw "Portfolio index not created: $index" }
    $len = (Get-Item $index).Length
    if ($len -lt 200) { throw "Portfolio file too small: $len bytes" }
    Write-Host "Portfolio OK: $index ($len bytes)"
}

Write-Host ""
Write-Host "Manual VS Code: Reload Window -> Ctrl+Shift+R -> ask Rori same portfolio prompt or click Agent."
