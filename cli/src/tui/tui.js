// RoForge TUI — Claude-Code-style interactive terminal session.
// Append-style rendering (terminal scrollback preserved).
//
// Two render paths, picked once at startup:
//   • LIVE (stdout is a TTY): the streaming block (markdown + status line) is
//     a LiveRegion — rewritten in place every frame, zero flicker, history
//     committed above it. See frame.js.
//   • LEGACY (piped output / tests): plain append + \r-spinner, exactly the
//     pre-LiveRegion behavior.
import { createRequire } from "node:module";
import { bold, dim, red, green, yellow, cyan, magenta, gray, wrap, SPINNER_FRAMES, CLEAR_LINE } from "./ansi.js";
import { parseModelRef, PROVIDERS } from "../config.js";
import { MarkdownStream, segsToAnsi } from "./markdown.js";
import { LiveRegion, ATTR } from "./frame.js";

const VERSION = (() => {
  try {
    return createRequire(import.meta.url)("../../package.json").version;
  } catch {
    return "dev";
  }
})();

// Known model names (for a soft /model warning; anything else is allowed).
const KNOWN_MODELS = new Set();
for (const p of Object.values(PROVIDERS)) {
  if (p.defaultModel) KNOWN_MODELS.add(p.defaultModel);
  if (p.freeModel) KNOWN_MODELS.add(p.freeModel);
}

export class TUI {
  constructor(session, { out = process.stdout, err = process.stderr, live } = {}) {
    this.session = session;
    this.out = out;
    this.err = err;
    this.busy = false;
    this.history = [];
    this.historyIndex = -1;
    this.buffer = "";
    this.inputLine = null; // active readline for line input
    this.charMode = false; // single-char mode (approval)
    this.charResolve = null;
    this.spinnerTimer = null;
    this.spinnerFrame = 0;
    this.spinnerVisible = false;
    this.ctrlCTime = 0;
    this.running = false;

    // LiveRegion (live path). `live` overrides detection (tests).
    this.live = new LiveRegion((s) => this.out.write(s), { maxRows: 6 });
    this._liveOK =
      live === undefined ? Boolean(process.stdout.isTTY) && this.out === process.stdout : live;
    this._md = null; // active MarkdownStream for the current assistant segment
    this._segLines = []; // completed styled lines for the current segment
    this._statusLabel = "thinking…";
    this._costStatus = null; // final cost line for this turn (plain text)
    this._lastLiveSig = null;
    this._toolOutputs = []; // recent tool outputs, expandable via /out
    this._toolOutSeq = 0;
  }

  // ---------------- low-level input ----------------

  _setRaw(on) {
    const stdin = process.stdin;
    try {
      if (on) {
        stdin.setRawMode(true);
        stdin.resume();
      } else if (stdin.isTTY) {
        stdin.setRawMode(false);
        stdin.pause();
      }
    } catch {
      /* non-tty */
    }
  }

  _onData(chunk) {
    const s = String(chunk);
    if (this.charMode) {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          this._endCharMode();
          this.charResolve && this.charResolve("(empty)");
          break;
        }
        if (ch === "\x7f" || ch === "\b") {
          this.out.write("\b \b");
          continue;
        }
        this.out.write(ch);
        this._endCharMode();
        this.charResolve && this.charResolve(ch.toLowerCase());
        break;
      }
      return;
    }
    for (const ch of s) {
      if (ch === "\x03") {
        // Ctrl+C
        if (this.busy) {
          this.session.abort();
          this._stopSpinner();
          this._liveCommit();
          this.out.write("\r\n" + yellow("aborted — type a new message or /exit\n"));
          continue;
        }
        const now = Date.now();
        if (now - this.ctrlCTime < 1500) {
          this.stop();
          process.exit(0);
        }
        this.ctrlCTime = now;
        this.out.write("\r\n" + dim("press Ctrl+C again to exit") + "\r> ");
        this.buffer = "";
      } else if (ch === "\x04") {
        // Ctrl+D
        this.stop();
        process.exit(0);
      } else if (ch === "\x7f" || ch === "\b") {
        if (this.buffer.length) {
          this.buffer = this.buffer.slice(0, -1);
          this.out.write("\b \b");
        }
      } else if (ch === "\u001b") {
        // escape sequence start (arrows) — consume via next chunks; we ignore here
        this._pendingEsc = true;
      } else if (this._pendingEsc) {
        this._pendingEsc = false;
        if (ch === "[") {
          this._pendingArrow = true;
          continue;
        }
      } else if (this._pendingArrow) {
        this._pendingArrow = false;
        if (ch === "A") this._historyNav(-1);
        else if (ch === "B") this._historyNav(1);
      } else if (ch === "\r" || ch === "\n") {
        const line = this.buffer;
        this.buffer = "";
        this.out.write("\r\n");
        this._submit(line);
      } else if (ch >= " " || ch === "\t") {
        this.buffer += ch;
        this.out.write(ch);
      }
    }
  }

  _historyNav(dir) {
    if (!this.history.length) return;
    const width = this.buffer.length;
    this.historyIndex = this.historyIndex === -1 ? this.history.length - 1 : Math.min(this.history.length - 1, Math.max(0, this.historyIndex + dir));
    const entry = this.history[this.historyIndex] || "";
    this.out.write("\r" + CLEAR_LINE + "> " + entry + " ".repeat(Math.max(0, width - entry.length)));
    this.buffer = entry;
  }

  _submit(line) {
    line = line.trim();
    if (!line) return;
    if (line.startsWith("/")) {
      this._slash(line);
      return;
    }
    // Shell commands typed into the TUI go to the model and fail
    // confusingly — catch the common ones and point at the terminal.
    if (/^(roforge|npm|node|npx|git)\b(\s|$)/.test(line)) {
      this.out.write(
        yellow(
          "that's a shell command, not a chat message — /exit first, then run it in your terminal " +
            "(e.g. `roforge login`). In the TUI use /help for commands.\n"
        )
      );
      return;
    }
    this.history.push(line);
    this.historyIndex = -1;
    this._runTurn(line);
  }

  // ---------------- commands ----------------

  _slash(line) {
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    if (cmd === "/save") {
      this._save(arg);
      return;
    }
    switch (cmd) {
      case "/exit":
      case "/quit":
        this.stop();
        process.exit(0);
        break;
      case "/help":
        this.out.write(
          [
            bold("/help") + "  this help",
            bold("/tools") + "  list available tools",
            bold("/studio") + "  studio connection status (MCP / bridge)",
            bold("/clear") + "  clear the conversation",
            bold("/model <name>") + "  switch model this session (supports provider:model, e.g. gemini:gemini-2.5-flash)",
            bold("/yolo") + "  approve all tool runs this session (careful!)",
            bold("/ask") + "  require approval again",
            bold("/save [path]") + "  save the conversation as a Markdown transcript",
            bold("/out [n]") + "  show the full output of tool call #n (no arg: list recent)",
            bold("/exit") + "  quit",
          ].join("\n")
        );
        break;
      case "/tools":
        for (const t of this.session.tools) {
          const tier = t.tier ? gray(` [${t.tier}]`) : "";
          const appr = t.requiresApproval ? gray(" (approve)") : "";
          this.out.write(`  ${cyan(t.name)}${tier}${appr} — ${gray(t.description.split(".")[0])}\n`);
        }
        break;
      case "/studio":
        this.out.write(this._studioStatusText() + "\n");
        break;
      case "/clear":
        this.session.clear();
        this.out.write(dim("conversation cleared") + "\n");
        break;
      case "/model":
        if (arg) {
          const ref = parseModelRef(arg);
          if (ref) {
            this.session.cfg.provider = ref.provider;
            this.session.cfg._activeModel = ref.model;
          } else {
            this.session.cfg._activeModel = arg;
          }
          const free = PROVIDERS[this.session.providerName]?.hasFreeTier ? dim(" · free tier") : "";
          this.out.write(`model → ${this.session.cfg._activeModel} (${this.session.providerName}${free})\n`);
          if (!ref && !KNOWN_MODELS.has(arg)) {
            this.out.write(
              dim(`  (unrecognized model name — double-check the spelling, or pin explicitly: /model provider:model, e.g. /model gemini:2.5-flash)\n`)
            );
          }
        } else {
          const free = PROVIDERS[this.session.providerName]?.hasFreeTier ? dim(" · free tier") : "";
          this.out.write(`current: ${this.session.model} (${this.session.providerName}${free})\n`);
        }
        break;
      case "/yolo":
        this.session.cfg.approve = "yolo";
        this.out.write(yellow("all tool runs auto-approved for this session") + "\n");
        break;
      case "/ask":
        this.session.cfg.approve = "ask";
        this.out.write("approval prompts re-enabled\n");
        break;
      case "/out": {
        const n = parseInt(arg, 10);
        if (arg && Number.isNaN(n)) {
          this.out.write(dim("usage: /out [n] — e.g. /out 3\n"));
        } else if (arg) {
          const entry = this._toolOutputs.find((e) => e.id === n);
          if (!entry) {
            this.out.write(dim(`no tool call #${n} in the buffer (last ${this._toolOutputs.length} kept)\n`));
          } else {
            this.out.write(cyan(`— #${n} ${entry.tool}(${entry.args})\n`));
            this.out.write((entry.full || "(no output)") + "\n");
          }
        } else if (!this._toolOutputs.length) {
          this.out.write(dim("no tool calls yet\n"));
        } else {
          for (const e of this._toolOutputs.slice(-10).reverse()) {
            const lines = (e.full || "").split("\n").length;
            this.out.write(dim(`  [${e.id}] ${e.tool} — ${lines} line(s)\n`));
          }
        }
        break;
      }
      default:
        this.out.write(`unknown command ${cmd} — /help\n`);
    }
  }

  async _save(arg) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const target =
        arg && arg.trim()
          ? path.resolve(this.session.cwd, arg.trim())
          : path.resolve(this.session.cwd, `roforge-transcript-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
      await fs.writeFile(target, this.session.transcript(), "utf8");
      this.out.write(green(`transcript saved → `) + target + "\n");
    } catch (e) {
      this.out.write(red(`could not save transcript: ${e.message || e}`) + "\n");
    }
  }

  _studioStatusText() {
    const s = this.session.studioInfo;
    const lines = [];
    if (s.mcp) lines.push(`${green("●")} studio MCP (built-in): ${s.mcpToolCount} tools @ ${this.session.cfg.mcpUrl}`);
    else lines.push(`${red("○")} studio MCP (built-in): not reachable @ ${this.session.cfg.mcpUrl}` + dim(" (File → Studio Settings → Beta Features → MCP Server)"));
    if (this.session.bridgeServer) {
      const b = this.session.bridgeServer;
      lines.push(
        b.connected
          ? `${green("●")} bridge plugin: connected (http://${b.host}:${b.port})`
          : `${yellow("○")} bridge plugin: waiting for Studio (http://${b.host}:${b.port})`
      );
    }
    return lines.join("\n");
  }

  // ---------------- turn rendering ----------------

  async _runTurn(text) {
    this.out.write(dim("you> ") + text + "\n");
    this.busy = true;
    this._resetSegment();
    this._costStatus = null;
    this._lastLiveSig = null;
    try {
      await this.session.send(text);
    } catch (e) {
      this._stopSpinner();
      this._liveCommit();
      this.out.write(red(`error: ${e.message || e}`) + "\n");
    }
    // commit the live block with the final cost line as its status
    this._liveCommit(this._costStatus ? [{ text: this._costStatus, attr: ATTR.DIM }] : null);
    this.busy = false;
    this._printPrompt();
  }

  _printPrompt() {
    this._stopSpinner();
    this.out.write("> ");
  }

  // ---------------- live-region plumbing ----------------

  // Region content for the current assistant segment: completed lines + the
  // partial line, with the magenta "RoForge> " header on the first
  // non-empty line (leading blank lines from the model stay blank).
  _regionLines() {
    const lines = [...this._segLines];
    const partial = this._md ? this._md.partialLines() : null;
    if (partial) lines.push(partial);
    const first = lines.findIndex((l) => l && l.some((s) => s.text));
    if (first === -1) return [];
    lines[first] = [{ text: "RoForge> ", attr: ATTR.MAGENTA }, ...lines[first]];
    return lines;
  }

  _statusSegs() {
    if (this._costStatus) return [{ text: this._costStatus, attr: ATTR.DIM }];
    const frame = SPINNER_FRAMES[this.spinnerFrame];
    return [{ text: frame + " " + this._statusLabel, attr: ATTR.DIM }];
  }

  // Redraw the live region (no-op when nothing changed since the last frame).
  _liveRefresh() {
    if (!this._liveOK || !this.live.isActive) return;
    const lines = this._regionLines();
    const status = this._statusSegs();
    const last = lines.length ? lines[lines.length - 1] : null;
    const sig =
      lines.length +
      ":" +
      (last ? last.map((s) => s.text).join("") : "") +
      "|" +
      status.map((s) => s.text).join("");
    if (sig === this._lastLiveSig) return;
    this._lastLiveSig = sig;
    this.live.update(lines, status);
  }

  // Commit the live block to history. statusSegs = final status line, or null
  // to commit with a blank one (acts as a separator).
  _liveCommit(statusSegs = null) {
    if (!this._liveOK || !this.live.isActive) return;
    this._finalizeMd();
    this.live.update(this._regionLines(), statusSegs || []);
    this.live.release();
    this._lastLiveSig = null;
  }

  _finalizeMd() {
    if (this._md) {
      const tail = this._md.finishLines();
      if (tail) this._segLines.push(tail);
      this._md = null;
    }
  }

  // Start a fresh assistant segment (clears streamed content + markdown).
  // The "running tool" region and gaps between segments show no content, so
  // the stale block never re-renders in a new region.
  _resetSegment() {
    this._md = null;
    this._segLines = [];
  }

  // ---------------- spinner ----------------

  _startSpinner(label = "thinking…") {
    this._stopSpinner();
    this._statusLabel = label;
    if (this._liveOK) {
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
        if (this.live.isActive) this._liveRefresh();
      }, 90);
      this.spinnerTimer.unref && this.spinnerTimer.unref();
      this._liveRefresh();
    } else if (process.stdout.isTTY) {
      this.spinnerVisible = true;
      this.out.write(label);
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
        const len = label.length + 3;
        this.out.write("\r" + CLEAR_LINE + this.spinnerFrame + " " + label.slice(0, Math.max(0, len - 2)));
      }, 90);
      this.spinnerTimer.unref && this.spinnerTimer.unref();
    }
  }

  _stopSpinner() {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.spinnerVisible) {
      this.out.write("\r" + CLEAR_LINE);
      this.spinnerVisible = false;
    }
  }

  // ---------------- ui event sink (Session) ----------------

  onText(delta) {
    this._stopSpinner();
    if (!this._md) this._md = new MarkdownStream();
    const newLines = this._md.pushLines(delta);
    for (const l of newLines) this._segLines.push(l);
    if (this._liveOK) {
      if (!this.live.isActive) this.live.begin();
      this._liveRefresh();
    } else {
      if (!this._assistantHeaderShown) {
        this.out.write(magenta("RoForge> "));
        this._assistantHeaderShown = true;
      }
      if (newLines.length) this.out.write(newLines.map(segsToAnsi).join("\n") + "\n");
    }
  }

  onAssistantDone() {
    if (this._md) {
      const tail = this._md.finishLines();
      this._md = null;
      if (tail) {
        if (this._liveOK) {
          this._segLines.push(tail);
          this._liveRefresh();
        } else {
          this.out.write(segsToAnsi(tail) + "\n");
        }
      }
    }
  }

  onToolStart(tool, args) {
    this._stopSpinner();
    this._liveCommit(); // assistant block → history (blank separator)
    this._resetSegment(); // running region shows status only, no content
    let argsStr;
    try {
      argsStr = JSON.stringify(args || {});
    } catch {
      argsStr = "{}";
    }
    if (argsStr.length > 80) argsStr = argsStr.slice(0, 77) + "…";
    this._toolOutSeq += 1;
    this._toolOutputs.push({ id: this._toolOutSeq, tool: tool.name, args: argsStr, full: "" });
    if (this._toolOutputs.length > 30) this._toolOutputs.shift();
    this.out.write(dim(`  ⚙ [${this._toolOutSeq}] ${tool.name}(${argsStr})`) + "\n");
    if (this._liveOK) this.live.begin();
    this._startSpinner("running " + tool.name + "…");
  }

  onToolEnd(tool, args, result) {
    this._stopSpinner();
    const r = String(result || "");
    const last = this._toolOutputs[this._toolOutputs.length - 1];
    if (last && last.tool === tool.name) last.full = r;
    this._liveCommit(); // "running…" block → history
    this._resetSegment(); // next assistant text starts a fresh segment
    const first = r.split("\n")[0].slice(0, 120);
    const more = (r.length > 120 || r.includes("\n")) && last ? dim(` (more: /out ${last.id})`) : "";
    if (r.startsWith("ERROR")) {
      this.out.write(dim("    ↳ ") + red(first) + "\n");
    } else {
      this.out.write(dim(`    ↳ ${first}`) + more + "\n");
    }
    if (this._liveOK) this.live.begin();
    this._startSpinner("thinking…");
  }

  onInfo(msg) {
    this._stopSpinner();
    this._liveCommit();
    this.out.write(gray(msg) + "\n");
  }

  onWarn(msg) {
    this._stopSpinner();
    this._liveCommit();
    this.out.write(red(msg) + "\n");
  }

  onStatus(msg) {
    const m = String(msg);
    if (m.includes("tok")) {
      // per-turn cost footer — becomes the live block's final status line
      this._costStatus = m;
      if (this._liveOK && this.live.isActive) {
        this._stopSpinner();
        this._liveRefresh();
      } else if (!this._liveOK) {
        this.out.write("\n" + gray(m) + "\n");
      }
      return;
    }
    // "thinking… (step n/total)" / "done" → live status label
    if (this._liveOK && this.live.isActive) {
      this._statusLabel = m === "done" ? "finishing…" : m;
      this._liveRefresh();
    }
  }

  async promptApproval(name, args) {
    this._stopSpinner();
    this._liveCommit();
    let target = "";
    try {
      target = JSON.stringify(args || {});
    } catch {
      target = "{}";
    }
    if (target.length > 100) target = target.slice(0, 97) + "…";
    this.out.write(yellow(`  ✋ approve ${name}(${target})? `) + dim("[y]es / [n]o / [a]lways "));
    const ans = await this._readChar();
    this.out.write("\n"); // next output starts on a fresh line
    return ans;
  }

  _readChar() {
    return new Promise((resolve) => {
      this.charMode = true;
      this.charResolve = (ch) => {
        if (ch === "y") resolve(true);
        else if (ch === "a") {
          // always for this tool (session handles via return true + marker)
          resolve("always");
        } else resolve(false);
      };
    });
  }

  _endCharMode() {
    this.charMode = false;
  }

  // ---------------- lifecycle ----------------

  async start() {
    const s = this.session;
    this.running = true;
    this.out.write(
      bold(`RoForge ${VERSION}`) +
        dim("  —  local Roblox agent  ") +
        cyan(s.model) +
        dim(`  (${s.providerName})  ·  ${s.cwd}`) +
        "\n"
    );
    this.out.write(this._studioStatusText() + "\n");
    if (!s.cfg._apiKeyPresent) {
      this.out.write(red("  no API key found — run `roforge login` or set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY (free keys work: aistudio.google.com, console.groq.com, openrouter.ai)") + "\n");
    }
    this.out.write(dim("  /help for commands · Ctrl+C aborts a turn · Ctrl+D exits") + "\n\n");

    if (process.platform === "win32" && process.stdin.isTTY) {
      // Verify raw mode is actually available (legacy conhost can claim a TTY
      // but not support raw mode — the TUI would be unusable there).
      try {
        process.stdin.setRawMode(true);
        process.stdin.setRawMode(false);
      } catch {
        this.out.write(
          red("Windows: raw terminal mode is unavailable (legacy console).\n") +
            dim("  Run RoForge in Windows Terminal (or PowerShell 7+), or use `roforge chat -m \"...\"` for one-shot mode.\n")
        );
        process.exit(1);
      }
    }
    if (process.stdin.isTTY) {
      this._setRaw(true);
      process.stdin.on("data", (c) => this._onData(c));
      if (this._liveOK) {
        this._onResize = () => {
          if (this.live.isActive) {
            this.live.eraseOnResize();
            this._lastLiveSig = null;
          }
        };
        process.stdout.on("resize", this._onResize);
      }
      this._printPrompt();
      return true;
    }
    this.out.write(dim("(stdin is not a TTY — use `roforge chat -m \"prompt\"` for one-shot mode)") + "\n");
    this.stop();
    return false;
  }

  stop() {
    this.running = false;
    this._stopSpinner();
    this._liveCommit();
    if (this._onResize) {
      process.stdout.removeListener("resize", this._onResize);
      this._onResize = null;
    }
    this._setRaw(false);
    process.stdin.removeAllListeners("data");
  }
}
