#!/usr/bin/env node
// RoForge plugin installer — thin wrapper over the shared installer
// (cli/src/install.js), which `roforge install-plugin` uses too.
//
// Usage:
//   node scripts/install-plugin.mjs [bridge|client]
//   node scripts/install-plugin.mjs --list     (print the target dir only)

import { PLUGINS, findPluginSource, installPlugin, pluginsDir } from "../cli/src/install.js";

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

const src = findPluginSource(what);
if (!src) {
  console.error("built plugin not found (no .rbxm in cli/dist or the repo dist/ folders).");
  console.error("build it first, e.g.:  rojo build -o studio-bridge/dist/RoForgeBridge.rbxm studio-bridge/default.project.json");
  process.exit(1);
}

const { dest } = installPlugin(what);
console.log(`installed: ${dest}`);
console.log(`(${PLUGINS[what].desc})`);
console.log("open Roblox Studio → Plugins page and enable it, then run `roforge` in your terminal.");
