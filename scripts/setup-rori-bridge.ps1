# Rori AI BYOK -> llm-adaptor Gemini Web bridge (Command Code providers.json).
param(
    [string]$BaseUrl = $env:LLM_BRIDGE_BASE_URL,
    [string]$ApiKey = $env:LLM_PLATFORM_OPENAI_API_KEY
)

$ErrorActionPreference = 'Stop'
if (-not $BaseUrl) { throw "Set LLM_BRIDGE_BASE_URL (e.g. http://100.79.204.29:5080/v1)" }
if (-not $ApiKey) { throw "Set LLM_PLATFORM_OPENAI_API_KEY (same as MSI api.env)" }

$base = $BaseUrl.TrimEnd('/')
if (-not $base.EndsWith('/v1')) { $base += '/v1' }

$json = @"
{
  "provider": {
    "rori": {
      "name": "Rori AI",
      "baseURL": "$base",
      "apiKey": "`$LLM_PLATFORM_OPENAI_API_KEY",
      "models": {
        "gemini-web": {
          "name": "Rori AI Gemini Web",
          "contextWindow": 1000000,
          "maxOutput": 8192
        }
      }
    }
  }
}
"@

$dir = Join-Path $env:USERPROFILE '.commandcode'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$providersPath = Join-Path $dir 'providers.json'
[System.IO.File]::WriteAllText($providersPath, $json.Trim(), (New-Object System.Text.UTF8Encoding $false))

$configPath = Join-Path $dir 'config.json'
$configJson = '{"localOnly":true}'
[System.IO.File]::WriteAllText($configPath, $configJson, (New-Object System.Text.UTF8Encoding $false))

[Environment]::SetEnvironmentVariable('LLM_PLATFORM_OPENAI_API_KEY', $ApiKey, 'User')
Write-Host "Rori AI: wrote $providersPath and $configPath (localOnly)"
Write-Host "Model: rori/gemini-web  (like ollama/qwen2.5-coder:7b — no Command Code subscription for the model)"
Write-Host "Do NOT run rori login for BYOK — that is Command Code cloud billing."
Write-Host "  rori --local-only -m rori/gemini-web"
Write-Host "Headless -p still requires rori login on some CC versions; prefer interactive --local-only."
