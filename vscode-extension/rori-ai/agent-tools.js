// @ts-check
const { spawnSync } = require("child_process");
const fs = require("fs");

const CMDLET_LINE =
  /^(?:Get-|Set-|Remove-|New-|Copy-|Move-|Test-Path|Invoke-|Start-|Stop-|Write-|Out-|Select-Object|ForEach-Object|Push-Location|Pop-Location|cd\s|dir\b|ls\b|rm\b|del\b|cat\b|type\b|npm\s|node\s|python\s|pip\s|git\s)/i;

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractCommands(text) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();

  const add = (/** @type {string} */ raw) => {
    const c = raw.replace(/\r\n/g, "\n").trim();
    if (!c || seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };

  const fenceRe =
    /```(?:powershell|ps1|pwsh|bash|sh|shell|cmd|bat|zsh)?\s*\r?\n([\s\S]*?)```/gi;
  let m;
  while ((m = fenceRe.exec(text))) add(m[1]);

  const anyFence = /```(?!json)([^\n`]*)\r?\n([\s\S]*?)```/gi;
  while ((m = anyFence.exec(text))) add(m[2]);

  const jsonRe = /```json\s*([\s\S]*?)```/gi;
  while ((m = jsonRe.exec(text))) {
    try {
      const j = JSON.parse(m[1].trim());
      const cmd = j.shell ?? j.exec ?? j.command ?? j.cmd;
      if (typeof cmd === "string") add(cmd);
    } catch {
      /* skip */
    }
  }

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t);
      const cmd = j.shell ?? j.exec ?? j.command ?? (j.tool === "shell" ? j.command : null);
      if (typeof cmd === "string") add(cmd);
    } catch {
      /* skip */
    }
  }

  // Gemini web often returns "PowerShell\nGet-ChildItem\n..." without fences
  const header = text.match(
    /(?:^|\n)(?:#{0,3}\s*)?(PowerShell|pwsh|Bash|Shell)\s*:?\s*\r?\n([\s\S]+)/i
  );
  if (header) {
    const block = trimCommandBlock(header[2]);
    if (block) add(block);
  }

  const cmdletLines = collectCmdletLines(text);
  if (cmdletLines.length) add(cmdletLines.join("\n"));

  return out;
}

/**
 * @param {string} chunk
 */
function trimCommandBlock(chunk) {
  /** @type {string[]} */
  const lines = [];
  for (const line of chunk.split("\n")) {
    const t = line.trim();
    if (!t) {
      if (lines.length) break;
      continue;
    }
    if (CMDLET_LINE.test(t) || t.startsWith("&") || t.includes("$")) {
      lines.push(t);
      continue;
    }
    if (lines.length) break;
    if (/^[`\s]/.test(line) || t.length < 120) continue;
    break;
  }
  return lines.join("\n");
}

/**
 * @param {string} text
 */
function collectCmdletLines(text) {
  /** @type {string[]} */
  const all = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (CMDLET_LINE.test(t)) all.push(t);
  }
  if (!all.length) return [];
  return all;
}

/**
 * @param {string[]} roots
 * @param {{ shell: string; platform: string }} env
 */
const WRITE_SHELL_RE =
  /\b(Remove-Item|rm\s+-|rm\b|rmdir|del\b|erase\b|Set-Content|Add-Content|Out-File|New-Item|mkdir|md\b|Move-Item|mv\b|Copy-Item|cp\s+-|touch\b|truncate\b|tee\b|>|>>|Format-Hex|Invoke-WebRequest\b[^\n]*-OutFile|npm\s+(i|install|uninstall|ci)\b|pip\s+install|git\s+(commit|push|reset|checkout\s+-f|clean|revert)|chmod\b|chown\b)\b/i;

/**
 * @param {string} command
 */
function isReadOnlyShell(command) {
  if (WRITE_SHELL_RE.test(command)) return false;
  if (/['"][^'"]*['"]\s*>/.test(command)) return false;
  return true;
}

/**
 * @param {"ask"|"agent"|"plan"} mode
 * @param {string[]} roots
 * @param {{ shell: string; platform: string }} env
 */
function buildModeSystem(mode, roots, env) {
  if (mode === "plan") return buildPlanSystem(roots, env);
  if (mode === "ask") return buildAskSystem(roots, env);
  return buildAgentSystem(roots, env);
}

/**
 * @param {string[]} roots
 * @param {{ shell: string; platform: string }} env
 */
function buildAskSystem(roots, env) {
  const rootList = roots.length ? roots.join("\n- ") : "(no folder open)";
  const fence = env.platform === "win32" ? "powershell" : "bash";
  return `You are Rori in ASK mode — helpful chat with READ-ONLY workspace access.

Reply with ONE JSON object per turn (host parses it). Wrap in \`\`\`json rori-turn or output raw JSON only.

Schema:
{
  "done": false,
  "actions": [
    { "type": "say", "text": "markdown shown in chat" },
    { "type": "shell", "command": "read-only one-liner or script" },
    { "type": "question", "text": "ask user; host waits for reply" }
  ],
  "summary": "optional bullets when done true"
}

Environment: OS ${env.platform}, shell ${env.shell}, roots:
- ${rootList}

shell: ONLY read-safe (Get-*, Select-String, Test-Path, git status/diff/log). No writes.
Ask clarifying questions with type question when needed.
Set done true when the user question is fully answered.`;
}

/**
 * @param {string[]} roots
 * @param {{ shell: string; platform: string }} env
 */
function buildPlanSystem(roots, env) {
  const rootList = roots.length ? roots.join("\n- ") : "(no folder open)";
  return `You are Rori in PLAN mode — planning only (no shell execution).

Reply with ONE JSON object per turn:
{
  "done": false,
  "actions": [{ "type": "say", "text": "markdown plan sections" }],
  "summary": "optional"
}

Roots:
- ${rootList}
OS: ${env.platform}

In say.text use headings: goal, current state, options, recommendation, risks, handoff to Agent.
No shell actions. Set done true when plan is complete.`;
}

function buildAgentSystem(roots, env) {
  const rootList = roots.length ? roots.join("\n- ") : "(no folder open)";
  const fence = env.platform === "win32" ? "powershell" : "bash";

  return `You are Rori, a coding AGENT in VS Code.

Each turn: ONE JSON object (fence: json rori-turn, or raw JSON only). Host runs all actions in order in a single turn.

{
  "done": false,
  "actions": [
    { "type": "say", "text": "what the user sees (markdown)" },
    { "type": "shell", "command": "PowerShell/bash for ${env.shell} — multiple lines OK" },
    { "type": "question", "text": "only when you must ask the user; host pauses for their reply" }
  ],
  "summary": "when done true — bullets of what changed"
}

Environment: OS ${env.platform}, shell ${env.shell}, cwd: workspace root.
Roots:
- ${rootList}

Rules:
- Combine say + shell + question in one turn when useful (not one action per message).
- Do not ask permission before shell; question is for real ambiguity only.
- After shell, host injects stdout/stderr — you get another turn.
- Attachments in user message are on Gemini — read PDFs/images before acting.
- Set done true on the final turn with summary when work is complete.`;
}

/**
 * @param {string} text
 * @param {string[]} journal
 */
function extractAgentSummary(text, journal) {
  try {
    const { parseRoriTurn } = require("./agent-actions");
    const turn = parseRoriTurn(text || "");
    if (turn.summary?.trim()) return turn.summary.trim();
  } catch {
    /* */
  }
  const m = text?.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##\s|\n\s*DONE\b|$)/i);
  if (m?.[1]?.trim()) return m[1].trim();
  if (journal?.length) {
    return journal.map((line) => `- ${line}`).join("\n");
  }
  const trimmed = (text || "").replace(/\bDONE\b/gi, "").trim();
  if (trimmed.length > 0 && trimmed.length < 1200) return trimmed;
  return "Agent run finished.";
}

/**
 * @param {string[]} roots
 */
function workspaceSnapshot(roots) {
  /** @type {string[]} */
  const lines = ["Workspace layout (shallow):"];
  for (const r of roots) {
    try {
      const names = fs.readdirSync(r).slice(0, 40);
      lines.push(`${r}:\n  ${names.join(", ")}`);
    } catch {
      lines.push(`${r}: (unreadable)`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {string} command
 * @param {string} cwd
 * @param {{ commandTimeoutMs: number; maxShellOutput: number; shell: string }} opts
 */
function runShell(command, cwd, opts) {
  const maxBuf = Math.max(opts.maxShellOutput, 4096);
  const timeout = Math.max(opts.commandTimeoutMs, 1000);
  const shell = opts.shell || (process.platform === "win32" ? "powershell" : "bash");

  /** @type {import("child_process").SpawnSyncReturns<string>} */
  let r;
  if (shell === "powershell" || shell === "pwsh") {
    const exe = shell === "pwsh" ? "pwsh.exe" : "powershell.exe";
    r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      encoding: "utf8",
      maxBuffer: maxBuf,
      timeout,
      windowsHide: true,
    });
  } else if (shell === "cmd") {
    r = spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
      cwd,
      encoding: "utf8",
      maxBuffer: maxBuf,
      timeout,
      windowsHide: true,
    });
  } else {
    r = spawnSync("bash", ["-lc", command], {
      cwd,
      encoding: "utf8",
      maxBuffer: maxBuf,
      timeout,
    });
  }

  const stdout = (r.stdout || "").slice(0, opts.maxShellOutput);
  const stderr = (r.stderr || "").slice(0, opts.maxShellOutput);
  if (r.error) {
    return {
      exitCode: r.status ?? -1,
      stdout,
      stderr: `${stderr}\n${r.error.message}`.trim(),
      error: r.error.message,
    };
  }
  return { exitCode: r.status ?? 0, stdout, stderr };
}

function agentEnv() {
  const platform = process.platform;
  const shell = platform === "win32" ? "powershell" : "bash";
  return { platform, shell };
}

/** @param {string} line */
function isTerminalShellLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (/^Write-Output\s+/i.test(t) && /\bDONE\b/i.test(t)) return true;
  if (/^Write-Host\s+/i.test(t) && /\bDONE\b/i.test(t)) return true;
  if (/^echo\s+/i.test(t) && /\bDONE\b/i.test(t)) return true;
  return false;
}

/** @param {string} cmd */
function isTerminalShellCommand(cmd) {
  const lines = cmd.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  return lines.every(isTerminalShellLine);
}

/** @param {string[]} commands */
function splitShellCommands(commands) {
  /** @type {string[]} */
  const substantive = [];
  /** @type {string[]} */
  const terminal = [];
  for (const c of commands) {
    if (isTerminalShellCommand(c)) terminal.push(c);
    else substantive.push(c);
  }
  return { substantive, terminal };
}

/** @param {string} text */
function assistantSignalsDone(text) {
  return /\bDONE\b/i.test(text);
}

/** @param {"ask"|"agent"|"plan"} mode */
function modeUserLead(mode) {
  if (mode === "ask") {
    return "[ASK · JSON turn] rori-turn JSON; shell read-only only.";
  }
  if (mode === "plan") {
    return "[PLAN · no execution] Deep plan only — do not output shell.";
  }
  return "[AGENT · JSON turn] Reply with rori-turn JSON (say + shell + question as needed).";
}

module.exports = {
  extractCommands,
  buildModeSystem,
  buildAskSystem,
  buildPlanSystem,
  buildAgentSystem,
  workspaceSnapshot,
  runShell,
  isReadOnlyShell,
  splitShellCommands,
  assistantSignalsDone,
  isTerminalShellCommand,
  modeUserLead,
  agentEnv,
  extractAgentSummary,
};
