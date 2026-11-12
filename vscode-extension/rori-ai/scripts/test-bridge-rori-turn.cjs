/**
 * Live bridge smoke: Gemini must return parseable rori-turn JSON.
 * Usage: set RORI_API_KEY (or reads Cursor settings rori-ai.apiKey).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { parseRoriTurn } = require("../agent-actions");
const { buildModeSystem, agentEnv } = require("../agent-tools");

function loadApiKey() {
  if (process.env.RORI_API_KEY) return process.env.RORI_API_KEY.trim();
  const settings = path.join(
    process.env.APPDATA || "",
    "Cursor",
    "User",
    "settings.json"
  );
  if (fs.existsSync(settings)) {
    const j = JSON.parse(fs.readFileSync(settings, "utf8").replace(/^\uFEFF/, ""));
    if (j["rori-ai.apiKey"]) return String(j["rori-ai.apiKey"]).trim();
  }
  throw new Error("No RORI_API_KEY or rori-ai.apiKey in Cursor settings");
}

function loadBridgeUrl() {
  if (process.env.RORI_BRIDGE_URL) return process.env.RORI_BRIDGE_URL.trim();
  const settings = path.join(
    process.env.APPDATA || "",
    "Cursor",
    "User",
    "settings.json"
  );
  const j = JSON.parse(fs.readFileSync(settings, "utf8").replace(/^\uFEFF/, ""));
  return String(j["rori-ai.bridgeUrl"] || "https://agent.williamthanhtrung.id.vn/v1").trim();
}

function httpJson(method, url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const hdr = { ...headers };
    if (body) hdr["Content-Length"] = String(Buffer.byteLength(body));
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers: hdr,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const code = res.statusCode || 0;
          if (code >= 400) {
            reject(new Error(`${code} ${text.slice(0, 300)}`));
            return;
          }
          try {
            resolve({ status: code, body: JSON.parse(text) });
          } catch {
            reject(new Error(`Invalid JSON: ${text.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function bridgeWsWait(postUrl, auth, job, timeoutMs) {
  const WebSocket = require("ws");
  const base = new URL(postUrl);
  const p = String(job.poll_ws);
  const u = new URL(p.startsWith("http") ? p : `${p.startsWith("/") ? p : `/${p}`}`, base);
  u.protocol = "wss:";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u.toString(), { headers: { Authorization: auth } });
    const t = setTimeout(() => {
      ws.close();
      reject(new Error("WS timeout"));
    }, timeoutMs);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.status === "in_progress") return;
      if (msg.error || msg.status === "failed") {
        clearTimeout(t);
        ws.close();
        reject(new Error(msg.error || "failed"));
        return;
      }
      if (msg.choices) {
        clearTimeout(t);
        ws.close();
        resolve(msg);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function main() {
  const key = loadApiKey();
  const base = loadBridgeUrl().replace(/\/$/, "");
  const postUrl = base.endsWith("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;
  const model = "llm-adaptor/gemini-browser";
  const env = agentEnv();
  const system = buildModeSystem(
    "agent",
    [process.cwd()],
    env
  );
  const user =
    'TEST ONLY: Reply with raw JSON only (no prose). actions: say "rori-turn smoke ok", shell "Get-Date -Format o", done false.';
  const payload = {
    model,
    user: `rori-test-${Date.now()}`,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  const timeoutMs = 8 * 60_000;
  console.log("POST async bridge… (up to ~8 min)");
  const post = await httpJson(
    "POST",
    postUrl,
    {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Bridge-Async": "1",
    },
    JSON.stringify(payload),
    120_000
  );
  let body = post.body;
  if (post.status === 202 && body?.poll) {
    console.log(`job id=${body.id}`);
    body = await bridgeWsWait(postUrl, `Bearer ${key}`, body, timeoutMs);
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  if (!String(content).trim()) throw new Error("empty assistant");
  console.log("assistant length:", content.length);
  const turn = parseRoriTurn(content);
  console.log("fromJson:", turn.fromJson, "actions:", turn.actions.length);
  const types = turn.actions.map((a) => a.type).join(",");
  console.log("types:", types);
  if (!turn.fromJson) {
    console.error("preview:", content.slice(0, 500));
    throw new Error("model did not return JSON turn (legacy parse only)");
  }
  const shell = turn.actions.find((a) => a.type === "shell");
  if (!shell) throw new Error("no shell action");
  console.log("shell cmd:", shell.command.slice(0, 80));
  console.log("OK  live bridge + parseRoriTurn");
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
