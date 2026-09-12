// Provider layer tests: Gemini streaming (mock SSE), OpenRouter + Groq
// (OpenAI-compatible mock), and free-tier auto-routing in config.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

// isolate any config-file writes before config.js is imported (it reads
// ROFORGE_CONFIG_DIR at module load)
const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-prov-test-"));
process.env.ROFORGE_CONFIG_DIR = tmpCfg;

const { resolveConfig, effectiveProvider, modelFor, parseModelRef, PROVIDERS } = await import("../src/config.js");
const { chatStream: geminiChat } = await import("../src/providers/gemini.js");
const { chatStream: openrouterChat } = await import("../src/providers/openrouter.js");
const { chatStream: groqChat } = await import("../src/providers/groq.js");
const { startMockGemini, startMockOpenAI } = await import("./mock-server.js");

function setEnv(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
}
const KEY_ENVS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
function clearKeys() {
  setEnv(Object.fromEntries(KEY_ENVS.map((k) => [k, null])));
  delete process.env.ROFORGE_PROVIDER;
  delete process.env.ROFORGE_MODEL;
  delete process.env.ROFORGE_FREE_FIRST;
}

// ---------------- Gemini ----------------

test("gemini: streams text + functionCall, usage, stop reason", async () => {
  const server = await startMockGemini();
  const cfg = { geminiKey: "gk", geminiBaseUrl: `http://127.0.0.1:${server.address().port}` };
  const r1 = await geminiChat(
    cfg,
    {
      model: "gemini-2.5-flash",
      maxTokens: 1000,
      system: "you are a test",
      messages: [{ role: "user", text: "hi" }],
      tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }],
    },
    {}
  );
  assert.equal(r1.text, "Let me check.");
  assert.equal(r1.toolCalls.length, 1);
  assert.equal(r1.toolCalls[0].name, "echo");
  assert.deepEqual(r1.toolCalls[0].input, { text: "ping" });
  assert.match(r1.toolCalls[0].id, /^call_gem_/);
  assert.equal(r1.stopReason, "end_turn");
  assert.deepEqual(r1.usage, { input_tokens: 10, output_tokens: 4 });

  const req = server.lastRequest;
  assert.equal(req.headers["x-goog-api-key"], "gk");
  assert.equal(req.body.systemInstruction.parts[0].text, "you are a test");
  assert.equal(req.body.tools[0].functionDeclarations[0].name, "echo");
  assert.equal(req.body.generationConfig.maxOutputTokens, 1000);
  assert.equal(req.body.contents[0].role, "user");
  server.close();
});

test("gemini: second turn carries functionResponses, consecutive results merge", async () => {
  const server = await startMockGemini();
  const cfg = { geminiKey: "gk", geminiBaseUrl: `http://127.0.0.1:${server.address().port}` };
  const history = [
    { role: "user", text: "hi" },
    {
      role: "assistant",
      text: "calling two tools",
      calls: [
        { id: "1", name: "echo", args: {} },
        { id: "2", name: "echo", args: {} },
      ],
    },
    { role: "tool", id: "1", name: "echo", result: "a" },
    { role: "tool", id: "2", name: "echo", result: "b" },
  ];
  const r = await geminiChat(cfg, { model: "gemini-2.5-flash", messages: history }, {});
  assert.equal(r.text, "Done — the function round-trip worked.");
  assert.equal(r.toolCalls.length, 0);
  assert.equal(r.stopReason, "end_turn");

  const contents = server.lastRequest.body.contents;
  assert.deepEqual(contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(contents[1].parts.filter((p) => p.functionCall).length, 2);
  assert.equal(contents[2].parts.filter((p) => p.functionResponse).length, 2);
  assert.equal(contents[2].parts[0].functionResponse.name, "echo");
  assert.equal(contents[2].parts[0].functionResponse.response.result, "a");
  server.close();
});

test("gemini: tool image becomes an inlineData part in the same turn", async () => {
  const server = await startMockGemini();
  const cfg = { geminiKey: "gk", geminiBaseUrl: `http://127.0.0.1:${server.address().port}` };
  const history = [
    { role: "user", text: "screenshot" },
    { role: "assistant", text: "capturing", calls: [{ id: "1", name: "forge_viewport", args: {} }] },
    { role: "tool", id: "1", name: "forge_viewport", result: "viewport ok", image: { base64: "aGVsbG8=", mediaType: "image/png" } },
  ];
  await geminiChat(cfg, { model: "gemini-2.5-flash", messages: history }, {});
  const last = server.lastRequest.body.contents.at(-1);
  const img = last.parts.find((p) => p.inlineData);
  assert.ok(img, "inlineData part present");
  assert.equal(img.inlineData.data, "aGVsbG8=");
  assert.equal(img.inlineData.mimeType, "image/png");
  server.close();
});

test("gemini: missing key → friendly ProviderError", async () => {
  await assert.rejects(
    () => geminiChat({ geminiKey: "" }, { model: "x", messages: [] }, {}),
    /GEMINI_API_KEY/
  );
});

// ---------------- OpenRouter / Groq (OpenAI-compatible) ----------------

test("openrouter: routes through its own key + base URL", async () => {
  const server = await startMockOpenAI();
  const cfg = {
    provider: "openrouter",
    openrouterKey: "or-key",
    openrouterBaseUrl: `http://127.0.0.1:${server.address().port}`,
  };
  const r = await openrouterChat(cfg, { model: "qwen/qwen3-coder:free", messages: [{ role: "user", text: "hi" }] }, {});
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].name, "echo");
  const req = server.lastRequest;
  assert.equal(req.headers.authorization, "Bearer or-key");
  assert.equal(req.body.model, "qwen/qwen3-coder:free");
  assert.equal(req.url, "/v1/chat/completions");
  server.close();
});

test("groq: routes through its own key + base URL", async () => {
  const server = await startMockOpenAI();
  const cfg = {
    provider: "groq",
    groqKey: "groq-key",
    groqBaseUrl: `http://127.0.0.1:${server.address().port}`,
  };
  const r = await groqChat(cfg, { model: "llama-3.3-70b-versatile", messages: [{ role: "user", text: "hi" }] }, {});
  assert.equal(r.toolCalls.length, 1);
  const req = server.lastRequest;
  assert.equal(req.headers.authorization, "Bearer groq-key");
  assert.equal(req.body.model, "llama-3.3-70b-versatile");
  server.close();
});

// ---------------- auto-routing (config) ----------------

test("parseModelRef: first colon is the provider prefix", () => {
  assert.deepEqual(parseModelRef("gemini:gemini-2.5-flash"), { provider: "gemini", model: "gemini-2.5-flash" });
  assert.deepEqual(parseModelRef("openrouter:a/b:free"), { provider: "openrouter", model: "a/b:free" });
  assert.equal(parseModelRef("gemini-2.5-flash"), null);
  assert.equal(parseModelRef(""), null);
});

test("auto: a single gemini key → gemini + free model", () => {
  clearKeys();
  setEnv({ GEMINI_API_KEY: "g" });
  const cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), "gemini");
  assert.equal(modelFor(cfg), "gemini-2.5-flash");
});

test("auto: free-tier priority gemini > groq > openrouter", () => {
  clearKeys();
  setEnv({ GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a" });
  assert.equal(effectiveProvider(resolveConfig()), "groq");
  setEnv({ GROQ_API_KEY: null, OPENROUTER_API_KEY: "o", ANTHROPIC_API_KEY: "a" });
  assert.equal(effectiveProvider(resolveConfig()), "openrouter");
  assert.equal(modelFor(resolveConfig()), "qwen/qwen3-coder:free");
});

test("auto: paid-only keys still work", () => {
  clearKeys();
  setEnv({ OPENAI_API_KEY: "o" });
  let cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), "openai");
  assert.equal(modelFor(cfg), "gpt-4.1");
  setEnv({ OPENAI_API_KEY: null, ANTHROPIC_API_KEY: "a" });
  cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), "anthropic");
  assert.equal(modelFor(cfg), "claude-sonnet-4-5");
});

test("freeFirst=false: paid providers beat free tiers", () => {
  clearKeys();
  setEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" });
  assert.equal(effectiveProvider(resolveConfig()), "gemini");
  process.env.ROFORGE_FREE_FIRST = "0";
  assert.equal(effectiveProvider(resolveConfig()), "anthropic");
});

test("explicit provider beats auto (even when other free keys exist)", () => {
  clearKeys();
  setEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "x" });
  process.env.ROFORGE_PROVIDER = "groq";
  const cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), "groq");
  assert.equal(modelFor(cfg), "llama-3.3-70b-versatile");
});

test("provider:model pin routes to that provider; falls back without a key", () => {
  clearKeys();
  setEnv({ OPENROUTER_API_KEY: "o" });
  process.env.ROFORGE_MODEL = "openrouter:deepseek/deepseek-chat-v3-0324:free";
  let cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), "openrouter");
  assert.equal(modelFor(cfg), "deepseek/deepseek-chat-v3-0324:free");

  setEnv({ OPENROUTER_API_KEY: null, GEMINI_API_KEY: "g" });
  cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), "gemini");
  delete process.env.ROFORGE_MODEL;
});

test("no keys anywhere → effectiveProvider is null", () => {
  clearKeys();
  const cfg = resolveConfig();
  assert.equal(effectiveProvider(cfg), null);
  // registry sanity: every provider has a default model and correct env name
  for (const [name, meta] of Object.entries(PROVIDERS)) {
    assert.ok(meta.defaultModel, `${name} has a default model`);
    assert.match(meta.env, /^[A-Z0-9_]+_API_KEY$/);
  }
});
