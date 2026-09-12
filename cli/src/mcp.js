// Minimal MCP (Model Context Protocol) client over the Streamable HTTP
// transport — used to talk to the MCP server built into Roblox Studio
// (File → Studio Settings → Beta Features → "MCP Server", default
// http://localhost:3004/mcp).
//
// Implements just enough of the protocol: initialize → tools/list → tools/call.
// Responses may arrive as a single JSON object or as an SSE stream; both handled.
import { parseSSEStream } from "./util.js";

export class McpError extends Error {}

export class McpClient {
  constructor(url, { timeoutMs = 30000 } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.nextId = 1;
    this.serverInfo = null;
  }

  async request(method, params) {
    const id = this.nextId++;
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    let res;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const reason = e.name === "TimeoutError" ? "timed out " : "";
      throw new McpError(`Studio MCP unreachable at ${this.url} (${reason}${e.cause?.code || e.message})`);
    }

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const ctype = res.headers.get("content-type") || "";
    const bodyText = await res.text();

    if (!res.ok) {
      let msg = bodyText.slice(0, 200);
      try {
        const j = JSON.parse(bodyText);
        msg = (j.error && j.error.message) || msg;
      } catch {
        /* keep slice */
      }
      throw new McpError(`MCP HTTP ${res.status}: ${msg}`);
    }

    let payload = null;
    if (ctype.includes("text/event-stream")) {
      for (const ev of parseSSEStream(bodyText)) {
        if (ev.event === "message" && ev.data && ev.data.id === id) {
          payload = ev.data;
          break;
        }
      }
      if (!payload) {
        // some servers send the result in an unnamed message event
        const first = parseSSEStream(bodyText).find((e) => e.data && typeof e.data === "object" && e.data.result);
        if (first) payload = first.data;
      }
    } else {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        if (bodyText.trim()) throw new McpError(`MCP: unparseable response: ${bodyText.slice(0, 120)}`);
      }
    }
    if (!payload) throw new McpError(`MCP: no response for request ${id}`);
    if (payload.error) throw new McpError(`MCP error ${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  }

  async notify(method, params) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: AbortSignal.timeout(10000),
      });
      await res.arrayBuffer(); // drain
    } catch {
      /* notifications are best-effort */
    }
  }

  async connect() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "roforge-cli", version: "0.2.0" },
    });
    this.serverInfo = result.serverInfo || null;
    await this.notify("notifications/initialized", {});
    return result;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return (result && result.tools) || [];
  }

  // Returns { text, isError, image? } — image is {base64, mediaType} when the
  // tool returned an MCP image content block (e.g. Studio's built-in
  // screenshot/capture tools) or a resource blob.
  async callTool(name, args) {
    const result = await this.request("tools/call", { name, arguments: args || {} });
    const content = (result && result.content) || [];
    const texts = [];
    let image = null;
    for (const c of content) {
      if (c.type === "text" && typeof c.text === "string") {
        texts.push(c.text);
      } else if (c.type === "image" && typeof c.data === "string" && c.data.length) {
        image = image || { base64: c.data, mediaType: c.mimeType || "image/png" };
      } else if (c.type === "resource" && c.resource) {
        if (typeof c.resource.blob === "string" && c.resource.blob.length) {
          image = image || { base64: c.resource.blob, mediaType: c.resource.mimeType || "image/png" };
        }
        if (typeof c.resource.text === "string") texts.push(c.resource.text);
      } else {
        texts.push(JSON.stringify(c));
      }
    }
    return { text: texts.join("\n") || "(no output)", isError: Boolean(result && result.isError), image: image || undefined };
  }
}

// Probe: is a Studio MCP server answering at url? Returns {ok, serverInfo, toolCount} or {ok:false, error}.
export async function probeMcp(url, { timeoutMs = 4000 } = {}) {
  const client = new McpClient(url, { timeoutMs });
  try {
    const init = await client.connect();
    let toolCount = -1;
    try {
      toolCount = (await client.listTools()).length;
    } catch {
      /* connected but tools/list failed — still ok */
    }
    return { ok: true, serverInfo: init.serverInfo, toolCount };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
