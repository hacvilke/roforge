// Mock servers for tests: Anthropic SSE, OpenAI SSE, MCP (Streamable HTTP).
// Lets the full agent loop run offline.
import http from "node:http";

function listen(handler, port = 0) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let out = "";
  for (const [event, data] of events) {
    out += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  res.end(out);
}

// Mock Anthropic /v1/messages. State machine:
//  • request whose last message contains tool_result → final answer
//  • otherwise → text + one tool_use (name/args configurable, default echo)
export async function startMockAnthropic({ toolName = "echo", toolArgs = { text: "ping" } } = {}) {
  const server = await listen((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/messages") {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      const hasToolResult = (body.messages || []).some(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")
      );
      if (hasToolResult) {
        sse(res, [
          ["message_start", { type: "message_start", message: { usage: { input_tokens: 20 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done — " } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "the echo round-trip worked." } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } }],
          ["message_stop", { type: "message_stop" }],
        ]);
      } else {
        sse(res, [
          ["message_start", { type: "message_start", message: { usage: { input_tokens: 10 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check." } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          [
            "content_block_start",
            { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_mock_1", name: toolName, input: {} } },
          ],
          ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"te' } }],
          ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'xt":"ping"}' } }],
          ["content_block_stop", { type: "content_block_stop", index: 1 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }],
          ["message_stop", { type: "message_stop" }],
        ]);
      }
    });
  });
  server.addressPort = server.address().port;
  return server;
}

export async function startMockOpenAI() {
  const server = await listen((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      server.lastRequest = { url: req.url, headers: req.headers, body };
      const hasTool = (body.messages || []).some((m) => m.role === "tool");
      if (hasTool) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "Done!" } }], usage: { prompt_tokens: 20, completion_tokens: 4 } })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_mock_1", function: { name: "echo", arguments: '{"te' } }] } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'xt":"ping"}' } }] } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });
  });
  return server;
}

// Mock MCP server (Streamable HTTP). tools/list answers with an SSE body to
// exercise that parse path; tools/call answers with plain JSON.
export async function startMockMcp() {
  const server = await listen((req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      const reply = (obj, status = 200, headers = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(obj));
      };
      if (!msg.id) {
        // notification (e.g. notifications/initialized)
        res.writeHead(202);
        return res.end();
      }
      switch (msg.method) {
        case "initialize":
          return reply(
            {
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                protocolVersion: "2025-03-26",
                serverInfo: { name: "mock-roblox-studio", version: "1.0" },
                capabilities: { tools: {} },
              },
            },
            200,
            { "mcp-session-id": "mock-session-1" }
          );
        case "tools/list":
          // SSE response body on purpose
          res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "mock-session-1" });
          res.write(
            `event: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                tools: [
                  { name: "get_descendants", description: "Mock: list instances", inputSchema: { type: "object", properties: {} } },
                  { name: "set_script_source", description: "Mock: write a script", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
                  { name: "capture_screenshot", description: "Mock: capture the 3D viewport as a screenshot image", inputSchema: { type: "object", properties: {} } },
                ],
              },
            })}\n\n`
          );
          res.end();
          return;
        case "tools/call":
          if (msg.params.name === "capture_screenshot") {
            // 1x1 red PNG, base64 (the vision-contract fixture)
            return reply({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                content: [
                  { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mimeType: "image/png" },
                  { type: "text", text: "screenshot captured (1x1)" },
                ],
                isError: false,
              },
            });
          }
          return reply({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [{ type: "text", text: `mock-studio executed ${msg.params.name} OK` }],
              isError: false,
            },
          });
        default:
          return reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } }, 200);
      }
    });
  });
  return server;
}

// Mock Gemini v1beta streamGenerateContent (alt=sse). Each SSE event's data
// is a GenerateContentResponse. State machine:
//  • contents include a functionResponse → final answer
//  • otherwise → text + one functionCall
export async function startMockGemini({ model = "gemini-2.5-flash" } = {}) {
  const server = await listen((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith(`/v1beta/models/${model}:streamGenerateContent`)) {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      server.lastRequest = { url: req.url, headers: req.headers, body };
      const hasResponse = (body.contents || []).some(
        (c) => Array.isArray(c.parts) && c.parts.some((p) => p.functionResponse)
      );
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (hasResponse) {
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Done — " }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 } })}\n\n`);
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "the function round-trip worked." }] }, finishReason: "STOP" }] })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Let me check." }] } } ], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 } })}\n\n`);
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "echo", args: { text: "ping" } } }] }, finishReason: "STOP" }] })}\n\n`);
      }
      res.end();
    });
  });
  return server;
}
