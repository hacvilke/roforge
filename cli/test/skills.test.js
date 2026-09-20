// Skills system: catalog integrity, frontmatter discipline, tool behavior, prompt index.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSkills, skillIndexText, getSkill } from "../src/skills.js";
import { skillTools } from "../src/tools/skills.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(HERE, "..", "src", "skills");
const skills = listSkills({ baseDir: SKILLS_DIR });

test("bundled skills exist and are well-formed", () => {
  assert.ok(skills.length >= 5, "expected at least 5 bundled skills, got " + skills.length);
  const expected = ["obby-course", "character-player", "ui-hud-menus", "data-saves", "monetization", "visuals-presentation"];
  for (const name of expected) {
    const hit = skills.find((s) => s.name === name);
    assert.ok(hit, "missing skill: " + name);
    assert.ok(hit.description.length >= 30 && hit.description.length <= 500, `${name} description length`);
    assert.ok(/use when/i.test(hit.description), `${name} description must state when to use it`);
    // folder name must match the frontmatter name
    assert.equal(hit.path, path.join(SKILLS_DIR, name, "SKILL.md"));
  }
});

test("no duplicate skill names", () => {
  const names = skills.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});

test("every skill body loads, is substantial, and has no frontmatter leaks", () => {
  for (const s of skills) {
    const body = getSkill(s.name, { baseDir: SKILLS_DIR });
    assert.ok(body, "body for " + s.name);
    assert.ok(body.length > 400, `${s.name} body too short (${body.length})`);
    assert.ok(!/^---/.test(body), `${s.name} body still contains frontmatter`);
    const lines = body.split("\n").length;
    assert.ok(lines <= 200, `${s.name} body too long (${lines} lines)`);
  }
});

test("getSkill rejects unknown names", () => {
  assert.equal(getSkill("nope", { baseDir: SKILLS_DIR }), null);
  assert.equal(getSkill("", { baseDir: SKILLS_DIR }), null);
});

test("skill tool: loads a skill, errors on unknown", async () => {
  const tool = skillTools()[0];
  assert.equal(tool.name, "roforge_skill");
  assert.ok(tool.inputSchema.required.includes("name"));

  const out = await tool.execute({ name: "obby-course" }, {});
  assert.ok(out.startsWith("Skill 'obby-course' playbook"));
  assert.ok(out.includes("attribute contract"));

  const bad = await tool.execute({ name: "nope" }, {});
  assert.ok(bad.startsWith("ERROR: no skill named 'nope'"));
  assert.ok(bad.includes("obby-course"), "error should list available skills");

  const empty = await tool.execute({}, {});
  assert.ok(empty.startsWith("ERROR: name is required"));
});

test("system-prompt index lists every skill with its trigger description", () => {
  const idx = skillIndexText({ baseDir: SKILLS_DIR });
  assert.ok(idx.startsWith("## Skills"));
  for (const s of skills) {
    assert.ok(idx.includes(`- ${s.name} — ${s.description}`), "index missing " + s.name);
  }
});

test("skill markdown files are plain text (no unbalanced code fences)", () => {
  for (const s of skills) {
    const raw = fs.readFileSync(s.path, "utf8");
    const fences = (raw.match(/^```/gm) || []).length;
    assert.equal(fences % 2, 0, `${s.name}: unbalanced code fences`);
  }
});
