// Web tools, running locally (no backend needed): web_search + url_fetch.
// Search provider order: serper → brave → wikipedia (keyless fallback).
import dns from "node:dns/promises";
import net from "node:net";
import { htmlToText, truncate } from "../util.js";

const UA = "RoForge/0.2 (+local; roblox studio agent)";

async function serper(q, max, key) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: max }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = await res.json();
  return (data.organic || []).slice(0, max).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
}

async function brave(q, max, key) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${max}`;
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = await res.json();
  const results = (data && data.web && data.web.results) || [];
  return results.slice(0, max).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function wikipedia(q, max) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${max}&search=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = await res.json();
  const titles = data[1] || [];
  const urls = data[3] || [];
  return titles.map((t, i) => ({ title: t, url: urls[i] || "", snippet: "Wikipedia (keyless fallback)" }));
}

function pickProvider(cfg) {
  if (cfg.searchProvider && cfg.searchProvider !== "auto") return cfg.searchProvider;
  if (cfg.serperKey) return "serper";
  if (cfg.braveKey) return "brave";
  return "wikipedia";
}

export async function webSearch(cfg, query, max = 6) {
  const provider = pickProvider(cfg);
  const impl = { serper, brave, wikipedia }[provider];
  if (!impl) throw new Error(`unknown search provider '${provider}'`);
  const results = await impl(String(query), max, cfg.serperKey || cfg.braveKey);
  if (!results.length) return "No results found.";
  let out = `Web search results for: ${query} (provider: ${provider}`;
  if (provider === "wikipedia") out += ", keyless fallback";
  out += ")\n";
  results.forEach((r, i) => {
    out += `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}\n`;
  });
  return out;
}

function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "::ffff:0.0.0.0") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("::ffff:")) return ipIsPrivate(lower.slice(7));
  return false;
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error(`Blocked: ${host} is a private/loopback address`);
    return;
  }
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => ipIsPrivate(a.address))) {
    throw new Error(`Blocked: ${host} resolves to a private/loopback address`);
  }
}

export async function fetchUrl(rawUrl, { maxBytes = 512 * 1024, maxChars = 60000, timeoutMs = 15000 } = {}) {
  let current;
  try {
    current = new URL(String(rawUrl));
  } catch {
    throw new Error("Invalid URL");
  }
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(current.protocol)) throw new Error("Only http/https URLs are allowed");
    await assertPublicHost(current.hostname);
    const res = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, Accept: "text/html,application/json,text/plain,application/xml,*/*" },
    }).catch((e) => {
      throw new Error(`Fetch failed: ${e.cause?.code || e.message}`);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop + 1 > 5) throw new Error("Too many redirects");
      current = new URL(res.headers.get("location"), current);
      continue;
    }
    if (!res.ok) throw new Error(`Upstream HTTP ${res.status}`);
    const ctype = String(res.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("octet-stream") || ctype.includes("zip") || ctype.includes("pdf")) {
      throw new Error(`Refusing binary content (${ctype || "unknown type"})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error(`Content too large (${buf.byteLength} bytes)`);
    let text = buf.toString("utf8");
    if (ctype.includes("html")) text = htmlToText(text);
    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("Fetched content was empty");
    return truncate(text, maxChars);
  }
}

export function webTools() {
  return [
    {
      name: "web_search",
      description: "Search the web and get top results with titles, URLs, and snippets. Use for documentation, APIs, and up-to-date facts about Roblox, Luau, or anything else.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          max_results: { type: "integer", description: "1-10. Default 6." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, ctx) => webSearch(ctx.cfg, args.query, Math.min(Math.max(1, Number(args.max_results) || 6), 10)),
    },
    {
      name: "url_fetch",
      description: "Fetch a URL and return its content as text (HTML is converted to plain text). Use to read documentation pages or JSON APIs.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL" } },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (args) => fetchUrl(args.url),
    },
  ];
}
