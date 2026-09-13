// LiveRegion: verified against a minimal terminal emulator that tracks the
// screen grid, cursor, and scrolling. If cursor math is wrong, these fail.
//
// The emulator starts at the top-left; the screen-bottom scroll case is
// exercised explicitly in its own test.
import test from "node:test";
import assert from "node:assert/strict";
import { LiveRegion, wrapSegments, ATTR } from "../src/tui/frame.js";

class FakeTerm {
  constructor(cols = 60, rows = 30) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => new Array(cols).fill(" "));
    this.x = 0;
    this.y = 0;
    this.scrolls = 0;
  }
  line(n) {
    return this.grid[n].join("").replace(/\s+$/, "");
  }
  _scroll() {
    this.grid.shift();
    this.grid.push(new Array(this.cols).fill(" "));
    this.y = this.rows - 1;
    this.scrolls++;
  }
  _advance() {
    this.x++;
    if (this.x >= this.cols) {
      this.x = 0;
      this.y++;
      if (this.y >= this.rows) this._scroll();
    }
  }
  write(s) {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "\x1b" && s[i + 1] === "[") {
        let j = i + 2;
        let params = "";
        while (j < s.length && /[0-9;]/.test(s[j])) {
          params += s[j];
          j++;
        }
        const letter = s[j];
        const n = parseInt(params || "1", 10) || 1;
        if (letter === "A") this.y = Math.max(0, this.y - n);
        else if (letter === "B") {
          this.y = Math.min(this.rows - 1, this.y + n);
        } else if (letter === "G") this.x = Math.max(0, n - 1);
        else if (letter === "K" && params === "2") for (let x = 0; x < this.cols; x++) this.grid[this.y][x] = " ";
        else if (letter === "K") for (let x = this.x; x < this.cols; x++) this.grid[this.y][x] = " ";
        i = j + 1;
        continue;
      }
      if (c === "\n") {
        this.x = 0;
        this.y++;
        if (this.y >= this.rows) this._scroll();
        i++;
        continue;
      }
      if (c === "\r") {
        this.x = 0;
        i++;
        continue;
      }
      this.grid[this.y][this.x] = c;
      this._advance();
      i++;
    }
  }
}

const t = (s, a) => ({ text: s, attr: a });
let stdoutCols = 60;
const origCols = Object.getOwnPropertyDescriptor(process.stdout, "columns");
Object.defineProperty(process.stdout, "columns", {
  configurable: true,
  get: () => stdoutCols,
});

function makeLive(term, opts = {}) {
  return new LiveRegion((s) => term.write(s), { maxRows: 6, enabled: true, ...opts });
}

test("frame: first render places content + status below the cursor", () => {
  const term = new FakeTerm();
  term.write("you> hello\n");
  const live = makeLive(term);
  live.begin();
  live.update([[t("thinking out loud…")]], [t("⠋ thinking…")]);
  assert.equal(term.line(1), "thinking out loud…");
  assert.equal(term.line(2), "⠋ thinking…");
  // cursor at end of status line
  assert.equal(term.y, 2);
  assert.equal(term.x, "⠋ thinking…".length);
});

test("frame: update rewrites in place, no flicker, history untouched", () => {
  const term = new FakeTerm();
  term.write("you> hello\n");
  const live = makeLive(term);
  live.begin();
  live.update([[t("partial")]], [t("⠋ thinking…")]);
  live.update([[t("partial line is now longer")]], [t("⠙ thinking…")]);
  assert.equal(term.line(0), "you> hello", "committed history intact");
  assert.equal(term.line(1), "partial line is now longer", "content line rewritten in place");
  assert.equal(term.line(2), "⠙ thinking…", "status line rewritten in place");
  assert.equal(term.y, 2, "cursor still at end of status line");
  // shorter line: no stale tail
  live.update([[t("short")]], [t("⠹ done")]);
  assert.equal(term.line(1), "short");
});

test("frame: long content appends; older lines commit above the status", () => {
  const term = new FakeTerm();
  term.write("you> go\n");
  const live = makeLive(term);
  live.begin();
  for (let i = 1; i <= 6; i++) {
    live.update(Array.from({ length: i }, (_, k) => [t("line " + (k + 1))]), [t("status")]);
  }
  // every line is preserved — the live region never clobbers committed text
  assert.equal(term.line(0), "you> go");
  for (let i = 1; i <= 6; i++) assert.equal(term.line(i), "line " + i);
  assert.equal(term.line(7), "status");
  assert.equal(term.y, 7, "cursor at end of the status line");
});

test("frame: partial last line grows in place without moving history", () => {
  const term = new FakeTerm();
  term.write("you> hi\n");
  const live = makeLive(term);
  live.begin();
  live.update([[t("Hel")]], [t("⠋ …")]);
  live.update([[t("Hello")]], [t("⠙ …")]);
  live.update([[t("Hello")], [t("wor")]], [t("⠹ …")]);
  live.update([[t("Hello")], [t("world!")]], [t("done 0.4s")]);
  assert.equal(term.line(0), "you> hi");
  assert.equal(term.line(1), "Hello");
  assert.equal(term.line(2), "world!");
  assert.equal(term.line(3), "done 0.4s");
  assert.equal(term.y, 3);
});

test("frame: release commits; next append lands below", () => {
  const term = new FakeTerm();
  term.write("banner\n");
  const live = makeLive(term, { maxRows: 4 });
  live.begin();
  live.update([[t("answer one")], [t("answer two")]], [t("↑10 ↓2 tok")]);
  live.end();
  term.write("> ");
  assert.equal(term.line(1), "answer one");
  assert.equal(term.line(2), "answer two");
  assert.equal(term.line(3), "↑10 ↓2 tok");
  assert.equal(term.line(4), ">", "prompt below the committed region");
});

test("frame: scroll at screen bottom keeps cursor invariant", () => {
  const term = new FakeTerm(40, 8);
  // fill all 8 lines; the 8th \n scrolls once, cursor back on the bottom line
  for (let i = 0; i < 8; i++) term.write("fill line " + i + "\n");
  assert.equal(term.y, 7, "cursor on the bottom line after fill");
  const live = makeLive(term, { maxRows: 3 });
  live.begin();
  live.update([[t("a")], [t("b")]], [t("s")]);
  // must have scrolled to make room; last lines = a/b/s
  assert.equal(term.line(5), "a");
  assert.equal(term.line(6), "b");
  assert.equal(term.line(7), "s");
  assert.equal(term.y, 7);
  live.update([[t("a")], [t("b")], [t("c")]], [t("s2")]);
  assert.equal(term.line(5), "b");
  assert.equal(term.line(6), "c");
  assert.equal(term.line(7), "s2");
});

test("frame: sameLine header flows into the first content line", () => {
  const term = new FakeTerm();
  term.write("you> hi\n");
  const live = makeLive(term);
  term.write("RoForge> ");
  live.begin({ sameLine: true });
  live.update([[t("Hello!")]], [t("⠋ thinking…")]);
  assert.equal(term.line(1), "RoForge> Hello!");
});

test("frame: eraseOnResize blanks the region", () => {
  const term = new FakeTerm();
  term.write("top\n");
  const live = makeLive(term, { maxRows: 4 });
  live.begin();
  live.update([[t("content")]], [t("status")]);
  live.eraseOnResize();
  assert.equal(term.line(1), "", "content line erased");
  assert.equal(term.line(2), "", "status line erased");
  // re-render lands back at the region top (in place)
  live.update([[t("fresh")]], [t("status2")]);
  assert.equal(term.line(1), "fresh");
  assert.equal(term.line(2), "status2");
});

test("frame: update after release is a no-op", () => {
  const term = new FakeTerm();
  const live = makeLive(term);
  live.begin();
  live.release();
  live.update([[t("nope")]], [t("s")]);
  assert.equal(term.line(0), "", "nothing written while inactive");
  assert.equal(term.y, 0);
});

test("wrapSegments: word-aware, keeps style per piece", () => {
  // space at the segment boundary is preserved across the wrap
  const lines = wrapSegments([{ text: "aa bb cc ", attr: ATTR.PLAIN }, { text: "dd", attr: ATTR.BOLD }], 6);
  assert.deepEqual(
    lines.map((l) => l.map((s) => s.text).join("")),
    ["aa bb", "cc dd"]
  );
  assert.equal(lines[1][1].attr, ATTR.BOLD);
  // single-segment text
  const one = wrapSegments([{ text: "one two three four", attr: 0 }], 7);
  assert.deepEqual(one.map((l) => l.map((s) => s.text).join("")), ["one two", "three", "four"]);
});

test("wrapSegments: long single word hard-breaks", () => {
  const lines = wrapSegments([{ text: "abcdefghij", attr: 0 }], 4);
  assert.deepEqual(lines.map((l) => l.map((s) => s.text).join("")), ["abcd", "efgh", "ij"]);
});
