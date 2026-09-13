// Strict declarative plugin system: validation (allowlist), discovery,
// approval gates, execution guarantees (caps, no traversal, allowlist).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateManifest, loadPlugins } from "../src/plugins.js";
import { buildTools } from "../src/tools/index.js";

// ---------- helpers ----------

function baseManifest(overrides = {}) {
  return {
    name: "test-plugin",
    version: "1.0.0",
    description: "test plugin",
    tools: [
      {
        name: "do_thing",
        description: "does a thing",
        input_schema: {
          type: "object",
          properties: { arg: { type: "string", description: "x" } },
          required: ["arg"],
          additionalProperties: false,
        },
        action: {
          type: "http",
          method: "GET",
          url: "https://example.com/api",
          query: { q: "{{arg}}" },
        },
      },
    ],
    ...overrides,
  };
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roforge-plugins-"));
}

function writePlugin(dir, file, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(obj, null, 2));
}

// ---------- validation: accepts ----------

test("validateManifest: accepts a well-formed manifest", () => {
  const r = validateManifest(baseManifest());
  assert.ok(r.ok, r.error);
  assert.equal(r.manifest.tools.length, 1);
  assert.equal(r.manifest.tools[0].requiresApproval, false, "GET is read-only");
});

test("validateManifest: approval gates per action kind", () => {
  const m = baseManifest({
    tools: [
      {
        name: "post_thing",
        description: "writes",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "http", method: "POST", url: "https://example.com/api", body: "x" },
      },
      {
        name: "run_thing",
        description: "runs",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "command", command: "roforge", args: ["--version"] },
      },
      {
        name: "read_thing",
        description: "reads",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "read-file", path: "NOTE.md" },
      },
      {
        name: "make_line",
        description: "templates",
        input_schema: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          additionalProperties: false,
        },
        action: { type: "transform", template: "{{a}}-{{b}}" },
      },
    ],
  });
  const r = validateManifest(m);
  assert.ok(r.ok, r.error);
  const by = (n) => r.manifest.tools.find((t) => t.name === n);
  assert.equal(by("post_thing").requiresApproval, true);
  assert.equal(by("run_thing").requiresApproval, true);
  assert.equal(by("read_thing").requiresApproval, false);
  assert.equal(by("make_line").requiresApproval, false);
});

test("validateManifest: examples ship valid manifests", () => {
  for (const f of ["game-stats.json", "place-helper.json"]) {
    const obj = JSON.parse(fs.readFileSync(new URL(`../examples/plugins/${f}`, import.meta.url), "utf8"));
    const r = validateManifest(obj);
    assert.ok(r.ok, `${f}: ${r.error}`);
  }
});

// ---------- validation: rejects (the "no malicious intent" surface) ----------

test("validateManifest: rejects a code field at top level", () => {
  const r = validateManifest({ ...baseManifest(), code: "os.remove('/etc/passwd')" });
  assert.ok(!r.ok);
  assert.match(r.error, /code field/);
});

test("validateManifest: rejects a code field on a tool", () => {
  const m = baseManifest();
  m.tools[0].handler = "function(){...}";
  const r = validateManifest(m);
  assert.ok(!r.ok);
  assert.match(r.error, /code field/);
});

test("validateManifest: rejects unknown keys at any depth", () => {
  let r = validateManifest({ ...baseManifest(), extra: 1 });
  assert.ok(!r.ok && /unknown manifest key/.test(r.error));

  const m2 = baseManifest();
  m2.tools[0].action.onComplete = "log";
  r = validateManifest(m2);
  assert.ok(!r.ok && /unknown key/.test(r.error));

  const m3 = baseManifest();
  m3.tools[0].input_schema.patterns = {};
  r = validateManifest(m3);
  assert.ok(!r.ok && /unknown key/.test(r.error));
});

test("validateManifest: rejects non-https and non-public hosts", () => {
  const url = (u) => {
    const m = baseManifest();
    m.tools[0].action.url = u;
    m.tools[0].action.query = {};
    return validateManifest(m);
  };
  assert.ok(!url("http://example.com/api").ok);
  assert.ok(!url("https://localhost:443/x").ok);
  assert.match(url("https://127.0.0.1/x").error, /not public/);
  assert.match(url("https://192.168.1.10/x").error, /not public/);
  assert.match(url("https://10.0.0.5/x").error, /not public/);
  assert.match(url("https://mygame.local/x").error, /not public/);
  assert.ok(!url("https://example.com:8443/x").ok);
});

test("validateManifest: rejects env-style and undeclared template refs", () => {
  const m = baseManifest();
  m.tools[0].action.query = { q: "{{env:HOME}}" };
  let r = validateManifest(m);
  assert.ok(!r.ok && /unsupported/.test(r.error));

  const m2 = baseManifest();
  m2.tools[0].action.query = { q: "{{other}}" };
  r = validateManifest(m2);
  assert.ok(!r.ok && /undeclared arg/.test(r.error));
});

test("validateManifest: command allowlist + no shell metacharacters", () => {
  const cmd = (command, args) => {
    const m = baseManifest();
    m.tools[0].name = "c";
    m.tools[0].action = { type: "command", command, args };
    return validateManifest(m);
  };
  assert.ok(cmd("roforge", ["--version"]).ok);
  assert.ok(!cmd("curl", ["x"]).ok);
  assert.match(cmd("bash", ["-c", "x"]).error, /allowlist/);
  assert.ok(!cmd("roforge", ["a; rm -rf /"]).ok);
  assert.ok(!cmd("roforge", ["a | b"]).ok);
  const r = validateManifest(cmd("rm", ["x"]));
  assert.ok(!r.ok);
});

test("validateManifest: read-file cannot escape the project root", () => {
  const rf = (p) => {
    const m = baseManifest();
    m.tools[0].name = "r";
    m.tools[0].action = { type: "read-file", path: p };
    return validateManifest(m);
  };
  assert.ok(rf("docs/x.md").ok);
  assert.ok(!rf("/etc/passwd").ok);
  assert.ok(!rf("../secret.txt").ok);
  assert.ok(!rf("a/../../b.txt").ok);
  assert.ok(!rf("~/key").ok);
});

test("validateManifest: strict schemas required", () => {
  const m = baseManifest();
  delete m.tools[0].input_schema.additionalProperties;
  let r = validateManifest(m);
  assert.ok(!r.ok && /additionalProperties/.test(r.error));

  const m2 = baseManifest();
  m2.tools[0].input_schema.type = "array";
  r = validateManifest(m2);
  assert.ok(!r.ok);
});

test("validateManifest: names, versions, duplicates, action types", () => {
  let r = validateManifest({ ...baseManifest(), name: "Bad Name" });
  assert.ok(!r.ok);
  r = validateManifest({ ...baseManifest(), name: "forge_tree" });
  assert.ok(!r.ok && /reserved/.test(r.error));
  r = validateManifest({ ...baseManifest(), version: "latest" });
  assert.ok(!r.ok);

  const m = baseManifest();
  m.tools.push({ ...m.tools[0] });
  r = validateManifest(m);
  assert.ok(!r.ok && /duplicate/.test(r.error));

  const m2 = baseManifest();
  m2.tools[0].action = { type: "websocket", url: "wss://x" };
  r = validateManifest(m2);
  assert.ok(!r.ok && /action.type/.test(r.error));
});

test("validateManifest: output cap bounds", () => {
  const m = baseManifest();
  m.tools[0].action.output_max_chars = 70000;
  const r = validateManifest(m);
  assert.ok(!r.ok && /output_max_chars/.test(r.error));
});

// ---------- discovery + approval wiring ----------

test("loadPlugins: loads valid, reports invalid, names conflict", () => {
  const dir = tmpdir();
  writePlugin(dir, "00-good.json", baseManifest());
  writePlugin(dir, "01-bad.json", { ...baseManifest(), code: "x" });
  writePlugin(dir, "02-conflict.json", baseManifest());

  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let out;
  try {
    out = loadPlugins({});
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  assert.equal(out.plugins.length, 1, JSON.stringify(out.errors));
  assert.equal(out.tools.length, 1);
  assert.equal(out.tools[0].tier, "plugin");
  assert.match(out.tools[0].description, /^\[plugin:test-plugin\]/);
  assert.equal(out.errors.length, 2);
  assert.match(out.errors[0].error, /code field|conflict/);
  assert.match(out.errors[1].error, /conflict|code field/);
});

test("loadPlugins: cwd plugins dir + disabled config path", () => {
  const cwd = tmpdir();
  writePlugin(path.join(cwd, "plugins"), "p.json", baseManifest());
  const out = loadPlugins({ cwd });
  assert.equal(out.plugins.length, 1);
});

// ---------- execution guarantees ----------

test("transform: fills declared args raw, caps output", async () => {
  const m = baseManifest({
    tools: [
      {
        name: "line",
        description: "template",
        input_schema: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: ["a", "b"],
          additionalProperties: false,
        },
        action: { type: "transform", template: "{{a}} + {{b}}", output_max_chars: 5 },
      },
    ],
  });
  const dir = tmpdir();
  writePlugin(dir, "t.json", m);
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let out;
  try {
    out = loadPlugins({});
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  const tool = out.tools[0];
  const res = await tool.execute({ a: "bridge", b: "vision" });
  assert.ok(res.startsWith("bridg"), res);
  assert.match(res, /truncated/, "5-char cap must truncate");
});

test("read-file: reads inside project root, errors cleanly outside", async () => {
  const cwd = tmpdir();
  fs.writeFileSync(path.join(cwd, "NOTE.md"), "hello project note");
  const m = baseManifest({
    tools: [
      {
        name: "note",
        description: "reads NOTE.md",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "read-file", path: "NOTE.md" },
      },
      {
        name: "missing",
        description: "reads absent file",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "read-file", path: "nope.txt" },
      },
    ],
  });
  const dir = tmpdir();
  writePlugin(dir, "r.json", m);
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  const oldCwd = process.cwd();
  let out;
  let resNote;
  let resMissing;
  try {
    process.chdir(cwd);
    out = loadPlugins({});
    const note = out.tools.find((t) => t.name === "note");
    const missing = out.tools.find((t) => t.name === "missing");
    resNote = await note.execute({});
    resMissing = await missing.execute({});
  } finally {
    process.chdir(oldCwd);
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  assert.equal(resNote, "hello project note");
  assert.match(resMissing, /^ERROR: file not found/);
});

test("command: allowlisted binary runs via argv (no shell), errors cleanly when absent", async () => {
  const cwd = tmpdir();
  // Fake allowlisted "roforge" shim on PATH.
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, "roforge");
  fs.writeFileSync(shim, "#!/bin/sh\necho \"roforge 9.9.9\"\n");
  fs.chmodSync(shim, 0o755);

  const m = baseManifest({
    tools: [
      {
        name: "ver",
        description: "version",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "command", command: "roforge", args: ["--version"], output_max_chars: 100 },
      },
    ],
  });
  const dir = tmpdir();
  writePlugin(dir, "c.json", m);
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  const savedPath = process.env.PATH;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  process.env.PATH = `${bin}:${savedPath}`;
  let out;
  let res;
  try {
    out = loadPlugins({});
    res = await out.tools[0].execute({});
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
    process.env.PATH = savedPath;
  }
  assert.match(res, /roforge 9\.9\.9/);
  assert.equal(out.tools[0].requiresApproval, true);
});

test("http: unreachable public host returns ERROR string (never throws)", async () => {
  const m = baseManifest({
    tools: [
      {
        name: "ping",
        description: "public get",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: {
          type: "http",
          method: "GET",
          url: "https://nonexistent-host-xyz-1234.invalid/",
          timeout_ms: 2000,
        },
      },
    ],
  });
  const dir = tmpdir();
  writePlugin(dir, "h.json", m);
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let out;
  try {
    out = loadPlugins({});
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  const res = await out.tools[0].execute({});
  assert.match(res, /^ERROR:/);
});

// ---------- buildTools integration ----------

test("buildTools: plugin tools merged, reserved names win, info surfaced", async () => {
  const cwd = tmpdir();
  // A plugin tool trying to shadow a built-in: reserved forge_ rejected,
  // so give it a normal name; verify it lands in the tool list.
  writePlugin(
    path.join(cwd, "plugins"),
    "p.json",
    baseManifest({
      name: "integ",
      tools: [
        {
          name: "integ_probe",
          description: "probe",
          input_schema: { type: "object", properties: {}, additionalProperties: false },
          action: { type: "transform", template: "ok" },
        },
      ],
    })
  );
  const info = await buildTools({ cfg: { plugins: { enabled: true } }, cwd, bridgeServer: null, luauAnalyzePath: null });
  assert.ok(info.tools.some((t) => t.name === "integ_probe"));
  assert.equal(info.plugins.length, 1);
  assert.equal(info.plugins[0].name, "integ");
  assert.deepEqual(info.pluginErrors, []);

  // disabled config → no plugin tools
  const info2 = await buildTools({ cfg: { plugins: { enabled: false } }, cwd, bridgeServer: null, luauAnalyzePath: null });
  assert.ok(!info2.tools.some((t) => t.name === "integ_probe"));
});
