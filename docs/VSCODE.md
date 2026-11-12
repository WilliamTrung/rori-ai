# Rori in VS Code / Cursor

**API key only** → `https://agent.williamthanhtrung.id.vn/v1`

## Install

```powershell
powershell -File .\scripts\setup-vscode-rori.ps1 -ApiKey "<LLM_PLATFORM_OPENAI_API_KEY>"
powershell -File .\scripts\test-vscode-rori.ps1   # bridge + optional agent portfolio smoke
```

**Developer: Reload Window** after install (required).

If you see `command 'rori-ai.openChat' not found`, the extension failed to activate — update to **0.2.1+** (constructor fix) and reload again.

## Use (Claude Code–style)

| Action | How |
|--------|-----|
| **Chat in editor pane** | **Ctrl+Shift+R** |
| **Ask** | Chat + **read-only** shell (Get-Content, list, search) |
| **Agent** | **Full** shell in workspace (default) |
| **Plan** | Deep planning chat — **no** command execution |
| Chat-only | Settings → `rori-ai.agentMode`: false |
| Terminal | Header **⌘** or `rori "your task"` in project folder (no extra flags) |
| New chat | Open another editor tab via **Ctrl+Shift+R** (or **Ctrl+Shift+N** on an existing Rori tab) |

Open a **folder** first (`File → Open Folder`, e.g. `D:\custom`). Agent run prepends a shallow workspace snapshot and optional editor selection.

### Slow turns?

Each agent **turn** = one HTTP call to **llm-adaptor → Playwright → Gemini Web** (not a fast API). Measured **~30–90s/turn** on the bridge; later turns grow slower if the full transcript is pasted into Gemini.

Mitigations: `rori-ai.maxHistoryMessages` (default 14), `rori-ai.maxToolOutputInHistory`, fewer agent turns when the model chats without shell. Status shows `bridge Xs` per turn.

**Attachments:** **+** or **drag-and-drop** onto chat/composer (VS Code explorer URIs or OS files). Right-click **+** = current editor file. Chips in composer; payload includes `attachments[]` on the user message. Max 8 files, 8 MB each. View **Output → Rori** for extension logs; API logs on MSI for adaptor + Gemini upload. Requires redeployed llm-adaptor with OpenAI-compat attachments.

**Model:** header dropdown loads from bridge `GET /v1/models` (same ids as OpenAI compat, e.g. `llm-adaptor/gemini-browser`). Changing model starts a new chat thread.

Settings: `rori-ai.model` (fallback), `rori-ai.defaultMode`, `rori-ai.shell`. Agent turns are **unlimited** by default (`rori-ai.maxAgentTurns`: **0**).

### Provider settings (BYOK)

| Where | What |
|--------|------|
| Chat header **⚙** | Full **JSON** of every `rori-ai` key (`apiKey` included), **Test connection**, **Save** |
| Command Palette | **Rori: Configure Provider** |
| Settings UI | `@ext:WilliamTrung.rori-ai` or **Rori: Open Extension Settings** |

**Rori** is the llm-adaptor interface — same name on the web (`/chat`) and in the editor tab (**Ctrl+Shift+R**).

API key is **not** kept in `settings.json` after save (migrated to secrets). Setup script still seeds `rori-ai.apiKey` once; extension moves it to secrets on activate.

Advanced: `rori-ai.maxAgentTurns` (0 = no cap), `rori-ai.shell`, `rori-ai.maxHistoryMessages`, optional `rori-ai.openChatOnActivate`.
