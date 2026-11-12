const { spawnSync } = require("child_process");
const fs = require("fs");

const CMDLET_LINE =
  /^(?:Get-|Set-|Remove-|New-|Copy-|Move-|Test-Path|Invoke-|Write-|Out-|Select-Object|ForEach-Object|cd\s|dir\b|ls\b|rm\b|del\b|cat\b|type\b|npm\s|node\s|python\s|git\s)/i;

function trimCommandBlock(chunk) {
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
  }
  return lines.join("\n");
}

function collectCmdletLines(text) {
  const all = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (CMDLET_LINE.test(t)) all.push(t);
  }
  return all;
}

function extractCommands(text) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
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
    } catch {}
  }

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

function buildAgentSystem(roots, env) {
  const rootList = roots.length ? roots.join("\n- ") : "(no folder open)";
  const fence = env.platform === "win32" ? "powershell" : "bash";
  return `You are Rori AGENT. Only fenced shell runs on the host.

OS: ${env.platform}, shell: ${env.shell}, cwd: workspace root
Roots:\n- ${rootList}

Required:\n\`\`\`${fence}\n# cmdlets\n\`\`\`

No confirmation. Use exact filenames. DONE when finished.`;
}

function workspaceSnapshot(roots) {
  const lines = ["Workspace layout (shallow):"];
  for (const r of roots) {
    try {
      lines.push(`${r}:\n  ${fs.readdirSync(r).slice(0, 40).join(", ")}`);
    } catch {
      lines.push(`${r}: (unreadable)`);
    }
  }
  return lines.join("\n");
}

function runShell(command, cwd, opts) {
  const maxBuf = Math.max(opts.maxShellOutput || 100000, 4096);
  const timeout = Math.max(opts.commandTimeoutMs || 120000, 1000);
  const shell = opts.shell || (process.platform === "win32" ? "powershell" : "bash");
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
  const stdout = (r.stdout || "").slice(0, maxBuf);
  const stderr = (r.stderr || "").slice(0, maxBuf);
  if (r.error) {
    return { exitCode: r.status ?? -1, stdout, stderr: `${stderr}\n${r.error.message}`.trim() };
  }
  return { exitCode: r.status ?? 0, stdout, stderr };
}

module.exports = { extractCommands, buildAgentSystem, workspaceSnapshot, runShell };
