import test from "node:test";
import assert from "node:assert/strict";
import { createSSE, parseSSEStream } from "../src/util.js";

test("SSE: single event", () => {
  const events = [];
  const p = createSSE((e) => events.push(e));
  p.push('event: ping\ndata: {"a":1}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "ping");
  assert.deepEqual(events[0].data, { a: 1 });
});

test("SSE: chunked across push() calls", () => {
  const events = [];
  const p = createSSE((e) => events.push(e));
  p.push("event: x\nda");
  p.push("ta: {\"b\":2}\n\n");
  assert.deepEqual(events[0].data, { b: 2 });
});

test("SSE: default event name + multi-line data", () => {
  const events = [];
  const p = createSSE((e) => events.push(e));
  p.push('data: {"c":\ndata:  3}\n\n');
  assert.equal(events[0].event, "message");
  assert.deepEqual(events[0].data, { c: 3 });
});

test("SSE: [DONE] sentinel", () => {
  const events = [];
  const p = createSSE((e) => events.push(e));
  p.push("data: [DONE]\n\n");
  assert.equal(events[0].done, true);
});

test("SSE: comments ignored, trailing partial on end()", () => {
  const events = [];
  const p = createSSE((e) => events.push(e));
  p.push(": keep-alive\n\nevent: t\ndata: 1");
  p.end();
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "t");
  assert.equal(events[0].data, 1);
});

test("parseSSEStream: full blob", () => {
  const evs = parseSSEStream('event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n');
  assert.equal(evs.length, 2);
  assert.deepEqual(evs[1].data, { y: 2 });
});
