// Plugin installation: copy a built .rbxm into the OS Roblox Studio plugins
// folder so it appears under Studio's plugin page.
//
// Sources are resolved in this order:
//   1. the npm package's bundled copy (cli/dist/<name>.rbxm) — works when
//      installed via `npm i -g roforge-cli`
//   2. the repo layout (<repoRoot>/studio-bridge/dist or <repoRoot>/client/dist)
//      — works when running from a git clone
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // cli/src

export const PLUGINS = {
  bridge: {
    dest: "RoForgeBridge.rbxm",
    desc: "RoForge Bridge (loopback bridge driven by the roforge CLI — tools, vision, Pro status)",
    repoRel: path.join("..", "..", "studio-bridge", "dist"),
  },
  client: {
    dest: "RoForge.rbxm",
    desc: "RoForge (in-Studio chat dock; standalone mode)",
    repoRel: path.join("..", "..", "client", "dist"),
  },
};

// Studio scans these folders for plugins.
export function pluginsDir(env = process.env, platform = process.platform, home = os.homedir()) {
  switch (platform) {
    case "win32":
      return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Roblox", "Plugins");
    case "darwin":
      return path.join(home, "Documents", "Roblox", "Plugins");
    default:
      return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "Roblox", "Plugins");
  }
}

// Find the built .rbxm for `name`. Returns an absolute path or null.
export function findPluginSource(name, { packageDir = path.join(here, "..") } = {}) {
  const meta = PLUGINS[name];
  if (!meta) return null;
  const candidates = [
    path.join(packageDir, "dist", meta.dest), // npm bundle
    path.join(here, meta.repoRel, meta.dest), // git clone
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Copy the plugin into the plugins folder. `destDir` overrides the target
// (tests); `destName` overrides the installed filename (Studio remembers a
// declined first-run prompt PER FILENAME, so a fresh name re-triggers it).
// Returns { src, dest }.
export function installPlugin(name, { destDir, destName } = {}) {
  const meta = PLUGINS[name];
  if (!meta) throw new Error(`unknown plugin: ${name} (expected: ${Object.keys(PLUGINS).join(" | ")})`);
  const src = findPluginSource(name);
  if (!src) {
    throw new Error(
      `no built plugin found (${meta.dest}). From a git clone run: ` +
        `rojo build -o studio-bridge/dist/RoForgeBridge.rbxm studio-bridge/default.project.json`
    );
  }
  const dir = destDir || pluginsDir();
  fs.mkdirSync(dir, { recursive: true });
  const destBase = destName
    ? /\.(rbxm|rbxmx)$/i.test(destName)
      ? destName
      : `${destName}.rbxm`
    : meta.dest;
  const dest = path.join(dir, destBase);
  fs.copyFileSync(src, dest);
  return { src, dest };
}
