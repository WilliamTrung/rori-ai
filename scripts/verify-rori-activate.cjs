const Module = require("module");
const path = require("path");

const commands = new Map();
const vscode = {
  window: {
    activeTextEditor: undefined,
    registerWebviewViewProvider: () => ({ dispose: () => {} }),
    createWebviewPanel: () => ({
      webview: {
        onDidReceiveMessage: () => {},
        postMessage: () => {},
        asWebviewUri: (u) => u,
        cspSource: "https://example.com",
      },
      onDidDispose: () => {},
      reveal: () => {},
    }),
    showErrorMessage: () => {},
    createTerminal: () => ({ show: () => {}, sendText: () => {} }),
    showInputBox: async () => undefined,
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (k) =>
        ({
          bridgeUrl: "https://agent.williamthanhtrung.id.vn/v1",
          apiKey: "test",
          model: "llm-adaptor/gemini-browser",
          openChatOnActivate: false,
        })[k] ?? null,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
  },
  commands: {
    registerCommand: (id, fn) => {
      commands.set(id, fn);
      return { dispose: () => {} };
    },
    executeCommand: async () => {},
  },
  Uri: {
    file: (p) => ({ fsPath: p }),
    joinPath: (base, ...parts) => ({
      toString: () => `${typeof base === "string" ? base : base.fsPath}/${parts.join("/")}`,
    }),
  },
  ViewColumn: { One: 1, Beside: 2, Two: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
};

const extPath = path.join(__dirname, "..", "vscode-extension", "rori-ai", "extension.js");
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "vscode") return vscode;
  return orig.apply(this, arguments);
};

const { activate } = require(extPath);
activate({
  subscriptions: [],
  globalState: {
    get: () => undefined,
    update: async () => {},
  },
  secrets: {
    get: async () => undefined,
    store: async () => {},
  },
});

if (!commands.has("rori-ai.openChat")) throw new Error("rori-ai.openChat missing");
commands.get("rori-ai.openChat")();
console.log("OK:", [...commands.keys()].join(", "));
