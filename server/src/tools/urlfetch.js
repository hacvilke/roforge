// url_fetch tool — SSRF-guarded fetch with HTML→text extraction.
import dns from "node:dns/promises";
import net from "node:net";
import { config } from "../config.js";
import { HttpError, htmlToText, truncate } from "../util.js";

function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "::ffff:0.0.0.0") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("::ffff:")) return ipIsPrivate(lower.slice(7));
  return false;
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new HttpError(`Blocked: ${host} is a private/loopback address`, 400, "SSRF_BLOCKED");
    return;
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (e) {
    throw new HttpError(`DNS lookup failed for ${host}: ${e.message}`, 502, "DNS_FAILED");
  }
  if (!addresses.length || addresses.some((a) => ipIsPrivate(a.address))) {
    throw new HttpError(`Blocked: ${host} resolves to a private/loopback address`, 400, "SSRF_BLOCKED");
  }
}

const MAX_REDIRECTS = 5;

export async function fetchUrl(rawUrl) {
  let current = new URL(String(rawUrl));
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(current.protocol)) {
      throw new HttpError("Only http/https URLs are allowed", 400, "BAD_URL");
    }
    await assertPublicHost(current.hostname);

    const res = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/json,text/plain,application/xml,*/*",
      },
    }).catch((e) => {
      throw new HttpError(`Fetch failed: ${e.cause?.code || e.message}`, 502, "FETCH_FAILED");
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop + 1 > MAX_REDIRECTS) throw new HttpError("Too many redirects", 400, "TOO_MANY_REDIRECTS");
      current = new URL(res.headers.get("location"), current);
      continue;
    }

    if (!res.ok) throw new HttpError(`Upstream HTTP ${res.status} ${res.statusText || ""}`.trim(), 502, "UPSTREAM_STATUS");
    const ctype = String(res.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("octet-stream") || ctype.includes("zip") || ctype.includes("pdf")) {
      throw new HttpError(`Refusing to fetch binary content (${ctype || "unknown type"})`, 415, "BINARY");
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > config.fetchMaxBytes) {
      throw new HttpError(`Content too large (${buf.byteLength} bytes > ${config.fetchMaxBytes})`, 413, "TOO_LARGE");
    }

    let text = buf.toString("utf8");
    if (ctype.includes("html")) text = htmlToText(text);
    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) throw new HttpError("Fetched content was empty", 502, "EMPTY");
    return truncate(text, config.fetchMaxChars);
  }
}
