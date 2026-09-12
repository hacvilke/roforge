// RoForge server entry point — zero-dependency HTTP server.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { json, readJsonBody, HttpError } from "./util.js";
import { login, requireUser } from "./auth.js";
import { checkRate } from "./ratelimit.js";
import { listTools, getTool, activeSearchProvider } from "./tools/registry.js";

async function handler(req, res) {
  const started = Date.now();
  let user = null;
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
    // CORS — Studio is not a browser, but a future web dashboard can use it.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "roforge",
        version: config.version,
        tools: listTools().length,
        searchProvider: activeSearchProvider(),
        time: new Date().toISOString(),
      });
    }

    if (req.method === "GET" && pathname === "/v1/info") {
      return json(res, 200, {
        service: "roforge",
        version: config.version,
        endpoints: ["POST /v1/auth/login", "GET /v1/tools", "POST /v1/tools/:name", "GET /health"],
        docs: "docs/TOOL_SPEC.md",
      });
    }

    if (req.method === "POST" && pathname === "/v1/auth/login") {
      const body = await readJsonBody(req, config.maxBodyBytes);
      const out = login(body.username, body.password);
      console.log(`[auth] login ok user=${out.username}`);
      return json(res, 200, out);
    }

    // Everything below requires auth.
    user = requireUser(req);
    const rl = checkRate(`req:${user.username}`, config.rateRequestPerMin);
    if (!rl.allowed) {
      res.setHeader("retry-after", String(rl.retryAfterSec));
      return json(res, 429, { error: "Rate limit exceeded", code: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec });
    }

    if (req.method === "GET" && pathname === "/v1/tools") {
      return json(res, 200, { tools: listTools() });
    }

    const m = /^\/v1\/tools\/([a-zA-Z0-9_-]+)$/.exec(pathname);
    if (req.method === "POST" && m) {
      const tool = getTool(m[1]);
      if (!tool) return json(res, 404, { error: `Unknown tool '${m[1]}'`, code: "TOOL_NOT_FOUND" });
      const trl = checkRate(`tool:${user.username}`, config.rateToolPerMin);
      if (!trl.allowed) {
        res.setHeader("retry-after", String(trl.retryAfterSec));
        return json(res, 429, { error: "Tool rate limit exceeded", code: "RATE_LIMITED", retryAfterSec: trl.retryAfterSec });
      }
      const body = await readJsonBody(req, config.maxBodyBytes);
      const args = body && typeof body === "object" && body.args && typeof body.args === "object" ? body.args : {};
      console.log(`[tool] ${user.username} → ${tool.name}`);
      const result = await tool.execute(args);
      return json(res, 200, { ok: true, tool: tool.name, result: String(result) });
    }

    return json(res, 404, { error: `No route: ${req.method} ${pathname}`, code: "NOT_FOUND" });
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "INTERNAL";
    if (status >= 500) console.error("[error]", err);
    json(res, status, { error: err.message || "Internal error", code });
  } finally {
    // Deliberately no request bodies / auth headers in logs (docs/SECURITY.md).
    const ms = Date.now() - started;
    console.log(`${req.method} ${pathname} ${res.statusCode} ${ms}ms${user ? ` user=${user.username}` : ""}`);
  }
}

export function createServer() {
  return http.createServer(handler);
}

export function startServer(port = config.port, host = config.host) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then((s) => {
    const { port } = s.address();
    console.log(`[roforge] listening on http://${config.host}:${port}`);
    console.log(`[roforge] search provider: ${activeSearchProvider()}`);
    console.log(`[roforge] data dir: ${config.dataDir}`);
  });
}
