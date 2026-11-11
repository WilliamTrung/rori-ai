# Repo-local launcher → global npm `rori`, else cmdc.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
$npmBin = npm prefix -g 2>$null
if ($npmBin) {
    $globalRori = Join-Path $npmBin 'rori.ps1'
    if (Test-Path $globalRori) {
        & $globalRori @Args
        exit $LASTEXITCODE
    }
}
$c = Get-Command cmdc -ErrorAction SilentlyContinue
if (-not $c) {
    Write-Error 'Install: powershell -File scripts/install-rori-cli.ps1'
    exit 1
}
& $c.Source @Args
exit $LASTEXITCODE
