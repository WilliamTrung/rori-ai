# Rori AI

Client for **[llm-adaptor](https://github.com/WilliamTrung/llm-adaptor)** (Gemini Web on MSI) — **API key only**, no subscription.

## Simplest (Cursor / VS Code)

```powershell
git clone https://github.com/WilliamTrung/rori-ai.git
cd rori-ai
powershell -File .\scripts\setup-vscode-rori.ps1 -ApiKey "<from llm-adaptor api.env>"
```

Reload window → **Rori AI** sidebar. Details: **[docs/VSCODE.md](docs/VSCODE.md)**.

## Download (Windows CLI installer)

**[Releases](https://github.com/WilliamTrung/rori-ai/releases)** — tag `rori-v*`

| Artifact | Use |
|----------|-----|
| **`RoriSetup-*-win-x64.exe`** | Windows wizard (recommended) |
| **`RoriInstall-*-win-x64.zip`** | Portable `RoriInstall.exe` + payload |

## Quick start (Windows)

1. Run **`RoriSetup-*-win-x64.exe`** (or ZIP → `RoriInstall.exe`).
2. Optional: enter bridge URL `https://your-host:5080/v1` and `LLM_PLATFORM_OPENAI_API_KEY`.
3. New terminal:

```powershell
rori --local-only --list-models
rori --local-only -m rori/gemini-web
```

Manual BYOK: **[docs/RORI-AI.md](docs/RORI-AI.md)** · sample **[examples/rori.providers.fragment.json](examples/rori.providers.fragment.json)**

## From source

```powershell
git clone https://github.com/WilliamTrung/rori-ai.git
cd rori-ai
powershell -NoProfile -File .\scripts\install-rori-cli.ps1
```

Build installer:

```powershell
powershell -NoProfile -File .\scripts\build-rori-installer.ps1 -Version 1.0.0 -Inno
```

## npm

```powershell
npm i -g command-code@latest
npm i -g https://github.com/WilliamTrung/rori-ai.git#main:packages/rori-cli
```

(Or clone and `npm i -g ./packages/rori-cli`.)

## Bridge server

Host **llm-adaptor** separately for Gemini Web `/v1` — **[llm-adaptor](https://github.com/WilliamTrung/llm-adaptor)**.

## CI releases

Tag `rori-v1.0.0` to build installers via GitHub Actions. If the workflow file is not on `main` yet, run `gh auth refresh -h github.com -s workflow`, then commit and push `.github/workflows/release-rori-installer.yml`.

## License

MIT
