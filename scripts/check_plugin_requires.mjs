#!/usr/bin/env node
// Static require-path checker for the Studio plugins.
//
// rojo maps a source tree onto an Instance tree:
//   - <project>/src/Root  -> the root instance (a Script, from init.server.luau)
//   - a directory with an init.* file -> ONE instance whose source is that file
//   - a directory without init.*      -> a Folder
//   - X.lua / X.luau                  -> a ModuleScript child named X
//
// In Studio, `script` inside a module is THAT module's Instance, so
// `require(script.Parent.Pro)` resolves one level up and then into a child.
// A wrong level (e.g. `require(script.Pro)` for a SIBLING module) fails at
// load time in Studio with "Pro is not a valid member of ModuleScript …".
// luau-analyze cannot catch that — this checker does: it resolves every
// `require(script…)` against the real tree and fails the build if any
// reference does not exist.
//
// Usage: node scripts/check_plugin_requires.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const PLUGINS = ["studio-bridge", "client"];

const CODE_EXT = new Set([".lua", ".luau"]);
const isInitFile = (base) => /^init(\.[A-Za-z0-9]+)*\.(lua|luau)$/.test(base);

function buildTree(dir, name, cls, parent) {
  const node = { name, cls, parent, children: new Map(), files: [] };
  let hasInit = false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = buildTree(p, e.name, null, node);
      if (sub.cls) node.children.set(e.name, sub);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      if (isInitFile(e.name)) {
        hasInit = true;
        node.files.push(p); // content of this instance
      } else {
        const modName = e.name.replace(/\.(lua|luau)$/, "");
        node.children.set(modName, {
          name: modName,
          cls: "ModuleScript",
          parent: node,
          children: new Map(),
          files: [p],
        });
      }
    }
  }
  if (!cls) node.cls = hasInit ? "ModuleScript" : "Folder";
  return node;
}

// Parse `script.Parent.Pro`, `script:WaitForChild("X")`, … into steps.
function parseScriptExpr(expr) {
  const s = expr.trim();
  if (!/^script(\.|\:)/.test(s)) return null; // not a script-relative require
  const steps = [];
  const re = /(?:\.([A-Za-z_][A-Za-z0-9_]*)|:WaitForChild\(\s*["']([^"']+)["']\s*\))/g;
  let m;
  let last = 6; // length of "script"
  while ((m = re.exec(s)) !== null) {
    if (m.index !== last) return "malformed"; // gap between tokens
    if (m[1] !== undefined) steps.push(m[1] === "Parent" ? ["parent"] : ["child", m[1]]);
    else steps.push(["child", m[2]]);
    last = re.lastIndex;
  }
  if (last !== s.length) return "malformed";
  return steps;
}

let failures = 0;

for (const plugin of PLUGINS) {
  const projectPath = path.join(ROOT, plugin, "default.project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const rootDir = path.resolve(path.join(ROOT, plugin, project.tree.$path));
  const root = buildTree(rootDir, project.name, "Script", null);

  const files = [];
  (function walk(n) {
    for (const f of n.files) files.push({ file: f, node: n });
    for (const c of n.children.values()) walk(c);
  })(root);

  for (const { file, node } of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const reqRe = /require\(/g;
    let m;
    while ((m = reqRe.exec(src)) !== null) {
      // balanced-paren extraction (arguments may contain parens themselves)
      let depth = 1;
      let i = reqRe.lastIndex;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      const expr = src.slice(reqRe.lastIndex, i - 1).trim();
      if (!expr.startsWith("script")) continue; // string/other requires are OK
      const line = src.slice(0, m.index).split("\n").length;
      const steps = parseScriptExpr(expr);
      if (steps === null) continue;
      if (steps === "malformed") {
        console.error(`FAIL  ${rel}:${line}  unparseable script-require: ${expr}`);
        failures++;
        continue;
      }
      let cur = node;
      let bad = null;
      for (const [kind, name] of steps) {
        if (kind === "parent") {
          if (!cur.parent) { bad = expr + "  (walks above the plugin root)"; break; }
          cur = cur.parent;
        } else {
          const next = cur.children.get(name);
          if (!next) { bad = `${expr}  — "${name}" is not a child of ${cur.name} (${cur.cls})`; break; }
          cur = next;
        }
      }
      if (bad) {
        console.error(`FAIL  ${rel}:${line}  require(${bad})`);
        failures++;
      }
    }
  }
  console.log(`checked ${plugin}: ${files.length} files`);
}

if (failures > 0) {
  console.error(`\n${failures} broken require path(s) — fix the script.* levels above.`);
  process.exit(1);
}
console.log("all script-require paths resolve ✓");
