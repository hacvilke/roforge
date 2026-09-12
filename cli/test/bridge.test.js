import test from "node:test";
import assert from "node:assert/strict";
import { BridgeServer } from "../src/bridge/server.js";

async function withBridge(fn) {
  const bridge = new BridgeServer({ port: 0, token: "test-token", jobTimeoutMs: 2000 });
  await bridge.start();
  const base = `http://127.0.0.1:${bridge.port}`;
  try {
    await fn(bridge, base);
  } finally {
    bridge.stop();
  }
}

test("bridge: auth enforced", async () => {
  await withBridge(async (bridge, base) => {
    const noauth = await fetch(`${base}/v1/bridge/ping`);
    assert.equal(noauth.status, 401);
    const bad = await fetch(`${base}/v1/bridge/ping`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/v1/bridge/ping`, { headers: { authorization: "Bearer test-token" } });
    assert.equal(ok.status, 200);
    assert.equal(bridge.connected, true);
  });
});

test("bridge: job round-trip (submit → claim → result)", async () => {
  await withBridge(async (bridge, base) => {
    const auth = { authorization: "Bearer test-token" };
    // mark as seen (connected)
    await fetch(`${base}/v1/bridge/ping`, { headers: auth });

    const promise = bridge.submit("forge_read", { path: "ServerScriptService.Main" });

    // plugin polls → claims the job
    const poll = await (await fetch(`${base}/v1/bridge/jobs`, { headers: auth })).json();
    assert.equal(poll.jobs.length, 1);
    assert.equal(poll.jobs[0].tool, "forge_read");
    assert.deepEqual(poll.jobs[0].args, { path: "ServerScriptService.Main" });

    // second poll is empty (job claimed)
    const poll2 = await (await fetch(`${base}/v1/bridge/jobs`, { headers: auth })).json();
    assert.equal(poll2.jobs.length, 0);

    // plugin posts the result
    const jobId = poll.jobs[0].id;
    const post = await fetch(`${base}/v1/bridge/jobs/${jobId}/result`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ result: "-- local script source" }),
    });
    assert.equal(post.status, 200);

    const out = await promise;
    assert.deepEqual(out, { ok: true, result: "-- local script source" });
  });
});

test("bridge: submit while disconnected fails fast with guidance", async () => {
  await withBridge(async (bridge, base) => {
    const out = await bridge.submit("forge_read", {});
    assert.equal(out.ok, false);
    assert.ok(out.error.includes("not connected"));
  });
});

test("bridge: job timeout resolves with error", { timeout: 10000 }, async () => {
  await withBridge(async (bridge, base) => {
    const auth = { authorization: "Bearer test-token" };
    await fetch(`${base}/v1/bridge/ping`, { headers: auth });
    const promise = bridge.submit("forge_run", { code: "x" }, { timeoutMs: 300 });
    const poll = await (await fetch(`${base}/v1/bridge/jobs`, { headers: auth })).json(); // claim it
    assert.equal(poll.jobs.length, 1);
    const out = await promise; // never answered → timeout
    assert.equal(out.ok, false);
    assert.ok(out.error.includes("timed out"));
  });
});

test("bridge: vision result (structured, 5MB base64) round-trips past the old 4MB cap", {
  timeout: 15000,
}, async () => {
  await withBridge(async (bridge, base) => {
    const auth = { authorization: "Bearer test-token" };
    await fetch(`${base}/v1/bridge/ping`, { headers: auth });
    const promise = bridge.submit("forge_viewport", { width: 1024, height: 576 });

    const poll = await (await fetch(`${base}/v1/bridge/jobs`, { headers: auth })).json();
    assert.equal(poll.jobs.length, 1);
    assert.equal(poll.jobs[0].tool, "forge_viewport");

    // ~5MB base64 payload — exceeds the pre-vision 4MB body cap, within 16MB.
    const bigB64 = Buffer.from("x".repeat(2_500_000)).toString("base64"); // ~3.3MB
    const filler = bigB64.repeat(2); // ~6.6MB total to be safely over 4MB
    const post = await fetch(`${base}/v1/bridge/jobs/${poll.jobs[0].id}/result`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        result: { text: "Viewport captured.", imageBase64: filler, mediaType: "image/png" },
      }),
    });
    assert.equal(post.status, 200);

    const out = await promise;
    assert.equal(out.ok, true);
    assert.equal(out.result.text, "Viewport captured.");
    assert.equal(out.result.mediaType, "image/png");
    assert.equal(out.result.imageBase64.length, filler.length);
  });
});
