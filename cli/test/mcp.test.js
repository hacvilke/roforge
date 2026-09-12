import test from "node:test";
import assert from "node:assert/strict";
import { startMockMcp } from "./mock-server.js";
import { McpClient, probeMcp } from "../src/mcp.js";

test("mcp: connect + tools/list (SSE body) + tools/call", { timeout: 20000 }, async (t) => {
  const server = await startMockMcp();
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/mcp`;

  const client = new McpClient(url);
  const init = await client.connect();
  assert.equal(init.serverInfo.name, "mock-roblox-studio");
  assert.equal(client.sessionId, "mock-session-1");

  const tools = await client.listTools();
  assert.equal(tools.length, 3);
  assert.equal(tools[0].name, "get_descendants");

  const out = await client.callTool("set_script_source", { path: "ServerScriptService.Main" });
  assert.equal(out.isError, false);
  assert.ok(out.text.includes("mock-studio executed set_script_source OK"));
});

test("mcp: probeMcp ok + unreachable", { timeout: 20000 }, async (t) => {
  const server = await startMockMcp();
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const ok = await probeMcp(url);
  assert.equal(ok.ok, true);
  assert.equal(ok.toolCount, 3);

  const bad = await probeMcp("http://127.0.0.1:1/mcp");
  assert.equal(bad.ok, false);
  assert.ok(bad.error.length > 0);
});

test("mcp: studio tool wrapping + approval flag", { timeout: 20000 }, async (t) => {
  const server = await startMockMcp();
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const client = new McpClient(url);
  await client.connect();
  const raw = await client.listTools();

  const { mcpToolsFromList } = await import("../src/tools/studio.js");
  const tools = mcpToolsFromList(client, raw);
  assert.equal(tools[0].name, "studio_get_descendants");
  assert.equal(tools[1].name, "studio_set_script_source");
  assert.equal(tools[0].requiresApproval, false);
  assert.equal(tools[1].requiresApproval, true);

  const out = await tools[0].execute({});
  assert.equal(typeof out, "object", "mcp tools return structured {text, image?}");
  assert.ok(out.text.includes("mock-studio executed get_descendants OK"));
  assert.equal(out.image, undefined);
});
