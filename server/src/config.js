// RoForge server configuration. Everything is driven by environment
// variables (see .env.example). No runtime dependencies.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;

function int(name, dflt) {
  const v = parseInt(env[name] ?? "", 10);
  return Number.isFinite(v) ? v : dflt;
}
function str(name, dflt) {
  return (env[name] && String(env[name]).trim()) || dflt;
}

let hmacSecret = str("ROFORGE_SECRET", "");
if (!hmacSecret) {
  hmacSecret = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[config] ROFORGE_SECRET not set — using a random ephemeral secret. " +
      "Sessions will not survive a restart. Set ROFORGE_SECRET in production."
  );
}

export const config = {
  port: int("PORT", 8787),
  host: str("HOST", "0.0.0.0"),
  version: "0.1.0",

  // auth
  hmacSecret,
  dataDir: str("ROFORGE_DATA_DIR", path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data")),
  tokenTtlMs: int("ROFORGE_TOKEN_TTL_MS", 7 * 24 * 60 * 60 * 1000), // 7 days
  passwordMinLen: 8,

  // rate limits (per user, per minute)
  rateToolPerMin: int("ROFORGE_RATE_TOOL_PER_MIN", 60),
  rateRequestPerMin: int("ROFORGE_RATE_REQUEST_PER_MIN", 300),

  // web search
  searchProvider: str("ROFORGE_SEARCH_PROVIDER", "auto"), // auto | serper | brave | wikipedia
  serperApiKey: str("SERPER_API_KEY", ""),
  braveApiKey: str("BRAVE_API_KEY", ""),
  searchMaxResults: int("ROFORGE_SEARCH_MAX_RESULTS", 6),

  // url_fetch
  fetchTimeoutMs: int("ROFORGE_FETCH_TIMEOUT_MS", 15000),
  fetchMaxBytes: int("ROFORGE_FETCH_MAX_BYTES", 512 * 1024),
  fetchMaxChars: 60000,

  // roblox api
  robloxTimeoutMs: int("ROFORGE_ROBLOX_TIMEOUT_MS", 10000),
  userAgent: "RoForge/0.1 (+https://github.com/roforge/roforge)",

  // request body limit
  maxBodyBytes: 256 * 1024,
};
