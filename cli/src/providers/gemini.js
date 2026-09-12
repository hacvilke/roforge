// Google Gemini (Generative Language API) — streaming (SSE) with function
// calling and inline images. The API key goes directly to Google
// (generativelanguage.googleapis.com, or cfg.geminiBaseUrl for mocks).
//
// Free tier: gemini-2.5-flash & Flash-Lite at ~1,500 req/day, no card needed.
import { createSSE } from "../util.js";
import { ProviderError } from "./anthropic.js";

let callCounter = 0;

/**
 * cfg: resolved config
 * params: { model, maxTokens, system, messages (internal history), tools, signal }
 * events: { onText(delta), onToolStart(name, id) }
 * returns: { text, toolCalls: [{id, name, input}], stopReason, usage }
 */
export async function chatStream(cfg, params, events = {}) {
  const key = cfg.geminiKey;
  if (!key) throw new ProviderError("No Gemini API key. Run `roforge login --provider gemini` or set GEMINI_API_KEY (free at aistudio.google.com).");
  const base = (cfg.geminiBaseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const body = {
    contents: renderHistory(params.messages),
    generationConfig: { maxOutputTokens: params.maxTokens || cfg.maxTokens || 8000 },
  };
  if (params.system) body.systemInstruction = { parts: [{ text: params.system }] };
  if (params.tools && params.tools.length) body.tools = [{ functionDeclarations: renderTools(params.tools) }];

  let res;
  try {
    res = await fetch(`${base}/v1beta/models/${params.model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError(`network error calling Gemini: ${e.cause?.code || e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`Gemini HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let text = "";
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls = [];
  const seenTools = new Set();

  const sse = createSSE((ev) => {
    const d = ev.data;
    if (typeof d !== "object" || !d) return;
    if (d.usageMetadata) {
      usage.input_tokens = d.usageMetadata.promptTokenCount || usage.input_tokens;
      usage.output_tokens = d.usageMetadata.candidatesTokenCount || usage.output_tokens;
    }
    const candidate = (d.candidates || [])[0];
    if (!candidate) return;
    if (candidate.finishReason) {
      stopReason =
        candidate.finishReason === "STOP" ? "end_turn" : candidate.finishReason === "MAX_TOKENS" ? "max_tokens" : candidate.finishReason.toLowerCase();
    }
    const parts = (candidate.content && candidate.content.parts) || [];
    for (const part of parts) {
      if (typeof part.text === "string" && part.text) {
        text += part.text;
        events.onText && events.onText(part.text);
      } else if (part.functionCall && part.functionCall.name) {
        const id = `call_gem_${++callCounter}_${toolCalls.length}`;
        const rec = { id, name: part.functionCall.name, input: part.functionCall.args || {} };
        if (!seenTools.has(id)) {
          seenTools.add(id);
          toolCalls.push(rec);
          events.onToolStart && events.onToolStart(rec.name, rec.id);
        }
      }
    }
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sse.push(decoder.decode(value, { stream: true }));
  }
  sse.end();

  return { text, toolCalls, stopReason, usage };
}

// Internal history → Gemini `contents` (role "user"/"model", parts arrays).
// Consecutive same-role turns are merged (Gemini requires alternation; our
// history has one assistant turn followed by N tool results).
export function renderHistory(history) {
  const contents = [];
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };
  for (const item of history) {
    if (item.role === "user") {
      push("user", [{ text: item.text }]);
    } else if (item.role === "assistant") {
      const parts = [];
      if (item.text) parts.push({ text: item.text });
      if (item.calls) {
        for (const c of item.calls) {
          parts.push({ functionCall: { name: c.name, args: c.args || c.input || {} } });
        }
      }
      push("model", parts);
    } else if (item.role === "tool") {
      const parts = [
        { functionResponse: { name: item.name, response: { result: item.result } } },
      ];
      if (item.image && item.image.base64) {
        parts.push({ inlineData: { mimeType: item.image.mediaType || "image/png", data: item.image.base64 } });
      }
      push("user", parts);
    }
  }
  return contents;
}

export function renderTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema || t.input_schema,
  }));
}
