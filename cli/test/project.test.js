import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectTools } from "../src/tools/project.js";

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roforge-test-"));
  fs.mkdirSync(path.join(dir, "src", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "Scripts", "Main.lua"), "print('hello')\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# demo\n");
  return dir;
}

test("project tools: tree/read/search/write/edit/run", { timeout: 30000 }, async (t) => {
  const dir = tmpProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = Object.fromEntries(projectTools({ cwd: dir, luauAnalyzePath: null }).map((x) => [x.name, x]));

  const tree = await tools.project_tree.execute({});
  assert.ok(tree.includes("src/"));
  assert.ok(tree.includes("Main.lua"));

  const read = await tools.project_read.execute({ path: "src/Scripts/Main.lua" });
  assert.ok(read.includes("print('hello')"));

  const search = await tools.project_search.execute({ pattern: "HELLO" });
  assert.ok(search.includes("Main.lua:1"));

  await tools.project_write.execute({ path: "src/Scripts/Extra.lua", content: "print('extra')\n" });
  assert.ok(fs.existsSync(path.join(dir, "src", "Scripts", "Extra.lua")));

  await tools.project_edit.execute({
    path: "src/Scripts/Main.lua",
    old_text: "print('hello')",
    new_text: "print('world')",
  });
  assert.ok(fs.readFileSync(path.join(dir, "src", "Scripts", "Main.lua"), "utf8").includes("print('world')"));

  const nonUnique = tools.project_edit.execute({
    path: "src/Scripts/Main.lua",
    old_text: "print('world')",
    new_text: "print('again')",
  });
  // should succeed (unique after edit)
  await assert.doesNotReject(nonUnique);

  const runOut = await tools.project_run.execute({ command: "echo roforge-ok" });
  assert.ok(runOut.includes("roforge-ok"));
  assert.ok(runOut.includes("OK"));
});

test("project tools: path escape is blocked", async (t) => {
  const dir = tmpProject();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = Object.fromEntries(projectTools({ cwd: dir, luauAnalyzePath: null }).map((x) => [x.name, x]));
  await assert.rejects(() => tools.project_read.execute({ path: "../etc/passwd" }), /escapes the project root/);
  await assert.rejects(() => tools.project_write.execute({ path: "/tmp/evil.lua", content: "x" }), /escapes the project root/);
});
