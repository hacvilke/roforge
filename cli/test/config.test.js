// Config: lenient env-var-style key import + friendly no-key error.
// Regression: a real user's config had {"bridge": {"OPENROUTER_API_KEY": "…"}}
// and the CLI dead-ended with "No Anthropic API key".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function withTempConfig(fileContent, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-cfg-"));
  fs.writeFileSync(path.join(dir, "config.json"), fileContent);
  const prev = process.env.ROFORGE_CONFIG_DIR;
  process.env.ROFORGE_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.ROFORGE_CONFIG_DIR;
    else process.env.ROFORGE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("config: env-var-style keys are imported from anywhere in the file", async () => {
  // the exact shape the real user's file had
  await withTempConfig(
    JSON.stringify({
      bridge: {
        token: "e715e31c0e612b023510b27c364c24e176d887794ba4b51c",
        OPENROUTER_API_KEY: "sk-or-v1-test123",
      },
    }),
    async () => {
      const m = await import("../src/config.js");
      const cfg = m.resolveConfig();
      assert.equal(cfg.openrouterKey, "sk-or-v1-test123", "nested OPENROUTER_API_KEY imported");
      assert.ok(cfg.bridge.token.startsWith("e715e31c"), "bridge token preserved");
      assert.equal(m.effectiveProvider(cfg), "openrouter", "auto routes to the provider that has a key");
      assert.equal(m.modelFor(cfg), "qwen/qwen3-coder:free", "free-tier model picked in auto mode");
    }
  );
});

test("config: top-level env-var-style key also works", async () => {
  await withTempConfig(JSON.stringify({ GEMINI_API_KEY: "gm-test" }), async () => {
    const m = await import("../src/config.js");
    const cfg = m.resolveConfig();
    assert.equal(cfg.geminiKey, "gm-test");
    assert.equal(m.effectiveProvider(cfg), "gemini");
  });
});

test("session: no keys configured → friendly error, not 'No Anthropic API key'", async () => {
  await withTempConfig(JSON.stringify({}), async () => {
    const m = await import("../src/config.js");
    const { Session } = await import("../src/session.js");
    const cfg = m.resolveConfig();
    const s = new Session({ cfg, cwd: os.tmpdir(), bridgeServer: null, luauAnalyzePath: null, ui: {} });
    assert.equal(s.provider, null, "auto with no keys resolves to no provider");
    await assert.rejects(
      () => s.send("hello"),
      (e) => e.message.includes("No API key found") && e.message.includes("roforge login"),
      "error message tells the user how to fix it"
    );
  });
});

test("session: explicit provider without a key → named error surfaced via onWarn", async () => {
  await withTempConfig(JSON.stringify({ provider: "anthropic" }), async () => {
    const m = await import("../src/config.js");
    const { Session } = await import("../src/session.js");
    const cfg = m.resolveConfig();
    const warnings = [];
    const s = new Session({
      cfg,
      cwd: os.tmpdir(),
      bridgeServer: null,
      luauAnalyzePath: null,
      ui: { onWarn: (msg) => warnings.push(String(msg)) },
    });
    assert.equal(s.providerName, "anthropic", "explicit provider kept");
    const out = await s.send("hello");
    assert.equal(out.ok, false, "turn fails");
    assert.equal(out.error, true);
    assert.match(warnings.join("\n"), /No Anthropic API key/, "names the missing provider's key");
  });
});
