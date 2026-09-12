import test from "node:test";
import assert from "node:assert/strict";

process.env.ROFORGE_DATA_DIR = new URL("./tmp-data-server", import.meta.url).pathname;
process.env.ROFORGE_SECRET = "unit-test-secret";
process.env.ROFORGE_SEARCH_PROVIDER = "wikipedia";
delete process.env.SERPER_API_KEY;
delete process.env.BRAVE_API_KEY;

const { startServer } = await import("../src/index.js");

test("server end-to-end", { timeout: 20000 }, async (t) => {
  const server = await startServer(0, "127.0.0.1");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((r) => server.close(r)));

  // health
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.service, "roforge");

  // info
  const info = await (await fetch(`${base}/v1/info`)).json();
  assert.ok(info.endpoints.includes("POST /v1/auth/login"));

  // unauthenticated access is rejected
  const noauth = await fetch(`${base}/v1/tools`);
  assert.equal(noauth.status, 401);

  // login
  const loginRes = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "tester", password: "testpass123" }),
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  assert.ok(token);

  const auth = { authorization: `Bearer ${token}` };

  // list tools
  const toolsRes = await fetch(`${base}/v1/tools`, { headers: auth });
  assert.equal(toolsRes.status, 200);
  const { tools } = await toolsRes.json();
  assert.ok(tools.some((x) => x.name === "web_search"));

  // execute a tool
  const echoRes = await fetch(`${base}/v1/tools/echo`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ args: { text: "ping from e2e" } }),
  });
  assert.equal(echoRes.status, 200);
  const echo = await echoRes.json();
  assert.equal(echo.result, "ping from e2e");

  // unknown tool
  const unknown = await fetch(`${base}/v1/tools/nope`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(unknown.status, 404);

  // SSRF block through the API
  const ssrf = await fetch(`${base}/v1/tools/url_fetch`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ args: { url: "http://127.0.0.1:1/" } }),
  });
  assert.equal(ssrf.status, 400);
  const ssrfBody = await ssrf.json();
  assert.equal(ssrfBody.code, "SSRF_BLOCKED");
});
