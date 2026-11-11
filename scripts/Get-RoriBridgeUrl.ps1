param([string]$BridgeUrl = $env:LLM_BRIDGE_BASE_URL)
if ($BridgeUrl) {
    $b = $BridgeUrl.TrimEnd('/')
    if (-not $b.EndsWith('/v1')) { $b += '/v1' }
    return $b
}
$cfg = Join-Path (Split-Path $PSScriptRoot -Parent) 'config\bridge-public.json'
if (Test-Path $cfg) {
    $j = Get-Content $cfg -Raw | ConvertFrom-Json
    if ($j.bridgeUrl) { return $j.bridgeUrl.TrimEnd('/') }
}
return 'https://agent.williamthanhtrung.id.vn/v1'
