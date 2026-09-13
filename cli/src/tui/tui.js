// RoForge TUI — Claude-Code-style interactive terminal session.
// Append-style rendering (terminal scrollback preserved), single status line
// with a spinner, approval prompts, slash commands, input history.
import { createRequire } from "node:module";
import { bold, dim, red, green, yellow, cyan, magenta, gray, wrap, SPINNER_FRAMES, CLEAR_LINE } from "./ansi.js";
import { parseModelRef, PROVIDERS } from "../config.js";
import { MarkdownStream } from "./markdown.js";

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
  constructor(session, { out = process.stdout, err = process.stderr } = {}) {
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
    this._md = null; // active MarkdownStream for the current assistant segment
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
              dim(`  (unrecognized model name — double-check the spelling, or pin explicitly: /model provider:model, e.g. /model gemini:gemini-2.5-flash)\n`)
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
    this._md = null;
    try {
      await this.session.send(text);
    } catch (e) {
      this.out.write(red(`error: ${e.message || e}`) + "\n");
    }
    this.busy = false;
    this._printPrompt();
  }

  _printPrompt() {
    this._stopSpinner();
    this.out.write("> ");
  }

  _startSpinner(label = "thinking…") {
    if (!process.stdout.isTTY) return;
    this._stopSpinner();
    this.spinnerVisible = true;
    this.out.write(label);
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      const len = label.length + 3;
      this.out.write("\r" + CLEAR_LINE + this.spinnerFrame + " " + label.slice(0, Math.max(0, len - 2)));
    }, 90);
    this.spinnerTimer.unref && this.spinnerTimer.unref();
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

  _flushMd() {
    if (this._md) {
      const tail = this._md.finish();
      if (tail) this.out.write(tail);
      this._md = null;
    }
  }

  onText(delta) {
    this._stopSpinner();
    if (!this._assistantHeaderShown) {
      this.out.write(magenta("RoForge> ") );
      this._assistantHeaderShown = true;
    }
    if (!this._md) this._md = new MarkdownStream();
    const rendered = this._md.push(delta);
    if (rendered) this.out.write(rendered);
  }

  onAssistantDone() {
    this._flushMd();
  }

  onToolStart(tool, args) {
    this._stopSpinner();
    this._flushMd();
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
    this._startSpinner(dim("running " + tool.name + "…"));
  }

  onToolEnd(tool, args, result) {
    this._stopSpinner();
    const r = String(result || "");
    const last = this._toolOutputs[this._toolOutputs.length - 1];
    if (last && last.tool === tool.name) last.full = r;
    const first = r.split("\n")[0].slice(0, 120);
    const more = (r.length > 120 || r.includes("\n")) && last ? dim(` (more: /out ${last.id})`) : "";
    if (r.startsWith("ERROR")) {
      this.out.write(dim("    ↳ ") + red(first) + "\n");
    } else {
      this.out.write(dim(`    ↳ ${first}`) + more + "\n");
    }
    this._startSpinner("thinking…");
  }

  onInfo(msg) {
    this._stopSpinner();
    this.out.write(gray(msg) + "\n");
  }

  onWarn(msg) {
    this._stopSpinner();
    this.out.write(red(msg) + "\n");
  }

  onStatus(msg) {
    // Only the per-turn cost footer is printed here; the spinner covers
    // "thinking…" and tool progress is shown on its own lines.
    if (String(msg).includes("tok")) this.out.write("\n" + gray(msg) + "\n");
  }

  async promptApproval(name, args) {
    this._stopSpinner();
    let target = "";
    try {
      target = JSON.stringify(args || {});
    } catch {
      target = "{}";
    }
    if (target.length > 100) target = target.slice(0, 97) + "…";
    this.out.write(yellow(`  ✋ approve ${name}(${target})? `) + dim("[y]es / [n]o / [a]lways "));
    return await this._readChar();
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
    this._setRaw(false);
    process.stdin.removeAllListeners("data");
  }
}
