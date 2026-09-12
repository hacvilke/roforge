// Validates the PNG produced by PngEncoder (run via png_test.lua):
// signature, chunk structure + CRCs, IHDR, zlib inflate, pixel content.
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import assert from "node:assert/strict";

const out = execFileSync(process.argv[2] || "/tmp/luau", ["test/png_test.lua"], {
  cwd: new URL("..", import.meta.url).pathname,
  maxBuffer: 16 * 1024 * 1024,
}).toString();
const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);

function take(afterTag) {
  const i = lines.findIndex((l) => l.startsWith(afterTag + " "));
  assert.notEqual(i, -1, `missing ${afterTag}`);
  return lines[i + 1];
}

function parsePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "signature");
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    const calc = zlib.crc32(buf.subarray(off + 4, off + 8 + len));
    assert.equal(crc, calc, `CRC mismatch in ${type}`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  assert.equal(off, buf.length, "trailing bytes");
  return chunks;
}

function expectPixels(chunks, W, H, pixelFn) {
  const ihdr = chunks.find((c) => c.type === "IHDR").data;
  assert.equal(ihdr.readUInt32BE(0), W);
  assert.equal(ihdr.readUInt32BE(4), H);
  assert.equal(ihdr.readUInt8(8), 8, "bit depth");
  assert.equal(ihdr.readUInt8(9), 6, "color type RGBA");
  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = zlib.inflateSync(idat); // stored blocks inflate fine
  assert.equal(raw.length, H * (1 + W * 4), "raw scanline size");
  for (let y = 0; y < H; y++) {
    const row = raw.subarray(y * (1 + W * 4));
    assert.equal(row[0], 0, "filter byte");
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = [row[1 + x * 4], row[2 + x * 4], row[3 + x * 4], row[4 + x * 4]];
      const [er, eg, eb, ea] = pixelFn(x, y);
      assert.equal(r, er); assert.equal(g, eg); assert.equal(b, eb); assert.equal(a, ea);
    }
  }
}

// main 4x2 image
const mainBuf = Buffer.from(take("SIZE"), "base64");
const mainChunks = parsePng(mainBuf);
assert.deepEqual(mainChunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"], "chunk order");
expectPixels(mainChunks, 4, 2, (x, y) => [(x * 40) % 256, (y * 128) % 256, ((x + y) * 60) % 256, 255]);

// 1x1 image
const oneBuf = Buffer.from(take("ONE"), "base64");
expectPixels(parsePng(oneBuf), 1, 1, () => [9, 8, 7, 255]);

console.log("PNG ENCODER: VALID (chunks, CRCs, zlib, pixels all verified)");
