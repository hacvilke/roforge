#!/usr/bin/env node
// RoForge plugin installer — copies a built .rbxm into your OS's Roblox
// Studio plugins folder so it appears under Studio's plugin page.
//
// Usage:
//   node scripts/install-plugin.mjs [bridge|client]
//   node scripts/install-plugin.mjs --list     (print the target dir only)
//
// Targets (Studio scans these folders for plugins):
//   Windows: %LOCALAPPDATA%\Roblox\Plugins
//   macOS:   ~/Documents/Roblox/Plugins
//   Linux:   ~/.local/share/Roblox/Plugins

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pluginsDir() {
  const home = os.homedir();
  switch (process.platform) {
    case "win32":
      return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Roblox", "Plugins");
    case "darwin":
      return path.join(home, "Documents", "Roblox", "Plugins");
    case "linux":
    default:
      return path.join(
        process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
        "Roblox",
        "Plugins"
      );
  }
}

const PLUGINS = {
  bridge: {
    src: path.join(repoRoot, "studio-bridge", "dist", "RoForgeBridge.rbxm"),
    dest: "RoForgeBridge.rbxm",
    desc: "RoForge Bridge (loopback bridge driven by the roforge CLI — vision, tools)",
  },
  client: {
    src: path.join(repoRoot, "client", "dist", "RoForge.rbxm"),
    dest: "RoForge.rbxm",
    desc: "RoForge (in-Studio chat dock; uses Studio HTTP or the local bridge)",
  },
};

const what = process.argv[2] || "bridge";

if (what === "--list" || what === "--help" || what === "-h") {
  console.log("Roblox plugins folder: " + pluginsDir());
  if (what === "--help") {
    console.log("\nusage: node scripts/install-plugin.mjs [bridge|client] [--list]");
  }
  process.exit(0);
}

if (!PLUGINS[what]) {
  console.error(`unknown plugin '${what}' — use 'bridge' or 'client' (or --help)`);
  process.exit(1);
}

const { src, dest, desc } = PLUGINS[what];
if (!fs.existsSync(src)) {
  console.error(`built plugin not found: ${src}`);
  console.error(`build it first, e.g.:  cd ${path.join(repoRoot, what === "bridge" ? "studio-bridge" : "client")} && rojo build -o dist/${dest} default.project.json`);
  process.exit(1);
}

const dir = pluginsDir();
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, dest);
fs.copyFileSync(src, target);
console.log(`installed: ${target}`);
console.log(`(${desc})`);
console.log("open Roblox Studio → Plugins page and enable it, then run `roforge` in your terminal.");
