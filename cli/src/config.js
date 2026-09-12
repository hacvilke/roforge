// RoForge CLI configuration.
// Precedence: env vars > ~/.roforge/config.json > defaults.
//
// Privacy: API keys live ONLY in this local config (or env). They are sent
// ONLY to the model provider. The Studio bridge and MCP traffic are local-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomToken } from "./util.js";

export const CONFIG_DIR = process.env.ROFORGE_CONFIG_DIR || path.join(os.homedir(), ".roforge");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Provider registry. "auto" (default) picks the first configured provider,
// free-tier providers first (gemini → groq → openrouter → anthropic → openai).
export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    keyField: "geminiKey",
    env: "GEMINI_API_KEY",
    baseField: "geminiBaseUrl",
    defaultModel: "gemini-2.5-flash",
    freeModel: "gemini-2.5-flash", // free tier: ~1,500 req/day, no card
    hasFreeTier: true,
  },
  groq: {
    label: "Groq",
    keyField: "groqKey",
    env: "GROQ_API_KEY",
    baseField: "groqBaseUrl",
    defaultModel: "llama-3.3-70b-versatile",
    freeModel: "llama-3.3-70b-versatile", // free tier: ~1,000 req/day per model
    hasFreeTier: true,
  },
  openrouter: {
    label: "OpenRouter",
    keyField: "openrouterKey",
    env: "OPENROUTER_API_KEY",
    baseField: "openrouterBaseUrl",
    defaultModel: "qwen/qwen3-coder",
    freeModel: "qwen/qwen3-coder:free", // :free models: req/day limit, no billing
    hasFreeTier: true,
  },
  anthropic: {
    label: "Anthropic",
    keyField: "anthropicKey",
    env: "ANTHROPIC_API_KEY",
    baseField: "anthropicBaseUrl",
    defaultModel: "claude-sonnet-4-5",
    freeModel: null,
    hasFreeTier: false,
  },
  openai: {
    label: "OpenAI",
    keyField: "openaiKey",
    env: "OPENAI_API_KEY",
    baseField: "openaiBaseUrl",
    defaultModel: "gpt-4.1",
    freeModel: null,
    hasFreeTier: false,
  },
};

// auto-routing order. freeFirst (default) prefers the free tiers so the CLI
// works out of the box with a free AI Studio key.
const ORDER_FREE_FIRST = ["gemini", "groq", "openrouter", "anthropic", "openai"];
const ORDER_PAID_FIRST = ["anthropic", "openai", "gemini", "groq", "openrouter"];

const DEFAULTS = {
  provider: "auto", // auto | gemini | groq | openrouter | anthropic | openai
  model: "", // empty = provider default; "provider:model" pins a provider
  freeFirst: true, // auto mode: prefer free-tier providers/models
  geminiKey: "",
  groqKey: "",
  openrouterKey: "",
  anthropicKey: "",
  openaiKey: "",
  geminiBaseUrl: "https://generativelanguage.googleapis.com",
  groqBaseUrl: "https://api.groq.com/openai",
  openrouterBaseUrl: "https://openrouter.ai/api",
  anthropicBaseUrl: "https://api.anthropic.com",
  openaiBaseUrl: "https://api.openai.com",
  maxTokens: 8000,
  maxIterations: 12,
  // web search
  searchProvider: "auto", // auto | serper | brave | wikipedia
  serperKey: "",
  braveKey: "",
  // studio connection
  studioMode: "auto", // auto | mcp | bridge
  mcpUrl: "http://localhost:3004/mcp",
  bridge: {
    port: 8790,
    host: "127.0.0.1",
    token: "",
  },
  // approvals: "ask" (default) or "yolo"
  approve: "ask",
  // approximate pricing per 1M tokens (USD) for the cost display.
  // Free-tier models are 0/0.
  pricing: {
    "claude-sonnet-4-5": { input: 3, output: 15 },
    "claude-opus-4-5": { input: 5, output: 25 },
    "claude-haiku-4-5": { input: 1, output: 5 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gemini-2.5-flash": { input: 0, output: 0 },
    "llama-3.3-70b-versatile": { input: 0, output: 0 },
    "qwen/qwen3-coder:free": { input: 0, output: 0 },
  },
};

export function loadFileConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveFileConfig(patch) {
  const current = loadFileConfig();
  const next = deepMerge(current, patch);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
  }
  return out;
}

// Resolved, runtime config (env overrides applied, defaults filled).
export function resolveConfig() {
  const file = loadFileConfig();
  const cfg = deepMerge(DEFAULTS, file);

  cfg.geminiKey = process.env.GEMINI_API_KEY || cfg.geminiKey || "";
  cfg.groqKey = process.env.GROQ_API_KEY || cfg.groqKey || "";
  cfg.openrouterKey = process.env.OPENROUTER_API_KEY || cfg.openrouterKey || "";
  cfg.anthropicKey = process.env.ANTHROPIC_API_KEY || cfg.anthropicKey || "";
  cfg.openaiKey = process.env.OPENAI_API_KEY || cfg.openaiKey || "";
  cfg.model = process.env.ROFORGE_MODEL || cfg.model;
  if (process.env.ROFORGE_PROVIDER) cfg.provider = process.env.ROFORGE_PROVIDER;
  if (process.env.ROFORGE_MCP_URL) cfg.mcpUrl = process.env.ROFORGE_MCP_URL;
  if (process.env.ROFORGE_BRIDGE_PORT) cfg.bridge.port = Number(process.env.ROFORGE_BRIDGE_PORT);
  if (process.env.ROFORGE_STUDIO_MODE) cfg.studioMode = process.env.ROFORGE_STUDIO_MODE;
  if (process.env.ROFORGE_MAX_ITERATIONS) cfg.maxIterations = Number(process.env.ROFORGE_MAX_ITERATIONS);
  if (process.env.ROFORGE_FREE_FIRST === "0" || process.env.ROFORGE_FREE_FIRST === "false") cfg.freeFirst = false;

  if (!cfg.bridge.token) {
    cfg.bridge.token = randomToken(24);
    // persist so the token survives restarts (the plugin stores it once)
    try {
      saveFileConfig({ bridge: { token: cfg.bridge.token } });
    } catch {
      /* non-fatal */
    }
  }
  return cfg;
}

export function providerMeta(name) {
  return PROVIDERS[name] || null;
}

export function providerHasKey(cfg, name) {
  const meta = PROVIDERS[name];
  return Boolean(meta && cfg[meta.keyField]);
}

// The provider that will actually serve requests:
// an explicit (valid, key-held) cfg.provider wins; otherwise "auto" walks
// the configured providers free-tier-first (or paid-first when freeFirst=false).
export function effectiveProvider(cfg) {
  if (cfg.provider && cfg.provider !== "auto") {
    return PROVIDERS[cfg.provider] && providerHasKey(cfg, cfg.provider) ? cfg.provider : null;
  }
  const order = cfg.freeFirst === false ? ORDER_PAID_FIRST : ORDER_FREE_FIRST;
  return order.find((p) => providerHasKey(cfg, p)) || null;
}

// "gemini:gemini-2.5-flash" → {provider:"gemini", model:"gemini-2.5-flash"}.
// Models may contain ":" themselves (OpenRouter), so only the FIRST segment
// counts as a provider prefix.
export function parseModelRef(model) {
  if (typeof model === "string" && model.includes(":")) {
    const i = model.indexOf(":");
    const p = model.slice(0, i);
    const rest = model.slice(i + 1);
    if (PROVIDERS[p] && rest) return { provider: p, model: rest };
  }
  return null;
}

export function modelFor(cfg) {
  // an explicit model ref like "provider:model" pins both
  const ref = parseModelRef(cfg.model);
  if (ref && providerHasKey(cfg, ref.provider)) {
    return ref.model;
  }
  const prov = ref ? null : effectiveProvider(cfg);
  const meta = prov && PROVIDERS[prov];
  if (!meta) return cfg.model || "claude-sonnet-4-5";
  // auto mode + freeFirst → the provider's free model; explicit provider →
  // its default model
  const wantFree = cfg.provider === "auto" && cfg.freeFirst !== false;
  return wantFree && meta.freeModel ? meta.freeModel : meta.defaultModel;
}

export function apiKeyFor(cfg) {
  const prov = effectiveProvider(cfg);
  const meta = prov && PROVIDERS[prov];
  return meta ? cfg[meta.keyField] || "" : "";
}

export function estimateCost(cfg, usage) {
  if (!usage) return null;
  const p = cfg.pricing && cfg.pricing[modelFor(cfg)];
  if (!p) return { tokens: usage, cost: null };
  const cost = ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output) / 1_000_000;
  return { tokens: usage, cost };
}
