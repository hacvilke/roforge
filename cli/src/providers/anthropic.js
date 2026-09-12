// Anthropic Messages API — streaming (SSE) with tool use.
// The API key goes directly to api.anthropic.com (or cfg.anthropicBaseUrl).
import { createSSE } from "../util.js";

export class ProviderError extends Error {}

/**
 * cfg: resolved config
 * params: { system, messages (internal history), tools, signal }
 * events: { onText(delta), onToolStart(name, id) }
 * returns: { text, toolCalls: [{id, name, input}], stopReason, usage }
 */
export async function chatStream(cfg, params, events = {}) {
  const key = cfg.anthropicKey;
  if (!key) throw new ProviderError("No Anthropic API key. Run `roforge login` or set ANTHROPIC_API_KEY.");
  const body = {
    model: params.model,
    max_tokens: params.maxTokens || cfg.maxTokens || 8000,
    stream: true,
    messages: renderHistory(params.messages),
  };
  if (params.system) body.system = params.system;
  if (params.tools && params.tools.length) body.tools = renderTools(params.tools);

  let res;
  try {
    res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e) {
    throw new ProviderError(`network error calling Anthropic: ${e.cause?.code || e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`Anthropic HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  let text = "";
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls = [];
  let currentTool = null;

  const sse = createSSE((ev) => {
    const d = ev.data;
    if (typeof d !== "object" || !d) return;
    switch (ev.event) {
      case "message_start":
        if (d.message && d.message.usage) usage = { ...usage, ...d.message.usage };
        break;
      case "content_block_start":
        if (d.content_block && d.content_block.type === "tool_use") {
          currentTool = { id: d.content_block.id, name: d.content_block.name, input: {}, _json: "" };
          toolCalls.push(currentTool);
          events.onToolStart && events.onToolStart(currentTool.name, currentTool.id);
        }
        break;
      case "content_block_delta": {
        const delta = d.delta;
        if (!delta) break;
        if (delta.type === "text_delta") {
          text += delta.text || "";
          events.onText && events.onText(delta.text || "");
        } else if (delta.type === "input_json_delta" && currentTool) {
          currentTool._json += delta.partial_json || "";
        }
        break;
      }
      case "content_block_stop":
        if (currentTool) {
          try {
            currentTool.input = currentTool._json ? JSON.parse(currentTool._json) : {};
          } catch {
            currentTool.input = {};
          }
          delete currentTool._json;
          currentTool = null;
        }
        break;
      case "message_delta":
        if (d.delta && d.delta.stop_reason) stopReason = d.delta.stop_reason;
        if (d.usage) usage = { ...usage, ...d.usage };
        break;
      default:
        break;
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

// Internal history → Anthropic messages.
// items: {role:"user",text} | {role:"assistant",text?,calls?} | {role:"tool",id,name,result}
export function renderHistory(history) {
  const msgs = [];
  for (const item of history) {
    if (item.role === "user") {
      msgs.push({ role: "user", content: item.text });
    } else if (item.role === "assistant") {
      const blocks = [];
      if (item.text) blocks.push({ type: "text", text: item.text });
      if (item.calls) {
        for (const c of item.calls) {
          blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args || c.input || {} });
        }
      }
      if (blocks.length) msgs.push({ role: "assistant", content: blocks });
    } else if (item.role === "tool") {
      // content: string, or [image block, text block] when the tool returned
      // a vision capture (e.g. forge_viewport).
      let content = item.result;
      if (item.image && item.image.base64) {
        content = [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: item.image.mediaType || "image/png",
              data: item.image.base64,
            },
          },
          { type: "text", text: item.result },
        ];
      }
      const block = { type: "tool_result", tool_use_id: item.id, content };
      const last = msgs[msgs.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        msgs.push({ role: "user", content: [block] });
      }
    }
  }
  return msgs;
}

export function renderTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema || t.input_schema,
  }));
}
