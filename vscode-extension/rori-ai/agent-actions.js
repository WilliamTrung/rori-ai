// @ts-check
const { extractCommands } = require("./agent-tools");

/**
 * @typedef {{ type: "say"; text: string }} RoriSayAction
 * @typedef {{ type: "shell"; command: string }} RoriShellAction
 * @typedef {{ type: "question"; text: string }} RoriQuestionAction
 * @typedef {RoriSayAction | RoriShellAction | RoriQuestionAction} RoriAction
 * @typedef {{ fromJson: boolean; done: boolean; actions: RoriAction[]; summary?: string; rawAssistant: string }} RoriTurn
 */

/**
 * @param {string} text
 * @returns {unknown}
 */
function tryParseJsonBlob(text) {
  const fenced =
    text.match(/```(?:json\s+rori-turn|rori-turn\s+json|json)?\s*([\s\S]*?)```/i) ||
    text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* try below */
    }
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* */
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * @param {unknown} o
 * @returns {RoriAction[]}
 */
function actionsFromObject(o) {
  if (!o || typeof o !== "object") return [];
  const rec = /** @type {Record<string, unknown>} */ (o);
  /** @type {RoriAction[]} */
  const out = [];

  if (Array.isArray(rec.actions)) {
    for (const item of rec.actions) {
      if (!item || typeof item !== "object") continue;
      const a = /** @type {Record<string, unknown>} */ (item);
      const type = String(a.type || "").toLowerCase();
      if (type === "say" || type === "response" || type === "comment") {
        const t = String(a.text ?? a.say ?? a.content ?? "").trim();
        if (t) out.push({ type: "say", text: t });
      } else if (type === "shell" || type === "bash") {
        const c = String(a.command ?? a.shell ?? a.bash ?? "").trim();
        if (c) out.push({ type: "shell", command: c });
      } else if (type === "question" || type === "ask") {
        const q = String(a.text ?? a.question ?? "").trim();
        if (q) out.push({ type: "question", text: q });
      }
    }
    return out;
  }

  const say = rec.say ?? rec.response ?? rec.comment ?? rec.message;
  if (typeof say === "string" && say.trim()) out.push({ type: "say", text: say.trim() });

  const shell = rec.shell ?? rec.bash ?? rec.cmd ?? rec.command;
  if (typeof shell === "string" && shell.trim())
    out.push({ type: "shell", command: shell.trim() });

  const question = rec.question ?? rec.ask;
  if (typeof question === "string" && question.trim())
    out.push({ type: "question", text: question.trim() });

  return out;
}

/**
 * @param {string} text
 * @returns {RoriTurn}
 */
function parseRoriTurn(text) {
  const raw = String(text || "");
  const json = tryParseJsonBlob(raw);
  if (json) {
    const rec = /** @type {Record<string, unknown>} */ (
      typeof json === "object" && json ? json : {}
    );
    const actions = actionsFromObject(rec);
    if (actions.length) {
      return {
        fromJson: true,
        done: Boolean(rec.done),
        actions,
        summary: typeof rec.summary === "string" ? rec.summary : undefined,
        rawAssistant: raw,
      };
    }
  }

  /** @type {RoriAction[]} */
  const legacy = [];
  const visible = raw.replace(/\bDONE\b/gi, "").trim();
  if (visible) legacy.push({ type: "say", text: visible.slice(0, 8000) });
  for (const cmd of extractCommands(raw)) {
    legacy.push({ type: "shell", command: cmd });
  }
  return {
    fromJson: false,
    done: /\bDONE\b/i.test(raw),
    actions: legacy,
    rawAssistant: raw,
  };
}

module.exports = { parseRoriTurn };
