// Pro CLI plumbing: queryProStatus against a real BridgeServer with a fake
// plugin, and renderProStatus output shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { BridgeServer } from "../src/bridge/server.js";
import { queryProStatus, renderProStatus, probeBridge, remoteSubmit } from "../src/pro.js";

const PRO_REPORT = [
  "RoForge Pro: PRO (active)",
  "Studio user: 424242",
  "Game Pass 111111: OWNED",
  "limits: export depth 10 · import 2500 nodes · viewport up to 1920x1080",
  "pro features: cloud snapshots=true team workspaces=true hosted MCP relay=true",
].join("\n");

const FREE_REPORT = [
  "RoForge Pro: FREE tier",
  "Studio user: 424242",
  "Game Pass 111111: not owned",
  "limits: export depth 6 · import 500 nodes · viewport up to 1280x720",
  "Unlock Pro: play the RoForge HQ experience and purchase the 'RoForge Pro' game pass (one-time).",
].join("\n");

// A fake Studio plugin: pings, claims forge_pro jobs, posts canned results.
// Starts the worker and waits for the bridge to report the plugin connected.
// Returns a stop function. The caller owns the bridge's lifecycle.
async function startFakePlugin(bridge, report) {
  const base = `http://127.0.0.1:${bridge.port}`;
  const auth = { authorization: `Bearer ${bridge.token}` };
  let stopped = false;
  const worker = (async () => {
    while (!stopped) {
      try {
        await fetch(`${base}/v1/bridge/ping`, { headers: auth });
        const poll = await (await fetch(`${base}/v1/bridge/jobs`, { headers: auth })).json();
        if (poll.jobs.length) {
          const job = poll.jobs[0];
          const result = job.tool === "forge_pro" ? report : "ERROR: unknown tool";
          await fetch(`${base}/v1/bridge/jobs/${job.id}/result`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ result }),
          });
        }
      } catch {
        /* bridge stopped */
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  const deadline = Date.now() + 3000;
  while (!bridge.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  return async () => {
    stopped = true;
    await worker;
  };
}

// Owns the bridge: starts a fake plugin, runs fn, then stops both.
async function withFakePlugin(bridge, report, fn) {
  const stopPlugin = await startFakePlugin(bridge, report);
  try {
    await fn();
  } finally {
    bridge.stop();
    await stopPlugin();
  }
}

test("pro: queryProStatus returns the forge_pro report from a connected bridge", async () => {
  const bridge = new BridgeServer({ port: 0, token: "pro-test-token" });
  await bridge.start();
  await withFakePlugin(bridge, PRO_REPORT, async () => {
    const res = await queryProStatus(bridge);
    assert.ok(!res.error, "no error");
    assert.equal(res.text, PRO_REPORT);
  });
});

test("pro: queryProStatus reports a helpful error when the bridge is down", async () => {
  const bridge = new BridgeServer({ port: 0, token: "t" });
  await bridge.start();
  const res = await queryProStatus(bridge);
  bridge.stop();
  assert.ok(res.error, "error expected");
  assert.match(res.error, /Studio bridge/i);
});

test("pro: renderProStatus styles the tier header and keeps the body", () => {
  const seen = [];
  const style = (name) => (s) => {
    seen.push(name);
    return `⟦${name}:${s}⟧`;
  };
  const out = renderProStatus({ text: PRO_REPORT }, {
    bold: style("bold"),
    dim: style("dim"),
    red: style("red"),
    green: style("green"),
    magenta: style("magenta"),
    yellow: style("yellow"),
  });
  assert.ok(out.includes("⟦green:RoForge Pro: PRO (active)⟧"), "PRO header green");
  assert.ok(out.includes("limits: export depth 10"), "limits line intact");
  assert.ok(!out.includes("Unlock Pro"), "pro report has no unlock hint");
});

test("pro: renderProStatus marks the free tier + unlock hint", () => {
  const out = renderProStatus({ text: FREE_REPORT }, { yellow: (s) => `[y]${s}[/y]`, magenta: (s) => `[m]${s}[/m]` });
  assert.ok(out.includes("[y]RoForge Pro: FREE tier[/y]"), "FREE header yellow");
  assert.ok(out.includes("[m]Unlock Pro:"), "unlock hint magenta");
});

test("pro: renderProStatus error path shows the connect steps", () => {
  const out = renderProStatus({ error: "No Studio bridge connection. blah" }, { red: (s) => `[r]${s}[/r]`, dim: (s) => `[d]${s}[/d]` });
  assert.ok(out.startsWith("[r]No Studio bridge"), "error in red");
  assert.ok(out.includes("roforge studio"), "points at roforge studio");
});

test("pro: probeBridge returns null when nothing is listening", async () => {
  const bridge = new BridgeServer({ port: 0, token: "t" });
  await bridge.start();
  const freePort = bridge.port;
  bridge.stop();
  assert.equal(await probeBridge(`http://127.0.0.1:${freePort}`), null);
});

test("pro: remoteSubmit enqueues on a running bridge and reads the result", async () => {
  const bridge = new BridgeServer({ port: 0, token: "attach-token" });
  await bridge.start();
  const stopPlugin = await startFakePlugin(bridge, PRO_REPORT);
  try {
    const out = await remoteSubmit(`http://127.0.0.1:${bridge.port}`, "attach-token", "forge_pro", {});
    assert.ok(out.ok, "no error");
    assert.equal(out.result, PRO_REPORT);
  } finally {
    bridge.stop();
    await stopPlugin();
  }
});

test("pro: queryProStatus attaches to a running bridge (no own bridge started)", async () => {
  const bridge = new BridgeServer({ port: 0, token: "attach-token" });
  await bridge.start();
  const stopPlugin = await startFakePlugin(bridge, FREE_REPORT);
  try {
    const health = await probeBridge(`http://127.0.0.1:${bridge.port}`);
    assert.ok(health, "bridge probed");
    assert.equal(health.connected, true, "plugin connected");
    const res = await queryProStatus(null, { port: bridge.port, token: "attach-token" });
    assert.ok(!res.error, "no error");
    assert.equal(res.text, FREE_REPORT);
  } finally {
    bridge.stop();
    await stopPlugin();
  }
});

test("pro: attach path fails fast when the bridge is up but Studio is not", async () => {
  const bridge = new BridgeServer({ port: 0, token: "t" });
  await bridge.start();
  try {
    const res = await queryProStatus(null, { port: bridge.port, token: "t", timeoutMs: 5000 });
    assert.ok(res.error, "error expected");
    assert.match(res.error, /Studio is not connected/i);
  } finally {
    bridge.stop();
  }
});

test("pro: attach path rejects a wrong token", async () => {
  const bridge = new BridgeServer({ port: 0, token: "right-token" });
  await bridge.start();
  const stopPlugin = await startFakePlugin(bridge, PRO_REPORT);
  try {
    const out = await remoteSubmit(`http://127.0.0.1:${bridge.port}`, "wrong-token", "forge_pro", {});
    assert.ok(!out.ok, "error expected");
    assert.match(out.error, /unauthorized|401/i);
  } finally {
    bridge.stop();
    await stopPlugin();
  }
});

test("bridge: local submit() still works alongside retained completed jobs", async () => {
  const bridge = new BridgeServer({ port: 0, token: "t", completedTtlMs: 400 });
  await bridge.start();
  const stopPlugin = await startFakePlugin(bridge, PRO_REPORT);
  try {
    const out = await bridge.submit("forge_pro", {});
    assert.ok(out.ok);
    // a second submit still claims fresh (the first job is "done", not pending)
    const out2 = await bridge.submit("forge_pro", {});
    assert.ok(out2.ok);
    assert.equal(out2.result, PRO_REPORT);
  } finally {
    bridge.stop();
    await stopPlugin();
  }
});
