// Vision via the MCP tier: Studio's built-in MCP server can return image
// content from capture/screenshot tools — the CLI must surface that image to
// the model's vision channel, exactly like the bridge's forge_viewport.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpClient } from "../src/mcp.js";
import { mcpToolsFromList, mcpCaptureNames, looksLikeCapture, bridgeTools } from "../src/tools/studio.js";
import { runAgent } from "../src/agent.js";
import * as Anthropic from "../src/providers/anthropic.js";
import { startMockMcp } from "./mock-server.js";

const PIXEL_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("mcp callTool: extracts image content blocks", async () => {
  const server = await startMockMcp();
  const client = new McpClient(`http://127.0.0.1:${server.address().port}/mcp`);
  await client.connect();
  const out = await client.callTool("capture_screenshot", {});
  assert.equal(out.isError, false);
  assert.equal(out.image.base64, PIXEL_1X1);
  assert.equal(out.image.mediaType, "image/png");
  assert.match(out.text, /screenshot captured/);
  const plain = await client.callTool("get_descendants", {});
  assert.equal(plain.image, undefined);
  server.close();
});

test("mcp tools: capture tools get a vision description + structured image result", async () => {
  const server = await startMockMcp();
  const client = new McpClient(`http://127.0.0.1:${server.address().port}/mcp`);
  await client.connect();
  const raw = await client.listTools();
  assert.deepEqual(mcpCaptureNames(raw), ["capture_screenshot"]);

  const tools = mcpToolsFromList(client, raw);
  const cap = tools.find((t) => t.name === "studio_capture_screenshot");
  assert.ok(cap, "wrapped capture tool exists");
  assert.match(cap.description, /SEE \(vision\)/);
  assert.equal(cap.requiresApproval, false, "capture is read-only");
  const r = await cap.execute({});
  assert.equal(typeof r, "object");
  assert.equal(r.image.base64, PIXEL_1X1);

  // non-capture tool still works and returns a structured {text}
  const plain = await tools.find((t) => t.name === "studio_get_descendants").execute({});
  assert.match(plain.text, /mock-studio executed get_descendants OK/);
  assert.equal(plain.image, undefined);
  server.close();
});

test("looksLikeCapture: name and description heuristics", () => {
  assert.ok(looksLikeCapture({ name: "screenshot", description: "" }));
  assert.ok(looksLikeCapture({ name: "get_scene_image", description: "" }));
  assert.ok(looksLikeCapture({ name: "do_thing", description: "Returns an image of the 3D viewport" }));
  assert.ok(!looksLikeCapture({ name: "get_descendants", description: "List instances" }));
  assert.ok(!looksLikeCapture({ name: "set_script_source", description: "Write a script" }));
});

// Recording Anthropic mock (same shape as vision.test.js) — proves the MCP
// image rides the same vision contract into the model request.
async function startRecordingAnthropic(toolName) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/messages") {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      bodies.push(body);
      const sse = (events) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        let out = "";
        for (const [event, data] of events) out += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.end(out);
      };
      const hasToolResult = (body.messages || []).some(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")
      );
      if (hasToolResult) {
        sse([
          ["message_start", { type: "message_start", message: { usage: { input_tokens: 20 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I can see it." } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } }],
          ["message_stop", { type: "message_stop" }],
        ]);
      } else {
        sse([
          ["message_start", { type: "message_start", message: { usage: { input_tokens: 10 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_mcp_1", name: toolName, input: {} } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }],
          ["message_stop", { type: "message_stop" }],
        ]);
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, bodies, port: server.address().port };
}

test("agent: MCP-tier image reaches the Anthropic request body (full loop)", { timeout: 20000 }, async (t) => {
  const mcp = await startMockMcp();
  const mock = await startRecordingAnthropic("studio_capture_screenshot");
  t.after(() => {
    mcp.close();
    mock.server.close();
  });
  const client = new McpClient(`http://127.0.0.1:${mcp.address().port}/mcp`);
  await client.connect();
  const tools = mcpToolsFromList(client, await client.listTools());

  const cfg = {
    provider: "anthropic",
    anthropicKey: "test-key",
    anthropicBaseUrl: `http://127.0.0.1:${mock.port}`,
    _activeModel: "claude-sonnet-4-5",
    maxTokens: 100,
    maxIterations: 4,
  };
  const history = [];
  const out = await runAgent(cfg, Anthropic, history, "system", tools, {
    shouldAbort: () => false,
    approve: () => true,
  });
  assert.equal(out.ok, true);
  assert.ok(mock.bodies.length >= 2, "two model requests");
  const toolItem = history.find((h) => h.role === "tool");
  assert.ok(toolItem.image, "history tool item carries the image");
  assert.equal(toolItem.image.base64, PIXEL_1X1);
  const second = mock.bodies[1];
  const trBlock = (second.messages || [])
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .find((b) => b.type === "tool_result");
  assert.ok(trBlock, "tool_result in request body");
  assert.ok(Array.isArray(trBlock.content));
  assert.equal(trBlock.content[0].type, "image");
  assert.equal(trBlock.content[0].source.data, PIXEL_1X1);
  assert.equal(trBlock.content[1].type, "text");
});

test("bridge: checkpoint/undo/checkpoints registered with correct gates", () => {
  const fakeBridge = { submit: async () => ({ ok: true, result: "ok" }) };
  const tools = bridgeTools(fakeBridge);
  assert.equal(tools.length, 24);
  const by = (n) => tools.find((t) => t.name === n);
  assert.ok(by("forge_checkpoint"));
  assert.ok(by("forge_undo"));
  assert.ok(by("forge_checkpoints"));
  assert.equal(by("forge_checkpoint").requiresApproval, false);
  assert.equal(by("forge_checkpoints").requiresApproval, false);
  assert.equal(by("forge_undo").requiresApproval, true, "undo is destructive");
});

test("bridge: find/bulk_create/snapshot/diff/export/import registered with correct gates", () => {
  const fakeBridge = { submit: async () => ({ ok: true, result: "ok" }) };
  const tools = bridgeTools(fakeBridge);
  const by = (n) => tools.find((t) => t.name === n);
  for (const n of [
    "forge_find",
    "forge_bulk_create",
    "forge_snapshot",
    "forge_diff",
    "forge_export",
    "forge_import",
  ]) {
    assert.ok(by(n), `registered: ${n}`);
  }
  assert.equal(by("forge_find").requiresApproval, false);
  assert.equal(by("forge_bulk_create").requiresApproval, true, "bulk create is destructive");
  assert.equal(by("forge_snapshot").requiresApproval, false);
  assert.equal(by("forge_diff").requiresApproval, false);
  assert.equal(by("forge_export").requiresApproval, false);
  assert.equal(by("forge_import").requiresApproval, true, "import is destructive");
  // schema sanity
  const bc = by("forge_bulk_create").inputSchema;
  assert.equal(bc.required[0], "items");
  assert.equal(bc.properties.items.type, "array");
  const find = by("forge_find").inputSchema;
  assert.ok(find.properties.pattern && find.properties.class_name && find.properties.limit);
  const imp = by("forge_import").inputSchema;
  assert.ok(imp.properties.json && imp.properties.path && imp.properties.parent && imp.properties.dry_run);
});
