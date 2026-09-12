// End-to-end demo (offline): mock Studio MCP + mock Anthropic, real CLI loop.
// Shows: agent → MCP (Studio) tool → local project tool → streamed answer.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
import os from "node:os";
import path from "node:path";
import { startMockAnthropic, startMockMcp } from "../test/mock-server.js";

const anthropic = await startMockAnthropic({ toolName: "project_tree" });
const mcp = await startMockMcp();

const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-demo-"));
fs.writeFileSync(
  path.join(cfgDir, "config.json"),
  JSON.stringify({
    provider: "anthropic",
    anthropicKey: "demo-key",
    anthropicBaseUrl: `http://127.0.0.1:${anthropic.address().port}`,
    mcpUrl: `http://127.0.0.1:${mcp.address().port}/mcp`,
    approve: "yolo",
  })
);

// a tiny fake project to work on
const proj = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-demo-proj-"));
fs.mkdirSync(path.join(proj, "src"), { recursive: true });
fs.writeFileSync(path.join(proj, "src", "Main.lua"), "print('demo project')\n");

const { execFile } = await import("node:child_process");
try {
  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["bin/roforge.js", "chat", "-m", "Summarize the project and list what studio can do."],
      {
        cwd: CLI_ROOT,
        env: { ...process.env, ROFORGE_CONFIG_DIR: cfgDir, NO_COLOR: "1" },
        stdio: ["ignore", "inherit", "inherit"],
        timeout: 60000,
      },
      (err) => (err ? reject(err) : resolve())
    );
  });
  console.log("\n=== E2E DEMO: OK (agent loop ran against mock Studio MCP + mock model) ===");
} catch (e) {
  console.error("\n=== E2E DEMO exited:", e.status ?? e.message, "===");
} finally {
  anthropic.close();
  mcp.close();
  fs.rmSync(cfgDir, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
}
