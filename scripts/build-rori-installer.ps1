# Build RoriInstall payload + exe (+ optional Inno RoriSetup.exe). Output: artifacts/
param(
    [string]$Version = "1.0.0",
    [switch]$Inno
)

$ErrorActionPreference = 'Stop'
$repo = (Join-Path $PSScriptRoot '..' | Resolve-Path).Path
$out = Join-Path $repo 'artifacts\RoriInstall'
$payload = Join-Path $out 'payload'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $payload, (Join-Path $payload 'scripts') | Out-Null

function Copy-Tree([string]$Src, [string]$Dst) {
    robocopy $Src $Dst /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $Src -> $Dst" }
}

Copy-Tree (Join-Path $repo 'packages\rori-cli') (Join-Path $payload 'rori-cli')
Copy-Item (Join-Path $repo 'scripts\setup-rori-bridge.ps1') (Join-Path $payload 'scripts\setup-rori-bridge.ps1') -Force
Copy-Item (Join-Path $repo 'installer\windows\post-install.ps1') (Join-Path $out 'post-install.ps1') -Force
Copy-Item (Join-Path $repo 'examples\rori.providers.fragment.json') (Join-Path $out 'rori.providers.fragment.json') -Force
Copy-Item (Join-Path $repo 'installer\windows\README.md') (Join-Path $out 'README.txt') -Force
Copy-Item (Join-Path $repo 'scripts\rori.cmd') (Join-Path $payload 'scripts\rori.cmd') -Force
Copy-Item (Join-Path $repo 'scripts\rori.ps1') (Join-Path $payload 'scripts\rori.ps1') -Force

Write-Host "Publishing RoriInstall.exe ..."
dotnet publish (Join-Path $repo 'installer\Rori.Installer\Rori.Installer.csproj') `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $out `
    /p:Version=$Version

$zip = Join-Path $repo "artifacts\RoriInstall-$Version-win-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip
Write-Host "ZIP: $zip"

if ($Inno) {
    $iscc = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) { throw 'Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php or run without -Inno' }
    & $iscc (Join-Path $repo 'installer\windows\rori-setup.iss')
    $setup = Join-Path $repo "artifacts\installer\RoriSetup-$Version-win-x64.exe"
    if (Test-Path $setup) { Write-Host "Setup EXE: $setup" }
}

$hash = Get-FileHash $zip -Algorithm SHA256
$hashPath = "$zip.sha256"
"$($hash.Hash)  $(Split-Path $zip -Leaf)" | Set-Content $hashPath -Encoding ascii
Write-Host "SHA256: $($hash.Hash)"
