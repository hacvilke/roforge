#!/usr/bin/env node
// Static guard: flag string methods that exist in JavaScript/LuaJIT but NOT in Luau.
// These are the classic "hallucinated API" bugs (string.trim, str.split, ...).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BAD_METHODS = [
  "trim", "startsWith", "endsWith", "includes", "indexOf", "lastIndexOf",
  "charAt", "charCodeAt", "slice", "substr", "substring", "padStart", "padEnd",
  "toUpperCase", "toLowerCase", "fromCharCode", "camelCase", "snakeCase",
  "pascalCase", "split", "repeat", "matchAll", "replaceAll", "localeCompare",
  "concat",
];

const ROOTS = ["studio-bridge/src", "client/src"];
const PATTERNS = BAD_METHODS.map((m) => ({ m, re: new RegExp(`(?<!table)[:.]${m}\\(`) }));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.lu?a$/.test(entry)) yield p;
  }
}

let failures = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { m, re } of PATTERNS) {
        if (re.test(line)) {
          console.error(`FAIL ${file}:${i + 1}: "${m}(" is not a Luau method (use the standard string library: ${m === "trim" ? "s:match(\"^%s*(.-)%s*$\")" : "see https://create.roblox.com/docs/reference/engine/library/string"})`);
          console.error(`     ${line.trim()}`);
          failures += 1;
        }
      }
    });
  }
}

if (failures > 0) {
  console.error(`\n${failures} non-Luau string method(s) found`);
  process.exit(1);
}
console.log("all string methods are Luau-standard ✓");
