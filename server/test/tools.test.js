import test from "node:test";
import assert from "node:assert/strict";

process.env.ROFORGE_DATA_DIR = new URL("./tmp-data-tools", import.meta.url).pathname;
process.env.ROFORGE_SECRET = "unit-test-secret";
process.env.ROFORGE_SEARCH_PROVIDER = "wikipedia"; // force keyless path in tests
delete process.env.SERPER_API_KEY;
delete process.env.BRAVE_API_KEY;

const { fetchUrl } = await import("../src/tools/urlfetch.js");
const { listTools, getTool } = await import("../src/tools/registry.js");
const { webSearch } = await import("../src/tools/websearch.js");
const { htmlToText } = await import("../src/util.js");

test("url_fetch blocks loopback", async () => {
  await assert.rejects(() => fetchUrl("http://127.0.0.1:8787/health"), /private\/loopback/);
});

test("url_fetch blocks RFC1918", async () => {
  await assert.rejects(() => fetchUrl("http://10.0.0.1/"), /private\/loopback/);
  await assert.rejects(() => fetchUrl("http://192.168.1.1/"), /private\/loopback/);
});

test("url_fetch rejects non-http schemes", async () => {
  await assert.rejects(() => fetchUrl("ftp://example.com/x"), /http\/https/);
  await assert.rejects(() => fetchUrl("not a url"), /Invalid|http\/https|DNS/);
});

test("registry exposes schemas for every tool", () => {
  const tools = listTools();
  assert.ok(tools.length >= 5);
  for (const t of tools) {
    assert.ok(typeof t.name === "string" && t.name.length > 0);
    assert.ok(typeof t.description === "string" && t.description.length > 0);
    assert.equal(t.input_schema.type, "object");
    assert.ok(getTool(t.name), `getTool(${t.name})`);
  }
});

test("echo tool roundtrips", async () => {
  const out = await getTool("echo").execute({ text: "hello roforge" });
  assert.equal(out, "hello roforge");
});

test("roblox_game_lookup rejects bad args", async () => {
  await assert.rejects(() => getTool("roblox_game_lookup").execute({ universeId: "abc" }), /positive integer/);
});

test("htmlToText strips markup", () => {
  const out = htmlToText(`<html><head><style>x{}</style><script>evil()</script></head><body><p>Hello&nbsp;world</p><div>Line two</div></body></html>`);
  assert.ok(out.includes("Hello world"));
  assert.ok(out.includes("Line two"));
  assert.ok(!out.includes("evil"));
});

test("web_search keyless fallback (network)", { timeout: 20000 }, async (t) => {
  try {
    const out = await webSearch("Roblox Studio");
    assert.ok(typeof out === "string" && out.length > 0);
    // Either the keyless-fallback banner or an honest empty answer.
    assert.ok(out.includes("wikipedia") || out.includes("No results found."), out);
  } catch (e) {
    if (/fetch|network|ENOTFOUND|EAI_AGAIN/i.test(String(e.cause?.code || e.message))) t.skip("no network in sandbox");
    else throw e;
  }
});
