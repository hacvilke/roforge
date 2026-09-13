// End-to-end TUI live-path test: drives a real TUI (live mode) through a
// full turn — streaming text, a tool call, an approval, the cost footer —
// into a fake terminal, and checks the committed screen state.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-tui-live-"));
process.env.ROFORGE_CONFIG_DIR = tmpCfg;

// ---- fake terminal (same emulator as frame.test.js) ------------------------
class FakeTerm {
  constructor(cols = 72, rows = 40) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => new Array(cols).fill(" "));
    this.x = 0;
    this.y = 0;
  }
  line(n) {
    return this.grid[n].join("").replace(/\s+$/, "");
  }
  _scroll() {
    this.grid.shift();
    this.grid.push(new Array(this.cols).fill(" "));
    this.y = this.rows - 1;
  }
  _advance() {
    this.x++;
    if (this.x >= this.cols) {
      this.x = 0;
      this.y++;
      if (this.y >= this.rows) this._scroll();
    }
  }
  write(s) {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "\x1b" && s[i + 1] === "[") {
        let j = i + 2;
        let params = "";
        while (j < s.length && /[0-9;]/.test(s[j])) {
          params += s[j];
          j++;
        }
        const letter = s[j];
        const n = parseInt(params || "1", 10) || 1;
        if (letter === "A") this.y = Math.max(0, this.y - n);
        else if (letter === "B") this.y = Math.min(this.rows - 1, this.y + n);
        else if (letter === "G") this.x = Math.max(0, n - 1);
        else if (letter === "K" && params === "2") for (let x = 0; x < this.cols; x++) this.grid[this.y][x] = " ";
        else if (letter === "K") for (let x = this.x; x < this.cols; x++) this.grid[this.y][x] = " ";
        i = j + 1;
        continue;
      }
      if (c === "\n") {
        this.x = 0;
        this.y++;
        if (this.y >= this.rows) this._scroll();
        i++;
        continue;
      }
      if (c === "\r") {
        this.x = 0;
        i++;
        continue;
      }
      this.grid[this.y][this.x] = c;
      this._advance();
      i++;
    }
  }
}

// ---- fake session: plays back a scripted turn -------------------------------
function makeSession() {
  const events = { onText: null, onToolStart: null, onToolEnd: null, onStatus: null, promptApproval: null };
  const session = {
    tools: [
      { name: "forge_read", description: "Read a DataModel tree path.", requiresApproval: false, tier: "forge" },
      { name: "forge_import", description: "Import assets (approval required).", requiresApproval: true },
    ],
    model: "test-model",
    providerName: "openrouter",
    cwd: "/tmp/proj",
    studioInfo: { mcp: false, bridge: false, mcpToolCount: 0 },
    cfg: { mcpUrl: "http://127.0.0.1:3777/mcp", approve: "ask", _apiKeyPresent: true },
    history: [],
    turns: 0,
    totalUsage: { input_tokens: 0, output_tokens: 0 },
    abort() {},
    clear() {},
    transcript() {
      return "";
    },
    async send(text) {
      const ui = events;
      // 1) stream an answer with markdown
      for (const d of ["# Plan\n", "First we **read** the ", "workspace, then `forge_import` runs.\n", "- step one\n", "- step two"]) {
        ui.onText(d);
      }
      ui.onAssistantDone();
      // 2) tool call
      ui.onToolStart({ name: "forge_read" }, { path: "Workspace" });
      ui.onToolEnd({ name: "forge_read" }, { path: "Workspace" }, "Workspace\n├─ Part\n└─ Script");
      // 3) approval-gated tool
      ui.onToolStart({ name: "forge_import" }, { assetId: "123" });
      const ans = await ui.promptApproval("forge_import", { assetId: "123" });
      assert.equal(ans, true, "approval answered yes");
      ui.onToolEnd({ name: "forge_import" }, { assetId: "123" }, "imported 1 asset");
      // 4) final text + done + cost
      for (const d of ["\nAll done — workspace updated."]) ui.onText(d);
      ui.onAssistantDone();
      ui.onStatus("done");
      ui.onStatus("↑1,200 ↓350 tok  ≈ $0.0000");
      return { ok: true };
    },
  };
  return { session, events };
}

// FakeTerm is 72 cols; make COLUMNS() agree so wrapping matches the grid.
Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => 72 });

test("tui live path: full turn commits cleanly into the fake terminal", async (t) => {
  const { TUI } = await import("../src/tui/tui.js");
  const { session, events } = makeSession();
  const term = new FakeTerm();
  const ui = new TUI(session, { out: term, live: true });
  t.after(() => {
    delete process.stdout.columns;
  });

  assert.ok(ui._liveOK, "live path active via explicit option");
  // wire events (the fake session reads them via closure)
  events.onText = (d) => ui.onText(d);
  events.onAssistantDone = () => ui.onAssistantDone();
  events.onToolStart = (t, a) => ui.onToolStart(t, a);
  events.onToolEnd = (t, a, r) => ui.onToolEnd(t, a, r);
  events.onStatus = (m) => ui.onStatus(m);
  events.promptApproval = (n, a) => ui.promptApproval(n, a);

  // "do the thing" — then answer the approval prompt the way a user would
  const turn = ui._runTurn("do the thing");
  process.nextTick(() => ui._onData("y"));
  await turn;

  const lines = [];
  for (let n = 0; n < term.rows; n++) lines.push(term.line(n));
  const used = lines.map((l, i) => ({ l, i })).filter((x) => x.l.length > 0);
  const joined = used.map((x) => x.l).join("\n");
  console.log("\n--- committed screen ---\n" + joined + "\n--- end ---");

  assert.ok(used[0].l === "you> do the thing", "user line committed first");
  assert.ok(joined.includes("Plan"), "heading present");
  assert.ok(joined.includes("First we read the"), "bold inline rendered without markers");
  assert.ok(!joined.includes("**"), "no raw markdown left");
  assert.ok(joined.includes("forge_read"), "tool card committed");
  assert.ok(joined.includes("imported 1 asset"), "tool result committed");
  assert.ok(joined.includes("All done — workspace updated."), "final text committed");
  assert.ok(joined.includes("↑1,200 ↓350 tok"), "cost footer committed");
  // no leftover spinner glyphs in the committed history
  assert.ok(!/[⠋⠙⠸⠼⠦⠧⠇⠏]/.test(joined), "no stale spinner chars committed");
  // prompt sits on a fresh line below everything
  assert.equal(term.line(term.y), ">", "prompt below committed region");
});
