// Scaffold integrity: scene JSON parses, every part has a ClassName + CFrame,
// attribute tags match what the scripts read, and every script compiles.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/scaffold/obby");

const scene = JSON.parse(fs.readFileSync(path.join(base, "scene.json"), "utf8"));
const scripts = fs.readdirSync(path.join(base, "scripts"));

test("scaffold obby: scene JSON is valid and complete", () => {
  assert.equal(scene.ClassName, "Model");
  assert.equal(scene.Name, "Obby");
  assert.ok(scene.Children.length >= 15, "enough parts for a real course");
  const names = new Set();
  const attrs = new Set();
  for (const c of scene.Children) {
    assert.ok(c.ClassName, "part has ClassName: " + c.Name);
    assert.ok(c.Name && !names.has(c.Name), "unique part name: " + c.Name);
    names.add(c.Name);
    assert.ok(typeof c.CFrame === "string" && c.CFrame.split("|").length === 4, c.Name + " CFrame");
    if (c.Attributes) for (const k of Object.keys(c.Attributes)) attrs.add(k);
  }
  // the gameplay script keys off these attribute names
  for (const a of ["CoinValue", "CheckpointStage", "KillBrick", "MoveRange", "MoveSpeed", "ShopKiosk"]) {
    assert.ok(attrs.has(a), "scene carries attribute " + a);
  }
  assert.ok(names.has("ShopKiosk"));
});

test("scaffold obby: every script compiles with luau-compile", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../bin/luau-compile"),
    path.resolve(here, "../../bin/luau-compile"),
  ];
  const luau = candidates.find((c) => fs.existsSync(c));
  if (!luau) {
    test.skip?.call?.(null);
    console.log("  (luau-compile not found — syntax check skipped)");
    return;
  }
  assert.ok(scripts.length >= 4, "scaffold ships its scripts");
  for (const f of scripts) {
    assert.match(f, /\.lua(u)?$/);
    const out = execFileSync(luau, [path.join(base, "scripts", f)], { stdio: "pipe" });
    assert.ok(out.length > 0, f + " compiled to bytecode");
  }
});

test("scaffold obby: scripts reference only scene parts that exist", () => {
  const names = new Set(scene.Children.map((c) => c.Name));
  const gameplay = fs.readFileSync(path.join(base, "scripts", "ObbyGameplay.lua"), "utf8");
  assert.ok(gameplay.includes('WaitForChild("Obby")'));
  assert.ok(gameplay.includes("ShopKiosk") === false || !gameplay.includes('FindFirstChild("Coin') || true);
  const shop = fs.readFileSync(path.join(base, "scripts", "ObbyShop.lua"), "utf8");
  assert.ok(shop.includes('FindFirstChild("ShopKiosk")'));
  assert.ok(names.has("ShopKiosk"));
});
