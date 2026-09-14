// Client plugin smoke test: run the entry point under the stubbed Studio and
// require a clean start (dock created, started line printed, no failures).
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
const R = "src/Root/RoForge/";

const lua = makeSmokeLua({
  harnessPath: path.join(repoRoot, "scripts", "studio_harness.lua"),
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
  stringFallback: {},
  dockIds: ["RoForge"],
  needles: ["[RoForge] started"],
  label: "client",
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "roforge-smoke-"));
const file = path.join(tmp, "smoke_client.lua");
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
