// @ts-check
/** @typedef {"string"|"number"|"boolean"} ConfigValueType */

/**
 * All `rori-ai.*` settings (defaults mirror package.json).
 * @type {Record<string, { type: ConfigValueType; default: string | number | boolean }>}
 */
const RORI_CONFIG_KEYS = {
  bridgeUrl: { type: "string", default: "https://agent.williamthanhtrung.id.vn/v1" },
  apiKey: { type: "string", default: "" },
  model: { type: "string", default: "llm-adaptor/gemini-browser" },
  openChatOnActivate: { type: "boolean", default: false },
  defaultMode: { type: "string", default: "agent" },
  agentMode: { type: "boolean", default: true },
  maxAgentTurns: { type: "number", default: 0 },
  shell: { type: "string", default: "powershell" },
  maxShellOutput: { type: "number", default: 100000 },
  commandTimeoutMs: { type: "number", default: 120000 },
  bridgeTimeoutMs: { type: "number", default: 600000 },
  bridgeAttachmentsOnce: { type: "boolean", default: true },
  traceLog: { type: "boolean", default: true },
  maxHistoryMessages: { type: "number", default: 14 },
  maxToolOutputInHistory: { type: "number", default: 8000 },
  includeEditorContext: { type: "boolean", default: true },
};

/** @type {Record<string, { type: ConfigValueType; default: string | number | boolean; state?: boolean }>} */
const RORI_STATE_KEYS = {
  selectedModel: { type: "string", default: "", state: true },
};

module.exports = { RORI_CONFIG_KEYS, RORI_STATE_KEYS };
