#!/usr/bin/env node
// RoForge — local Claude-Code-style agent for Roblox Studio.
// Zero dependencies, zero backend. Your key goes only to the model provider.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveConfig, apiKeyFor, modelFor, CONFIG_FILE, saveFileConfig, PROVIDERS, providerHasKey, effectiveProvider } from "../src/config.js";
import { Session } from "../src/session.js";
import { BridgeServer } from "../src/bridge/server.js";
import { probeMcp } from "../src/mcp.js";
import { TUI } from "../src/tui/tui.js";
import { bold, dim, red, green, cyan, yellow, gray, magenta } from "../src/tui/ansi.js";

const argv = process.argv.slice(2);
const command = argv[0] || "tui";
const flags = parseFlags(argv.slice(1));

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith("-") && a.length === 2) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[a.slice(1)] = next;
        i++;
      } else {
        flags[a.slice(1)] = true;
      }
    } else {
      flags._pos = (flags._pos || []).concat(a);
    }
  }
  return flags;
}

function findLuauAnalyze() {
  const candidates = [
    process.env.ROFORGE_LUAU_ANALYZE,
    "luau-analyze",
    path.resolve(process.cwd(), "luau-analyze"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ["--help"], { stdio: "ignore" });
      return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function main() {
  const cfg = resolveConfig();
  if (flags.provider && PROVIDERS[flags.provider]) cfg.provider = flags.provider;
  cfg._apiKeyPresent = Boolean(apiKeyFor(cfg));

  switch (command) {
    case "version":
    case "--version":
    case "-v": {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(process.argv[1]), "../package.json"), "utf8"));
      console.log(`roforge ${pkg.version}`);
      return;
    }

    case "login": {
      const provider =
        flags.provider || (cfg.provider !== "auto" && PROVIDERS[cfg.provider] ? cfg.provider : null);
      if (!provider) {
        console.error(red("usage: roforge login --provider <gemini|groq|openrouter|anthropic|openai>"));
        process.exit(1);
      }
      const promptKey = async (label) => {
        process.stderr.write(`Paste ${label} (input hidden): `);
        let val = "";
        // raw mode hides input; legacy Windows consoles may not support it —
        // fall back to a visible paste instead of crashing
        let raw = false;
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
          try {
            process.stdin.setRawMode(true);
            raw = true;
          } catch {
            raw = false;
          }
        }
        if (raw) {
          for await (const chunk of process.stdin) {
            for (const ch of String(chunk)) {
              if (ch === "\r" || ch === "\n" || ch === "\x04") {
                try {
                  process.stdin.setRawMode(false);
                } catch {
                  /* ignore */
                }
                console.error("");
                return val;
              }
              if (ch === "\x7f" || ch === "\b") val = val.slice(0, -1);
              else if (ch >= " " || ch === "\t") val += ch;
            }
          }
        } else {
          process.stderr.write(dim("(raw input unsupported — paste the key and press Enter)\n"));
          for await (const chunk of process.stdin) val += String(chunk);
          return val.trim();
        }
      };
      const hint = {
        gemini: "Gemini API key (free at aistudio.google.com)",
        groq: "Groq API key (console.groq.com)",
        openrouter: "OpenRouter API key (openrouter.ai)",
        anthropic: "Anthropic API key",
        openai: "OpenAI API key",
      }[provider];
      const val = await promptKey(hint);
      if (!val) {
        console.error(red("no key entered"));
        process.exit(1);
      }
      saveFileConfig({ [PROVIDERS[provider].keyField]: val });
      console.error(green(`saved ${provider} key to ${CONFIG_FILE}`) + dim(" (0600 perms recommended)"));
      try {
        fs.chmodSync(CONFIG_FILE, 0o600);
      } catch {
        /* windows */
      }
      return;
    }

    case "studio": {
      const bridge = new BridgeServer({ port: cfg.bridge.port, host: cfg.bridge.host, token: cfg.bridge.token });
      try {
        await bridge.start();
      } catch (e) {
        console.error(red(`bridge could not start on port ${cfg.bridge.port}: ${e.message}`));
        process.exit(1);
      }
      const mcp = await probeMcp(cfg.mcpUrl);
      console.log(bold("RoForge — Studio connection") + "\n");
      if (mcp.ok) {
        console.log(`${green("●")} studio MCP (built into Studio): ${mcp.toolCount} tools @ ${cfg.mcpUrl}`);
      } else {
        console.log(`${red("○")} studio MCP: not reachable @ ${cfg.mcpUrl}`);
        console.log(dim("  enable: Roblox Studio → File → Studio Settings → Beta Features → 'MCP Server'"));
      }
      console.log(`${yellow("○")} bridge plugin: waiting for Studio @ http://${bridge.host}:${bridge.port}`);
      console.log(dim(`  bridge token: ${cfg.bridge.token}`));
      console.log(dim("  (paste the token into the RoForge Bridge plugin's settings in Studio)"));
      console.log(dim("\nthis process stays running as the bridge — Ctrl+C to stop"));
      const stop = () => {
        bridge.stop();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }

    case "tools": {
      const bridge = new BridgeServer({ port: cfg.bridge.port, host: cfg.bridge.host, token: cfg.bridge.token });
      await bridge.start();
      const session = new Session({ cfg, cwd: process.cwd(), bridgeServer: bridge, luauAnalyzePath: null, ui: {} });
      await session.init();
      console.log(bold(`tools (${session.tools.length})`));
      for (const t of session.tools) {
        const tier = t.tier ? gray(` [${t.tier}]`) : "";
        const appr = t.requiresApproval ? gray(" (approve)") : "";
        console.log(`  ${cyan(t.name)}${tier}${appr} — ${dim(t.description.split(".")[0])}`);
      }
      bridge.stop();
      return;
    }

    case "chat": {
      const prompt = flags.m || flags.message;
      if (!prompt) {
        console.error(red('usage: roforge chat -m "your prompt"  (or just run `roforge` for the TUI)'));
        process.exit(1);
      }
      await oneShot(cfg, prompt);
      return;
    }

    case "analyze": {
      const files = flags._pos || [];
      if (!files.length) {
        console.error(red("usage: roforge analyze <file.lua ...>"));
        process.exit(1);
      }
      const luau = findLuauAnalyze();
      if (!luau) {
        console.error(red("luau-analyze not found. Install it (https://github.com/luau-lang/luau/releases) or set ROFORGE_LUAU_ANALYZE."));
        process.exit(1);
      }
      for (const f of files) {
        let stdout = "";
        let failed = false;
        try {
          stdout = execFileSync(luau, [f], { stdio: "pipe" }).toString();
        } catch (e) {
          // luau-analyze reports on stderr
          const buf = (e.stderr && e.stderr.length ? e.stderr : e.stdout) || Buffer.alloc(0);
          stdout = buf.toString();
          failed = true;
        }
        // The standalone analyzer doesn't know Roblox's built-in globals
        // (game, script, Instance, task, …). Those are expected noise; only
        // real problems (syntax, type, undefined locals) should fail.
        const issues = stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .filter((l) => !/Unknown global|consider assigning to it first/i.test(l));
        if (failed && issues.length) {
          console.log(`${red("FAIL")} ${f}\n${stdout}`);
          process.exitCode = 1;
        } else if (failed && !issues.length) {
          console.log(`${green("ok  ")} ${f}` + (stdout.trim() ? dim("  (only expected Roblox-global notes)") : ""));
        } else {
          console.log(`${green("ok  ")} ${f}`);
        }
      }
      return;
    }

    case "config": {
      const sub = flags._pos && flags._pos[0];
      if (sub === "set" && flags._pos[1] && flags._pos[2]) {
        const key = flags._pos[1];
        const value = flags._pos[2];
        saveFileConfig({ [key]: value });
        console.log(`${key} = ${value}`);
      } else {
        console.log(JSON.stringify(cfg, (k, v) => (/Key$/.test(k) ? (v ? "•••set•••" : "") : v), 2));
      }
      return;
    }

    case "providers": {
      const eff = effectiveProvider(cfg);
      console.log(bold("providers") + dim("  (provider → model for auto mode)\n"));
      for (const [name, meta] of Object.entries(PROVIDERS)) {
        const has = providerHasKey(cfg, name);
        const marker = eff === name ? green("◀ active") : has ? green("key set") : dim("no key");
        const free = meta.hasFreeTier ? dim(` · free tier: ${meta.freeModel}`) : "";
        console.log(`  ${has ? green("●") : dim("№")} ${name.padEnd(11)} ${marker.padEnd(12)} ${has ? meta.defaultModel : dim(meta.defaultModel)}${free}`);
      }
      console.log(dim("\nset a key: roforge login --provider <name>   ·   pin a model: roforge chat -m hi --model gemini:gemini-2.5-flash"));
      console.log(dim("auto mode picks the first key above (free tiers first). freeFirst=false reverses the order."));
      return;
    }

    case "pro": {
      const { queryProStatus, renderProStatus, probeBridge, startOwnBridge } = await import("../src/pro.js");
      const port = flags.port ? Number(flags.port) : cfg.bridge.port;
      const host = cfg.bridge.host;
      const token = cfg.bridge.token;
      const base = `http://${host}:${port}`;
      console.log(bold("RoForge Pro") + dim(" — license status\n"));
      // Attach to an already-running bridge (e.g. `roforge studio`);
      // otherwise start a throwaway one for the plugin to connect to.
      const health = await probeBridge(base);
      if (health) {
        const res = await queryProStatus(null, { port, token, baseUrl: base });
        console.log(renderProStatus(res, { bold, dim, red, green, magenta, yellow }) + "\n");
        return;
      }
      const bridge = startOwnBridge({ port, host, token });
      try {
        await bridge.start();
      } catch (e) {
        console.error(red(`bridge could not start on port ${port}: ${e.message}`));
        process.exit(1);
      }
      // The plugin pings every ~1s; give it a moment to show up if it's up.
      const deadline = Date.now() + 6000;
      while (!bridge.connected && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
      }
      const res = await queryProStatus(bridge, { port, token });
      console.log(renderProStatus(res, { bold, dim, red, green, magenta, yellow }) + "\n");
      bridge.stop();
      return;
    }

    case "help":
    case "--help":
    case "-h": {
      printHelp();
      return;
    }

    case "tui": {
      await runTUI(cfg);
      return;
    }

    default:
      console.error(red(`unknown command: ${command}`));
      printHelp();
      process.exit(1);
      return;
  }
}

async function runTUI(cfg) {
  const bridge = new BridgeServer({ port: cfg.bridge.port, host: cfg.bridge.host, token: cfg.bridge.token });
  try {
    await bridge.start();
  } catch (e) {
    console.error(yellow(`bridge disabled (port ${cfg.bridge.port} busy): ${e.message}`));
  }
  const session = new Session({
    cfg,
    cwd: process.cwd(),
    bridgeServer: bridge.server ? bridge : null,
    luauAnalyzePath: findLuauAnalyze(),
    ui: {},
  });
  try {
    await session.init();
  } catch (e) {
    console.error(red(`init: ${e.message}`));
  }
  const tui = new TUI(session);
  session.ui = tui; // wire the event sink
  const ok = await tui.start();
  if (!ok) {
    bridge.stop();
    return;
  }
  process.on("exit", () => bridge.stop());
  // keep the bridge alive while the TUI runs
  await new Promise(() => {
    /* stays until process exit */
  });
}

async function oneShot(cfg, prompt) {
  const bridge = new BridgeServer({ port: cfg.bridge.port, host: cfg.bridge.host, token: cfg.bridge.token });
  try {
    await bridge.start();
  } catch {
    /* bridge optional in one-shot */
  }
  const session = new Session({
    cfg,
    cwd: process.cwd(),
    bridgeServer: bridge.server ? bridge : null,
    luauAnalyzePath: findLuauAnalyze(),
    ui: {
      onText: (d) => process.stdout.write(d),
      onToolStart: (tool, args) => {
        let a;
        try {
          a = JSON.stringify(args || {});
        } catch {
          a = "{}";
        }
        if (a.length > 80) a = a.slice(0, 77) + "…";
        process.stderr.write(gray(`[tool] ${tool.name}(${a})\n`));
      },
      onToolEnd: (tool, args, result) => {
        const first = String(result || "").split("\n")[0].slice(0, 120);
        process.stderr.write(result.startsWith("ERROR") ? red(`  ↳ ${first}\n`) : dim(`  ↳ ${first}\n`));
      },
      onWarn: (m) => process.stderr.write(red(m + "\n")),
      onInfo: (m) => process.stderr.write(gray(m + "\n")),
      onStatus: (m) => {
        if (String(m).includes("tok")) process.stderr.write(gray(m + "\n"));
      },
    },
  });
  await session.init();
  let out;
  try {
    out = await session.send(prompt);
  } catch (e) {
    console.error(red(`error: ${e.message || e}`) + "\n");
    bridge.stop();
    process.exit(1);
  }
  process.stdout.write("\n");
  bridge.stop();
  process.exit(out.ok ? 0 : 1);
}

function printHelp() {
  console.log(`
${bold("RoForge")} — local Claude-Code-style agent for Roblox Studio. BYOK, zero backend.

${bold("Usage")}
  roforge                     interactive TUI (starts the local bridge)
  roforge chat -m "prompt"    one-shot mode (streams to stdout)
  roforge studio              keep the Studio bridge running + show connection status
  roforge tools               list all tools
  roforge login --provider <p> store a key (gemini|groq|openrouter|anthropic|openai)
  roforge providers           list providers, keys, and auto-routing order
  roforge pro                 show RoForge Pro license status (needs Studio bridge)
  roforge analyze <file...>   run the official Luau analyzer on files
  roforge config [set k v]    show / set configuration
  roforge version

${bold("How it connects to Studio")}
  1. Built-in MCP (recommended): Studio → File → Studio Settings → Beta Features →
     ${bold("MCP Server")} — roforge talks to it at http://localhost:3004/mcp automatically.
  2. RoForge Bridge plugin: install studio-bridge/dist/RoForgeBridge.rbxm into Studio,
     paste the bridge token (shown by ${bold("roforge studio")}) into the plugin.

${bold("Model providers (BYOK, zero backend)")}
  auto (default): first configured key wins, free tiers first:
  gemini → groq → openrouter → anthropic → openai
  free tiers: Gemini 2.5 Flash (~1,500 req/day), Groq Llama 3.3 70B (~1,000 req/day),
  OpenRouter ":free" models (e.g. nvidia/nemotron-3-super-120b-a12b:free)
  pin: --provider <p> or --model <provider>:<model> · ROFORGE_FREE_FIRST=0

${bold("Config & keys")}
  ~/.roforge/config.json · env: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
  ANTHROPIC_API_KEY, OPENAI_API_KEY, ROFORGE_MODEL, ROFORGE_PROVIDER,
  ROFORGE_MCP_URL, ROFORGE_BRIDGE_PORT, ROFORGE_STUDIO_MODE (auto|mcp|bridge)
  --no-color · ROFORGE_NO_COLOR / NO_COLOR=1   disable ANSI colors
`);
}

main().catch((e) => {
  console.error(red(`error: ${e.stack || e.message || e}`));
  process.exit(1);
});
