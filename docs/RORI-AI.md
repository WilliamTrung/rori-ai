# Rori AI (Command Code BYOK)

**Rori** uses **only your llm-adaptor host + API key** for model traffic when `localOnly` is set:

| Variable | Purpose |
|----------|---------|
| **`LLM_BRIDGE_BASE_URL`** | `https://llm.williamthanhtrung.id.vn/v1` (public; see `config/bridge-public.json`) |
| **`LLM_PLATFORM_OPENAI_API_KEY`** | Bearer from llm-adaptor `api.env` |

Setup:

```powershell
$env:LLM_BRIDGE_BASE_URL = "https://llm.williamthanhtrung.id.vn/v1"
$env:LLM_PLATFORM_OPENAI_API_KEY = "<msi key>"
powershell -NoProfile -File .\scripts\setup-rori-bridge.ps1
```

**No `rori login`** and **no `COMMAND_CODE_API_KEY`** for BYOK headless agent (`-p`). That path uses **`rori-bridge-agent`** (tools via bridge + local disk).

Interactive TUI still uses Command Code if you omit `-p` — optional **`rori login`** only for CC cloud features, not for MSI Gemini.

```powershell
rori --local-only --list-models
rori --local-only -m rori/gemini-web
rori --local-only -p "your task" -m rori/gemini-web --max-turns 20 --add-dir .
```

Sample providers: **[examples/rori.providers.fragment.json](../examples/rori.providers.fragment.json)**

Server: **[llm-adaptor](https://github.com/WilliamTrung/llm-adaptor)** — model id **`rori/gemini-web`**.
