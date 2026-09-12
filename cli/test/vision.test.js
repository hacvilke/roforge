// Vision: image results flow from bridge tools → agent history → provider
// request bodies (Anthropic tool_result image blocks, OpenAI image_url).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { renderHistory as renderAnthropic } from "../src/providers/anthropic.js";
import { renderHistory as renderOpenAI } from "../src/providers/openai.js";
import { bridgeTools } from "../src/tools/studio.js";
import { runAgent } from "../src/agent.js";
import * as Anthropic from "../src/providers/anthropic.js";

// 1x1 red pixel (real PNG)
const PIXEL_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function toolHistoryItem() {
  return {
    role: "tool",
    id: "tu_1",
    name: "forge_viewport",
    result: "Viewport captured at 1024x576.",
    image: { base64: PIXEL_1X1, mediaType: "image/png" },
  };
}

test("anthropic renderHistory: image tool result → [image, text] content array", () => {
  const msgs = renderAnthropic([
    { role: "user", text: "what does it look like?" },
    { role: "assistant", text: null, calls: [{ id: "tu_1", name: "forge_viewport", args: {} }] },
    toolHistoryItem(),
  ]);
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, "user");
  const tr = last.content.find((b) => b.type === "tool_result");
  assert.ok(tr, "tool_result block present");
  assert.ok(Array.isArray(tr.content));
  assert.equal(tr.content.length, 2);
  assert.equal(tr.content[0].type, "image");
  assert.equal(tr.content[0].source.type, "base64");
  assert.equal(tr.content[0].source.media_type, "image/png");
  assert.equal(tr.content[0].source.data, PIXEL_1X1);
  assert.equal(tr.content[1].type, "text");
  assert.equal(tr.content[1].text, "Viewport captured at 1024x576.");
});

test("anthropic renderHistory: plain tool result stays a string", () => {
  const msgs = renderAnthropic([{ role: "tool", id: "tu_1", name: "x", result: "plain" }]);
  assert.equal(msgs[0].content[0].content, "plain");
});

test("openai renderHistory: image tool result → tool msg + user image_url msg", () => {
  const msgs = renderOpenAI([
    { role: "user", text: "what does it look like?" },
    { role: "assistant", text: null, calls: [{ id: "tu_1", name: "forge_viewport", args: {} }] },
    toolHistoryItem(),
  ]);
  const toolMsg = msgs.find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.content, "Viewport captured at 1024x576.");
  const imgMsg = msgs[msgs.length - 1];
  assert.equal(imgMsg.role, "user");
  assert.equal(imgMsg.content[0].type, "text");
  assert.equal(imgMsg.content[1].type, "image_url");
  assert.ok(imgMsg.content[1].image_url.url.startsWith("data:image/png;base64,"));
  assert.ok(imgMsg.content[1].image_url.url.endsWith(PIXEL_1X1));
});

test("openai renderHistory: no image → no extra user message", () => {
  const msgs = renderOpenAI([{ role: "tool", id: "tu_1", name: "x", result: "plain" }]);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, "tool");
});

test("bridge tools: 24 registered, new shapes + approval gates", async () => {
  const fakeBridge = {
    submit: async (name) => {
      if (name === "forge_viewport") {
        return { ok: true, result: { text: "Viewport captured at 64x32.", imageBase64: PIXEL_1X1, mediaType: "image/png" } };
      }
      if (name === "forge_selected") return { ok: false, error: "studio job timed out after 60s" };
      return { ok: true, result: "plain string" };
    },
  };
  const tools = bridgeTools(fakeBridge);
  assert.equal(tools.length, 24);
  const by = (n) => tools.find((t) => t.name === n);
  for (const n of [
    "forge_viewport",
    "forge_get_property",
    "forge_set_property",
    "forge_get_attributes",
    "forge_set_attribute",
    "forge_select",
  ]) {
    assert.ok(by(n), `tool registered: ${n}`);
  }
  assert.equal(by("forge_viewport").requiresApproval, false);
  assert.equal(by("forge_set_property").requiresApproval, true);
  assert.equal(by("forge_set_attribute").requiresApproval, true);

  const img = await by("forge_viewport").execute({});
  assert.equal(typeof img, "object");
  assert.equal(img.text, "Viewport captured at 64x32.");
  assert.equal(img.image.base64, PIXEL_1X1);
  assert.equal(img.image.mediaType, "image/png");

  const plain = await by("forge_game_info").execute({});
  assert.equal(typeof plain, "string");

  const err = await by("forge_selected").execute({});
  assert.match(err, /^ERROR: /);
});

// Recording mock: request 1 → tool_use(forge_viewport); request 2 → final
// text; records every request body for assertions.
async function startRecordingMock() {
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
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I can see the viewport." } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } }],
          ["message_stop", { type: "message_stop" }],
        ]);
      } else {
        sse([
          ["message_start", { type: "message_start", message: { usage: { input_tokens: 10 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_vision_1", name: "forge_viewport", input: {} } }],
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

test("agent: vision image reaches the Anthropic request body (full loop)", { timeout: 20000 }, async (t) => {
  const mock = await startRecordingMock();
  t.after(() => mock.server.close());
  const cfg = {
    provider: "anthropic",
    anthropicKey: "test-key",
    anthropicBaseUrl: `http://127.0.0.1:${mock.port}`,
    _activeModel: "claude-sonnet-4-5",
    maxTokens: 100,
    maxIterations: 4,
  };
  const history = [];
  const tools = [
    {
      name: "forge_viewport",
      description: "capture viewport",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({
        text: "Viewport captured at 64x32.",
        image: { base64: PIXEL_1X1, mediaType: "image/png" },
      }),
    },
  ];
  const out = await runAgent(cfg, Anthropic, history, "system", tools, {
    shouldAbort: () => false,
    approve: () => true,
  });
  assert.equal(out.ok, true);
  assert.ok(mock.bodies.length >= 2, "two model requests");
  // history carries the image on the tool item
  const toolItem = history.find((h) => h.role === "tool");
  assert.ok(toolItem.image, "history item has image");
  assert.equal(toolItem.image.base64, PIXEL_1X1);
  // the 2nd request body carries the image inside the tool_result
  const second = mock.bodies[1];
  const trBlock = (second.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === "tool_result");
  assert.ok(trBlock, "tool_result in request body");
  assert.ok(Array.isArray(trBlock.content));
  assert.equal(trBlock.content[0].type, "image");
  assert.equal(trBlock.content[0].source.data, PIXEL_1X1);
  assert.equal(trBlock.content[1].type, "text");
});
