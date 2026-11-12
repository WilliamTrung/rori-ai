#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** @param {string[]} args */
function expandSimpleArgv(args) {
  const hasFlags = args.some((a) => a.startsWith("-"));
  if (hasFlags) return args;
  const cwd = process.cwd();
  if (args.length === 0) {
    return ["--local-only", "-p", "Help with this workspace", "--add-dir", cwd];
  }
  const prompt = args.join(" ");
  return ["--local-only", "-p", prompt, "--add-dir", cwd];
}

const argv = expandSimpleArgv(process.argv.slice(2));

function hasLocalOnly() {
  if (argv.includes("--local-only")) return true;
  if (process.env.CMD_LOCAL_ONLY === "1") return true;
  const cfg = path.join(os.homedir(), ".commandcode", "config.json");
  if (fs.existsSync(cfg)) {
    try {
      if (JSON.parse(fs.readFileSync(cfg, "utf8")).localOnly) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function hasPrintMode() {
  return argv.some((a) => a === "-p" || a === "--print" || (typeof a === "string" && a.startsWith("-p") && a.length > 2));
}

function resolveEntry() {
  try {
    const pkgRoot = path.dirname(require.resolve("command-code/package.json"));
    return path.join(pkgRoot, "dist", "index.mjs");
  } catch {
  }
  const npmRoot = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "npm",
    "node_modules"
  );
  const sibling = path.join(npmRoot, "command-code", "dist", "index.mjs");
  if (fs.existsSync(sibling)) return sibling;
  const local = path.resolve(__dirname, "..", "node_modules", "command-code", "dist", "index.mjs");
  if (fs.existsSync(local)) return local;
  console.error("command-code not found. Run: npm i -g command-code@latest");
  process.exit(1);
}

function runBridgeAgent() {
  const agent = path.join(__dirname, "rori-bridge-agent.mjs");
  const child = spawnSync(process.execPath, [agent, ...argv], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(child.status === null ? 1 : child.status);
}

if (hasLocalOnly() && hasPrintMode() && process.env.RORI_FORCE_COMMAND_CODE !== "1") {
  if (!process.env.LLM_PLATFORM_OPENAI_API_KEY?.trim()) {
    console.error("BYOK: set LLM_PLATFORM_OPENAI_API_KEY (llm-adaptor MSI).");
    process.exit(1);
  }
  runBridgeAgent();
}

const entry = resolveEntry();
const child = spawnSync(process.execPath, [entry, ...argv], {
  stdio: "inherit",
  env: process.env,
});
const code = child.status === null ? 1 : child.status;
if (code !== 0 && hasLocalOnly() && hasPrintMode()) runBridgeAgent();
process.exit(code);
