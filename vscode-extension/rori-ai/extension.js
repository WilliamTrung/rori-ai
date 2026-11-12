// @ts-check
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const http = require("node:http");
const https = require("node:https");
const {
  buildModeSystem,
  workspaceSnapshot,
  runShell,
  isReadOnlyShell,
  assistantSignalsDone,
  extractAgentSummary,
  modeUserLead,
  agentEnv,
} = require("./agent-tools");
const { parseRoriTurn } = require("./agent-actions");
const { RORI_CONFIG_KEYS, RORI_STATE_KEYS } = require("./config-schema");
const {
  loadAttachments,
  readAttachmentFile,
  normalizeDroppedAttachments,
  inlineTextSupplement,
  MAX_FILES,
} = require("./attachments");

/** @type {vscode.OutputChannel | undefined} */
let roriLog;

function traceEnabled() {
  return getConfig().traceLog !== false;
}

function logTrace(/** @type {string} */ message) {
  if (!traceEnabled()) return;
  const line = `[trace] ${message}`;
  roriLog?.appendLine(line);
  console.log(line);
}

function logAttach(/** @type {string} */ message) {
  const line = `[attachments] ${message}`;
  roriLog?.appendLine(line);
  console.log(line);
}

/**
 * @param {RoriAttachment[] | undefined} list
 */
function attachmentByteSummary(list) {
  if (!list?.length) return "(none)";
  return list
    .map((a) => {
      const b64 = a.base64?.length || 0;
      const approx = Math.round((b64 * 3) / 4);
      return `${a.fileName} (${a.mediaType || "?"} ~${approx} bytes raw)`;
    })
    .join("; ");
}

/** @param {string} raw */
function fsPathsFromUriList(raw) {
  return raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      if (/^file:/i.test(l)) {
        try {
          return vscode.Uri.parse(l).fsPath;
        } catch {
          return "";
        }
      }
      if (/^[a-zA-Z]:[\\/]/.test(l) || l.startsWith("\\\\") || l.startsWith("/")) return l;
      try {
        return vscode.Uri.parse(l).fsPath;
      } catch {
        return l;
      }
    })
    .filter((p) => p && fs.existsSync(p));
}

/**
 * @param {{ role: string; content: string; attachments?: RoriAttachment[] }[]} messages
 */
function summarizeAttachmentsInPayload(messages) {
  let n = 0;
  const names = [];
  for (const m of messages) {
    for (const a of m.attachments || []) {
      n++;
      names.push(a.fileName);
    }
  }
  return { count: n, names };
}

/** @typedef {"ask"|"agent"|"plan"} RoriMode */
/** @typedef {{ fileName: string; mediaType: string; base64: string }} RoriAttachment */

/** @type {vscode.ExtensionContext | undefined} */
let extensionContext;
/** @type {RoriChatSession | undefined} */
let session;
const SECRET_API_KEY = "rori-ai.apiKey";
/** @type {string} */
let cachedApiKey = "";
/** @type {vscode.WebviewPanel | undefined} */
let editorPanel;

/**
 * @param {{ role: string; content: string }[]} messages
 * @param {number} maxTail
 */
/**
 * @param {{ role: string; content: string; attachments?: RoriAttachment[] }[]} messages
 * @param {number} maxTail
 */
function trimMessagesForBridge(messages, maxTail) {
  if (messages.length <= maxTail + 1) return messages;
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const tail = rest.slice(-maxTail);
  return [...system.slice(0, 1), ...tail];
}

/**
 * @param {{ role: string; content: string; attachments?: RoriAttachment[] }[]} messages
 */
function toBridgeMessages(messages) {
  return messages.map((m) => {
    /** @type {Record<string, unknown>} */
    const o = { role: m.role, content: m.content };
    if (m.attachments?.length) o.attachments = m.attachments;
    return o;
  });
}

/** @param {string} s @param {number} max */
function clipForHistory(s, max) {
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars for bridge speed]`;
}

/**
 * Agent turns add user lines without attachments; re-attach files for Gemini upload each bridge call.
 * @param {{ role: string; content: string; attachments?: RoriAttachment[] }[]} payload
 * @param {RoriAttachment[] | undefined} sticky
 */
function applyStickyAttachments(payload, sticky) {
  if (!sticky?.length) return payload;
  const out = payload.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i].attachments = sticky;
      return out;
    }
  }
  return out;
}

/**
 * @param {string} base
 * @param {string} key
 * @param {string} model
 * @param {{ role: string; content: string; attachments?: RoriAttachment[] }[]} messages
 * @param {string} userId
 * @param {RoriAttachment[] | undefined} [stickyAttachments]
 * @param {{ attachmentsAlreadyOnBridge?: boolean }} [opts]
 */
async function bridgeChat(base, key, model, messages, userId, stickyAttachments, opts) {
  const maxTail = getConfig().maxHistoryMessages;
  let payload = toBridgeMessages(trimMessagesForBridge(messages, maxTail));
  const sendAttachmentsOnce = getConfig().bridgeAttachmentsOnce !== false;
  const sticky =
    stickyAttachments?.length &&
    !(sendAttachmentsOnce && opts?.attachmentsAlreadyOnBridge)
      ? stickyAttachments
      : undefined;
  payload = applyStickyAttachments(payload, sticky);
  const url = base.replace(/\/$/, "").endsWith("/v1")
    ? `${base.replace(/\/$/, "")}/chat/completions`
    : `${base.replace(/\/$/, "")}/v1/chat/completions`;
  const att = summarizeAttachmentsInPayload(payload);
  logTrace(
    `bridgeChat user=${userId} model=${model} messages=${payload.length} attachInJson=${att.count} stickyHeld=${stickyAttachments?.length ?? 0} skipReupload=${Boolean(opts?.attachmentsAlreadyOnBridge)}`
  );
  if (sticky?.length) logTrace(`payload files: ${attachmentByteSummary(sticky)}`);
  if (att.count > 0) {
    logAttach(
      `bridge POST ${att.count} file(s): ${att.names.join(", ")}${sticky?.length ? " (sticky)" : ""}`
    );
  } else if (stickyAttachments?.length && !opts?.attachmentsAlreadyOnBridge) {
    logAttach(`WARN: sticky attachments missing from payload: ${stickyAttachments.map((a) => a.fileName).join(", ")}`);
  } else if (stickyAttachments?.length && opts?.attachmentsAlreadyOnBridge) {
    logAttach(
      `bridge POST (attachments on server thread only; skipped ${stickyAttachments.length} file(s) in JSON)`
    );
  } else {
    logAttach("bridge POST (no attachments in JSON payload)");
  }

  const timeoutMs = Math.max(getConfig().bridgeTimeoutMs, 60_000);
  const jsonBody = JSON.stringify({ model, messages: payload, user: userId });
  logTrace(`POST ${url} bodyBytes=${Buffer.byteLength(jsonBody)} async=1`);
  const body = await bridgePostJson(
    url,
    {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Bridge-Async": "1",
    },
    jsonBody,
    timeoutMs
  );
  const content = body.choices?.[0]?.message?.content ?? "";
  logTrace(
    `bridge done contentLen=${String(content).length} preview=${String(content).slice(0, 120).replace(/\s+/g, " ")}`
  );
  if (!String(content).trim()) {
    throw new Error("Bridge returned empty assistant message");
  }
  return content;
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string} body
 * @param {number} timeoutMs
 */
/**
 * @param {string} method
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string | undefined} body
 * @param {number} timeoutMs
 */
function bridgeHttpJson(method, url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const hdr = { ...headers };
    if (body) hdr["Content-Length"] = String(Buffer.byteLength(body));
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
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
          if (code === 504) {
            reject(
              new Error(
                "504 Gateway Timeout — Cloudflare caps ~100s on agent.*. Retry after deploy or use Tailscale bridge URL."
              )
            );
            return;
          }
          if (code >= 400) {
            reject(new Error(`${code} ${text}`));
            return;
          }
          try {
            resolve({ status: code, body: JSON.parse(text) });
          } catch {
            reject(new Error(`Invalid JSON from bridge: ${text.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(
        new Error(
          `Bridge timeout after ${(timeoutMs / 1000).toFixed(0)}s (PDFs and agent turns often need 2–5 min)`
        )
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * @param {string} postUrl
 * @param {Record<string, string>} headers
 * @param {string} body
 * @param {number} timeoutMs
 */
/**
 * @param {string} bridgePostUrl
 * @param {string} path
 */
function bridgeAbsoluteUrl(bridgePostUrl, path) {
  const base = new URL(bridgePostUrl);
  const p = path.startsWith("http")
    ? new URL(path)
    : new URL(path.startsWith("/") ? path : `/${path}`, base);
  return p.toString();
}

/**
 * @param {string} bridgePostUrl
 * @param {string} path — typically poll_ws (already ends with /ws)
 */
function bridgeWsUrl(bridgePostUrl, path) {
  const u = new URL(bridgeAbsoluteUrl(bridgePostUrl, path));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/**
 * @param {string} postUrl
 * @param {Record<string, string>} headers
 * @param {object} jobBody
 * @param {number} timeoutMs
 */
async function bridgeWaitAsyncJob(postUrl, headers, jobBody, timeoutMs) {
  const started = Date.now();
  const pollHttpPath = String(jobBody.poll || "");
  const pollHttpUrl = pollHttpPath ? bridgeAbsoluteUrl(postUrl, pollHttpPath) : "";

  let WebSocketClient;
  try {
    WebSocketClient = require("ws");
  } catch {
    WebSocketClient = null;
  }

  if (WebSocketClient && jobBody.poll_ws) {
    const wsUrl = bridgeWsUrl(postUrl, String(jobBody.poll_ws));
    logAttach(`bridge async job ${jobBody.id} — WebSocket ${wsUrl}`);
    return new Promise((resolve, reject) => {
      const ws = new WebSocketClient(wsUrl, {
        headers: { Authorization: headers.Authorization || "" },
      });
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Bridge WebSocket timed out after ${(timeoutMs / 1000).toFixed(0)}s`));
      }, timeoutMs);
      ws.on("message", (/** @type {Buffer} */ data) => {
        try {
          const msg = JSON.parse(data.toString("utf8"));
          if (msg.status === "in_progress") return;
          if (msg.error || msg.status === "failed") {
            clearTimeout(timer);
            ws.close();
            reject(new Error(msg.error || "Bridge job failed"));
            return;
          }
          if (msg.choices) {
            clearTimeout(timer);
            ws.close();
            resolve(msg);
          }
        } catch (e) {
          clearTimeout(timer);
          ws.close();
          reject(/** @type {Error} */ (e));
        }
      });
      ws.on("error", (/** @type {Error} */ err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  if (!pollHttpUrl) throw new Error("Bridge async job missing poll URL");
  logAttach(`bridge async job ${jobBody.id} — HTTP poll (install ws: npm i in extension for WebSocket)`);
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await bridgeHttpJson("GET", pollHttpUrl, headers, undefined, 30_000);
    if (poll.status === 202 || poll.body?.status === "in_progress") continue;
    return poll.body;
  }
  throw new Error(`Bridge job timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
}

async function bridgePostJson(postUrl, headers, body, timeoutMs) {
  const post = await bridgeHttpJson("POST", postUrl, headers, body, Math.min(timeoutMs, 120_000));
  if (post.status === 202 && post.body?.poll) {
    const job = post.body;
    logTrace(`async job id=${job.id} session=${job.user ?? job.session ?? "-"} poll_ws=${job.poll_ws || job.poll}`);
    return bridgeWaitAsyncJob(postUrl, headers, job, timeoutMs);
  }
  return post.body;
}

const MODEL_PREFIX = "llm-adaptor/";

/** @param {string} id */
function formatModelLabel(id) {
  const slug = id.includes("/") ? id.split("/").pop() || id : id;
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** @param {string} base */
function bridgeBaseUrl(base) {
  return base.replace(/\/$/, "").replace(/\/v1$/i, "");
}

/**
 * Same labels as llm-adaptor chat UI (`/api/llm/v1/models`).
 * @param {string} base
 * @returns {Promise<{ labels: Map<string, string>; defaultId: string | null }>}
 */
async function fetchModelCatalog(base) {
  try {
    const res = await fetch(`${bridgeBaseUrl(base)}/api/llm/v1/models`);
    if (!res.ok) return { labels: new Map(), defaultId: null };
    const body = await res.json();
    /** @type {Map<string, string>} */
    const labels = new Map();
    for (const m of body.models || []) {
      if (!m?.name) continue;
      const id = MODEL_PREFIX + m.name;
      labels.set(
        id,
        `${m.name} — ${m.label || ""}${m.ready ? "" : " (setup)"}`.trim()
      );
    }
    const def = body.defaultConnectionId;
    const match = (body.models || []).find(
      (/** @type {{ connectionId?: string }} */ m) => m.connectionId === def
    );
    const defaultId = match?.name ? MODEL_PREFIX + match.name : null;
    return { labels, defaultId };
  } catch {
    return { labels: new Map(), defaultId: null };
  }
}

/**
 * @param {string} bridgeUrl
 * @param {string} apiKey
 * @returns {Promise<{ id: string; label: string }[]>}
 */
async function fetchBridgeModels(bridgeUrl, apiKey) {
  const base = bridgeBaseUrl(bridgeUrl);
  const [{ labels }, res] = await Promise.all([
    fetchModelCatalog(bridgeUrl),
    fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }),
  ]);
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .map((/** @type {{ id?: string }} */ m) => m.id)
    .filter(Boolean)
    .map((/** @type {string} */ id) => ({
      id,
      label: labels.get(id) || formatModelLabel(id),
    }));
}

function readProvidersBridge() {
  try {
    const p = path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      ".commandcode",
      "providers.json"
    );
    if (p && fs.existsSync(p)) {
      const provider = JSON.parse(fs.readFileSync(p, "utf8"))?.provider;
      const base =
        provider?.["llm-adaptor-gemini"]?.baseURL || provider?.rori?.baseURL;
      if (base) return base;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function resolveApiKeyFromSettingsAndEnv(cfg) {
  const fromSetting = (cfg.get("apiKey") || "").trim();
  if (fromSetting) return fromSetting;
  return (process.env.LLM_PLATFORM_OPENAI_API_KEY || "").trim();
}

function resolveApiKey(cfg) {
  if (cachedApiKey) return cachedApiKey;
  return resolveApiKeyFromSettingsAndEnv(cfg);
}

async function refreshApiKeyCache() {
  if (extensionContext) {
    const fromSecret = await extensionContext.secrets.get(SECRET_API_KEY);
    if (fromSecret?.trim()) {
      cachedApiKey = fromSecret.trim();
      return;
    }
  }
  const cfg = vscode.workspace.getConfiguration("rori-ai");
  cachedApiKey = resolveApiKeyFromSettingsAndEnv(cfg);
}

async function migrateApiKeyToSecret() {
  if (!extensionContext) return;
  const cfg = vscode.workspace.getConfiguration("rori-ai");
  const plain = (cfg.get("apiKey") || "").trim();
  if (!plain) return;
  const existing = await extensionContext.secrets.get(SECRET_API_KEY);
  if (!existing) await extensionContext.secrets.store(SECRET_API_KEY, plain);
  cachedApiKey = plain;
}

/** @param {string} raw */
function normalizeBridgeUrl(raw) {
  let url = (raw || "").trim().replace(/\/$/, "");
  if (!url) return "";
  if (!/\/v1$/i.test(url)) url += "/v1";
  return url;
}

async function buildConfigObjectForUi() {
  const cfg = vscode.workspace.getConfiguration("rori-ai");
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, meta] of Object.entries(RORI_CONFIG_KEYS)) {
    if (key === "apiKey") {
      out.apiKey = cachedApiKey || (cfg.get("apiKey") || "").trim() || "";
      continue;
    }
    const v = cfg.get(key);
    out[key] = v !== undefined && v !== null ? v : meta.default;
  }
  for (const [key, meta] of Object.entries(RORI_STATE_KEYS)) {
    if (meta.state && extensionContext) {
      out[key] =
        extensionContext.globalState.get(`rori-ai.${key}`) ||
        session?.resolveModel?.() ||
        meta.default;
    } else {
      out[key] = meta.default;
    }
  }
  return out;
}

function providerConfigPayload() {
  const c = getConfig();
  return {
    type: "providerConfig",
    configJson: "", // filled async in postProviderConfig
    bridgeHint: c.bridgeUrl.replace(/\/v1$/i, ""),
  };
}

/**
 * @param {unknown} value
 * @param {ConfigValueType} type
 */
function coerceConfigValue(value, type) {
  if (type === "boolean") return Boolean(value);
  if (type === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) throw new Error(`Invalid number: ${value}`);
    return n;
  }
  return String(value ?? "");
}

/**
 * @param {Record<string, unknown>} patch
 */
async function applyConfigObject(patch) {
  if (!extensionContext) return;
  const cfg = vscode.workspace.getConfiguration("rori-ai");
  const target = vscode.ConfigurationTarget.Global;

  for (const [key, meta] of Object.entries(RORI_CONFIG_KEYS)) {
    if (!(key in patch)) continue;
    let value = coerceConfigValue(patch[key], meta.type);
    if (key === "bridgeUrl") value = normalizeBridgeUrl(String(value));
    if (key === "apiKey") {
      const keyStr = String(value).trim();
      cachedApiKey = keyStr;
      await extensionContext.secrets.store(SECRET_API_KEY, keyStr);
      await cfg.update("apiKey", keyStr, target);
      continue;
    }
    await cfg.update(key, value, target);
  }

  if ("selectedModel" in patch && patch.selectedModel) {
    const modelId = String(patch.selectedModel).trim();
    if (modelId) {
      await extensionContext.globalState.update("rori-ai.selectedModel", modelId);
      session?.setModel(modelId);
    }
  }

  await refreshApiKeyCache();
  session?.postProviderConfig();
  await session?.refreshModels();
}

/**
 * @param {string} jsonText
 */
async function applyConfigJson(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config must be a JSON object");
  }
  const unknown = Object.keys(parsed).filter(
    (k) => !(k in RORI_CONFIG_KEYS) && !(k in RORI_STATE_KEYS)
  );
  if (unknown.length) {
    throw new Error(`Unknown keys: ${unknown.join(", ")}`);
  }
  await applyConfigObject(/** @type {Record<string, unknown>} */ (parsed));
}

/**
 * @param {Record<string, unknown>} [fromJson]
 */
async function testProviderConnection(fromJson) {
  const cfg = getConfig();
  const url = normalizeBridgeUrl(
    String(fromJson?.bridgeUrl ?? cfg.bridgeUrl ?? "")
  );
  const key = String(fromJson?.apiKey ?? "").trim() || cfg.apiKey;
  if (!key) throw new Error("API key required");
  await fetchBridgeModels(url, key);
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("rori-ai");
  const bridgeUrl =
    (cfg.get("bridgeUrl") || "").trim() ||
    (process.env.LLM_BRIDGE_BASE_URL || "").trim() ||
    readProvidersBridge() ||
    "https://agent.williamthanhtrung.id.vn/v1";
  return {
    bridgeUrl,
    apiKey: resolveApiKey(cfg),
    model: (cfg.get("model") || "llm-adaptor/gemini-browser").trim(),
    maxAgentTurns: /** @type {number} */ (cfg.get("maxAgentTurns") ?? 0),
    shell: /** @type {string} */ (
      cfg.get("shell") || (process.platform === "win32" ? "powershell" : "bash")
    ),
    maxShellOutput: /** @type {number} */ (cfg.get("maxShellOutput") ?? 100000),
    commandTimeoutMs: /** @type {number} */ (cfg.get("commandTimeoutMs") ?? 120000),
    bridgeTimeoutMs: /** @type {number} */ (cfg.get("bridgeTimeoutMs") ?? 600000),
    bridgeAttachmentsOnce: cfg.get("bridgeAttachmentsOnce") !== false,
    traceLog: cfg.get("traceLog") !== false,
    maxHistoryMessages: /** @type {number} */ (cfg.get("maxHistoryMessages") ?? 14),
    maxToolOutputInHistory: /** @type {number} */ (cfg.get("maxToolOutputInHistory") ?? 8000),
    includeEditorContext: cfg.get("includeEditorContext") !== false,
    defaultMode: /** @type {RoriMode} */ (
      cfg.get("defaultMode") ||
        (cfg.get("agentMode") === false ? "ask" : "agent")
    ),
  };
}

/** @param {unknown} m @returns {RoriMode} */
function normalizeMode(m) {
  if (m === "ask" || m === "agent" || m === "plan") return m;
  return getConfig().defaultMode;
}

function systemForMode(/** @type {RoriMode} */ mode) {
  const roots = workspaceRoots();
  const env = { ...agentEnv(), shell: getConfig().shell };
  return buildModeSystem(mode, roots, env);
}

function shellRuntimeConfig() {
  const c = getConfig();
  return {
    shell: c.shell,
    maxShellOutput: c.maxShellOutput,
    commandTimeoutMs: c.commandTimeoutMs,
  };
}

function workspaceRoots() {
  return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
}

function editorContext() {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return "";
  const doc = ed.document;
  const sel = ed.selection;
  if (!sel.isEmpty) {
    return `File: ${doc.uri.fsPath}\nSelected lines ${sel.start.line + 1}-${sel.end.line + 1}:\n${doc.getText(sel)}`;
  }
  return `Open file: ${doc.uri.fsPath}`;
}

class RoriChatSession {
  constructor() {
    /** @type {Set<vscode.Webview>} */
    this._webviews = new Set();
    /** @type {Set<vscode.Webview>} */
    this._bound = new Set();
    /** @type {number} */
    this._runId = 0;
    /** @type {RoriMode} */
    this._mode = getConfig().defaultMode;
    /** @type {RoriAttachment[]} */
    this._pendingAttachments = [];
    /** @type {string | undefined} */
    this._selectedModel = undefined;
    /** @type {string[]} */
    this._runJournal = [];
    /** @type {string} */
    this._lastAssistantText = "";
    /** @type {boolean} */
    this._awaitingAnswer = false;
    /** @type {{ runId: number; resolve: (t: string) => void } | null} */
    this._questionWait = null;
    this.reset(this._mode);
  }

  /**
   * @param {number} runId
   */
  waitForUserAnswer(runId) {
    return new Promise((resolve) => {
      this._questionWait = { runId, resolve };
      this._awaitingAnswer = true;
      this.postAll({ type: "agentAwaitingAnswer", active: true });
    });
  }

  /** @param {string} text */
  resolveQuestion(text) {
    if (!this._questionWait || this._questionWait.runId !== this._runId) return;
    this._awaitingAnswer = false;
    this.postAll({ type: "agentAwaitingAnswer", active: false });
    const wait = this._questionWait;
    this._questionWait = null;
    wait.resolve(String(text || "").trim() || "(no answer)");
  }

  /** @returns {string} */
  resolveModel() {
    return this._selectedModel || getConfig().model;
  }

  /**
   * @param {string} modelId
   * @param {{ newChat?: boolean }} opts
   */
  setModel(modelId, opts = {}) {
    if (!modelId) return;
    this._selectedModel = modelId;
    extensionContext?.globalState.update("rori-ai.selectedModel", modelId);
    this.postAll({ type: "modelSelected", model: modelId });
    if (opts.newChat) {
      this.reset(this._mode);
      this.clearPendingAttachments();
      this.clearWebviews();
    }
  }

  async refreshModels() {
    const { bridgeUrl, apiKey, model } = getConfig();
    if (!apiKey) {
      this.postAll({
        type: "models",
        models: [{ id: model, label: formatModelLabel(model) }],
        selected: this.resolveModel(),
        error: "Missing API key",
      });
      return;
    }
    try {
      const [{ defaultId }, models] = await Promise.all([
        fetchModelCatalog(bridgeUrl),
        fetchBridgeModels(bridgeUrl, apiKey),
      ]);
      let selected = this.resolveModel();
      if (!models.some((m) => m.id === selected)) {
        selected =
          (defaultId && models.some((m) => m.id === defaultId) ? defaultId : null) ||
          models[0]?.id ||
          model;
        this._selectedModel = selected;
        extensionContext?.globalState.update("rori-ai.selectedModel", selected);
      }
      this.postAll({ type: "models", models, selected });
    } catch (e) {
      const err = /** @type {Error} */ (e);
      const fallback = this.resolveModel();
      this.postAll({
        type: "models",
        models: [{ id: fallback, label: formatModelLabel(fallback) }],
        selected: fallback,
        error: err.message,
      });
    }
  }

  async postProviderConfig() {
    const base = providerConfigPayload();
    const configJson = JSON.stringify(await buildConfigObjectForUi(), null, 2);
    this.postAll({ ...base, configJson });
  }

  syncAttachmentUi() {
    const names = this._pendingAttachments.map((a) => a.fileName);
    this.postAll({ type: "attachments", names });
  }

  clearPendingAttachments() {
    this._pendingAttachments = [];
    this.syncAttachmentUi();
  }

  /**
   * @param {RoriAttachment[]} items
   */
  addPendingAttachments(items) {
    for (const a of items) {
      if (this._pendingAttachments.length >= MAX_FILES) break;
      if (this._pendingAttachments.some((x) => x.fileName === a.fileName)) continue;
      this._pendingAttachments.push(a);
    }
    this.syncAttachmentUi();
  }

  /** @returns {RoriAttachment[]} */
  takePendingAttachments() {
    const batch = [...this._pendingAttachments];
    this.clearPendingAttachments();
    return batch;
  }

  /** @param {RoriMode} mode */
  reset(mode) {
    this._mode = normalizeMode(mode);
    /** @type {{ role: string; content: string }[]} */
    this._history = [
      { role: "system", content: systemForMode(this._mode) },
    ];
    this._runId += 1;
    this._runJournal = [];
    this._lastAssistantText = "";
    this._awaitingAnswer = false;
    this._questionWait = null;
  }

  /**
   * @param {RoriMode} mode
   * @param {string} userText
   * @param {boolean} includeContext
   */
  buildUserPrompt(mode, userText, includeContext) {
    const roots = workspaceRoots();
    const lead = modeUserLead(mode);
    const snap = roots.length ? workspaceSnapshot(roots) : "";
    if (includeContext) {
      const ctx = editorContext();
      return [lead, userText, "", snap, ctx ? `---\n${ctx}` : ""].filter(Boolean).join("\n");
    }
    return [lead, userText, snap].filter(Boolean).join("\n\n");
  }

  clearWebviews() {
    for (const w of this._webviews) {
      w.postMessage({ type: "cleared" });
    }
  }

  /** @param {Record<string, unknown>} msg */
  postAll(msg) {
    for (const w of this._webviews) {
      w.postMessage(msg);
    }
  }

  /** @param {vscode.Webview} webview */
  attach(webview) {
    this._webviews.add(webview);
    webview.onDidDispose?.(() => this._webviews.delete(webview));
  }

  /**
   * @param {vscode.Webview} webview
   * @param {string} userText
   * @param {boolean} includeContext
   * @param {number} runId
   */
  /**
   * @param {vscode.Webview} webview
   * @param {string} userText
   * @param {boolean} includeContext
   * @param {number} runId
   * @param {RoriMode} mode
   */
  async runShellLoop(webview, userText, includeContext, runId, mode) {
    const roots = workspaceRoots();
    if (!roots.length) {
      throw new Error("Open a folder in VS Code (File → Open Folder) so the agent can scan files.");
    }

    const { bridgeUrl, apiKey, maxAgentTurns } = getConfig();
    const turnCap = maxAgentTurns > 0 ? maxAgentTurns : Number.POSITIVE_INFINITY;
    const model = this.resolveModel();
    const shellOpts = shellRuntimeConfig();
    const cwd = roots[0];
    const readOnly = mode === "ask";
    const fence = process.platform === "win32" ? "powershell" : "bash";

    const attachments = this.takePendingAttachments();
    const stickyAttachments = attachments.length ? attachments : undefined;
    if (attachments.length) {
      logAttach(`send ${attachments.length} file(s): ${attachments.map((a) => a.fileName).join(", ")}`);
    }
  const fileContext = stickyAttachments ? inlineTextSupplement(stickyAttachments) : "";
    this._history.push({
      role: "user",
      content: this.buildUserPrompt(mode, userText, includeContext) + fileContext,
      attachments: stickyAttachments,
    });

    const userId = `rori-vscode-${Date.now()}`;
    let attachmentsUploadedToBridge = false;
    let terminalOnlyStreak = 0;
    this._runJournal = [];
    this._lastAssistantText = "";

    for (let turn = 0; turn < turnCap; turn++) {
      if (runId !== this._runId) return;

      const t0 = Date.now();
      const turnLabel =
        maxAgentTurns > 0 ? `turn ${turn + 1}/${maxAgentTurns}` : `turn ${turn + 1}`;
      this.postAll({
        type: "thinking",
        active: true,
        text: "Thinking",
        status: `${mode} · ${turnLabel} · Gemini Web…`,
      });
      this.postAll({
        type: "agentStatus",
        text: `${mode} · ${turnLabel} · waiting on Gemini Web (30s–5m; PDFs longer)…`,
      });

      let text;
      try {
        text = await bridgeChat(bridgeUrl, apiKey, model, this._history, userId, stickyAttachments, {
          attachmentsAlreadyOnBridge: attachmentsUploadedToBridge,
        });
        if (stickyAttachments?.length) attachmentsUploadedToBridge = true;
      } catch (e) {
        const err = /** @type {Error} */ (e);
        this.postAll({ type: "thinking", active: false });
        this.postAll({
          type: "error",
          text: `Failed to reach Gemini (bridge): ${err.message}`,
        });
        return;
      }
      this.postAll({ type: "thinking", active: false });
      const bridgeSec = ((Date.now() - t0) / 1000).toFixed(1);
      this.postAll({
        type: "agentStatus",
        text: `${mode} · turn ${turn + 1} · bridge ${bridgeSec}s`,
      });
      if (runId !== this._runId) return;

      const bridgeRaw = String(text || "");
      const turnData = parseRoriTurn(text);
      const actions = turnData.actions;
      const done =
        turnData.done || assistantSignalsDone(text);

      if (!actions.length) {
        const visible = String(text || "").trim();
        if (readOnly && visible) {
          this._lastAssistantText = text;
          this.postAll({ type: "reply", text: visible, raw: bridgeRaw });
          break;
        }
        if (done) {
          this._lastAssistantText = text;
          if (visible)
            this.postAll({ type: "reply", text: visible.slice(0, 8000), raw: bridgeRaw });
          break;
        }
        this.postAll({
          type: "agentReply",
          text: visible
            ? `${visible.slice(0, 4000)}\n\n(no parseable rori-turn actions — retrying)`
            : "(empty model reply — retrying)",
          turn: turn + 1,
          raw: bridgeRaw,
        });
        this._history.push({ role: "assistant", content: text });
        this._history.push({
          role: "user",
          content: readOnly
            ? `Host parsed zero actions. Reply with ONE JSON rori-turn object: actions with say and/or read-only shell.`
            : `Host parsed zero actions. Reply with ONE JSON rori-turn object, e.g. {"actions":[{"type":"say","text":"..."},{"type":"shell","command":"..."}]}.`,
        });
        continue;
      }

      this._history.push({ role: "assistant", content: text });
      this._lastAssistantText = text;

      let ranShell = false;
      let stoppedForQuestion = false;

      for (const act of actions) {
        if (runId !== this._runId) return;

        if (act.type === "say") {
          const sayText = act.text.slice(0, 8000);
          this.postAll({
            type: "agentReply",
            text: sayText,
            turn: turn + 1,
            raw: bridgeRaw,
          });
        } else if (act.type === "question") {
          this.postAll({ type: "agentQuestion", text: act.text, raw: bridgeRaw });
          const answer = await this.waitForUserAnswer(runId);
          if (runId !== this._runId) return;
          this._history.push({ role: "user", content: `User answer: ${answer}` });
          stoppedForQuestion = true;
          break;
        } else if (act.type === "shell") {
          const cmd = act.command;
          const preview = cmd.split("\n")[0].slice(0, 120);
          this.postAll({
            type: "agentReply",
            text: `Run:\n${cmd.slice(0, 2000)}`,
            turn: turn + 1,
            raw: bridgeRaw,
          });
          this.postAll({ type: "agentTool", tool: readOnly ? "read" : "shell", path: preview });
          /** @type {{ exitCode: number; stdout: string; stderr: string }} */
          let result;
          if (readOnly && !isReadOnlyShell(cmd)) {
            result = {
              exitCode: 1,
              stdout: "",
              stderr:
                "Blocked: ASK mode is read-only. Switch to Agent mode to write, delete, or install.",
            };
          } else {
            result = runShell(cmd, cwd, shellOpts);
          }
          const cap = getConfig().maxToolOutputInHistory;
          this._history.push({
            role: "user",
            content: `Command output (exit ${result.exitCode}):\nSTDOUT:\n${clipForHistory(result.stdout, cap)}\nSTDERR:\n${clipForHistory(result.stderr, cap)}`,
          });
          const outLen = (result.stdout || "").length;
          const errLen = (result.stderr || "").length;
          this.postAll({
            type: "agentToolResult",
            tool: "shell",
            summary: `exit ${result.exitCode} · out ${outLen}b · err ${errLen}b`,
          });
          this._runJournal.push(`${preview} → exit ${result.exitCode}`);
          ranShell = true;
        }
      }

      if (stoppedForQuestion) {
        terminalOnlyStreak = 0;
        continue;
      }

      if (ranShell) {
        terminalOnlyStreak = 0;
        if (done) break;
        continue;
      }

      terminalOnlyStreak += 1;
      if (done || (readOnly && actions.some((a) => a.type === "say"))) {
        break;
      }
      if (terminalOnlyStreak >= 2) {
        break;
      }
    }

    const summary = extractAgentSummary(this._lastAssistantText, this._runJournal);
    this.postAll({ type: "agentSummary", text: summary });
    this.postAll({ type: "agentDone" });
  }

  /**
   * @param {string} userText
   * @param {boolean} includeContext
   */
  async runPlanChat(userText, includeContext) {
    const prompt = this.buildUserPrompt("plan", userText, includeContext);
    const attachments = this.takePendingAttachments();
    const stickyAttachments = attachments.length ? attachments : undefined;
    if (attachments.length) {
      logAttach(`send ${attachments.length} file(s): ${attachments.map((a) => a.fileName).join(", ")}`);
    }
    const fileContext = stickyAttachments ? inlineTextSupplement(stickyAttachments) : "";
    this._history.push({
      role: "user",
      content: prompt + fileContext,
      attachments: stickyAttachments,
    });
    const { bridgeUrl, apiKey } = getConfig();
    const model = this.resolveModel();
    this.postAll({
      type: "thinking",
      active: true,
      text: "Planning",
      status: "Waiting for Gemini Web…",
    });
    let reply;
    try {
      reply = await bridgeChat(
        bridgeUrl,
        apiKey,
        model,
        this._history,
        `rori-plan-${Date.now()}`,
        stickyAttachments
      );
    } catch (e) {
      const err = /** @type {Error} */ (e);
      this.postAll({ type: "thinking", active: false });
      this.postAll({
        type: "error",
        text: `Failed to reach Gemini (bridge): ${err.message}`,
      });
      return;
    }
    this.postAll({ type: "thinking", active: false });
    this._history.push({ role: "assistant", content: reply });
    const planTurn = parseRoriTurn(reply);
    const display =
      planTurn.actions
        .filter((a) => a.type === "say")
        .map((a) => a.text)
        .join("\n\n")
        .trim() || String(reply || "").replace(/\bDONE\b/gi, "").trim();
    this.postAll({ type: "reply", text: display || reply, raw: reply });
  }

  /** @param {vscode.Webview} webview */
  bind(webview) {
    this.attach(webview);
    if (this._bound.has(webview)) return;
    this._bound.add(webview);
    const cfg = getConfig();
    webview.postMessage({
      type: "init",
      mode: cfg.defaultMode,
      includeContext: cfg.includeEditorContext,
    });
    this.syncAttachmentUi();
    void this.postProviderConfig();
    void this.refreshModels();
    webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "getProviderConfig") {
        void this.postProviderConfig();
        return;
      }
      if (msg.type === "saveProviderConfig") {
        try {
          await applyConfigJson(String(msg.configJson || "{}"));
          webview.postMessage({ type: "providerSaved", ok: true });
          vscode.window.showInformationMessage("Rori config saved.");
        } catch (e) {
          const err = /** @type {Error} */ (e);
          webview.postMessage({ type: "providerSaved", ok: false, error: err.message });
        }
        return;
      }
      if (msg.type === "testProvider") {
        try {
          const fromJson = msg.configJson
            ? JSON.parse(String(msg.configJson))
            : await buildConfigObjectForUi();
          await testProviderConnection(fromJson);
          webview.postMessage({ type: "providerTest", ok: true });
        } catch (e) {
          const err = /** @type {Error} */ (e);
          webview.postMessage({ type: "providerTest", ok: false, error: err.message });
        }
        return;
      }
      if (msg.type === "openVscodeSettings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:WilliamTrung.rori-ai"
        );
        return;
      }
      if (msg.type === "refreshModels") {
        await this.refreshModels();
        return;
      }
      if (msg.type === "setModel") {
        const modelId = String(msg.model || "");
        if (modelId && modelId !== this.resolveModel()) {
          this.setModel(modelId, { newChat: true });
        }
        return;
      }
      if (msg.type === "newChat") {
        this.reset(normalizeMode(msg.mode));
        this.clearPendingAttachments();
        this.clearWebviews();
        return;
      }
      if (msg.type === "pickAttachments") {
        await vscode.commands.executeCommand("rori-ai.attachFiles");
        return;
      }
      if (msg.type === "dropAttachments") {
        try {
          const items = normalizeDroppedAttachments(msg.files);
          if (items.length) {
            this.addPendingAttachments(items);
            logAttach(`dropped ${items.length} file(s) from webview: ${items.map((a) => a.fileName).join(", ")}`);
          }
        } catch (e) {
          const err = /** @type {Error} */ (e);
          webview.postMessage({ type: "error", text: err.message });
        }
        return;
      }
      if (msg.type === "dropPaths") {
        try {
          const paths = fsPathsFromUriList(String(msg.uris || ""));
          if (!paths.length) {
            webview.postMessage({
              type: "error",
              text: "No files on drop — hold Shift while dragging from Explorer, or use +.",
            });
            return;
          }
          const items = loadAttachments(paths);
          this.addPendingAttachments(items);
          logAttach(`dropped ${items.length} path(s): ${items.map((a) => a.fileName).join(", ")}`);
        } catch (e) {
          const err = /** @type {Error} */ (e);
          webview.postMessage({ type: "error", text: err.message });
        }
        return;
      }
      if (msg.type === "attachActiveFile") {
        const ed = vscode.window.activeTextEditor;
        if (ed && !ed.document.isUntitled) {
          try {
            this.addPendingAttachments([readAttachmentFile(ed.document.uri.fsPath)]);
          } catch (e) {
            const err = /** @type {Error} */ (e);
            webview.postMessage({ type: "error", text: err.message });
          }
        }
        return;
      }
      if (msg.type === "removeAttachment") {
        const name = String(msg.name || "");
        this._pendingAttachments = this._pendingAttachments.filter((a) => a.fileName !== name);
        this.syncAttachmentUi();
        return;
      }
      if (msg.type === "agentTerminal") {
        await vscode.commands.executeCommand("rori-ai.runAgentTerminal", msg.text);
        return;
      }
      if (msg.type === "chat" && this._awaitingAnswer && this._questionWait) {
        const answer = String(msg.text || "").trim();
        if (answer) this.resolveQuestion(answer);
        return;
      }
      if (msg.type !== "chat") return;

      const { bridgeUrl, apiKey } = getConfig();
      const model = this.resolveModel();
      if (!apiKey) {
        webview.postMessage({
          type: "error",
          text: "Configure provider: click ⚙ in the header (Bridge URL + API key).",
        });
        webview.postMessage({ type: "openProviderPanel" });
        return;
      }

      const mode = normalizeMode(msg.mode);
      if (mode !== this._mode) {
        this.reset(mode);
      } else if (this._history[0]?.role === "system") {
        this._history[0].content = systemForMode(mode);
      }

      const runId = this._runId;
      const userText = msg.text;
      const includeContext = msg.includeContext !== false;
      try {
        if (!userText && !this._pendingAttachments.length) return;

        if (mode === "plan") {
          await this.runPlanChat(userText, includeContext);
        } else if (mode === "ask" || mode === "agent") {
          await this.runShellLoop(webview, userText, includeContext, runId, mode);
        }
      } catch (e) {
        const err = /** @type {Error} */ (e);
        webview.postMessage({ type: "error", text: err.message || String(e) });
      } finally {
        if (runId === this._runId) {
          this.postAll({ type: "idle" });
        }
      }
    });
  }
}

function getMediaUri() {
  return vscode.Uri.file(path.join(__dirname, "media"));
}

function buildHtml(webview, layoutClass) {
  const media = getMediaUri();
  const nonce = String(Date.now());
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js"));
  const { bridgeUrl, defaultMode, includeEditorContext } = getConfig();
  let html = fs.readFileSync(path.join(__dirname, "media", "chat.html"), "utf8");
  return html
    .replace(/\$\{cspSource\}/g, webview.cspSource)
    .replace(/\$\{nonce\}/g, nonce)
    .replace(/\$\{styleUri\}/g, styleUri.toString())
    .replace(/\$\{scriptUri\}/g, scriptUri.toString())
    .replace(/\$\{layoutClass\}/g, layoutClass)
    .replace(/\$\{bridgeHint\}/g, bridgeUrl.replace(/\/v1$/, ""))
    .replace(/\$\{defaultMode\}/g, defaultMode)
    .replace(/\$\{includeContextJs\}/g, includeEditorContext ? "true" : "false");
}

class RoriChatViewProvider {
  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [getMediaUri()],
    };
    webviewView.webview.html = buildHtml(webviewView.webview, "layout-sidebar");
    session.bind(webviewView.webview);
  }
}

function openEditorChat() {
  if (!extensionContext) {
    vscode.window.showErrorMessage("Rori: extension not ready — reload window");
    return;
  }
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  const targetColumn =
    column === vscode.ViewColumn.One ? vscode.ViewColumn.Beside : column;

  if (editorPanel) {
    editorPanel.reveal(targetColumn);
    return;
  }

  editorPanel = vscode.window.createWebviewPanel(
    "roriAiEditorChat",
    "Rori",
    targetColumn,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [getMediaUri()],
    }
  );

  editorPanel.iconPath = vscode.Uri.file(path.join(__dirname, "media", "icon.svg"));
  editorPanel.webview.html = buildHtml(editorPanel.webview, "layout-editor");
  session.bind(editorPanel.webview);

  editorPanel.onDidDispose(() => {
    editorPanel = undefined;
  });

  extensionContext.subscriptions.push(editorPanel);
}

function activate(context) {
  extensionContext = context;
  roriLog = vscode.window.createOutputChannel("Rori");
  context.subscriptions.push(roriLog);
  roriLog.appendLine(`[trace] Rori trace log started ${new Date().toISOString()} (rori-ai.traceLog)`);
  session = new RoriChatSession();
  session._selectedModel =
    context.globalState.get("rori-ai.selectedModel") || getConfig().model;

  void (async () => {
    await refreshApiKeyCache();
    await migrateApiKeyToSecret();
    session?.postProviderConfig();
  })();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("rori-ai")) return;
      void refreshApiKeyCache().then(() => {
        session?.postProviderConfig();
        void session?.refreshModels();
      });
    }),
    vscode.window.registerWebviewViewProvider("rori-ai.chatView", new RoriChatViewProvider()),
    vscode.commands.registerCommand("rori-ai.openChat", () => openEditorChat()),
    vscode.commands.registerCommand("rori-ai.configure", () => {
      openEditorChat();
      session?.postAll({ type: "openProviderPanel" });
    }),
    vscode.commands.registerCommand("rori-ai.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:WilliamTrung.rori-ai")
    ),
    vscode.commands.registerCommand("rori-ai.showTraceLog", () => {
      roriLog?.show(true);
    }),
    vscode.commands.registerCommand("rori-ai.openChatSidebar", async () => {
      await vscode.commands.executeCommand("rori-ai.chatView.focus");
    }),
    vscode.commands.registerCommand("rori-ai.newChat", () => {
      const mode = normalizeMode(
        vscode.workspace.getConfiguration("rori-ai").get("defaultMode")
      );
      session?.reset(mode);
      session?.clearWebviews();
    }),
    vscode.commands.registerCommand("rori-ai.attachFiles", async () => {
      const roots = workspaceRoots();
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: "Attach to chat",
        defaultUri: roots[0] ? vscode.Uri.file(roots[0]) : undefined,
      });
      if (!picked?.length) return;
      try {
        session?.addPendingAttachments(loadAttachments(picked.map((u) => u.fsPath)));
      } catch (e) {
        const err = /** @type {Error} */ (e);
        vscode.window.showErrorMessage(err.message);
      }
    }),
    vscode.commands.registerCommand("rori-ai.attachExplorerSelection", async (resource, resources) => {
      /** @type {vscode.Uri[]} */
      const uris = [];
      if (Array.isArray(resources) && resources.length) {
        for (const u of resources) {
          if (u?.fsPath) uris.push(u);
        }
      } else if (resource?.fsPath) {
        uris.push(resource);
      }
      if (!uris.length) return;
      try {
        session?.addPendingAttachments(loadAttachments(uris.map((u) => u.fsPath)));
        logAttach(`explorer attach ${uris.length} file(s)`);
      } catch (e) {
        const err = /** @type {Error} */ (e);
        vscode.window.showErrorMessage(err.message);
      }
    }),
    vscode.commands.registerCommand("rori-ai.runAgentTerminal", async (prompt) => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const text =
        typeof prompt === "string" && prompt
          ? prompt
          : await vscode.window.showInputBox({ prompt: "Rori agent task" });
      if (!text) return;
      const term = vscode.window.createTerminal({ name: "llm-adaptor", cwd: folder });
      term.show();
      term.sendText(`rori ${JSON.stringify(text)}`);
    })
  );

  const cfg = vscode.workspace.getConfiguration("rori-ai");
  if (cfg.get("openChatOnActivate")) {
    openEditorChat();
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
