// Shared helpers: SSE parsing, JSON over HTTP, misc. Zero dependencies.
import { randomBytes } from "node:crypto";

// Incremental Server-Sent-Events parser.
// push(chunk) feeds raw text; each complete event invokes onEvent({event, data}).
// `data` is JSON-decoded when possible, else the raw string. [DONE] → data="[DONE]".
export function createSSE(onEvent) {
  let buf = "";
  return {
    push(chunk) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSSEBlock(raw);
        if (ev) onEvent(ev);
      }
      // guard against unbounded buffer on malformed streams
      if (buf.length > 4 * 1024 * 1024) buf = "";
    },
    end() {
      if (buf.trim()) {
        const ev = parseSSEBlock(buf);
        buf = "";
        if (ev) onEvent(ev);
      }
    },
  };
}

function parseSSEBlock(raw) {
  let event = "message";
  const dataLines = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // comment
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  const dataStr = dataLines.join("\n");
  if (dataStr === "[DONE]") return { event, data: "[DONE]", done: true };
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return { event, data: dataStr };
  }
}

// Parse an entire SSE text blob (used for MCP responses that arrive as a whole body).
export function parseSSEStream(text) {
  const events = [];
  const parser = createSSE((ev) => events.push(ev));
  parser.push(text);
  parser.end();
  return events;
}

export class HttpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 500;
    this.code = code || "HTTP_ERROR";
  }
}

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json", ...opts.headers },
    signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 30000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const msg = (json && (json.error && (typeof json.error === "string" ? json.error : json.error.message))) || text.slice(0, 300);
    throw new HttpError(`HTTP ${res.status}: ${msg}`, res.status, (json && json.code) || "HTTP_ERROR");
  }
  return json ?? text;
}

export function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + `\n... [truncated ${s.length - n} chars]` : s;
}

// Crude but effective HTML → plain text.
export function htmlToText(html) {
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  t = t.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/(p|div|li|h[1-6]|tr|section|article|pre|blockquote)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\s*\n\s*/g, "\n");
  return t.trim();
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("hex");
}
