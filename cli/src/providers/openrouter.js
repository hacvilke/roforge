// OpenRouter — one key, hundreds of models. OpenAI-compatible chat
// completions, so this reuses the OpenAI streaming client with
// provider-specific key/base. Free models use the ":free" suffix
// (request-per-day limits, no billing). The key goes directly to
// openrouter.ai (or cfg.openrouterBaseUrl for mocks).
import { chatStream as openaiChatStream } from "./openai.js";

export function chatStream(cfg, params, events = {}) {
  const mapped = {
    ...cfg,
    openaiKey: cfg.openrouterKey,
    openaiBaseUrl: cfg.openrouterBaseUrl || "https://openrouter.ai/api",
  };
  return openaiChatStream(mapped, { ...params, model: params.model }, events);
}

export { renderHistory, renderTools } from "./openai.js";
