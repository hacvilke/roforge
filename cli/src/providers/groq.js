// Groq — fast inference for open-weight models (Llama, Gemma, DeepSeek
// distills). OpenAI-compatible, so this reuses the OpenAI streaming client
// with provider-specific key/base. Free tier: ~1,000 req/day per model.
// The key goes directly to api.groq.com (or cfg.groqBaseUrl for mocks).
import { chatStream as openaiChatStream } from "./openai.js";

export function chatStream(cfg, params, events = {}) {
  const mapped = {
    ...cfg,
    openaiKey: cfg.groqKey,
    openaiBaseUrl: cfg.groqBaseUrl || "https://api.groq.com/openai",
  };
  return openaiChatStream(mapped, { ...params, model: params.model }, events);
}

export { renderHistory, renderTools } from "./openai.js";
