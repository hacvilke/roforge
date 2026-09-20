// RoForge Skills — ECC-style progressive disclosure.
// A skill is a folder cli/src/skills/<name>/SKILL.md with YAML-ish frontmatter:
//   ---
//   name: obby-course
//   description: ... Use when ...
//   ---
//   (markdown body — procedural how-to)
//
// Level 1 (always in context): name + description, one line each.
// Level 2 (on demand): full body, loaded by the agent via the roforge_skill tool.
// Skills are trusted local files shipped with the CLI — no code, no network.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "skills");

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function parseFrontmatter(raw) {
  // ---\n key: value\n---\n body
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description|version):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** @returns {Array<{name:string, description:string, path:string}>} */
export function listSkills({ baseDir = SKILLS_DIR } = {}) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const file = path.join(baseDir, ent.name, "SKILL.md");
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(raw);
    if (!parsed) continue;
    const { meta } = parsed;
    if (!meta.name || !meta.description) continue;
    if (!NAME_RE.test(meta.name)) continue;
    out.push({ name: meta.name, description: meta.description, path: file });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** One-line-per-skill index for the system prompt (level 1). */
export function skillIndexText({ baseDir } = {}) {
  const skills = listSkills({ baseDir });
  if (!skills.length) return "";
  return (
    "## Skills (how-to playbooks — load with the roforge_skill tool)\n" +
    "Before starting a build task, scan this list. If a skill matches the work, call roforge_skill with its name FIRST and follow the playbook — it encodes exact tool sequences, attribute contracts, and known pitfalls:\n" +
    skills.map((s) => `- ${s.name} — ${s.description}`).join("\n")
  );
}

/** @returns {string|null} full skill body, or null when the name is unknown. */
export function getSkill(name, { baseDir = SKILLS_DIR } = {}) {
  const skills = listSkills({ baseDir });
  const hit = skills.find((s) => s.name === name);
  if (!hit) return null;
  const raw = fs.readFileSync(hit.path, "utf8");
  const parsed = parseFrontmatter(raw);
  return parsed ? parsed.body.trim() : null;
}
