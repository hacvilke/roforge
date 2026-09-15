// Client plugin TOOL TEST: boot the client under the stubbed Studio, then
// execute all nine forge_* tools with representative arguments and assert no
// Roblox API crash signatures appear in the results.
// Usage: node test/validate_tools.mjs <path-to-luau>
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { makeToolsLua } from "../../scripts/tools_battery_core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.join(here, "..");
const repoRoot = path.join(pluginDir, "..");
const luau = process.argv[2];
if (!luau) {
  console.error("usage: node validate_tools.mjs <path-to-luau>");
  process.exit(1);
}

const read = (rel) => readFileSync(path.join(pluginDir, rel), "utf8");
const R = "src/Root/RoForge/";

const steps = [
  { tool: "forge_game_info", args: {}, expect: "Place name: Place1" },
  { tool: "forge_tree", args: { root: "workspace", max_depth: 1 }, expect: "Workspace" },
  { tool: "forge_tree", args: { root: "Workspace", max_depth: 1 }, expect: "Workspace" },
  { tool: "forge_selected", args: {}, expect: "Nothing is selected" },
  { tool: "forge_create", args: { parent_path: "workspace", class_name: "Part", name: "CPart", properties: { Size: { x: 8, y: 1, z: 4 } } }, expect: "Size = " },
  { tool: "forge_create", args: { parent_path: "workspace", class_name: "BasePart", name: "Bad" }, expectError: "Invalid class name" },
  { tool: "forge_read", args: { path: "workspace.CPart" }, expect: "CPart" },
  { tool: "forge_write", args: { path: "workspace.CMain", source: "print('client')" }, expect: "Wrote" },
  { tool: "forge_read", args: { path: "workspace.CMain" }, expect: "client" },
  { tool: "forge_run", args: { code: "return 40 + 2" }, expect: "returned: 42" },
  { tool: "forge_screenshot", args: { name: "client" }, expect: "Screenshot saved to the RoForge plugin storage folder" },
  { tool: "forge_delete", args: { path: "workspace.CPart" }, expect: "Destroyed Workspace.CPart" },
];

const lua = makeToolsLua({
  harnessSrc: readFileSync(path.join(repoRoot, "scripts", "studio_harness.lua"), "utf8"),
  sources: {
    entry: read("src/Root/init.server.luau"),
    RoForge: read(R + "init.lua"),
    Agent: read(R + "Agent.lua"),
    Config: read(R + "Config.lua"),
    Http: read(R + "Http.lua"),
    Anthropic: read(R + "Providers/Anthropic.lua"),
    OpenAI: read(R + "Providers/OpenAI.lua"),
    LocalTools: read(R + "Tools/LocalTools.lua"),
    RemoteTools: read(R + "Tools/RemoteTools.lua"),
    UI: read(R + "UI/init.lua"),
    UiBuilder: read(R + "UI/UiBuilder.lua"),
  },
  graphSpec: {
    Name: "RoForge",
    id: "entry",
    children: [
      {
        Name: "RoForge",
        id: "RoForge",
        children: [
          { Name: "Agent", id: "Agent" },
          { Name: "Config", id: "Config" },
          { Name: "Http", id: "Http" },
          {
            Name: "Providers",
            children: [
              { Name: "Anthropic", id: "Anthropic" },
              { Name: "OpenAI", id: "OpenAI" },
            ],
          },
          {
            Name: "Tools",
            children: [
              { Name: "LocalTools", id: "LocalTools" },
              { Name: "RemoteTools", id: "RemoteTools" },
            ],
          },
          {
            Name: "UI",
            id: "UI",
            children: [{ Name: "UiBuilder", id: "UiBuilder" }],
          },
        ],
      },
    ],
  },
  localToolsNodeLua: `graph._children["RoForge"]._children["Tools"]._children["LocalTools"]`,
  steps,
  label: "client",
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "roforge-tools-"));
const file = path.join(tmp, "tools.lua");
writeFileSync(file, lua);

const r = spawnSync(luau, [file], { encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
console.log(out.trimEnd());
if (r.status !== 0 || !out.includes("TOOLS OK (client)")) {
  console.error("TOOL TEST FAILED (client)");
  process.exit(1);
}
