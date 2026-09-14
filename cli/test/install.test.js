// Plugin install: pluginsDir per-OS, source resolution (npm bundle vs git
// clone), copy behavior, and npm-bundle ↔ repo rbxm parity.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGINS, pluginsDir, findPluginSource, installPlugin } from "../src/install.js";
import { TUI } from "../src/tui/tui.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoCli = path.join(here, "..");
const repoRoot = path.join(repoCli, "..");

test("install: pluginsDir — Windows uses %LOCALAPPDATA%", () => {
  const d = pluginsDir({ LOCALAPPDATA: "C:\\Users\\brandon\\AppData\\Local" }, "win32", "C:\\Users\\brandon");
  assert.equal(d, path.join("C:\\Users\\brandon\\AppData\\Local", "Roblox", "Plugins"));
});

test("install: pluginsDir — macOS + Linux (XDG) + fallback", () => {
  assert.equal(pluginsDir({}, "darwin", "/Users/x"), path.join("/Users/x", "Documents", "Roblox", "Plugins"));
  assert.equal(
    pluginsDir({ XDG_DATA_HOME: "/home/u/.data" }, "linux", "/home/u"),
    path.join("/home/u/.data", "Roblox", "Plugins")
  );
  assert.equal(pluginsDir({}, "linux", "/home/u"), path.join("/home/u/.local", "share", "Roblox", "Plugins"));
});

test("install: findPluginSource resolves the bundled rbxm (npm layout or clone)", () => {
  const src = findPluginSource("bridge");
  assert.ok(src, "bridge rbxm found");
  assert.ok(src.endsWith("RoForgeBridge.rbxm"));
  const src2 = findPluginSource("client");
  assert.ok(src2 && src2.endsWith("RoForge.rbxm"));
  assert.equal(findPluginSource("nope"), null);
});

test("install: installPlugin copies into the target dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-install-"));
  try {
    const { src, dest } = installPlugin("bridge", { destDir: tmp });
    assert.ok(fs.existsSync(src), "source exists");
    assert.equal(path.dirname(dest), tmp);
    assert.ok(fs.statSync(dest).size > 1000, "rbxm copied with content");
    assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(src), "byte-identical copy");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("install: destName overrides the installed filename (.rbxm appended)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-install-"));
  try {
    const { dest } = installPlugin("bridge", { destDir: tmp, destName: "RoForgeB2" });
    assert.equal(path.basename(dest), "RoForgeB2.rbxm");
    assert.ok(fs.existsSync(dest));
    const { dest: d2 } = installPlugin("client", { destDir: tmp, destName: "RoForgeC2.rbxm" });
    assert.equal(path.basename(d2), "RoForgeC2.rbxm", "explicit extension kept");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("install: unknown plugin name throws", () => {
  assert.throws(() => installPlugin("wheels"), /unknown plugin/);
});

test("install: npm bundle matches the repo build (no drift)", () => {
  for (const name of Object.keys(PLUGINS)) {
    const bundle = path.join(repoCli, "dist", PLUGINS[name].dest);
    const repo = path.join(repoRoot, PLUGINS[name].repoRel, PLUGINS[name].dest);
    if (!fs.existsSync(bundle) || !fs.existsSync(repo)) continue; // e.g. running under `npm i -g`
    assert.deepEqual(
      fs.readFileSync(bundle),
      fs.readFileSync(repo),
      `cli/dist/${PLUGINS[name].dest} must match the repo build — re-copy after rebuilding`
    );
  }
});

test("tui: waiting-for-Studio status line shows the token + install hint", () => {
  const session = {
    tools: [],
    cfg: { mcpUrl: "http://localhost:3004/mcp" },
    studioInfo: {},
    bridgeServer: { connected: false, host: "127.0.0.1", port: 8790, token: "abc123" },
  };
  const ui = new TUI(session, { out: { write: () => {} } });
  const text = ui._studioStatusText();
  assert.match(text, /abc123/, "token visible");
  assert.match(text, /roforge install-plugin/, "install hint visible");
});

test("tui: connected status line has no token", () => {
  const session = {
    tools: [],
    cfg: { mcpUrl: "http://localhost:3004/mcp" },
    studioInfo: {},
    bridgeServer: { connected: true, host: "127.0.0.1", port: 8790, token: "abc123" },
  };
  const ui = new TUI(session, { out: { write: () => {} } });
  const text = ui._studioStatusText();
  assert.match(text, /connected/);
  assert.ok(!text.includes("abc123"), "token hidden when connected");
});
