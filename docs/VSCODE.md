# Rori in VS Code / Cursor (simplest)

Uses **[llm-adaptor](https://github.com/WilliamTrung/llm-adaptor)** on MSI — **only your API key** (no Command Code login).

## 1. One command

```powershell
git clone https://github.com/WilliamTrung/rori-ai.git
cd rori-ai
powershell -NoProfile -File .\scripts\setup-vscode-rori.ps1 -ApiKey "<LLM_PLATFORM_OPENAI_API_KEY>"
```

Bridge URL default: `http://100.79.204.29:5080/v1` (override with `-BridgeUrl`).

## 2. Reload editor

**Developer: Reload Window** → open **Rori AI** in the activity bar (**Ctrl+Shift+R**).

## Settings (optional)

| Key | Default |
|-----|---------|
| `rori-ai.apiKey` | set by setup script |
| `rori-ai.bridgeUrl` | MSI `/v1` |
| `rori-ai.model` | `rori/gemini-web` |

You can set only the API key in **Settings → Rori AI** if the extension is already installed.

## Agent with file tools

Button **Run agent in terminal** needs global `rori` CLI (`scripts/install-rori-cli.ps1`). Chat in the sidebar does **not** need the CLI.
