// Small shared helpers (no dependencies).
import { Buffer } from "node:buffer";

export function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > maxBytes) {
        aborted = true;
        reject(Object.assign(new Error("Request body too large"), { status: 413, code: "BODY_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400, code: "BAD_JSON" }));
      }
    });
    req.on("error", (e) => {
      if (!aborted) reject(e);
    });
  });
}

export function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + `\n... [truncated ${s.length - n} chars]` : s;
}

// Crude but effective HTML → plain text for LLM consumption.
export function htmlToText(html) {
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  t = t.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  t = t.replace(/<aside[\s\S]*?<\/aside>/gi, " ");
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

export class HttpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 400;
    this.code = code || "BAD_REQUEST";
  }
}
