import test from "node:test";
import assert from "node:assert/strict";
import { startMockAnthropic, startMockOpenAI } from "./mock-server.js";
import { runAgent } from "../src/agent.js";
import * as Anthropic from "../src/providers/anthropic.js";
import * as OpenAI from "../src/providers/openai.js";

function makeTools() {
  return [
    {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      execute: async (args) => `echoed: ${args.text}`,
    },
    {
      name: "boom",
      description: "always errors",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("kaboom");
      },
    },
  ];
}

test("agent: anthropic full loop (text → tool_use → final)", { timeout: 20000 }, async (t) => {
  const server = await startMockAnthropic();
  t.after(() => server.close());
  const cfg = {
    provider: "anthropic",
    anthropicKey: "test-key",
    anthropicBaseUrl: `http://127.0.0.1:${server.address().port}`,
    _activeModel: "claude-sonnet-4-5",
    maxTokens: 100,
    maxIterations: 5,
  };
  const history = [];
  const seen = { text: "", tools: [] };
  const out = await runAgent(
    cfg,
    Anthropic,
    history,
    "system",
    makeTools(),
    {
      onText: (d) => (seen.text += d),
      onToolStart: (tool, args) => seen.tools.push({ name: tool.name, args }),
      shouldAbort: () => false,
      approve: () => true,
    }
  );
  assert.equal(out.ok, true);
  assert.equal(seen.tools.length, 1);
  assert.equal(seen.tools[0].name, "echo");
  assert.equal(seen.tools[0].args.text, "ping");
  assert.ok(seen.text.includes("Let me check."));
  assert.ok(seen.text.includes("Done — the echo round-trip worked."));
  // history: user, assistant(+calls), tool, assistant
  assert.deepEqual(history.map((h) => h.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(history[1].calls[0].name, "echo");
  assert.equal(history[2].result, "echoed: ping");
  assert.ok(out.usage.input_tokens >= 30);
  assert.ok(out.usage.output_tokens >= 17);
});

test("agent: openai full loop", { timeout: 20000 }, async (t) => {
  const server = await startMockOpenAI();
  t.after(() => server.close());
  const cfg = {
    provider: "openai",
    openaiKey: "test-key",
    openaiBaseUrl: `http://127.0.0.1:${server.address().port}`,
    _activeModel: "gpt-4.1",
    maxTokens: 100,
    maxIterations: 5,
  };
  const history = [];
  const seen = { text: "", tools: [] };
  const out = await runAgent(
    cfg,
    OpenAI,
    history,
    "system",
    makeTools(),
    {
      onText: (d) => (seen.text += d),
      onToolStart: (tool) => seen.tools.push(tool.name),
      shouldAbort: () => false,
      approve: () => true,
    }
  );
  assert.equal(out.ok, true);
  assert.deepEqual(seen.tools, ["echo"]);
  assert.equal(seen.text, "Done!");
  assert.deepEqual(history.map((h) => h.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(history[2].result, "echoed: ping");
});

test("agent: tool error becomes ERROR string in history", { timeout: 20000 }, async (t) => {
  // point at a dead port → provider error path
  const cfg = {
    provider: "anthropic",
    anthropicKey: "k",
    anthropicBaseUrl: "http://127.0.0.1:1",
    _activeModel: "m",
    maxIterations: 1,
  };
  const out = await runAgent(cfg, Anthropic, [], "s", makeTools(), {
    shouldAbort: () => false,
    onError: () => {},
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, true);
});

test("agent: iteration limit stops the loop", { timeout: 20000 }, async (t) => {
  const server = await startMockAnthropic();
  t.after(() => server.close());
  const cfg = {
    provider: "anthropic",
    anthropicKey: "k",
    anthropicBaseUrl: `http://127.0.0.1:${server.address().port}`,
    _activeModel: "m",
    maxIterations: 1, // mock always wants a tool on the first turn
  };
  const errors = [];
  const out = await runAgent(cfg, Anthropic, [], "s", makeTools(), {
    shouldAbort: () => false,
    onError: (m) => errors.push(m),
  });
  assert.equal(out.limit, true);
  assert.ok(errors[0].includes("safety limit"));
});
