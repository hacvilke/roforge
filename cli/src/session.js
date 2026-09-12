// Session: wires config + provider + tools + UI events into a working agent.
// Used by both the interactive TUI and the one-shot `roforge chat` mode.
import { buildTools } from "./tools/index.js";
import { runAgent } from "./agent.js";
import * as Anthropic from "./providers/anthropic.js";
import * as OpenAI from "./providers/openai.js";
import * as Gemini from "./providers/gemini.js";
import * as Groq from "./providers/groq.js";
import * as OpenRouter from "./providers/openrouter.js";
import { modelFor, estimateCost, effectiveProvider, PROVIDERS } from "./config.js";

const PROVIDER_MODULES = { anthropic: Anthropic, openai: OpenAI, gemini: Gemini, groq: Groq, openrouter: OpenRouter };

export class Session {
  constructor({ cfg, cwd, bridgeServer, luauAnalyzePath, ui }) {
    this.cfg = cfg;
    this.cwd = cwd;
    this.bridgeServer = bridgeServer;
    this.luauAnalyzePath = luauAnalyzePath;
    this.ui = ui; // { onText, onToolStart, onToolEnd, onInfo, onWarn, onStatus, promptApproval }
    this.history = [];
    this.tools = [];
    this.studioInfo = { mcp: false, bridge: false, mcpToolCount: 0 };
    this.aborted = false;
    this._controller = null;
    this.turns = 0;
    this.totalUsage = { input_tokens: 0, output_tokens: 0 };
    this._alwaysApprove = new Set();
  }

  get providerName() {
    return effectiveProvider(this.cfg) || this.cfg.provider || "auto";
  }
  get provider() {
    return PROVIDER_MODULES[this.providerName] || Anthropic;
  }
  get model() {
    return this.cfg._activeModel || modelFor(this.cfg);
  }

  async init() {
    const info = await buildTools({
      cfg: this.cfg,
      cwd: this.cwd,
      bridgeServer: this.bridgeServer,
      luauAnalyzePath: this.luauAnalyzePath,
    });
    this.tools = info.tools;
    this.studioInfo = { mcp: info.mcp, bridge: info.bridge, mcpToolCount: info.mcpToolCount, mcpCapture: info.mcpCapture || [] };
    this.cfg._activeModel = this.model;
    return this.studioInfo;
  }

  systemPrompt() {
    const studio = [];
    if (this.studioInfo.mcp) studio.push(`Studio's built-in MCP server is connected (${this.studioInfo.mcpToolCount} tools, prefix "studio_").`);
    if (this.studioInfo.bridge) studio.push("The RoForge Bridge plugin is available (forge_* tools) — it connects when Studio is open and the bridge plugin is active.");
    const caps = (this.studioInfo.mcpCapture || []).map((n) => `studio_${n}`).join(", ");
    if (caps) studio.push(`Studio's MCP exposes vision tools (${caps}) — they return an image you can SEE; prefer them for visual checks.`);
    if (!studio.length) studio.push("No Studio connection yet — forge_* tools will error until Studio is open with the RoForge Bridge plugin (or enable Studio's built-in MCP beta).");

    return `You are RoForge, a local AI agent for Roblox development, running on the user's machine (Claude-Code-style). You work on two surfaces:

1. PROJECT FILES (on disk): the user's Rojo project in ${this.cwd}. Edit .lua/.json/.md files with project_read / project_edit / project_write, discover with project_tree / project_search, and run builds/checks with project_run (e.g. "rojo build -o dist/RoForge.rbxm"). This is the primary workflow for real development.
2. LIVE STUDIO (when connected): inspect and modify the open place with forge_* tools (tree, read/write scripts, run Luau, screenshot).

Rules:
- Prefer inspecting before changing: project_tree / project_read / forge_read first.
- When editing code, read the current content, then write the COMPLETE new file (project_write) or use project_edit for precise, unique replacements.
- After project_write / project_edit, verify: re-read the file or run the analyzer (luau_analyze) / build (project_run) when that makes sense.
- If a tool returns ERROR, read the message and adapt. Never repeat the exact same failing call.
- Roblox specifics: current Luau (task.*, string methods, continue), current Roblox APIs, ServerScriptService vs ReplicatedStorage scoping, Rojo conventions.
- Be concise. Show code only when the user asks or right after you wrote it.
- You are local: no telemetry, no backend. Only the model provider sees your prompts.

Current state:
- Model: ${this.model} (${this.providerName}${PROVIDERS[this.providerName] && PROVIDERS[this.providerName].hasFreeTier && this.cfg.freeFirst !== false ? ", free tier" : ""})
- ${studio.join(" ")}
- Tools: ${this.tools.map((t) => t.name).join(", ")}`;
  }

  async send(userText) {
    this.turns++;
    this.aborted = false;
    this._controller = new AbortController();
    this.history.push({ role: "user", text: userText });

    const usageBefore = { ...this.totalUsage };
    const out = await runAgent(
      this.cfg,
      this.provider,
      this.history,
      this.systemPrompt(),
      this.tools,
      {
        onText: (d) => this.ui.onText && this.ui.onText(d),
        onAssistantDone: (text) => this.ui.onAssistantDone && this.ui.onAssistantDone(text),
        onToolStart: (tool, args) => this.ui.onToolStart && this.ui.onToolStart(tool, args),
        onToolEnd: (tool, args, result) => this.ui.onToolEnd && this.ui.onToolEnd(tool, args, result),
        onIter: (n, total) => this.ui.onStatus && this.ui.onStatus(`thinking… (step ${n}/${total})`),
        onUsage: (u) => {
          this.totalUsage = u;
        },
        onDone: () => this.ui.onStatus && this.ui.onStatus("done"),
        onAborted: () => this.ui.onInfo && this.ui.onInfo("aborted"),
        onError: (msg) => this.ui.onWarn && this.ui.onWarn(msg),
        shouldAbort: () => this.aborted,
        abortSignal: this._controller.signal,
        approve: (name, args) => {
          if (this.cfg.approve === "yolo" || this._alwaysApprove.has(name)) return Promise.resolve(true);
          if (this.ui.promptApproval) {
            return this.ui.promptApproval(name, args).then((ok) => {
              if (ok === "always") this.alwaysApprove(name);
              return ok === true || ok === "always";
            });
          }
          return Promise.resolve(true); // non-interactive fallback
        },
      }
    );

    if (out.ok) {
      const est = estimateCost(this.cfg, this.totalUsage);
      if (this.ui.onStatus) {
        const delta = `↑${(this.totalUsage.input_tokens - usageBefore.input_tokens).toLocaleString()} ↓${(this.totalUsage.output_tokens - usageBefore.output_tokens).toLocaleString()} tok`;
        this.ui.onStatus(`${delta}${est && est.cost != null ? `  ≈ $${est.cost.toFixed(4)}` : ""}`);
      }
    }
    this._controller = null;
    return out;
  }

  abort() {
    this.aborted = true;
    if (this._controller) this._controller.abort();
  }

  clear() {
    this.history = [];
  }

  // Render the conversation as a Markdown transcript (for /save).
  transcript() {
    const lines = [
      "# RoForge session transcript",
      "",
      `- Model: ${this.model} (${this.providerName})`,
      `- Project: ${this.cwd}`,
      `- Date: ${new Date().toISOString()}`,
      `- Turns: ${this.turns}`,
      `- Tokens: ↑${this.totalUsage.input_tokens} ↓${this.totalUsage.output_tokens}`,
      "",
      "---",
      "",
    ];
    for (const item of this.history) {
      if (item.role === "user") {
        lines.push("## You", "", item.text, "");
      } else if (item.role === "assistant") {
        if (item.text) lines.push("## RoForge", "", item.text, "");
        if (item.calls && item.calls.length) {
          lines.push("### Tool calls");
          for (const c of item.calls) {
            let args = "{}";
            try {
              args = JSON.stringify(c.args || c.input || {});
            } catch {
              /* keep "{}" */
            }
            lines.push(`- ${c.name} \`${args}\``);
          }
          lines.push("");
        }
      } else if (item.role === "tool") {
        let result = String(item.result ?? "");
        if (result.length > 4000) {
          result = result.slice(0, 4000) + `\n… [truncated ${result.length - 4000} chars]`;
        }
        lines.push(`### Tool result — ${item.name}`);
        if (item.image) {
          lines.push(`[image: ${item.image.mediaType || "image/png"}, ${item.image.base64.length} base64 chars — not inlined]`);
        }
        lines.push("```", result, "```", "");
      }
    }
    return lines.join("\n");
  }

  alwaysApprove(name) {
    this._alwaysApprove.add(name);
  }
}
