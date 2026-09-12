import test from "node:test";
import assert from "node:assert/strict";

// Isolate data + secret BEFORE importing app code (config reads env at import).
process.env.ROFORGE_DATA_DIR = new URL("./tmp-data-auth", import.meta.url).pathname;
process.env.ROFORGE_SECRET = "unit-test-secret";
process.env.ROFORGE_TOKEN_TTL_MS = "3600000";

const { login, verifyToken, issueToken } = await import("../src/auth.js");
const { config } = await import("../src/config.js");

test("login creates a user and returns a valid token", () => {
  const out = login("alice", "password123");
  assert.ok(out.token.startsWith("rf1."));
  assert.equal(out.username, "alice");
  const verified = verifyToken(out.token);
  assert.ok(verified);
  assert.equal(verified.username, "alice");
});

test("login with wrong password for existing user fails", () => {
  login("alice", "password123");
  assert.throws(() => login("alice", "wrongpass99"), /Invalid username or password/);
});

test("username format is enforced", () => {
  assert.throws(() => login("a", "password123"), /Username/);
  assert.throws(() => login("bad name!", "password123"), /Username/);
});

test("short password is rejected", () => {
  assert.throws(() => login("bob", "short"), /Password/);
});

test("tampered token is rejected", () => {
  const { token } = login("carol", "password123");
  const parts = token.split(".");
  // flip a character in the signature
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  assert.equal(verifyToken(parts.join(".")), null);
});

test("forged payload with valid-looking format is rejected", () => {
  const payload = Buffer.from(JSON.stringify({ u: "mallory", iat: 0, exp: Date.now() + 999999999 })).toString("base64url");
  assert.equal(verifyToken(`rf1.${payload}.deadbeef`), null);
});

test("expired token is rejected", () => {
  const oldTtl = config.tokenTtlMs;
  config.tokenTtlMs = -1000;
  const { token } = login("dave", "password123");
  config.tokenTtlMs = oldTtl;
  assert.equal(verifyToken(token), null);
});

test("issueToken and verifyToken roundtrip", () => {
  const t = issueToken("erin");
  assert.equal(verifyToken(t).username, "erin");
});
