// Project tools: work on the Rojo project on disk (the Claude-Code-style
// "agent edits your project files" workflow). cwd-scoped, with path guards.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { truncate } from "../util.js";

const IGNORED = new Set([
  "node_modules", ".git", "dist", "build", ".rojo", "coverage", ".venv", "out", "target", "__pycache__", ".next",
]);

function isWithin(root, p) {
  const rel = path.relative(root, p);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function safeJoin(root, p) {
  const abs = path.resolve(root, p);
  if (!isWithin(root, abs)) throw new Error(`path escapes the project root: ${p}`);
  return abs;
}

function listTree(root, dir = "", depth = 0, maxDepth = 4, acc = [], cap = { n: 0 }) {
  if (depth > maxDepth || cap.n > 500) return acc;
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter((e) => !IGNORED.has(e.name) && !e.name.startsWith(".rojo"))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const e of entries) {
    if (cap.n++ > 500) {
      acc.push(`${"  ".repeat(depth)}… (truncated)`);
      return acc;
    }
    acc.push(`${"  ".repeat(depth)}${e.name}${e.isDirectory() ? "/" : ""}`);
    if (e.isDirectory()) listTree(root, path.join(dir, e.name), depth + 1, maxDepth, acc, cap);
  }
  return acc;
}

export function projectTools({ cwd, luauAnalyzePath }) {
  const root = path.resolve(cwd);
  return [
    {
      name: "project_tree",
      description: `List the Rojo project tree on disk (root: ${root}). Use before reading or editing files.`,
      inputSchema: {
        type: "object",
        properties: {
          dir: { type: "string", description: "Subdirectory. Default: project root." },
          max_depth: { type: "integer", description: "1-8. Default 4." },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const dir = args.dir ? safeJoin(root, args.dir) : root;
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`not a directory: ${args.dir}`);
        return listTree(root, dir === root ? "" : path.relative(root, dir), 0, Math.min(Math.max(1, Number(args.max_depth) || 4), 8)).join("\n");
      },
    },
    {
      name: "project_read",
      description: "Read a file from the project (relative path).",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const abs = safeJoin(root, args.path);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`no such file: ${args.path}`);
        const src = fs.readFileSync(abs, "utf8");
        return truncate(`-- ${args.path} (${src.length} chars)\n${src}`, 24000);
      },
    },
    {
      name: "project_write",
      description:
        "Write (create or overwrite) a file in the project. ALWAYS send the complete new file content, never partial edits.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      requiresApproval: true,
      execute: async (args) => {
        const abs = safeJoin(root, args.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(args.content));
        return `Wrote ${String(args.content).length} chars to ${args.path}`;
      },
    },
    {
      name: "project_edit",
      description:
        "Replace an exact text match in a file (first occurrence). Safer than project_write for small changes; old_text must match exactly (whitespace included).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["path", "old_text", "new_text"],
        additionalProperties: false,
      },
      requiresApproval: true,
      execute: async (args) => {
        const abs = safeJoin(root, args.path);
        const src = fs.readFileSync(abs, "utf8");
        const idx = src.indexOf(args.old_text);
        if (idx === -1) throw new Error("old_text not found — read the file and retry with the exact text");
        if (src.indexOf(args.old_text, idx + 1) !== -1) {
          throw new Error("old_text is not unique in the file — include more surrounding context");
        }
        fs.writeFileSync(abs, src.slice(0, idx) + args.new_text + src.slice(idx + args.old_text.length));
        return `Edited ${args.path}`;
      },
    },
    {
      name: "project_search",
      description: "Grep the project files (case-insensitive fixed-string search). Returns file:line matches.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Fixed string to search for" },
          glob: { type: "string", description: "Only search files whose name contains this, e.g. 'lua'" },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const needle = String(args.pattern).toLowerCase();
        const matches = [];
        const cap = 100;
        const walk = (dir) => {
          if (matches.length >= cap) return;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (matches.length >= cap) return;
            if (IGNORED.has(e.name) || e.name.startsWith(".")) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else {
              if (args.glob && !e.name.toLowerCase().includes(args.glob.toLowerCase())) continue;
              if (p.length > 300 || !/\.(lua|md|json|txt|rbxl)$/.test(e.name)) continue;
              try {
                const lines = fs.readFileSync(p, "utf8").split("\n");
                for (let i = 0; i < lines.length; i++) {
                  if (matches.length >= cap) return;
                  if (lines[i].toLowerCase().includes(needle)) {
                    matches.push(`${path.relative(root, p)}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
                  }
                }
              } catch {
                /* skip unreadable */
              }
            }
          }
        };
        walk(root);
        return matches.length ? matches.join("\n") : `No matches for '${args.pattern}'.`;
      },
    },
    {
      name: "project_run",
      description:
        "Run a command in the project root (e.g. 'rojo build -o dist/RoForge.rbxm', 'node --test test/', 'luau-analyze src/…'). 60s timeout. Use for builds and checks, not long-running servers.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string", description: "Shell command to run" } },
        required: ["command"],
        additionalProperties: false,
      },
      requiresApproval: true,
      execute: async (args) => {
        const { code, out } = await runShell(String(args.command), root, 60000);
        const status = code === 0 ? "OK" : `exit ${code}`;
        return `[${args.command}]\n${status}\n${truncate(out, 8000)}`;
      },
    },
    luauAnalyzePath
      ? {
          name: "luau_analyze",
          description: `Run the official Luau static analyzer on a project file (catches syntax + type errors). Path relative to project root.`,
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
          execute: async (args) => {
            const abs = safeJoin(root, args.path);
            if (!fs.existsSync(abs)) throw new Error(`no such file: ${args.path}`);
            const { code, out } = await runShell(`"${luauAnalyzePath}" "${abs}"`, root, 30000);
            return code === 0 ? "No analyzer issues found." : truncate(out, 6000);
          },
        }
      : null,
  ].filter(Boolean);
}

function runShell(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, out: [stdout, stderr].filter(Boolean).join("\n") || "(no output)" });
    });
  });
}
