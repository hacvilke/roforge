import test from "node:test";
import assert from "node:assert/strict";
import { checkRate, _reset } from "../src/ratelimit.js";

test("allows up to the limit", () => {
  _reset();
  const now = 1_000_000_000_000;
  for (let i = 0; i < 5; i++) {
    const r = checkRate("k", 5, now + i);
    assert.equal(r.allowed, true, `call ${i + 1} should be allowed`);
  }
  assert.equal(checkRate("k", 5, now + 5).allowed, false);
});

test("window slides — old requests expire after 60s", () => {
  _reset();
  const now = 1_000_000_000_000;
  for (let i = 0; i < 3; i++) checkRate("k", 3, now + i);
  assert.equal(checkRate("k", 3, now + 10).allowed, false);
  const after = checkRate("k", 3, now + 61_001);
  assert.equal(after.allowed, true);
});

test("retryAfterSec is positive and sane", () => {
  _reset();
  const now = 1_000_000_000_000;
  for (let i = 0; i < 2; i++) checkRate("k", 2, now + i);
  const r = checkRate("k", 2, now + 30_000);
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSec >= 1 && r.retryAfterSec <= 60);
});

test("keys are independent", () => {
  _reset();
  const now = 1_000_000_000_000;
  checkRate("a", 1, now);
  checkRate("a", 1, now + 1);
  assert.equal(checkRate("b", 1, now + 2).allowed, true);
});
