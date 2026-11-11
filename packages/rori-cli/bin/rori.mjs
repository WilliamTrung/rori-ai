#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const entry = resolveEntry();
const child = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(child.status === null ? 1 : child.status);
