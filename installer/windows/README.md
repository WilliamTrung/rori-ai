# Rori AI — Windows installer

Public release artifacts:

| File | Description |
|------|-------------|
| **`RoriSetup-x.x.x-win-x64.exe`** | Inno Setup wizard (single download, recommended) |
| **`RoriInstall-x.x.x-win-x64.zip`** | `RoriInstall.exe` + `payload/` + `post-install.ps1` |

## Build (maintainers)

```powershell
cd D:\source\llm-adaptor
# ZIP + RoriInstall.exe (requires .NET 10 SDK)
powershell -NoProfile -File .\scripts\build-rori-installer.ps1 -Version 1.0.0
# Add RoriSetup.exe (requires Inno Setup 6 on the machine)
powershell -NoProfile -File .\scripts\build-rori-installer.ps1 -Version 1.0.0 -Inno
```

GitHub Actions builds both on tag `rori-v*` (see `.github/workflows/release-rori-installer.yml`).

## Silent install (enterprise / CI)

```powershell
.\RoriInstall.exe --silent --skip-bridge
# or with bridge:
.\RoriInstall.exe --silent --bridge-url "https://host:5080/v1" --api-key "your-key"
```

## What gets installed

1. **Node.js 22+** — prompted via winget if missing  
2. **`command-code`** and **`rori-cli`** — global npm (`rori` on PATH)  
3. **Optional BYOK** — `%USERPROFILE%\.commandcode\providers.json` + `config.json` (`localOnly`)

Docs: [docs/RORI-AI.md](../../docs/RORI-AI.md)
