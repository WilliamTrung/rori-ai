#!/usr/bin/env node
/**
 * Headless agent: llm-adaptor /v1 + API key. Model proposes shell; host executes.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { extractCommands, buildAgentSystem, workspaceSnapshot, runShell } = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "shell-agent.cjs")
);

const argv = process.argv.slice(2);

function arg(name, short) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name || (short && argv[i] === short)) {
      return argv[i + 1] ?? true;
    }
    if (argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1);
  }
  return null;
}

function loadBridge() {
  const key = process.env.LLM_PLATFORM_OPENAI_API_KEY?.trim();
  if (!key) throw new Error("LLM_PLATFORM_OPENAI_API_KEY required");
  let base =
    process.env.LLM_BRIDGE_BASE_URL?.trim() ||
    "https://agent.williamthanhtrung.id.vn/v1";
  const providersPath = path.join(os.homedir(), ".commandcode", "providers.json");
  if (fs.existsSync(providersPath)) {
    const p = JSON.parse(fs.readFileSync(providersPath, "utf8"));
    if (p?.provider?.rori?.baseURL) base = p.provider.rori.baseURL;
  }
  base = base.replace(/\/$/, "");
  if (!base.endsWith("/v1")) base += "/v1";
  return { url: `${base}/chat/completions`, key };
}

function parseDirs() {
  const dirs = [process.cwd()];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--add-dir" && argv[i + 1]) dirs.push(path.resolve(argv[i + 1]));
  }
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function parsePrompt() {
  const i = argv.findIndex((a) => a === "-p" || a === "--print");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const p = arg("--print", "-p");
  if (typeof p === "string") return p;
  throw new Error("Missing -p prompt");
}

async function chat(bridge, model, messages, userId) {
  const res = await fetch(bridge.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bridge.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, user: userId, messages }),
  });
  if (!res.ok) throw new Error(`bridge ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const bridge = loadBridge();
  const model = arg("--model", "-m") || "rori/gemini-web";
  const maxTurns = parseInt(arg("--max-turns") || "0", 10);
  const turnCap = maxTurns > 0 ? maxTurns : Number.POSITIVE_INFINITY;
  const roots = parseDirs();
  const prompt = parsePrompt();
  const userId = `rori-bridge-${Date.now()}`;
  const env = {
    platform: process.platform,
    shell: process.platform === "win32" ? "powershell" : "bash",
  };
  const shellOpts = {
    shell: env.shell,
    maxShellOutput: 100000,
    commandTimeoutMs: 120000,
  };
  const cwd = roots[0];
  const messages = [
    { role: "system", content: buildAgentSystem(roots, env) },
    {
      role: "user",
      content: `${prompt}\n\n${workspaceSnapshot(roots)}`,
    },
  ];

  for (let turn = 0; turn < turnCap; turn++) {
    const text = await chat(bridge, model, messages, userId);
    messages.push({ role: "assistant", content: text });
    process.stdout.write(text + "\n");

    const commands = extractCommands(text);
    if (commands.length === 0) {
      if (/DONE/i.test(text)) break;
      messages.push({
        role: "user",
        content:
          "Propose the next shell command in a fenced ```powershell or ```bash block. Use real CLI to inspect/edit files.",
      });
      continue;
    }
    for (const cmd of commands) {
      process.stderr.write(`$ ${cmd.split("\n")[0]}\n`);
      const result = runShell(cmd, cwd, shellOpts);
      messages.push({
        role: "user",
        content: `Command output (exit ${result.exitCode}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
      });
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
