// OpenAI Chat Completions — streaming (SSE) with function calling.
// The API key goes directly to api.openai.com (or cfg.openaiBaseUrl).
import { createSSE } from "../util.js";
import { ProviderError } from "./anthropic.js";

// fetch with a per-attempt timeout and ONE automatic retry on network-level
// failures (UND_ERR_CONNECT_TIMEOUT etc.) — user-initiated aborts are never
// retried.
export async function fetchWithRetry(url, opts, { timeoutMs = 60000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw lastErr || new ProviderError("aborted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => controller.abort(opts.signal.reason);
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } catch (e) {
      lastErr = e;
      if (opts.signal?.aborted) break; // user Ctrl+C — don't retry
      const sig = `${e.cause?.code || ""} ${e.name} ${e.message}`;
      const isNetwork = /UND_ERR|ECONN|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENOTFOUND|timeout|aborted/i.test(sig);
      if (!isNetwork || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr;
}

export async function chatStream(cfg, params, events = {}) {
  const key = cfg.openaiKey;
  if (!key) throw new ProviderError("No OpenAI API key. Run `roforge login` or set OPENAI_API_KEY.");
  const msgs = renderHistory(params.messages);
  if (params.system) msgs.unshift({ role: "system", content: params.system });
  const body = {
    model: params.model,
    stream: true,
    messages: msgs,
  };
  if (params.tools && params.tools.length) body.tools = renderTools(params.tools);

  let res;
  try {
    res = await fetchWithRetry(`${cfg.openaiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError(
      `network error calling OpenAI: ${e.cause?.code || e.message} (retried once — if it persists, check your connection)`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // OpenRouter retires free slugs; the 404 body names the paid replacement
    if (res.status === 404 && /unavailable for free/i.test(text)) {
      const m = text.match(/use this slug instead:\s*([^\s",}]+)/);
      throw new ProviderError(
        `${params.model} was retired from the free tier. Paid slug: ${m ? m[1] : "(see error)"} — ` +
          "or pick a live free model: https://openrouter.ai/models?max_price=0 (then /model openrouter:<slug>)"
      );
    }
    throw new ProviderError(`OpenAI HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let text = "";
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls = [];

  const sse = createSSE((ev) => {
    const d = ev.data;
    if (d === "[DONE]") return;
    if (typeof d !== "object" || !d) return;
    if (d.usage) usage = { ...usage, ...d.usage };
    const choice = (d.choices || [])[0];
    if (!choice) return;
    const delta = choice.delta || {};
    if (choice.finish_reason) stopReason = choice.finish_reason;
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      events.onText && events.onText(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: "", name: "", input: {}, _json: "" };
        const rec = toolCalls[idx];
        if (tc.id) {
          if (!rec.id) events.onToolStart && events.onToolStart(tc.function?.name || "tool", tc.id);
          rec.id = tc.id;
        }
        if (tc.function && tc.function.name) rec.name = tc.function.name;
        if (tc.function && tc.function.arguments) rec._json += tc.function.arguments;
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

  const finalCalls = toolCalls
    .filter(Boolean)
    .map((rec) => {
      try {
        rec.input = rec._json ? JSON.parse(rec._json) : {};
      } catch {
        rec.input = {};
      }
      delete rec._json;
      return { id: rec.id, name: rec.name, input: rec.input };
    });

  const normReason = stopReason === "tool_calls" ? "tool_use" : stopReason === "stop" ? "end_turn" : stopReason;
  return { text, toolCalls: finalCalls, stopReason: normReason, usage };
}

export function renderHistory(history) {
  const msgs = [];
  for (const item of history) {
    if (item.role === "user") {
      msgs.push({ role: "user", content: item.text });
    } else if (item.role === "assistant") {
      const msg = { role: "assistant", content: item.text || "" };
      if (item.calls && item.calls.length) {
        msg.tool_calls = item.calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args || c.input || {}) },
        }));
      }
      msgs.push(msg);
    } else if (item.role === "tool") {
      msgs.push({ role: "tool", tool_call_id: item.id, content: item.result });
      // OpenAI has no image in tool messages — attach a follow-up user
      // message with an image_url data URI when the tool returned an image.
      if (item.image && item.image.base64) {
        const uri = `data:${item.image.mediaType || "image/png"};base64,${item.image.base64}`;
        msgs.push({
          role: "user",
          content: [
            { type: "text", text: `Image captured by tool ${item.name} (rendered from the Studio viewport):` },
            { type: "image_url", image_url: { url: uri } },
          ],
        });
      }
    }
  }
  return msgs;
}

export function renderTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema || t.input_schema,
    },
  }));
}
