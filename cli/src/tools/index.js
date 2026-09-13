// Tool registry: merges local tools (web, roblox, project) with the active
// Studio tier (bridge or MCP). Same contract everywhere:
//   { name, description, inputSchema, execute(args, ctx) -> string, requiresApproval? }
// Errors are returned as "ERROR: ..." strings the model can adapt to.
import { webTools } from "./web.js";
import { robloxTools } from "./roblox.js";
import { projectTools } from "./project.js";
import { bridgeTools, mcpToolsFromList, mcpCaptureNames } from "./studio.js";
import { McpClient } from "../mcp.js";
import { loadPlugins } from "../plugins.js";
import { configDir } from "../config.js";

export async function buildTools({ cfg, cwd, bridgeServer, luauAnalyzePath }) {
  const tools = [];
  const seen = new Set();
  const add = (list) => {
    for (const t of list) {
      if (!t || seen.has(t.name)) continue;
      seen.add(t.name);
      tools.push(t);
    }
  };

  add(webTools());
  add(robloxTools());
  add(projectTools({ cwd, luauAnalyzePath }));
  if (bridgeServer) add(bridgeTools(bridgeServer));

  // Strict declarative plugins (JSON only — no code fields, ever).
  const pluginInfo =
    cfg && cfg.plugins && cfg.plugins.enabled === false
      ? { tools: [], plugins: [], pluginErrors: [] }
      : loadPlugins({ cwd, configDirBase: configDir() });
  add(pluginInfo.tools);

  // MCP tier (official, built into Studio)
  if (cfg.studioMode === "mcp" || cfg.studioMode === "auto") {
    try {
      const client = new McpClient(cfg.mcpUrl, { timeoutMs: cfg.studioMode === "mcp" ? 30000 : 4000 });
      await client.connect();
      const raw = await client.listTools();
      if (raw.length) {
        add(mcpToolsFromList(client, raw));
        cfg._mcpClient = client;
        cfg._mcpConnected = true;
        return {
          tools,
          mcp: true,
          bridge: Boolean(bridgeServer),
          mcpToolCount: raw.length,
          mcpCapture: mcpCaptureNames(raw),
          plugins: pluginInfo.plugins,
          pluginErrors: pluginInfo.errors,
        };
      }
    } catch {
      /* fall through to bridge-only */
    }
  }

  return {
    tools,
    mcp: false,
    bridge: Boolean(bridgeServer),
    mcpToolCount: 0,
    mcpCapture: [],
    plugins: pluginInfo.plugins,
    pluginErrors: pluginInfo.errors,
  };
}

export function listToolNames(tools) {
  return tools.map((t) => t.name);
}
