// Studio tools — two interchangeable tiers:
//   • bridge: our RoForge Bridge plugin polls the local BridgeServer
//   • mcp:    the MCP server built into Roblox Studio (beta), over HTTP
// Both expose the same tool shape; the agent doesn't care which tier answers.

const BRIDGE_TOOL_NAMES = [
  "forge_selected",
  "forge_tree",
  "forge_read",
  "forge_write",
  "forge_create",
  "forge_delete",
  "forge_run",
  "forge_screenshot",
  "forge_game_info",
  "forge_viewport",
  "forge_get_property",
  "forge_set_property",
  "forge_get_attributes",
  "forge_set_attribute",
  "forge_select",
  "forge_checkpoint",
  "forge_undo",
  "forge_checkpoints",
  "forge_find",
  "forge_bulk_create",
  "forge_snapshot",
  "forge_diff",
  "forge_export",
  "forge_import",
  "forge_pro",
  "forge_pro_features",
  "forge_cloud_snapshot",
  "forge_cloud_restore",
  "forge_team_share",
];

const BRIDGE_DESCRIPTIONS = {
  forge_selected: "List the instances currently selected in Studio (full path + class).",
  forge_tree: "Show an indented tree of instances in Studio (default root: workspace). Use to discover names before reading or editing.",
  forge_read: "Read a script's source in Studio by dotted path (e.g. 'ServerScriptService.Game.Main'), or dump an instance's properties.",
  forge_write: "Write COMPLETE source to a script in Studio by path. Use after forge_read; send the full new source, never partial edits.",
  forge_create: "Create an instance in Studio under a parent path, optionally setting simple properties.",
  forge_delete: "Delete an instance in Studio by path. Destructive.",
  forge_run: "Run a Luau snippet inside Studio and report return values or the error. For diagnostics only.",
  forge_screenshot: "Save a screenshot of the Studio 3D viewport to the user's computer (file only; the model cannot see it).",
  forge_game_info: "Place id, job id, Studio mode, selection count.",
  forge_viewport: "Capture the Studio 3D viewport as a PNG image that the model can actually SEE (vision). Use to visually inspect the scene after making changes.",
  forge_get_property: "Read a single property of an instance in Studio by dotted path.",
  forge_set_property: "Set a single property of an instance in Studio. Destructive.",
  forge_get_attributes: "List all attributes (name = value) on an instance in Studio.",
  forge_set_attribute: "Set a string/number/boolean attribute on an instance in Studio. Destructive.",
  forge_select: "Set the Studio selection to the given instance paths.",
  forge_checkpoint: "Mark the current Studio state as a named checkpoint in the undo history. Call it BEFORE a batch of destructive changes so they can be rolled back as a unit with forge_undo.",
  forge_undo: "Undo Studio changes: pass to='name' to roll back to a named checkpoint, or omit to undo one step. Destructive.",
  forge_checkpoints: "List recorded checkpoints (name, index, steps back) and the current change-history index.",
  forge_find: "Find instances in Studio by name substring (pattern) and/or ClassName (class_name). Returns up to `limit` full paths (default 50, max 200).",
  forge_bulk_create: "Create many instances in one call (paste-style): items[] of {path: parent path, class_name, name?, properties?}. Destructive.",
  forge_snapshot: "Capture the current instance tree under a name, so forge_diff can show what changed later. Keeps the last 10.",
  forge_diff: "Compare a snapshot to the current instance tree: added (+) and removed (-) instances. Omit name to diff the most recent snapshot.",
  forge_export: "Export a DataModel subtree as JSON (properties, script sources truncated, attributes). Defaults to workspace, depth 3 (max 6; 10 with RoForge Pro).",
  forge_import: "Apply a forge_export JSON back into Studio: recreates the instance tree (properties, sources, attributes) under a parent. dry_run=true only reports. Destructive; max 500 nodes (2500 with RoForge Pro).",
  forge_pro: "Report the current RoForge Pro entitlement: Free or Pro, which pass/product the Studio user owns, and the active limits + Pro features. Call it to know whether the user has Pro.",
  forge_pro_features: "Status of the Pro feature component (closed module): installed or absent, plus its report (snapshot store, team workspace, MCP relay). Read-only; call before offering Pro features.",
  forge_cloud_snapshot: "PRO: save a named snapshot of a place subtree (default: workspace) to the Pro store for later restore. Needs the Pro module installed and the Pro pass.",
  forge_cloud_restore: "PRO: restore a named Pro snapshot into the place (default under workspace). Destructive: rebuilds the instance tree. Needs the Pro module installed and the Pro pass.",
  forge_team_share: "PRO: publish a reference (place id, checkpoint label, or note) to the shared team workspace visible to teammates in the place. Destructive: writes the shared store. Needs the Pro module installed and the Pro pass.",
};

const BRIDGE_SCHEMAS = {
  forge_selected: { type: "object", properties: {}, additionalProperties: false },
  forge_tree: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root service (workspace, ServerScriptService, …). Default workspace." },
      max_depth: { type: "integer", description: "1-6. Default 3." },
    },
    additionalProperties: false,
  },
  forge_read: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  forge_write: {
    type: "object",
    properties: { path: { type: "string" }, source: { type: "string" }, create: { type: "boolean" } },
    required: ["path", "source"],
    additionalProperties: false,
  },
  forge_create: {
    type: "object",
    properties: {
      parent_path: { type: "string" },
      class_name: { type: "string" },
      name: { type: "string" },
      properties: { type: "object" },
    },
    required: ["parent_path", "class_name"],
    additionalProperties: false,
  },
  forge_delete: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  forge_run: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
  forge_screenshot: {
    type: "object",
    properties: { name: { type: "string" }, width: { type: "integer" }, height: { type: "integer" } },
    additionalProperties: false,
  },
  forge_game_info: { type: "object", properties: {}, additionalProperties: false },
  forge_viewport: {
    type: "object",
    properties: {
      width: { type: "integer", description: "256-1280. Default 1024." },
      height: { type: "integer", description: "240-720. Default 576." },
    },
    additionalProperties: false,
  },
  forge_get_property: {
    type: "object",
    properties: { path: { type: "string" }, property: { type: "string" } },
    required: ["path", "property"],
    additionalProperties: false,
  },
  forge_set_property: {
    type: "object",
    properties: {
      path: { type: "string" },
      property: { type: "string" },
      value: { type: "string", description: "New value (numbers/booleans coerced)" },
    },
    required: ["path", "property", "value"],
    additionalProperties: false,
  },
  forge_get_attributes: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  forge_set_attribute: {
    type: "object",
    properties: {
      path: { type: "string" },
      name: { type: "string" },
      value: { type: "string", description: "New value (string/number/boolean)" },
    },
    required: ["path", "name", "value"],
    additionalProperties: false,
  },
  forge_select: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: "Dotted instance paths to select" },
    },
    required: ["paths"],
    additionalProperties: false,
  },
  forge_checkpoint: {
    type: "object",
    properties: { name: { type: "string", description: "Checkpoint label, e.g. 'before-car-tweaks'" } },
    required: ["name"],
    additionalProperties: false,
  },
  forge_undo: {
    type: "object",
    properties: { to: { type: "string", description: "Checkpoint name to roll back to (omit to undo one step)" } },
    additionalProperties: false,
  },
  forge_checkpoints: { type: "object", properties: {}, additionalProperties: false },
  forge_find: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Name substring, case-insensitive" },
      class_name: { type: "string", description: "Exact ClassName, e.g. Part, Script" },
      limit: { type: "integer", description: "Max results, 1-200. Default 50." },
    },
    additionalProperties: false,
  },
  forge_bulk_create: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Instances to create (max 200)",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "Parent dotted path" },
            class_name: { type: "string", description: "Instance class, e.g. Part" },
            name: { type: "string", description: "Instance name (default: class_name)" },
            properties: { type: "object", description: "Optional properties to set" },
          },
          required: ["path", "class_name"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  forge_snapshot: {
    type: "object",
    properties: { name: { type: "string", description: "Snapshot label (default: auto)" } },
    additionalProperties: false,
  },
  forge_diff: {
    type: "object",
    properties: { name: { type: "string", description: "Snapshot name (default: most recent)" } },
    additionalProperties: false,
  },
  forge_export: {
    type: "object",
    properties: {
      path: { type: "string", description: "Dotted path of subtree root (default: workspace)" },
      depth: { type: "integer", description: "Tree depth 1-6 (default 3)" },
    },
    additionalProperties: false,
  },
  forge_import: {
    type: "object",
    properties: {
      json: { type: "string", description: "The export JSON text" },
      path: { type: "string", description: "Plugin-folder file containing the export JSON" },
      parent: { type: "string", description: "Parent path to import under (default: workspace)" },
      name: { type: "string", description: "Rename the root instance (optional)" },
      dry_run: { type: "boolean", description: "Only report what would be created" },
    },
    additionalProperties: false,
  },
  forge_pro: { type: "object", properties: {}, additionalProperties: false },
  forge_pro_features: { type: "object", properties: {}, additionalProperties: false },
  forge_cloud_snapshot: {
    type: "object",
    properties: {
      path: { type: "string", description: "Dotted subtree root (default: workspace)" },
      name: { type: "string", description: "Snapshot label (default: auto)" },
    },
    additionalProperties: false,
  },
  forge_cloud_restore: {
    type: "object",
    properties: {
      name: { type: "string", description: "Snapshot label to restore" },
      path: { type: "string", description: "Dotted parent to restore into (default: workspace)" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  forge_team_share: {
    type: "object",
    properties: {
      label: { type: "string", description: "Short name, e.g. 'level1-wip'" },
      ref: { type: "string", description: "The reference to share, e.g. 'place:12345'" },
    },
    required: ["label", "ref"],
    additionalProperties: false,
  },
};

// Tools that modify the DataModel — gated by the approval prompt.
const DESTRUCTIVE = new Set([
  "forge_write",
  "forge_create",
  "forge_delete",
  "forge_run",
  "forge_set_property",
  "forge_set_attribute",
  "forge_undo",
  "forge_bulk_create",
  "forge_import",
  "forge_cloud_restore",
  "forge_team_share",
]);

export function bridgeTools(bridgeServer) {
  return BRIDGE_TOOL_NAMES.map((name) => ({
    name,
    description: BRIDGE_DESCRIPTIONS[name],
    inputSchema: BRIDGE_SCHEMAS[name],
    tier: "bridge",
    requiresApproval: DESTRUCTIVE.has(name),
    // Returns a plain string, or {text, image:{base64, mediaType}} when the
    // tool produced an image (forge_viewport).
    execute: async (args) => {
      const out = await bridgeServer.submit(name, args, { timeoutMs: 60000 });
      if (!out.ok) return `ERROR: ${out.error}`;
      const r = out.result;
      if (r && typeof r === "object") {
        const image =
          typeof r.imageBase64 === "string" && r.imageBase64.length
            ? { base64: r.imageBase64, mediaType: r.mediaType || "image/png" }
            : undefined;
        return { text: String(r.text ?? ""), image };
      }
      return String(r ?? "");
    },
  }));
}

// Wrap Studio's built-in MCP tools as roforge tools. Names are prefixed to
// avoid clashes with bridge tools; descriptions pass through.

// Studio MCP tools that return a scene capture (vision) — matched by name or
// description so the model is told they produce a SEEABLE image.
const CAPTURE_NAME_RE = /screenshot|capture|render|image|viewport/i;
const CAPTURE_DESC_RE = /screenshot|capture|render|image of|viewport/i;
export function looksLikeCapture(t) {
  return CAPTURE_NAME_RE.test(t.name || "") || CAPTURE_DESC_RE.test(t.description || "");
}

export function mcpCaptureNames(rawTools) {
  return (rawTools || []).filter(looksLikeCapture).map((t) => t.name);
}

export function mcpTools(mcpClient) {
  return (mcpClient._listedTools || []).map((t) => ({
    name: `studio_${t.name}`,
    description:
      (t.description || `Studio MCP tool: ${t.name}`) +
      (looksLikeCapture(t) ? " Returns an image the model can actually SEE (vision)." : ""),
    inputSchema: t.inputSchema || { type: "object", properties: {} },
    tier: "mcp",
    _mcpName: t.name,
    _isCapture: looksLikeCapture(t),
    // MCP write tools are usually named create_*/set_*/delete_* — approve those.
    requiresApproval: /^(create|set|delete|remove|rename|move|execute|run|write|update|add|destroy|insert|sync|push)/i.test(t.name),
    execute: async (args) => {
      const out = await mcpClient.callTool(t.name, args);
      if (out.isError && !out.image) return `ERROR: ${out.text}`;
      // structured so a returned image reaches the model's vision channel
      return { text: out.text, image: out.image };
    },
  }));
}

// After a successful tools/list, store the raw list and build wrapped tools.
export function mcpToolsFromList(mcpClient, rawTools) {
  mcpClient._listedTools = rawTools;
  return mcpTools(mcpClient);
}
