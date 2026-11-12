const { parseRoriTurn } = require("../agent-actions");
const { extractAgentSummary } = require("../agent-tools");

const cases = [
  {
    name: "rori-turn fence multi-action",
    input:
      'Here you go:\n```json rori-turn\n{"done":false,"actions":[{"type":"say","text":"Hi"},{"type":"shell","command":"Get-Date"}]}\n```',
    expect(t) {
      if (!t.fromJson) throw new Error("expected fromJson");
      if (t.actions.length !== 2) throw new Error(`actions len ${t.actions.length}`);
      if (t.actions[0].type !== "say" || t.actions[1].type !== "shell")
        throw new Error("wrong types");
    },
  },
  {
    name: "raw JSON only",
    input: '{"actions":[{"type":"question","text":"Which branch?"}]}',
    expect(t) {
      if (!t.fromJson) throw new Error("fromJson");
      if (t.actions[0].type !== "question") throw new Error("question");
    },
  },
  {
    name: "flat shorthand",
    input: '{"say":"ok","bash":"pwd","done":true,"summary":"- did pwd"}',
    expect(t) {
      if (!t.fromJson || !t.done) throw new Error("done");
      if (t.actions.length !== 2) throw new Error("flat actions");
      if (t.summary !== "- did pwd") throw new Error("summary");
    },
  },
  {
    name: "legacy powershell fence",
    input: "Listing.\n```powershell\nGet-ChildItem\n```\nDONE",
    expect(t) {
      if (t.fromJson) throw new Error("legacy");
      if (!t.done) throw new Error("done");
      const shell = t.actions.filter((a) => a.type === "shell");
      if (shell.length !== 1 || !/Get-ChildItem/.test(shell[0].command))
        throw new Error("shell");
    },
  },
  {
    name: "action order preserved",
    input:
      '{"actions":[{"type":"say","text":"1"},{"type":"shell","command":"a"},{"type":"say","text":"2"}]}',
    expect(t) {
      const types = t.actions.map((a) => a.type).join(",");
      if (types !== "say,shell,say") throw new Error(types);
    },
  },
  {
    name: "comment alias",
    input: '{"actions":[{"type":"comment","text":"note"}]}',
    expect(t) {
      if (t.actions[0].type !== "say") throw new Error("say");
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    const t = parseRoriTurn(c.input);
    c.expect(t);
    console.log(`OK  ${c.name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${c.name}:`, e.message);
  }
}

const summarySrc =
  '```json rori-turn\n{"done":true,"summary":"- file touched","actions":[{"type":"say","text":"bye"}]}\n```';
const sum = extractAgentSummary(summarySrc, []);
if (!sum.includes("file touched")) {
  failed++;
  console.error("FAIL extractAgentSummary json summary");
} else {
  console.log("OK  extractAgentSummary");
}

function simulateTurnActions(text) {
  const turn = parseRoriTurn(text);
  const log = [];
  for (const act of turn.actions) {
    if (act.type === "say") log.push(`say:${act.text.slice(0, 20)}`);
    if (act.type === "shell") log.push(`shell:${act.command.split("\n")[0]}`);
    if (act.type === "question") {
      log.push(`question:${act.text}`);
      break;
    }
  }
  return { log };
}

const sim = simulateTurnActions(
  '{"actions":[{"type":"say","text":"start"},{"type":"shell","command":"echo hi"},{"type":"question","text":"ok?"}]}'
);
const expected = "say:start|shell:echo hi|question:ok?";
if (sim.log.join("|") !== expected) {
  failed++;
  console.error("FAIL simulate order", sim.log.join("|"), "!==", expected);
} else {
  console.log("OK  simulate execution order");
}

// Real shell via agent-tools (cwd = extension root)
const { runShell } = require("../agent-tools");
const shellResult = runShell('Write-Output "rori-turn-test"', __dirname, {
  commandTimeoutMs: 15000,
  maxShellOutput: 65536,
  shell: "powershell",
});
if (shellResult.exitCode !== 0 || !String(shellResult.stdout).includes("rori-turn-test")) {
  failed++;
  console.error("FAIL runShell", shellResult);
} else {
  console.log("OK  runShell powershell");
}

process.exit(failed ? 1 : 0);
