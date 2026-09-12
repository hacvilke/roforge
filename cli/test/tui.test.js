// TUI primitives: streaming markdown renderer + --no-color handling.
import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownStream } from "../src/tui/markdown.js";
import { TUI } from "../src/tui/tui.js";
import * as ansi from "../src/tui/ansi.js";

// strip ANSI escapes so assertions hold whether or not color is enabled
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("markdown: headings, bold, inline code", () => {
  const m = new MarkdownStream();
  const out = strip(m.push("# Setup\n\nUse **forge_checkpoint** before edits; run `forge_undo` to revert.\n") + m.finish());
  assert.match(out, /# Setup/);
  assert.match(out, /Setup\n/);
  assert.ok(out.includes("forge_checkpoint"), "bold text kept");
  assert.ok(!out.includes("**"), "no raw ** markers left");
});

test("markdown: bullets and numbered lists", () => {
  const m = new MarkdownStream();
  const out = m.push("- first\n- second\n\n1. step one\n2. step two\n") + m.finish();
  assert.match(out, /•/);
  assert.ok(out.includes("first"));
  assert.ok(out.match(/1\./) && out.includes("step one"));
  assert.ok(!out.match(/^\s*-/m), "raw dash bullets replaced");
});

test("markdown: code fences render dim + state persists across deltas", () => {
  const m = new MarkdownStream();
  let out = "";
  out += m.push("here is code:\n```lua\n");
  out += m.push("local x = 1\n");
  out += m.push("print(x)\n```\n");
  out += m.push("after the fence\n");
  out += m.finish();
  out = strip(out);
  // the code lines are indented; "after the fence" is plain
  assert.match(out, /^\s+local x = 1/m);
  assert.match(out, /after the fence/);
  assert.equal(m.inFence, false, "fence closed");
});

test("markdown: fence state survives mid-line deltas; unclosed fence flushes", () => {
  const m = new MarkdownStream();
  let out = "";
  out += m.push("```py\npr");
  out += m.push("int('hi')\n");
  out += m.finish(); // fence never closed — finish flushes remaining code line
  assert.match(strip(out), /print\('hi'\)/);
  assert.equal(m.buf, "");
});

test("markdown: blockquotes and rules", () => {
  const m = new MarkdownStream();
  const out = strip(m.push("> a note\n\n---\n") + m.finish());
  assert.match(out, /│ a note/);
  assert.match(out, /─{10,}/);
});

test("expandable tool output: /out lists and shows full results", () => {
  const writes = [];
  const ui = new TUI({ tools: [] }, { out: { write: (s) => writes.push(String(s)) } });
  const tool = { name: "forge_find" };
  ui.onToolStart(tool, { pattern: "car" });
  ui.onToolEnd(tool, {}, "found 3 instance(s)\n  workspace.Car.Part\n  workspace.Car.Wheel");
  ui.onToolStart(tool, { pattern: "tree" });
  ui.onToolEnd(tool, {}, "no instances matched (pattern='tree', class='')");
  const all = () => writes.join("");

  assert.match(all(), /⚙ \[1\] forge_find/);
  assert.match(all(), /⚙ \[2\] forge_find/);
  assert.match(all(), /↳ found 3 instance\(s\)/);
  assert.match(all(), /more: \/out 1/, "multi-line result gets an expand hint");
  assert.ok(!/more: \/out 2/.test(all()), "single-line result has no hint");

  ui._slash("/out 1");
  assert.ok(all().includes("workspace.Car.Part"), "/out 1 shows the full output");
  assert.ok(all().includes("workspace.Car.Wheel"));

  ui._slash("/out");
  const tail = all().slice(all().indexOf("[1] forge_find"));
  assert.match(tail, /\[2\] forge_find — 1 line/);

  ui._slash("/out 99");
  assert.match(all(), /no tool call #99/);
});

test("no-color: --no-color flag and env vars strip ANSI", (t) => {
  t.after(() => {
    delete process.argv.noColorBackup;
    const i = process.argv.indexOf("--no-color");
    if (i !== -1) process.argv.splice(i, 1);
    delete process.env.ROFORGE_NO_COLOR;
    delete process.env.NO_COLOR;
  });

  assert.match(ansi.bold("x"), /\x1b\[1m/);
  process.argv.push("--no-color");
  assert.equal(ansi.bold("x"), "x");
  process.argv.splice(process.argv.indexOf("--no-color"), 1);
  process.env.ROFORGE_NO_COLOR = "1";
  assert.equal(ansi.red("y"), "y");
  delete process.env.ROFORGE_NO_COLOR;
  process.env.NO_COLOR = "1";
  assert.equal(ansi.green("z"), "z");
  delete process.env.NO_COLOR;
  assert.match(ansi.bold("w"), /\x1b\[1m/);
});
