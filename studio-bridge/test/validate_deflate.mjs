// Validates the Deflate module: every emitted stream must inflate (Node zlib)
// to the exact original bytes; compressible cases must actually compress.
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import assert from "node:assert/strict";

const out = execFileSync(process.argv[2] || "/tmp/luau", ["test/deflate_test.lua"], {
  cwd: new URL("..", import.meta.url).pathname,
  maxBuffer: 64 * 1024 * 1024,
}).toString();

const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
assert.ok(lines.includes("DONE"), "missing DONE marker");

// cases where compression MUST win (structure-rich data)
const mustCompress = new Set(["A", "B", "D", "F", "G", "H", "H2"]);

let checked = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith("TIME ")) {
    const [, name, secs] = line.split(" ");
    console.log(`  ${name}: ${secs}s`);
    continue;
  }
  if (!line.startsWith("CASE ")) continue;
  const [, name, origLen, b64Stream, b64Orig] = line.split(" ");
  const orig = b64Orig ? Buffer.from(b64Orig, "base64") : Buffer.alloc(0);
  const stream = Buffer.from(b64Stream, "base64");
  assert.equal(orig.length, Number(origLen), `${name}: declared length matches`);

  // zlib header sanity
  assert.equal(stream[0], 0x78, `${name}: zlib header`);
  assert.ok((stream[0] * 256 + stream[1]) % 31 === 0, `${name}: FCHECK`);

  // byte-exact round trip
  const inflated = zlib.inflateSync(stream);
  assert.ok(inflated.equals(orig), `${name}: inflated bytes === original (${orig.length} bytes)`);
  checked++;

  const ratio = orig.length > 0 ? stream.length / orig.length : 1;
  if (mustCompress.has(name)) {
    assert.ok(stream.length < orig.length, `${name}: compressed (${stream.length}) < original (${orig.length})`);
  }
  console.log(`  ${name}: ${orig.length}B → ${stream.length}B (${ratio.toFixed(3)}x) OK`);
}

assert.equal(checked, 12, `expected 12 cases, got ${checked}`);
console.log(`DEFLATE: VALID (${checked} cases byte-exact, ${mustCompress.size} compression-checked)`);
