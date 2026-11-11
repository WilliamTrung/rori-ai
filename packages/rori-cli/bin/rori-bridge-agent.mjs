#!/usr/bin/env node
/**
 * Headless agent: llm-adaptor /v1 + LLM_PLATFORM_OPENAI_API_KEY only.
 * Local tools: read_file, write_file, list_dir (JSON blocks in model output).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function flag(name, short) {
  return argv.includes(name) || (short && argv.includes(short));
}

function loadBridge() {
  const key = process.env.LLM_PLATFORM_OPENAI_API_KEY?.trim();
  if (!key) throw new Error("LLM_PLATFORM_OPENAI_API_KEY required");
  let base =
    process.env.LLM_BRIDGE_BASE_URL?.trim() ||
    "http://100.79.204.29:5080/v1";
  const providersPath = path.join(os.homedir(), ".commandcode", "providers.json");
  if (fs.existsSync(providersPath)) {
    const p = JSON.parse(fs.readFileSync(providersPath, "utf8"));
    const rori = p?.provider?.rori;
    if (rori?.baseURL) base = rori.baseURL;
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

function insideRoot(file, roots) {
  const abs = path.resolve(file);
  return roots.some((r) => abs === r || abs.startsWith(r + path.sep));
}

function runTool(name, input, roots) {
  if (name === "read_file") {
    const fp = path.resolve(input.path);
    if (!insideRoot(fp, roots)) return { error: "path not allowed" };
    if (!fs.existsSync(fp)) return { error: "not found" };
    return { content: fs.readFileSync(fp, "utf8").slice(0, 120000) };
  }
  if (name === "write_file") {
    const fp = path.resolve(input.path);
    if (!insideRoot(fp, roots)) return { error: "path not allowed" };
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, input.content ?? "", "utf8");
    return { ok: true, bytes: Buffer.byteLength(input.content ?? "", "utf8") };
  }
  if (name === "list_dir") {
    const dir = path.resolve(input.path || roots[0]);
    if (!insideRoot(dir, roots)) return { error: "path not allowed" };
    if (!fs.existsSync(dir)) return { error: "not found" };
    return { entries: fs.readdirSync(dir) };
  }
  return { error: `unknown tool ${name}` };
}

function extractTools(text) {
  const out = [];
  const re = /```json\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    try {
      const j = JSON.parse(m[1].trim());
      if (j.tool) out.push(j);
    } catch {
      /* skip */
    }
  }
  const lineRe = /^\s*\{"tool"\s*:/gm;
  for (const block of text.split("\n")) {
    if (block.includes('"tool"')) {
      try {
        const j = JSON.parse(block.trim());
        if (j.tool) out.push(j);
      } catch {
        /* skip */
      }
    }
  }
  return out;
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

const SYSTEM = `You are Rori AI (Gemini Web via llm-adaptor). Execute tasks with tools.

Emit each tool call as a standalone JSON code fence:
\`\`\`json
{"tool":"read_file","path":"..."}
\`\`\`
\`\`\`json
{"tool":"write_file","path":"...","content":"..."}
\`\`\`
\`\`\`json
{"tool":"list_dir","path":"..."}
\`\`\`

After tools run, you receive results as user messages. When done, say DONE briefly.`;

async function main() {
  const bridge = loadBridge();
  const model = arg("--model", "-m") || "rori/gemini-web";
  const maxTurns = parseInt(arg("--max-turns") || "25", 10);
  const roots = parseDirs();
  const prompt = parsePrompt();
  const userId = `rori-bridge-${Date.now()}`;
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const text = await chat(bridge, model, messages, userId);
    messages.push({ role: "assistant", content: text });
    process.stdout.write(text + "\n");

    const tools = extractTools(text);
    if (tools.length === 0) {
      if (/DONE/i.test(text)) break;
      if (turn >= maxTurns - 1) break;
      messages.push({
        role: "user",
        content: "Continue or finish with write_file. Use tool JSON blocks.",
      });
      continue;
    }
    for (const t of tools) {
      const result = runTool(t.tool, t, roots);
      messages.push({
        role: "user",
        content: `Tool ${t.tool} result:\n${JSON.stringify(result)}`,
      });
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
