// Scratch smoke test: run the REAL TUI (default path, no `live` override)
// inside a PTY (via `script`) against a scripted fake session, so the actual
// TTY detection + LiveRegion rendering is exercised end-to-end.
//   (printf 'fix the part\r'; sleep 12; printf '/exit\r') | script -qec "node test/pty-smoke.mjs" /dev/null
import { TUI } from "../src/tui/tui.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = {
  tools: [{ name: "project_read", description: "Read a project file.", requiresApproval: false }],
  model: "nvidia/nemotron-3-super-120b-a12b:free",
  providerName: "openrouter",
  cwd: process.cwd(),
  studioInfo: { mcp: false, bridge: false, mcpToolCount: 0 },
  cfg: { mcpUrl: "http://127.0.0.1:3777/mcp", approve: "ask", _apiKeyPresent: true },
  history: [],
  abort() {},
  clear() {},
  transcript() {
    return "";
  },
  async send() {
    const u = session.ui;
    const chunks = [
      "Here's what I'd do:\n\n",
      "1. **Inspect** the `Workspace` tree\n",
      "2. Check the `Part` properties\n",
      "3. Write the fix and verify\n\n",
      "Let me look at the workspace first.",
    ];
    for (const c of chunks) {
      u.onText(c);
      await sleep(150);
    }
    u.onAssistantDone();
    await sleep(500);
    u.onToolStart({ name: "project_read" }, { path: "src/Workspace.server.luau" });
    await sleep(600);
    u.onToolEnd({ name: "project_read" }, { path: "src/Workspace.server.luau" }, "local Part = Workspace.Part\nprint(Part.Name)");
    await sleep(500);
    u.onText("\nDone — `Part` is a BasePart with CanCollide = false.");
    u.onAssistantDone();
    await sleep(400);
    u.onStatus("done");
    u.onStatus("↑1,234 ↓456 tok  ≈ $0.0000");
    return { ok: true };
  },
};
session.ui = {};

const ui = new TUI(session);
session.ui = {
  onText: (d) => ui.onText(d),
  onAssistantDone: () => ui.onAssistantDone(),
  onToolStart: (t, a) => ui.onToolStart(t, a),
  onToolEnd: (t, a, r) => ui.onToolEnd(t, a, r),
  onStatus: (m) => ui.onStatus(m),
  onInfo: (m) => ui.onInfo(m),
  onWarn: (m) => ui.onWarn(m),
  promptApproval: (n, a) => ui.promptApproval(n, a),
};

console.error("LIVE_OK=" + ui._liveOK);
const ok = await ui.start();
if (!ok) process.exit(1);
// keep alive until /exit comes in (handled by TUI)
await new Promise(() => {});
