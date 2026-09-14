// Bridge plugin TOOL TEST: boot the plugin under the stubbed Studio, then
// execute every forge_* tool with representative arguments and assert the
// results contain no Roblox API crash signatures (e.g. "is not a valid
// member") and match the expected success strings. This is the regression
// net for hallucinated Roblox API usage: the smoke test only proves modules
// load; this proves the tools actually run.
// Usage: node test/validate_tools.mjs <path-to-luau>
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { luaObj } from "../../scripts/smoke_core.mjs";
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
const B = "src/Root/Bridge/";

const house = JSON.parse(readFileSync(path.join(repoRoot, "cli", "src", "demo", "house.json"), "utf8"));

const steps = [
  // core info (turn-34: used the nonexistent RunService.IsPaused)
  { tool: "forge_game_info", args: {}, expect: "Place ID" },
  // tree with lowercase AND uppercase root (turn-34: "unknown root 'workspace'")
  { tool: "forge_tree", args: { root: "workspace", max_depth: 1 }, expect: "Workspace" },
  { tool: "forge_tree", args: { root: "Workspace", max_depth: 1 }, expect: "Workspace" },
  // the demo house: import it (via HttpService JSON decode), then work with it
  {
    tool: "forge_import",
    argsLua: `{ json = HttpService:JSONEncode(${luaObj(house)}) }`,
    expect: "imported 13 node(s)",
  },
  { tool: "forge_read", args: { path: "Workspace.RoForgeHouse" }, expect: "RoForgeHouse" },
  { tool: "forge_get_property", args: { path: "Workspace.RoForgeHouse.Floor", property: "Name" }, expect: "Floor" },
  { tool: "forge_set_property", args: { path: "Workspace.RoForgeHouse.Floor", property: "Name", value: "FloorSlab" }, expect: "FloorSlab" },
  { tool: "forge_set_attribute", args: { path: "Workspace.RoForgeHouse", name: "RoForge", value: "true" }, expect: "RoForge" },
  { tool: "forge_get_attributes", args: { path: "Workspace.RoForgeHouse" }, expect: "RoForge" },
  { tool: "forge_select", args: { paths: ["Workspace.RoForgeHouse"] }, expect: "RoForgeHouse" },
  { tool: "forge_selected", args: {}, expect: "RoForgeHouse" },
  { tool: "forge_find", args: { pattern: "RoForgeHouse" }, expect: "RoForgeHouse" },
  // screenshot via StudioCaptureService (turn-34: game:Screenshot no longer exists)
  { tool: "forge_screenshot", args: { name: "test" }, expect: "Screenshot saved to the RoForge plugin storage folder" },
  // viewport capture returns a base64 image table
  { tool: "forge_viewport", args: {}, expectTableWith: { field: "imageBase64", minLen: 64 } },
  // native change-history integration (SetChangePoint / ChangeHistoryIndex)
  { tool: "forge_checkpoint", args: { name: "cp1" }, expect: "checkpoint 'cp1' set" },
  { tool: "forge_checkpoints", args: {}, expect: "cp1" },
  { tool: "forge_undo", args: {}, expect: "undid back to index" },
  { tool: "forge_snapshot", args: { name: "snap1" }, expect: "snapshot 'snap1' captured" },
  { tool: "forge_diff", args: { name: "snap1" }, expect: "diff vs snapshot 'snap1'" },
  { tool: "forge_export", args: { path: "Workspace.RoForgeHouse" }, expect: "RoForgeHouse" },
  { tool: "forge_create", args: { parent_path: "Workspace.RoForgeHouse", class_name: "Part", name: "Lamp" }, expect: "Created Part at" },
  { tool: "forge_write", args: { path: "Workspace.RoForgeHouse.Main", source: "print('roforge')" }, expect: "Wrote" },
  { tool: "forge_read", args: { path: "Workspace.RoForgeHouse.Main" }, expect: "roforge" },
  { tool: "forge_run", args: { code: "return 40 + 2" }, expect: "returned: 42" },
  { tool: "forge_delete", args: { path: "Workspace.RoForgeHouse.Lamp" }, expect: "Destroyed Workspace.RoForgeHouse.Lamp" },
];

const lua = makeToolsLua({
  harnessSrc: readFileSync(path.join(repoRoot, "scripts", "studio_harness.lua"), "utf8"),
  sources: {
    entry: read("src/Root/init.server.luau"),
    Bridge: read(B + "init.lua"),
    Deflate: read(B + "Deflate.lua"),
    ExtraTools: read(B + "ExtraTools.lua"),
    Http: read(B + "Http.lua"),
    LocalTools: read(B + "LocalTools.lua"),
    PngEncoder: read(B + "PngEncoder.lua"),
    Pro: read(B + "Pro.lua"),
    ProModuleLoader: read(B + "ProModuleLoader.lua"),
    Viewport: read(B + "Viewport.lua"),
  },
  graphSpec: {
    Name: "RoForgeBridge",
    id: "entry",
    children: [
      {
        Name: "Bridge",
        id: "Bridge",
        children: [
          { Name: "Deflate", id: "Deflate" },
          { Name: "ExtraTools", id: "ExtraTools" },
          { Name: "Http", id: "Http" },
          { Name: "LocalTools", id: "LocalTools" },
          { Name: "PngEncoder", id: "PngEncoder" },
          { Name: "Pro", id: "Pro" },
          { Name: "ProModuleLoader", id: "ProModuleLoader" },
          { Name: "Viewport", id: "Viewport" },
        ],
      },
    ],
  },
  localToolsNodeLua: `graph._children["Bridge"]._children["LocalTools"]`,
  extraToolsNodeLua: `graph._children["Bridge"]._children["ExtraTools"]`,
  steps,
  label: "bridge",
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "roforge-tools-"));
const file = path.join(tmp, "tools.lua");
writeFileSync(file, lua);

const r = spawnSync(luau, [file], { encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
console.log(out.trimEnd());
if (r.status !== 0 || !out.includes("TOOLS OK (bridge)")) {
  console.error("TOOL TEST FAILED (bridge)");
  process.exit(1);
}
