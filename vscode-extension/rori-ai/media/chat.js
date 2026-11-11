// @ts-check
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const agentBtn = document.getElementById("agent");
const statusEl = document.getElementById("status");

/** @param {string} role @param {string} text */
function append(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = (role === "user" ? "You: " : "Rori: ") + text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

sendBtn.addEventListener("click", () => {
  const text = inputEl.value.trim();
  if (!text) return;
  append("user", text);
  inputEl.value = "";
  statusEl.textContent = "Thinking…";
  vscode.postMessage({ type: "chat", text });
});

agentBtn.addEventListener("click", () => {
  const text = inputEl.value.trim() || "Help with this workspace";
  vscode.postMessage({ type: "agent", text });
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (msg.type === "reply") {
    statusEl.textContent = "";
    append("assistant", msg.text);
  }
  if (msg.type === "error") {
    statusEl.textContent = "";
    append("assistant", "Error: " + msg.text);
  }
});
