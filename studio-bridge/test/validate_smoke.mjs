// Bridge plugin smoke test: run the entry point under the stubbed Studio and
// require a clean start (dock created, ready line printed, no failures).
// Usage: node test/validate_smoke.mjs <path-to-luau>
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { makeSmokeLua } from "../../scripts/smoke_core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.join(here, "..");
const repoRoot = path.join(pluginDir, "..");
const luau = process.argv[2];
if (!luau) {
  console.error("usage: node validate_smoke.mjs <path-to-luau>");
  process.exit(1);
}

const read = (rel) => readFileSync(path.join(pluginDir, rel), "utf8");
const B = "src/Root/Bridge/";

const lua = makeSmokeLua({
  harnessPath: path.join(repoRoot, "scripts", "studio_harness.lua"),
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
  stringFallback: { "./Deflate": "Deflate" },
  dockIds: ["RoForgeBridge"],
  needles: ["[RoForge Bridge] ready"],
  label: "bridge",
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "roforge-smoke-"));
const file = path.join(tmp, "smoke_bridge.lua");
writeFileSync(file, lua);
const r = spawnSync(luau, [file], { encoding: "utf8" });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) {
  console.error(`smoke test FAILED (exit ${r.status})`);
  process.exit(1);
}
if (!/SMOKE OK/.test(r.stdout || "")) {
  console.error("smoke test did not report SMOKE OK");
  process.exit(1);
}
console.log("smoke OK ✓");
