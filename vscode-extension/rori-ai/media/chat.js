// @ts-check
const vscode = acquireVsCodeApi();
const scrollEl = document.getElementById("scroll");
const messagesEl = document.getElementById("messages");
const emptyEl = document.getElementById("empty");
const emptyHint = document.getElementById("emptyHint");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const cliBtn = document.getElementById("cliBtn");
const attachBtn = document.getElementById("attachBtn");
const attachPreview = document.getElementById("attachPreview");
const statusEl = document.getElementById("status");
const modeBtns = document.querySelectorAll(".mode-btn");
const modelSelect = document.getElementById("modelSelect");
const bridgeHintEl = document.getElementById("bridgeHint");
const providerPanel = document.getElementById("providerPanel");
const providerBackdrop = document.getElementById("providerBackdrop");
const providerClose = document.getElementById("providerClose");
const settingsBtn = document.getElementById("settingsBtn");
const cfgJson = document.getElementById("cfgJson");
const cfgStatus = document.getElementById("cfgStatus");
const cfgSave = document.getElementById("cfgSave");
const cfgTest = document.getElementById("cfgTest");
const cfgVscode = document.getElementById("cfgVscode");
const rawPanel = document.getElementById("rawPanel");
const rawBackdrop = document.getElementById("rawBackdrop");
const rawClose = document.getElementById("rawClose");
const rawCloseBtn = document.getElementById("rawCloseBtn");
const rawCopy = document.getElementById("rawCopy");
const rawContent = document.getElementById("rawContent");

/** @type {{ mode: string; includeContext: boolean }} */
const init = window.__roriInit || { mode: "agent", includeContext: true };

/** @type {string[]} */
let pendingNames = [];

/** @type {HTMLElement | null} */
let thinkingEl = null;

function showThinking(/** @type {string} */ text) {
  hideThinking();
  hideEmpty();
  thinkingEl = document.createElement("div");
  thinkingEl.className = "block thinking";
  thinkingEl.setAttribute("aria-live", "polite");
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = text || "Thinking";
  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.textContent = "…";
  thinkingEl.appendChild(label);
  thinkingEl.appendChild(dots);
  messagesEl.appendChild(thinkingEl);
  scrollEl.scrollTop = scrollEl.scrollHeight;
}

function hideThinking() {
  thinkingEl?.remove();
  thinkingEl = null;
}

function setStatusError(/** @type {string} */ text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.add("is-error");
}

function clearStatus() {
  if (!statusEl) return;
  statusEl.textContent = "";
  statusEl.classList.remove("is-error");
}

const MODE_HINT = {
  ask: "Chat with read-only shell (list/read/search files).",
  agent: "Full shell — create, edit, delete, run tools.",
  plan: "Deep planning only — no commands executed.",
};

const MODE_PH = {
  ask: "Ask about this project…",
  agent: "What should we change in this workspace?",
  plan: "What should we plan or architect?",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACH_FILES = 8;

/**
 * @param {File} file
 */
function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error(`${file.name} exceeds 8 MB`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      resolve({
        fileName: file.name,
        mediaType: file.type || "application/octet-stream",
        base64,
      });
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {FileList | File[]} fileList
 */
async function onFilesDropped(fileList) {
  /** @type {{ fileName: string; mediaType: string; base64: string }[]} */
  const batch = [];
  for (const file of fileList) {
    try {
      batch.push(await readFileAsAttachment(file));
    } catch (e) {
      const err = /** @type {Error} */ (e);
      statusEl.textContent = err.message;
    }
  }
  if (!batch.length) return;
  vscode.postMessage({ type: "dropAttachments", files: batch.slice(0, MAX_ATTACH_FILES) });
}

/**
 * @param {DragEvent} e
 */
function isAttachableDrag(e) {
  const types = [...(e.dataTransfer?.types || [])];
  if (types.includes("Files")) return true;
  if (types.includes("text/uri-list")) return true;
  if (types.includes("application/vnd.code.uri-list")) return true;
  if (types.includes("resourceurls")) return true;
  return types.some((t) => /uri|file|resource|code/i.test(t));
}

/**
 * @param {File} file
 */
function fileToUri(file) {
  const p = /** @type {{ path?: string }} */ (file).path;
  if (!p) return "";
  if (p.startsWith("/")) return `file://${encodeURI(p)}`;
  return `file:///${encodeURI(p.replace(/\\/g, "/"))}`;
}

/**
 * @param {DragEvent} e
 */
async function handleFileDrop(e) {
  const dt = e.dataTransfer;
  if (!dt) return;

  /** @type {string[]} */
  const uriLines = [];

  for (const file of [...dt.files]) {
    const u = fileToUri(file);
    if (u) uriLines.push(u);
  }

  const mimeUris =
    dt.getData("text/uri-list") ||
    dt.getData("application/vnd.code.uri-list") ||
    dt.getData("resourceurls") ||
  dt.getData("text/plain") ||
    "";

  if (mimeUris.trim()) {
    mimeUris
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .forEach((l) => uriLines.push(l));
  }

  if (uriLines.length) {
    vscode.postMessage({ type: "dropPaths", uris: [...new Set(uriLines)].join("\n") });
    return;
  }

  const needRead = [...dt.files];
  if (needRead.length) {
    await onFilesDropped(needRead);
    return;
  }

  statusEl.textContent =
    "Drop failed — hold Shift while dragging from Explorer, or drop from Windows Explorer.";
}

/** Global capture handlers (VS Code explorer uses text/uri-list, not Files). */
function initFileDrop() {
  let depth = 0;

  window.addEventListener(
    "dragenter",
    (e) => {
      if (!isAttachableDrag(e)) return;
      e.preventDefault();
      depth++;
      if (depth === 1) document.body.classList.add("file-drop-active");
    },
    true
  );

  window.addEventListener(
    "dragleave",
    (e) => {
      if (!isAttachableDrag(e)) return;
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) document.body.classList.remove("file-drop-active");
    },
    true
  );

  window.addEventListener(
    "dragover",
    (e) => {
      if (!isAttachableDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    true
  );

  window.addEventListener(
    "drop",
    (e) => {
      if (!isAttachableDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      document.body.classList.remove("file-drop-active");
      void handleFileDrop(e);
    },
    true
  );
}

initFileDrop();

function setMode(/** @type {string} */ mode, /** @type {boolean} */ fresh) {
  init.mode = mode;
  modeBtns.forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-mode") === mode);
  });
  if (emptyHint) emptyHint.textContent = MODE_HINT[mode] || MODE_HINT.agent;
  inputEl.placeholder = MODE_PH[mode] || "Message…";
  if (fresh) {
    messagesEl.innerHTML = "";
    pendingNames = [];
    renderAttachPreview();
    showEmpty();
    vscode.postMessage({ type: "newChat", mode });
    statusEl.textContent = "";
  }
}

setMode(init.mode || "agent", false);

function openProviderPanel() {
  if (!providerPanel) return;
  providerPanel.hidden = false;
  cfgStatus.textContent = "";
  cfgStatus.className = "provider-status";
  vscode.postMessage({ type: "getProviderConfig" });
}

function closeProviderPanel() {
  if (providerPanel) providerPanel.hidden = true;
}

function applyProviderConfig(/** @type {{ configJson?: string; bridgeHint?: string }} */ cfg) {
  if (cfgJson && cfg.configJson) cfgJson.value = cfg.configJson;
  if (bridgeHintEl && cfg.bridgeHint) bridgeHintEl.textContent = cfg.bridgeHint;
}

function currentConfigJsonText() {
  return cfgJson?.value?.trim() || "{}";
}

settingsBtn?.addEventListener("click", openProviderPanel);
providerClose?.addEventListener("click", closeProviderPanel);
providerBackdrop?.addEventListener("click", closeProviderPanel);

cfgSave?.addEventListener("click", () => {
  cfgStatus.textContent = "Saving…";
  cfgStatus.className = "provider-status";
  try {
    JSON.parse(currentConfigJsonText());
  } catch (e) {
    const err = /** @type {Error} */ (e);
    cfgStatus.textContent = `Invalid JSON: ${err.message}`;
    cfgStatus.className = "provider-status err";
    return;
  }
  vscode.postMessage({ type: "saveProviderConfig", configJson: currentConfigJsonText() });
});

cfgTest?.addEventListener("click", () => {
  cfgStatus.textContent = "Testing…";
  cfgStatus.className = "provider-status";
  vscode.postMessage({ type: "testProvider", configJson: currentConfigJsonText() });
});

cfgVscode?.addEventListener("click", () => {
  vscode.postMessage({ type: "openVscodeSettings" });
});

function fillModels(/** @type {{ id: string; label: string }[]} */ models, /** @type {string} */ selected) {
  if (!modelSelect) return;
  modelSelect.innerHTML = "";
  models.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.label;
    o.title = m.id;
    modelSelect.appendChild(o);
  });
  if (selected) modelSelect.value = selected;
}

modelSelect?.addEventListener("change", () => {
  vscode.postMessage({ type: "setModel", model: modelSelect.value });
});

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const m = btn.getAttribute("data-mode");
    if (!m || m === init.mode) return;
    setMode(m, true);
  });
});

function renderAttachPreview() {
  if (!attachPreview) return;
  attachPreview.innerHTML = "";
  if (!pendingNames.length) {
    attachPreview.hidden = true;
    return;
  }
  attachPreview.hidden = false;
  pendingNames.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "att-chip";
    chip.textContent = name;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "att-remove";
    x.textContent = "×";
    x.title = "Remove";
    x.addEventListener("click", () => {
      vscode.postMessage({ type: "removeAttachment", name });
    });
    chip.appendChild(x);
    attachPreview.appendChild(chip);
  });
}

function hideEmpty() {
  emptyEl?.classList.add("hidden");
}

function showEmpty() {
  emptyEl?.classList.remove("hidden");
}

function appendUser(text, /** @type {string[]} */ attNames) {
  hideEmpty();
  const div = document.createElement("div");
  div.className = "block user";
  if (text) {
    const body = document.createElement("div");
    body.className = "content";
    body.textContent = text;
    div.appendChild(body);
  }
  if (attNames?.length) {
    const row = document.createElement("div");
    row.className = "att-row";
    attNames.forEach((n) => {
      const chip = document.createElement("span");
      chip.className = "att-chip";
      chip.textContent = n;
      row.appendChild(chip);
    });
    div.appendChild(row);
  }
  messagesEl.appendChild(div);
  scrollEl.scrollTop = scrollEl.scrollHeight;
}

function openRawPanel(/** @type {string} */ raw) {
  if (!rawPanel || !rawContent) return;
  rawContent.textContent = raw || "";
  rawPanel.hidden = false;
}

function closeRawPanel() {
  if (rawPanel) rawPanel.hidden = true;
}

rawBackdrop?.addEventListener("click", closeRawPanel);
rawClose?.addEventListener("click", closeRawPanel);
rawCloseBtn?.addEventListener("click", closeRawPanel);
rawCopy?.addEventListener("click", async () => {
  const text = rawContent?.textContent || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (rawCopy) rawCopy.textContent = "Copied";
    setTimeout(() => {
      if (rawCopy) rawCopy.textContent = "Copy";
    }, 1200);
  } catch {
    /* clipboard blocked in webview on some hosts */
  }
});

/**
 * @param {string} kind
 * @param {string} text
 * @param {string | undefined} [raw]
 */
function appendBlock(kind, text, raw) {
  const t = String(text || "").trim();
  if (!t && !raw) return;
  hideEmpty();
  const div = document.createElement("div");
  div.className = `block ${kind}`;
  const body = document.createElement("div");
  body.className = "content";
  body.textContent = t || "(empty display)";
  div.appendChild(body);
  if (raw && String(raw).length > 0) {
    const footer = document.createElement("div");
    footer.className = "block-footer";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "raw-view-btn";
    btn.textContent = "View raw response";
    btn.addEventListener("click", () => openRawPanel(String(raw)));
    footer.appendChild(btn);
    div.appendChild(footer);
  }
  messagesEl.appendChild(div);
  scrollEl.scrollTop = scrollEl.scrollHeight;
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  if (cliBtn) cliBtn.disabled = busy;
  if (attachBtn) attachBtn.disabled = busy;
  modeBtns.forEach((b) => {
    b.disabled = busy;
  });
}

function resizeInput() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

inputEl.addEventListener("input", resizeInput);

attachBtn?.addEventListener("click", () => {
  vscode.postMessage({ type: "pickAttachments" });
});

attachBtn?.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  vscode.postMessage({ type: "attachActiveFile" });
});

function sendChat() {
  const text = inputEl.value.trim();
  if (!text && !pendingNames.length) return;
  const att = [...pendingNames];
  appendUser(text, att);
  inputEl.value = "";
  pendingNames = [];
  renderAttachPreview();
  resizeInput();
  setBusy(true);
  clearStatus();
  const mode = init.mode || "agent";
  showThinking(
    mode === "plan" ? "Planning" : mode === "ask" ? "Thinking" : "Thinking"
  );
  statusEl.textContent = "Waiting for Gemini Web…";
  vscode.postMessage({
    type: "chat",
    text: text || "",
    mode,
    includeContext: init.includeContext !== false,
  });
}

sendBtn.addEventListener("click", sendChat);

cliBtn?.addEventListener("click", () => {
  const text = inputEl.value.trim();
  vscode.postMessage({ type: "agentTerminal", text: text || undefined });
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendChat();
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (msg.type === "attachments") {
    pendingNames = Array.isArray(msg.names) ? msg.names : [];
    renderAttachPreview();
  }
  if (msg.type === "thinking") {
    if (msg.active) {
      showThinking(msg.text || "Thinking");
      if (msg.status) statusEl.textContent = msg.status;
    } else {
      hideThinking();
    }
  }
  if (msg.type === "reply") {
    setBusy(false);
    hideThinking();
    clearStatus();
    appendBlock("assistant", msg.text, msg.raw ? String(msg.raw) : undefined);
  }
  if (msg.type === "error") {
    setBusy(false);
    hideThinking();
    setStatusError(msg.text || "Request failed");
    appendBlock("error", msg.text || "Request failed");
  }
  if (msg.type === "cleared") {
    messagesEl.innerHTML = "";
    pendingNames = [];
    renderAttachPreview();
    showEmpty();
    clearStatus();
  }
  if (msg.type === "idle") {
    setBusy(false);
    hideThinking();
    if (!statusEl.classList.contains("is-error") && statusEl.textContent === "Done") {
      setTimeout(() => {
        if (statusEl.textContent === "Done") clearStatus();
      }, 1500);
    } else if (!statusEl.classList.contains("is-error")) {
      clearStatus();
    }
  }
  if (msg.type === "agentStatus") {
    if (msg.text) {
      statusEl.textContent = msg.text;
      statusEl.classList.remove("is-error");
      if (/waiting|Gemini|bridge/i.test(msg.text)) {
        showThinking("Thinking");
      }
    }
  }
  if (msg.type === "agentReply") {
    hideThinking();
    appendBlock("assistant", msg.text, msg.raw ? String(msg.raw) : undefined);
  }
  if (msg.type === "agentQuestion") {
    hideThinking();
    appendBlock(
      "assistant",
      `Question: ${msg.text || ""}`,
      msg.raw ? String(msg.raw) : undefined
    );
    setBusy(false);
  }
  if (msg.type === "agentAwaitingAnswer") {
    if (msg.active) {
      statusEl.textContent = "Reply in the box below to answer the question.";
      statusEl.classList.remove("is-error");
      if (inputEl) {
        inputEl.placeholder = "Your answer…";
        inputEl.focus();
      }
    } else if (inputEl && MODE_PH[init.mode]) {
      inputEl.placeholder = MODE_PH[init.mode] || "";
    }
  }
  if (msg.type === "agentTool") {
    appendBlock("tool", `${msg.tool}  ${msg.path || ""}`.trim());
  }
  if (msg.type === "agentToolResult") {
    appendBlock("tool", `   ${msg.summary}`);
  }
  if (msg.type === "agentSummary" && msg.text) {
    const div = document.createElement("div");
    div.className = "block summary";
    const label = document.createElement("div");
    label.className = "content";
    label.style.fontWeight = "600";
    label.style.marginBottom = "6px";
    label.textContent = "Summary";
    const body = document.createElement("div");
    body.className = "content";
    body.textContent = msg.text;
    div.appendChild(label);
    div.appendChild(body);
    messagesEl.appendChild(div);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
  if (msg.type === "agentDone") {
    setBusy(false);
    hideThinking();
    clearStatus();
    statusEl.textContent = "Done";
    setTimeout(() => {
      if (statusEl.textContent === "Done") clearStatus();
    }, 1500);
  }
  if (msg.type === "init") {
    init.includeContext = msg.includeContext !== false;
    if (msg.mode) setMode(msg.mode, false);
  }
  if (msg.type === "models") {
    fillModels(msg.models || [], msg.selected || "");
    if (msg.error && statusEl) statusEl.textContent = `Models: ${msg.error}`;
  }
  if (msg.type === "modelSelected" && msg.model && modelSelect) {
    modelSelect.value = msg.model;
  }
  if (msg.type === "providerConfig") {
    applyProviderConfig(msg);
  }
  if (msg.type === "openProviderPanel") {
    openProviderPanel();
  }
  if (msg.type === "providerSaved") {
    if (msg.ok) {
      cfgStatus.textContent = "Saved.";
      cfgStatus.className = "provider-status ok";
      vscode.postMessage({ type: "getProviderConfig" });
      vscode.postMessage({ type: "refreshModels" });
    } else {
      cfgStatus.textContent = msg.error || "Save failed";
      cfgStatus.className = "provider-status err";
    }
  }
  if (msg.type === "providerTest") {
    if (msg.ok) {
      cfgStatus.textContent = "Connection OK — models reachable.";
      cfgStatus.className = "provider-status ok";
    } else {
      cfgStatus.textContent = msg.error || "Test failed";
      cfgStatus.className = "provider-status err";
    }
  }
});
