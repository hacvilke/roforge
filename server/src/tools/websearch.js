// web_search tool.
//
// Provider priority (ROFORGE_SEARCH_PROVIDER=auto):
//   serper (Google results) → brave → wikipedia (keyless fallback).
import { config } from "../config.js";
import { HttpError } from "../util.js";

async function serper(q) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": config.serperApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: config.searchMaxResults }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(`Serper search failed (HTTP ${res.status})`, 502, "SEARCH_UPSTREAM");
  const data = await res.json();
  return (data.organic || []).slice(0, config.searchMaxResults).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

async function brave(q) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${config.searchMaxResults}`;
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": config.braveApiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(`Brave search failed (HTTP ${res.status})`, 502, "SEARCH_UPSTREAM");
  const data = await res.json();
  const results = (data && data.web && data.web.results) || [];
  return results.slice(0, config.searchMaxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function wikipedia(q) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${config.searchMaxResults}&search=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(`Wikipedia search failed (HTTP ${res.status})`, 502, "SEARCH_UPSTREAM");
  const data = await res.json();
  const titles = data[1] || [];
  const urls = data[3] || [];
  return titles.map((t, i) => ({
    title: t,
    url: urls[i] || "",
    snippet: "Wikipedia result (keyless fallback)",
  }));
}

const IMPLS = { serper, brave, wikipedia };

export function activeSearchProvider() {
  if (config.searchProvider === "auto") {
    if (config.serperApiKey) return "serper";
    if (config.braveApiKey) return "brave";
    return "wikipedia";
  }
  return config.searchProvider;
}

export async function webSearch(query) {
  const provider = activeSearchProvider();
  const impl = IMPLS[provider];
  if (!impl) throw new HttpError(`Unknown search provider '${provider}'`, 500, "CONFIG");
  const results = await impl(String(query));
  if (!results.length) return "No results found.";
  let out = `Web search results for: ${query} (provider: ${provider}`;
  if (provider === "wikipedia") out += ", keyless fallback";
  out += ")\n";
  results.forEach((r, i) => {
    out += `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}\n`;
  });
  return out;
}
