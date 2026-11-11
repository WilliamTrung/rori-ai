# Rori AI (Command Code BYOK)

**Rori** is the CLI (`rori` npm package). Same engine as [Command Code](https://commandcode.ai/). Point BYOK `providers.json` at any OpenAI-compatible **`/v1`** API — commonly **[llm-adaptor](https://github.com/WilliamTrung/llm-adaptor)** Gemini Web.

## Install

- **Windows:** [GitHub Releases](https://github.com/WilliamTrung/rori-ai/releases) → `RoriSetup-*-win-x64.exe`
- **Source:** `scripts/install-rori-cli.ps1`

## Bridge (BYOK)

**Windows:** `%USERPROFILE%\.commandcode\providers.json`

```powershell
$env:LLM_BRIDGE_BASE_URL = "https://your-host:5080/v1"
$env:LLM_PLATFORM_OPENAI_API_KEY = "<bridge bearer key>"
powershell -NoProfile -File .\scripts\setup-rori-bridge.ps1
```

Sample: **[examples/rori.providers.fragment.json](../examples/rori.providers.fragment.json)**

| CLI model | `rori/gemini-web` |
| Provider id in JSON | `rori` |
| Model key in JSON | `gemini-web` |

Use **`rori --local-only -m rori/gemini-web`**. Do **not** use **`rori login`** for BYOK-only (that is Command Code cloud billing).

See also **[installer/windows/README.md](../installer/windows/README.md)**.
