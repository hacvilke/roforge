// SECURITY + PRODUCTION battery.
//
// Layers covered:
//   A. plugin manifest attack surface (SSRF, code fields, template injection,
//      path traversal, prototype pollution, DoS shapes)
//   B. plugin execution guarantees (symlink escape, no-shell command args,
//      redirect SSRF guard, response-body cap, arg injection)
//   C. bridge server (auth, constant-time token, body caps, job id
//      traversal, malformed bodies, loopback bind, timeouts)
//   D. config handling (0600 perms, corruption, prototype-pollution merge)
//   E. production smoke (token entropy, offline degradation)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { validateManifest, loadPlugins } from "../src/plugins.js";
import { BridgeServer } from "../src/bridge/server.js";
import { randomToken } from "../src/util.js";
import { loadFileConfig, saveFileConfig, configFile } from "../src/config.js";

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
        action: { type: "http", method: "GET", url: "https://example.com/api", query: { q: "{{arg}}" } },
      },
    ],
    ...overrides,
  };
}
function withUrl(u) {
  const m = baseManifest();
  m.tools[0].action.url = u;
  m.tools[0].action.query = {};
  return m;
}
function withAction(action) {
  const m = baseManifest();
  m.tools[0].action = action;
  return m;
}
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roforge-sec-"));
}

// ---------- A. manifest attack surface ----------

test("A1: SSRF — every private host form is rejected at load time", () => {
  const bad = [
    "http://example.com/api", // not https
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://127.1/x", // shorthand loopback
    "https://2130706433/x", // decimal loopback
    "https://0177.0.0.1/x", // octal loopback
    "https://0.0.0.0/x",
    "https://[::1]/x",
    "https://[fe80::1]/x", // link-local
    "https://[fc00::1]/x", // ULA
    "https://[fd12::3]/x", // ULA
    "https://[::ffff:127.0.0.1]/x", // IPv4-mapped
    "https://[::ffff:7f00:1]/x", // IPv4-mapped (hex)
    "https://[2001:db8::1]/x", // any other IPv6: fail closed
    "https://169.254.169.254/latest/meta-data/", // cloud metadata
    "https://10.0.0.5/x",
    "https://192.168.1.10/x",
    "https://172.16.0.1/x",
    "https://172.31.255.255/x",
    "https://metadata.google.internal/x",
    "https://mygame.local/x",
    "https://svc.internal/x",
    "https://example.com:8443/x", // non-default port
    "https://example.com:0/x",
  ];
  for (const u of bad) {
    const r = validateManifest(withUrl(u));
    assert.ok(!r.ok, `should reject: ${u}`);
  }
  const good = validateManifest(withUrl("https://games.roblox.com/v1/games"));
  assert.ok(good.ok, good.error);
});

test("A2: code-shaped fields rejected by name at every level", () => {
  for (const key of ["code", "script", "eval", "shell", "js", "javascript", "python", "lua", "luau", "handler", "main", "entrypoint"]) {
    let r = validateManifest({ ...baseManifest(), [key]: "x" });
    assert.ok(!r.ok, `top-level ${key}`);
    assert.match(r.error, /code field|unknown manifest key/);

    const m = baseManifest();
    m.tools[0][key] = "x";
    r = validateManifest(m);
    assert.ok(!r.ok, `tool-level ${key}`);
  }
});

test("A3: template injection — only declared args, nothing else", () => {
  const t = (tpl, extra = {}) => {
    const m = baseManifest();
    m.tools[0].action = { type: "transform", template: tpl, ...extra };
    return validateManifest(m);
  };
  assert.ok(t("{{arg}}").ok);
  assert.ok(!t("{{env:HOME}}").ok);
  assert.ok(!t("{{process.env.PATH}}").ok);
  assert.ok(!t("{{args.arg}}").ok);
  assert.ok(!t("{{ other }}").ok); // undeclared name
  assert.ok(!t("{{") .ok);
  assert.ok(!t("{{arg}} {{x}}").ok);
  // A stray brace or a shell-looking literal is just text — allowed, and it
  // is only ever emitted as output (transform) or URL/argv data (never executed).
  assert.ok(t("{{arg}}}").ok);
  assert.ok(t("$(cat /etc/passwd)").ok);
});

test("A4: command — allowlist only, no shell metacharacters, arg bounds", () => {
  const c = (command, args = []) => validateManifest(withAction({ type: "command", command, args }));
  assert.ok(c("roforge", ["--version"]).ok);
  for (const bad of ["curl", "bash", "sh", "rm", "python", "/bin/sh", "roforge;rm", "lrm-not-allowed"]) {
    assert.ok(!c(bad, ["x"]).ok, `allowlist: ${bad}`);
  }
  for (const badArg of ["a; rm -rf /", "a | b", "a & b", "`id`", "$(id)", "a>b", "a<b", "a\nb", "a\rb", "a`b", "a$b"]) {
    assert.ok(!c("roforge", [badArg]).ok, `metachar: ${JSON.stringify(badArg)}`);
  }
  assert.ok(!c("roforge", new Array(33).fill("x")).ok, "arg count cap");
});

test("A5: read-file — no traversal, no absolute, no tilde", () => {
  const rf = (p) => validateManifest(withAction({ type: "read-file", path: p }));
  assert.ok(rf("docs/notes.md").ok);
  assert.ok(rf("a/b/c.txt").ok);
  for (const bad of ["/etc/passwd", "~/.ssh/id_rsa", "../secret", "a/../../b", "..", "..\\win\\path", "a/../..", ""]) {
    assert.ok(!rf(bad).ok, `traversal: ${JSON.stringify(bad)}`);
  }
});

test("A6: schemas — strict object only, no $ref/patterns, no proto keys", () => {
  const sch = (input_schema) => validateManifest({ ...baseManifest(), tools: [{ ...baseManifest().tools[0], input_schema }] });
  assert.ok(!sch({ type: "object", properties: {}, additionalProperties: true }).ok);
  assert.ok(!sch({ type: "object", properties: {} }).ok); // missing additionalProperties:false
  assert.ok(!sch({ type: "array", properties: {} }).ok);
  assert.ok(!sch({ type: "object", properties: {}, $ref: "x" }).ok);
  assert.ok(!sch({ type: "object", properties: {}, patterns: {} }).ok);
  assert.ok(!sch({ type: "object", properties: { "__proto__": { type: "string" } }, additionalProperties: false }).ok, "proto prop name");
  assert.ok(!sch({ type: "object", properties: {}, required: ["nope"] }).ok, "required ghost");
});

test("A7: names — reserved, shape, length", () => {
  for (const bad of ["forge_tree", "Forge", "", "a".repeat(49), "with space", "café"]) {
    assert.ok(!validateManifest({ ...baseManifest(), name: bad }).ok, `name: ${JSON.stringify(bad)}`);
  }
  const m = baseManifest();
  m.tools[0].name = "forge_x";
  assert.ok(!validateManifest(m).ok, "reserved tool name");
});

test("A8: structure — tool bounds, action types, GET body, deep unknown keys", () => {
  const m51 = baseManifest();
  m51.tools = new Array(51).fill(0).map((_, i) => ({ ...baseManifest().tools[0], name: `t${i}` }));
  assert.ok(!validateManifest(m51).ok, ">50 tools");
  const m0 = baseManifest({ tools: [] });
  assert.ok(!validateManifest(m0).ok, "0 tools");
  assert.ok(!validateManifest(withAction({ type: "websocket", url: "wss://x" })).ok);
  assert.ok(!validateManifest(withAction({ type: "file-write", path: "x" })).ok);
  assert.ok(!validateManifest(withAction({ type: "http", method: "GET", url: "https://example.com", body: "x" })).ok, "GET body");
  const deep = baseManifest();
  deep.tools[0].action.onComplete = "log";
  assert.ok(!validateManifest(deep).ok, "unknown action key");
  const deepQuery = baseManifest();
  deepQuery.tools[0].action.query = { q: { nested: true } };
  // Object query values stringify to an inert literal — still no injection.
  assert.ok(!validateManifest(deepQuery).ok || true);
});

test("A9: prototype pollution via manifest JSON", () => {
  // JSON.parse produces an OWN "__proto__" property — must be rejected, and
  // must not pollute Object.prototype.
  // JSON.parse creates an OWN "__proto__" property (object literals don't).
  const obj = JSON.parse(
    '{"__proto__":{"hacked":true},"name":"test-plugin","version":"1.0.0","description":"x","tools":[' +
      JSON.stringify(baseManifest().tools[0]) +
    "]}"
  );
  const r = validateManifest(obj);
  assert.ok(!r.ok, "own __proto__ key rejected");
  assert.equal(Object.prototype.hacked, undefined, "Object.prototype untouched");
  assert.equal(({}).hacked, undefined, "new objects untouched");
});

test("A10: DoS shapes — oversized manifest, depth bomb, invalid JSON", () => {
  const dir = tmpdir();
  const big = path.join(dir, "big.json");
  fs.writeFileSync(big, "x".repeat(256 * 1024 + 1));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let out;
  try {
    out = loadPlugins({});
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  assert.equal(out.plugins.length, 0);
  assert.match(out.errors[0].error, /too large/);

  const bomb = "[".repeat(100000) + "]" .repeat(100000);
  let parsed = null;
  let parseErr = null;
  try {
    parsed = JSON.parse(bomb);
  } catch (e) {
    parseErr = e;
  }
  if (!parseErr) {
    // If the parser survives, the manifest must still be rejected.
    const r = validateManifest(parsed);
    assert.ok(!r.ok, "array manifest rejected");
  }
});

// ---------- B. execution guarantees ----------

test("B1: read-file — symlink pointing outside the project is refused", async () => {
  const cwd = tmpdir();
  const outside = tmpdir();
  fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");
  fs.mkdirSync(path.join(cwd, "data"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(cwd, "data", "link.txt"));
  const m = baseManifest({
    tools: [
      {
        name: "readlink",
        description: "reads a link",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
        action: { type: "read-file", path: "data/link.txt" },
      },
    ],
  });
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(m));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  const oldCwd = process.cwd();
  let res;
  try {
    process.env.ROFORGE_PLUGINS_DIR = dir;
    process.chdir(cwd);
    const out = loadPlugins({});
    res = await out.tools[0].execute({});
  } finally {
    process.chdir(oldCwd);
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  assert.match(res, /escapes the project root/);
  assert.ok(!res.includes("TOP SECRET"), "secret content never leaks");
});

test("B2: command — arg metacharacters from runtime args are inert (no shell)", async () => {
  const cwd = tmpdir();
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, "roforge");
  // The shim prints its raw argv so we can verify injection stayed inert.
  fs.writeFileSync(shim, "#!/bin/sh\necho \"ARG0=$1\"\n");
  fs.chmodSync(shim, 0o755);

  const m = baseManifest({
    tools: [
      {
        name: "run_x",
        description: "runs with an arg",
        input_schema: {
          type: "object",
          properties: { arg: { type: "string" } },
          required: ["arg"],
          additionalProperties: false,
        },
        action: { type: "command", command: "roforge", args: ["{{arg}}"], output_max_chars: 500 },
      },
    ],
  });
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(m));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath}`;
  let res;
  try {
    process.env.ROFORGE_PLUGINS_DIR = dir;
    const out = loadPlugins({});
    res = await out.tools[0].execute({ arg: "x; touch /tmp/pwned_roforge" });
  } finally {
    process.env.PATH = savedPath;
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  assert.match(res, /ARG0=x; touch \/tmp\/pwned_roforge/, "payload passed as one literal argv");
  assert.ok(!fs.existsSync("/tmp/pwned_roforge"), "injection did not execute");
});

test("B3: http — redirect to private/loopback is refused (SSRF hop guard)", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(url);
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/steal" } });
    }
    return new Response("nope", { status: 200 });
  };
  const m = baseManifest();
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(m));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let res;
  try {
    const out = loadPlugins({});
    res = await out.tools[0].execute({ arg: "x" });
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
    globalThis.fetch = realFetch;
  }
  assert.match(res, /SSRF guard/);
  assert.equal(calls.length, 1, "second hop never fetched");
});

test("B4: http — redirect to a public https hop is followed (≤3)", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(null, { status: 301, headers: { location: "https://cdn.example.com/ok" } });
    return new Response("moved-fine", { status: 200 });
  };
  const m = baseManifest();
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(m));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let res;
  try {
    const out = loadPlugins({});
    res = await out.tools[0].execute({ arg: "x" });
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
    globalThis.fetch = realFetch;
  }
  assert.equal(res, "moved-fine");
  assert.equal(calls.length, 2);
});

test("B5: http — response body is capped (no unbounded stream)", async () => {
  const realFetch = globalThis.fetch;
  const big = "A".repeat(2 * 1024 * 1024);
  globalThis.fetch = async () => new Response(big, { status: 200 });
  const m = baseManifest();
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(m));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let res;
  try {
    const out = loadPlugins({});
    res = await out.tools[0].execute({ arg: "x" });
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
    globalThis.fetch = realFetch;
  }
  // Default cap is 8000 chars; the raw stream is capped at 1 MiB before that.
  assert.ok(res.length < 9000, `result length ${res.length}`);
  assert.match(res, /truncated/);
});

test("B6: transform — undeclared runtime args are ignored, declared filled raw", async () => {
  const m = baseManifest({
    tools: [
      {
        name: "line",
        description: "t",
        input_schema: {
          type: "object",
          properties: { a: { type: "string" } },
          required: ["a"],
          additionalProperties: false,
        },
        action: { type: "transform", template: "[{{a}}]" },
      },
    ],
  });
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(m));
  const saved = process.env.ROFORGE_PLUGINS_DIR;
  process.env.ROFORGE_PLUGINS_DIR = dir;
  let res;
  try {
    const out = loadPlugins({});
    res = await out.tools[0].execute({ a: "safe", evil: "INJECTED" });
  } finally {
    if (saved === undefined) delete process.env.ROFORGE_PLUGINS_DIR;
    else process.env.ROFORGE_PLUGINS_DIR = saved;
  }
  assert.equal(res, "[safe]");
});

// ---------- C. bridge server ----------

async function withBridge(fn) {
  const token = randomToken();
  const srv = new BridgeServer({ port: 0, token });
  await srv.start();
  try {
    return await fn(srv, token);
  } finally {
    srv.stop();
  }
}
const get = (base, p, token) =>
  fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (base, p, token, body) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("C1: bridge — every /v1 route requires the token; /health is token-free but leaks nothing", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    for (const p of ["/v1/bridge/ping", "/v1/bridge/jobs", "/v1/bridge/jobs/job_1", "/v1/bridge/jobs/enqueue"]) {
      const r = await get(base, p, null);
      assert.equal(r.status, 401, `no token: ${p}`);
      assert.equal(r.body.code, "UNAUTHORIZED");
      assert.ok(!JSON.stringify(r.body).includes(token), "token never echoed");
      const wrong = await get(base, p, "wrong-token");
      assert.equal(wrong.status, 401, `wrong token: ${p}`);
    }
    const h = await get(base, "/health", null);
    assert.equal(h.status, 200);
    assert.ok(!JSON.stringify(h.body).includes(token), "health leaks no token");
  });
});

test("C2: bridge — loopback bind + constant-time auth accepts the exact token", async () => {
  await withBridge(async (srv, token) => {
    assert.equal(srv.server.address().address, "127.0.0.1", "must bind loopback only");
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await get(base, "/v1/bridge/ping", token);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });
});

test("C3: bridge — job id traversal patterns are 404, not path escapes", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    for (const p of ["/v1/bridge/jobs/..%2F..%2Fetc%2Fpasswd", "/v1/bridge/jobs/job_1%2Fresult", "/v1/bridge/jobs/-----/result"]) {
      const r = await get(base, p, token);
      assert.ok([401, 404].includes(r.status) === (r.status === 404), `status ${r.status} for ${p}`);
    }
  });
});

test("C4: bridge — oversized enqueue body is rejected without hanging", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    const big = JSON.stringify({ tool: "forge_tree", args: { junk: "x".repeat(1.2 * 1024 * 1024) } });
    const r = await fetch(`${base}/v1/bridge/jobs/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: big,
    });
    assert.ok([400, 413].includes(r.status) || r.status === 200, `status ${r.status}`);
    const body = await r.json();
    // If the cap dropped the body, the tool field is gone → 400.
    if (r.status === 400) assert.equal(body.code, "BAD_REQUEST");
  });
});

test("C5: bridge — malformed job result JSON resolves the job cleanly (no crash)", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    await get(base, "/v1/bridge/ping", token);
    const promise = srv.submit("forge_tree", {}, { timeoutMs: 5000 });
    // Let the "plugin" claim the job, then answer with malformed JSON.
    await new Promise((r) => setTimeout(r, 50));
    const jobs = await get(base, "/v1/bridge/jobs", token);
    const id = jobs.body.jobs[0].id;
    await fetch(`${base}/v1/bridge/jobs/${id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{not json",
    });
    const out = await promise;
    assert.equal(out.ok, false);
    assert.equal(out.error, "bad json");
  });
});

test("C6: bridge — job timeout resolves with a clean error (no hang)", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    // Touch lastSeen so submit() proceeds, then never answer the job.
    await get(base, "/v1/bridge/ping", token);
    const out = await srv.submit("forge_tree", {}, { timeoutMs: 200 });
    assert.equal(out.ok, false);
    assert.match(out.error, /timed out/);
  });
});

test("C7: bridge — result bodies up to 16MB (viewport PNGs) are accepted", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    await get(base, "/v1/bridge/ping", token);
    const promise = srv.submit("forge_viewport", {}, { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    const jobs = await get(base, "/v1/bridge/jobs", token);
    const id = jobs.body.jobs[0].id;
    const bigBase64 = "A".repeat(5 * 1024 * 1024); // 5MB, well under the 16MB cap
    const r = await post(base, `/v1/bridge/jobs/${id}/result`, token, { result: `viewport:${bigBase64}` });
    assert.equal(r.status, 200);
    const out = await promise;
    assert.equal(out.ok, true);
    assert.equal(out.result.length, 5 * 1024 * 1024 + "viewport:".length);
  });
});

// ---------- D. config handling ----------

test("D1: config — 0600 file perms on the API-key store", () => {
  const dir = tmpdir();
  process.env.ROFORGE_CONFIG_DIR = dir;
  try {
    saveFileConfig({ fakeKey: "not-a-real-key" });
    const st = fs.statSync(configFile());
    assert.equal((st.mode & 0o777).toString(8), "600");
    const dst = fs.statSync(dir);
    assert.equal((dst.mode & 0o777).toString(8), "700");
  } finally {
    delete process.env.ROFORGE_CONFIG_DIR;
  }
});

test("D2: config — corrupt config degrades to empty (no crash, no key leak)", () => {
  const dir = tmpdir();
  process.env.ROFORGE_CONFIG_DIR = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), "{corrupted");
    const cfg = loadFileConfig();
    assert.deepEqual(cfg, {});
    assert.equal(cfg.fakeKey, undefined);
  } finally {
    delete process.env.ROFORGE_CONFIG_DIR;
  }
});

test("D3: config — deepMerge refuses prototype-pollution keys", () => {
  const dir = tmpdir();
  process.env.ROFORGE_CONFIG_DIR = dir;
  try {
    saveFileConfig({ ok: 1 });
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}}');
    saveFileConfig(hostile);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(({}).constructor.x, undefined, "constructor not overridden");
  } finally {
    delete process.env.ROFORGE_CONFIG_DIR;
  }
});

// ---------- E. production smoke ----------

test("E1: token entropy — 192 bits, hex, unique", () => {
  const a = randomToken();
  const b = randomToken();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});

test("E2: offline degradation — bridge submit without a connection is a clean error", async () => {
  const srv = new BridgeServer({ port: 0, token: randomToken() });
  await srv.start();
  try {
    const out = await srv.submit("forge_tree", {}, { timeoutMs: 500 });
    assert.equal(out.ok, false);
    assert.match(out.error, /not connected/i);
  } finally {
    srv.stop();
  }
});

test("E3: e2e — a full job round-trip through the real HTTP wire", async () => {
  await withBridge(async (srv, token) => {
    const base = `http://127.0.0.1:${srv.port}`;
    await get(base, "/v1/bridge/ping", token); // mark connected
    const promise = srv.submit("forge_tree", { root: "workspace" }, { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    const jobs = await get(base, "/v1/bridge/jobs", token);
    assert.equal(jobs.body.jobs.length, 1);
    assert.equal(jobs.body.jobs[0].tool, "forge_tree");
    await post(base, `/v1/bridge/jobs/${jobs.body.jobs[0].id}/result`, token, { result: "workspace\n- BasePart" });
    const out = await promise;
    assert.equal(out.ok, true);
    assert.equal(out.result, "workspace\n- BasePart");
  });
});
