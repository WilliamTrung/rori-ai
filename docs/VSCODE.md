# Rori in VS Code / Cursor (simplest)

Uses **[llm-adaptor](https://github.com/WilliamTrung/llm-adaptor)** on MSI — **only your API key**.

Public bridge (default): **`https://llm.williamthanhtrung.id.vn/v1`** — see `config/bridge-public.json`.

## 1. One command

```powershell
git clone https://github.com/WilliamTrung/rori-ai.git
cd rori-ai
powershell -NoProfile -File .\scripts\setup-vscode-rori.ps1 -ApiKey "<LLM_PLATFORM_OPENAI_API_KEY>"
```

## 2. Reload editor

**Developer: Reload Window** → **Rori AI** in the activity bar (**Ctrl+Shift+R**).
