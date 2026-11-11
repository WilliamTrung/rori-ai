// @ts-check
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

/** @type {vscode.WebviewViewProvider | undefined} */
let chatProvider;

/**
 * @param {string} base
 * @param {string} key
 * @param {string} model
 * @param {{ role: string; content: string }[]} messages
 */
async function bridgeChat(base, key, model, messages) {
  const url = base.replace(/\/$/, "").endsWith("/v1")
    ? `${base.replace(/\/$/, "")}/chat/completions`
    : `${base.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("rori-ai");
  return {
    bridgeUrl: cfg.get("bridgeUrl") || "http://100.79.204.29:5080/v1",
    apiKey: (cfg.get("apiKey") || "").trim(),
    model: cfg.get("model") || "rori/gemini-web",
  };
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

class RoriChatViewProvider {
  constructor() {
    /** @type {vscode.WebviewView | undefined} */
    this._view = undefined;
    /** @type {{ role: string; content: string }[]} */
    this._history = [
      {
        role: "system",
        content:
          "You are Rori AI embedded in the IDE. Be concise. User may share open file context.",
      },
    ];
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.getMediaUri()] };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "agent") {
        await vscode.commands.executeCommand("rori-ai.runAgentTerminal", msg.text);
        return;
      }
      if (msg.type !== "chat") return;

      const { bridgeUrl, apiKey, model } = getConfig();
      if (!apiKey) {
        webviewView.webview.postMessage({
          type: "error",
          text: "Set rori-ai.apiKey (llm-adaptor MSI key) in Settings.",
        });
        return;
      }
      const ctx = editorContext();
      const userText = ctx ? `${msg.text}\n\n---\n${ctx}` : msg.text;
      this._history.push({ role: "user", content: userText });
      try {
        const reply = await bridgeChat(bridgeUrl, apiKey, model, this._history);
        this._history.push({ role: "assistant", content: reply });
        webviewView.webview.postMessage({ type: "reply", text: reply });
      } catch (e) {
        const err = /** @type {Error} */ (e);
        webviewView.webview.postMessage({ type: "error", text: err.message || String(e) });
      }
    });
  }

  getMediaUri() {
    return vscode.Uri.file(path.join(__dirname, "media"));
  }

  /**
   * @param {vscode.Webview} webview
   */
  getHtml(webview) {
    const media = this.getMediaUri();
    const nonce = String(Date.now());
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js"));
    let html = fs.readFileSync(path.join(__dirname, "media", "chat.html"), "utf8");
    html = html
      .replace(/\$\{cspSource\}/g, webview.cspSource)
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{styleUri\}/g, styleUri.toString())
      .replace(/\$\{scriptUri\}/g, scriptUri.toString());
    return html;
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  chatProvider = new RoriChatViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("rori-ai.chatView", chatProvider),
    vscode.commands.registerCommand("rori-ai.openChat", async () => {
      await vscode.commands.executeCommand("rori-ai.chatView.focus");
    }),
    vscode.commands.registerCommand("rori-ai.runAgentTerminal", async (prompt) => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const text =
        typeof prompt === "string" && prompt
          ? prompt
          : await vscode.window.showInputBox({ prompt: "Rori agent task" });
      if (!text) return;
      const term = vscode.window.createTerminal({ name: "Rori Agent", cwd: folder });
      term.show();
      const q = text.replace(/"/g, '\\"');
      term.sendText(
        `rori --local-only -t --yolo --skip-onboarding -m rori/gemini-web -p "${q}" --max-turns 30` +
          (folder ? ` --add-dir "${folder}"` : "")
      );
    }),
    vscode.commands.registerCommand("rori-ai.setupIde", async () => {
      const term = vscode.window.createTerminal({ name: "Rori IDE Setup" });
      term.show();
      term.sendText("rori --ide-setup");
      void vscode.window.showInformationMessage(
        "Optional: Command Code extension for full CC IDE sync. BYOK chat works in this Rori sidebar with apiKey only."
      );
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
