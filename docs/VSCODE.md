# Rori in VS Code / Cursor

## Rori sidebar (BYOK — API key only)

Claude Code–style **activity bar** chat wired to **llm-adaptor** on MSI.

```powershell
$env:LLM_BRIDGE_BASE_URL = "http://100.79.204.29:5080/v1"
$env:LLM_PLATFORM_OPENAI_API_KEY = "<msi key>"
powershell -NoProfile -File .\scripts\setup-vscode-rori.ps1
```

Then **Developer: Reload Window** → **Rori AI** in the activity bar (or **Ctrl+Shift+R**).

Settings (`rori-ai.*`):

| Setting | Meaning |
|---------|---------|
| `rori-ai.bridgeUrl` | `…/v1` on MSI |
| `rori-ai.apiKey` | `LLM_PLATFORM_OPENAI_API_KEY` |
| `rori-ai.model` | `rori/gemini-web` |

**Run agent in terminal** uses `rori --local-only -p` (bridge agent, file tools) in the integrated terminal.

## Optional: Command Code extension (full CC UI)

Same pattern as upstream docs: sidebar sessions + IDE context sync (may need CC account for some features).

```powershell
cursor --install-extension CommandCode.commandcode-vscode
rori --ide-setup
```

Launch **`rori --local-only -m rori/gemini-web`** from the IDE terminal for `IDE ✓` context. BYOK model traffic still uses MSI + your API key.
