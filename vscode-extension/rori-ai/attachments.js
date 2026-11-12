// @ts-check
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 8;

/**
 * @param {string} fileName
 */
function mimeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  /** @type {Record<string, string>} */
  const map = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".ts": "text/typescript",
    ".py": "text/x-python",
    ".cs": "text/plain",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".csv": "text/csv",
    ".log": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * @param {string} fp
 */
function readAttachmentFile(fp) {
  const buf = fs.readFileSync(fp);
  if (buf.length > MAX_BYTES) {
    throw new Error(`${path.basename(fp)} exceeds 8 MB`);
  }
  return {
    fileName: path.basename(fp),
    mediaType: mimeFor(fp),
    base64: buf.toString("base64"),
  };
}

/**
 * @param {string[]} paths
 */
function loadAttachments(paths) {
  /** @type {{ fileName: string; mediaType: string; base64: string }[]} */
  const out = [];
  for (const p of paths) {
    out.push(readAttachmentFile(p));
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/**
 * @param {{ fileName?: string; mediaType?: string; base64?: string }[]} files
 */
function normalizeDroppedAttachments(files) {
  /** @type {{ fileName: string; mediaType: string; base64: string }[]} */
  const out = [];
  for (const f of files || []) {
    if (!f?.fileName || !f?.base64) continue;
    const raw = String(f.base64);
    const comma = raw.indexOf(",");
    const base64 = comma >= 0 && raw.slice(0, comma).includes("base64") ? raw.slice(comma + 1) : raw;
    const buf = Buffer.from(base64, "base64");
    if (buf.length > MAX_BYTES) {
      throw new Error(`${f.fileName} exceeds 8 MB`);
    }
    out.push({
      fileName: path.basename(String(f.fileName)),
      mediaType: f.mediaType || mimeFor(f.fileName),
      base64,
    });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/**
 * @param {{ fileName: string; mediaType: string; base64: string }} a
 */
function isTextLikeAttachment(a) {
  const mt = (a.mediaType || "").toLowerCase();
  if (mt.startsWith("text/")) return true;
  const ext = path.extname(a.fileName).toLowerCase();
  return [".md", ".txt", ".py", ".json", ".yaml", ".yml", ".csv", ".xml", ".html", ".css", ".js", ".ts", ".mjs", ".cs", ".log"].includes(
    ext
  );
}

/**
 * Inline small text files so the model can read them even if Gemini upload fails.
 * @param {{ fileName: string; mediaType: string; base64: string }[]} attachments
 * @param {number} [maxChars]
 */
function inlineTextSupplement(attachments, maxChars = 24000) {
  if (!attachments?.length) return "";
  const parts = [];
  let used = 0;
  for (const a of attachments) {
    if (!isTextLikeAttachment(a)) continue;
    const buf = Buffer.from(a.base64, "base64");
    if (buf.length > 96 * 1024) continue;
    let text = buf.toString("utf8");
    const budget = maxChars - used;
    if (budget <= 0) break;
    if (text.length > budget) text = `${text.slice(0, budget)}\n…[truncated]`;
    parts.push(`--- ${a.fileName} ---\n${text}\n--- end ${a.fileName} ---`);
    used += text.length;
  }
  if (!parts.length) return "";
  return `\n\n[Attached file contents]\n${parts.join("\n")}`;
}

module.exports = {
  loadAttachments,
  readAttachmentFile,
  normalizeDroppedAttachments,
  inlineTextSupplement,
  MAX_FILES,
  MAX_BYTES,
};
