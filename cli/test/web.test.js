import test from "node:test";
import assert from "node:assert/strict";
import { fetchUrl, webSearch } from "../src/tools/web.js";
import { gameByUniverse } from "../src/tools/roblox.js";

test("url_fetch blocks loopback and private ranges", async () => {
  await assert.rejects(() => fetchUrl("http://127.0.0.1:8790/"), /private\/loopback/);
  await assert.rejects(() => fetchUrl("http://10.1.2.3/"), /private\/loopback/);
  await assert.rejects(() => fetchUrl("http://192.168.0.1/"), /private\/loopback/);
});

test("url_fetch rejects bad schemes", async () => {
  await assert.rejects(() => fetchUrl("ftp://x.com/"), /http\/https/);
  await assert.rejects(() => fetchUrl("not a url"), /Invalid|DNS|Blocked|http/);
});

test("web_search wikipedia fallback shape", { timeout: 20000 }, async (t) => {
  const cfg = { searchProvider: "wikipedia" };
  try {
    const out = await webSearch(cfg, "Roblox Studio");
    assert.ok(typeof out === "string" && out.length > 0);
    assert.ok(out.includes("wikipedia") || out.includes("No results found."));
  } catch (e) {
    if (/fetch|network|ENOTFOUND|EAI_AGAIN/i.test(String(e.cause?.code || e.message))) t.skip("no network in sandbox");
    else throw e;
  }
});

test("roblox game lookup validates args", async () => {
  await assert.rejects(() => gameByUniverse("abc"), /positive integer/);
});
