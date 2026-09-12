// The agent loop: chat ↔ model provider ↔ tools, until a final answer.
// Runs locally — streaming, with an iteration safety cap.
import { ProviderError } from "./providers/anthropic.js";

const MAX_TOOL_RESULT_CHARS = 24000;
const MAX_HISTORY_ITEMS = 60;

function truncate(s, n = MAX_TOOL_RESULT_CHARS) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + `\n... [truncated ${s.length - n} chars]` : s;
}

function trimHistory(history) {
  while (history.length > MAX_HISTORY_ITEMS) history.shift();
  if (history.length && history[0].role !== "user") {
    history.unshift({ role: "user", text: "(Earlier conversation was trimmed to fit the context window.)" });
  }
}

/**
 * run(cfg, provider, history, system, tools, io)
 * provider: { chatStream(cfg, {model, system, messages, tools, signal}, events) -> {text, toolCalls, usage} }
 * io: {
 *   onText(delta), onAssistantDone(text), onToolStart(tool, args), onToolEnd(tool, args, result),
 *   onIter(n, total), onUsage(usage), onDone(), onAborted(), onError(err),
 *   shouldAbort() -> bool,        // user pressed Ctrl+C
 *   approve(name, args) -> bool,  // approval gate (session supplies)
 * }
 * returns { ok, text, usage: {input_tokens, output_tokens}, iterations }
 */
export async function runAgent(cfg, provider, history, system, tools, io) {
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const maxIterations = cfg.maxIterations || 12;
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = "";

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (io.shouldAbort && io.shouldAbort()) {
      io.onAborted && io.onAborted();
      return { ok: false, aborted: true, text: finalText, usage: totalUsage, iterations: iter - 1 };
    }
    io.onIter && io.onIter(iter, maxIterations);

    let result;
    try {
      result = await provider.chatStream(
        cfg,
        {
          model: cfg._activeModel,
          maxTokens: cfg.maxTokens,
          system,
          messages: history,
          tools,
          signal: io.abortSignal,
        },
        { onText: io.onText }
      );
    } catch (e) {
      if (io.shouldAbort && io.shouldAbort()) {
        io.onAborted && io.onAborted();
        return { ok: false, aborted: true, text: finalText, usage: totalUsage, iterations: iter - 1 };
      }
      io.onError && io.onError(e instanceof ProviderError ? e.message : String(e.message || e));
      return { ok: false, error: true, text: finalText, usage: totalUsage, iterations: iter - 1 };
    }

    if (result.usage) {
      totalUsage.input_tokens += result.usage.input_tokens || 0;
      totalUsage.output_tokens += result.usage.output_tokens || 0;
      io.onUsage && io.onUsage(totalUsage);
    }

    const text = result.text || "";
    const calls = result.toolCalls || [];

    if (text) {
      finalText = text;
    }
    if (!calls.length) {
      history.push({ role: "assistant", text: text || "(no output)" });
      trimHistory(history);
      io.onAssistantDone && io.onAssistantDone(text);
      io.onDone && io.onDone();
      return { ok: true, text: finalText, usage: totalUsage, iterations: iter };
    }

    // record assistant turn with tool calls, then execute each
    history.push({
      role: "assistant",
      text: text || null,
      calls: calls.map((c) => ({ id: c.id, name: c.name, args: c.input })),
    });

    for (const call of calls) {
      if (io.shouldAbort && io.shouldAbort()) {
        io.onAborted && io.onAborted();
        return { ok: false, aborted: true, text: finalText, usage: totalUsage, iterations: iter };
      }
      const tool = toolByName.get(call.name);
      let resultStr;
      let image; // {base64, mediaType} — set when a tool returns an image
      if (!tool) {
        resultStr = `ERROR: unknown tool '${call.name}'. Do not call it again.`;
      } else {
        io.onToolStart && io.onToolStart(tool, call.input || {});
        if (tool.requiresApproval) {
          const ok = (await (io.approve && io.approve(tool.name, call.input || {}))) || false;
          if (!ok) {
            resultStr = "ERROR: user declined to run this tool. Choose a different approach or ask the user what they want.";
            io.onToolEnd && io.onToolEnd(tool, call.input || {}, resultStr);
            history.push({ role: "tool", id: call.id, name: call.name, result: resultStr });
            continue;
          }
        }
        try {
          const raw = await tool.execute(call.input || {}, { cfg, history, iter });
          if (raw && typeof raw === "object") {
            resultStr = String(raw.text ?? "");
            if (raw.image && typeof raw.image.base64 === "string") image = raw.image;
          } else {
            resultStr = String(raw ?? "");
          }
        } catch (e) {
          resultStr = `ERROR: ${e.message || e}`;
        }
      }
      resultStr = truncate(resultStr);
      io.onToolEnd && io.onToolEnd(tool, call.input || {}, resultStr);
      history.push({ role: "tool", id: call.id, name: call.name, result: resultStr, ...(image ? { image } : {}) });
      trimHistory(history);
    }
  }

  const msg = `Stopped after ${maxIterations} iterations (safety limit). Say "continue" to pick up where I left off.`;
  io.onError && io.onError(msg);
  return { ok: false, limit: true, text: finalText, usage: totalUsage, iterations: maxIterations };
}
