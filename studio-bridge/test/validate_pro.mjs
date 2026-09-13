// Validates Pro.lua: runs the luau test under a stubbed Roblox env and
// requires every check to pass. Usage: node test/validate_pro.mjs /path/to/luau
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const luau = process.argv[2] || "/tmp/luau";
let out;
try {
  out = execFileSync(luau, ["test/pro_test.lua"], {
    cwd: new URL("..", import.meta.url).pathname,
    maxBuffer: 16 * 1024 * 1024,
  }).toString();
} catch (e) {
  console.error(e.stdout?.toString() || "");
  throw new Error("luau pro_test.lua failed: " + (e.message || e));
}

const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
const passes = lines.filter((l) => l.startsWith("PASS "));
assert.ok(lines.some((l) => l.startsWith("DONE ")), "missing DONE marker");
const declared = Number(lines.find((l) => l.startsWith("DONE ")).split(" ")[1]);
assert.equal(passes.length, declared, `PASS count mismatch (${passes.length} vs DONE ${declared})`);
for (const l of passes) console.log("  " + l);
console.log(`pro: ${passes.length} checks OK`);
