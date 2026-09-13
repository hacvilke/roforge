// RoForge CLI — strict declarative plugin system.
//
// A plugin is a JSON file. That is the whole trust model:
//
//   • NO code fields. Not a script, not a handler, not an eval, not a
//     template engine. The validator is a strict allowlist — any key that is
//     not explicitly permitted (at any depth) rejects the plugin. A plugin
//     therefore cannot contain malicious intent by construction.
//   • Actions are limited to four: http (public https only, no
//     localhost/private addresses), command (allowlisted binary, argv array,
//     no shell), read-file (relative path inside the project root, size-capped),
//     transform (placeholder fill from validated args only).
//   • The CLI never passes its own API keys or environment to plugins. There
//     is no variable expansion at all — the only template syntax is
//     {{argname}} and only for args declared in the tool's input_schema.
//   • Mutations are approval-gated: http POST/PUT and command tools always
//     require approval.
//   • Every output is size-capped (per-tool, hard ceiling 64 KB).
//
// Placement: <project>/plugins/*.json (project-local) and
// ~/.roforge/plugins/*.json (user-wide). ROFORGE_PLUGINS_DIR overrides for tests.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

export const HARD_OUTPUT_LIMIT = 65536;
const DEFAULT_OUTPUT_LIMIT = 8000;
const DEFAULT_HTTP_TIMEOUT_MS = 15000;
const DEFAULT_READ_BYTES = 256 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_TOOLS = 50;
const MAX_MANIFEST_BYTES = 256 * 1024;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

// Fields that are never allowed at the top level, even if a future allowlist
// regressed — these are the classic "hidden code" shapes.
const BANNED_TOP_KEYS = /^(code|script|eval|exec|shell|js|javascript|python|lua|luau|handler|entrypoint|main)$/i;

const ACTION_TYPES = new Set(["http", "command", "read-file", "transform"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT"]);
const FORBIDDEN_ARG_CHARS = /[;|&`$<>\n\r]/;
const PRIVATE_HOST_RE =
  /^(localhost|127\.[0-9.]+|0\.0\.0\.0|::1|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|169\.254\.[0-9.]+|metadata\.google\.internal|.*\.local|.*\.internal)$/i;

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function err(msg, extra = {}) {
  return { ok: false, error: msg, ...extra };
}

function checkName(name, what) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return err(`${what} name must match ${NAME_RE} (got ${JSON.stringify(name)})`);
  }
  if (name.startsWith("forge_")) {
    return err(`${what} name "${name}" is reserved for Studio bridge tools`);
  }
  return { ok: true, value: name };
}

function checkDesc(desc) {
  if (typeof desc !== "string" || desc.length === 0 || desc.length > 300) {
    return err("description must be a non-empty string (max 300 chars)");
  }
  return { ok: true, value: desc };
}

// input_schema: JSON-schema object shape, strict, no $ref, no patterns
// beyond simple strings. Returns the property names for template checks.
function checkInputSchema(schema) {
  if (!isObj(schema)) return err("input_schema must be an object");
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "description"]);
  for (const k of Object.keys(schema)) {
    if (!allowed.has(k)) return err(`input_schema: unknown key "${k}"`);
  }
  if (schema.type !== "object") return err('input_schema.type must be "object"');
  if (schema.additionalProperties !== false) {
    return err('input_schema must set "additionalProperties": false (strict)');
  }
  const props = schema.properties || {};
  const propNames = new Set();
  for (const [pname, pdef] of Object.entries(props)) {
    if (!NAME_RE.test(pname)) return err(`input_schema property "${pname}" has an invalid name`);
    if (!isObj(pdef)) return err(`input_schema property "${pname}" must be an object`);
    const pAllowed = new Set(["type", "description", "minimum", "maximum", "minLength", "maxLength", "items"]);
    for (const k of Object.keys(pdef)) {
      if (!pAllowed.has(k)) return err(`input_schema property "${pname}": unknown key "${k}"`);
    }
    if (!["string", "integer", "number", "boolean", "array"].includes(pdef.type)) {
      return err(`input_schema property "${pname}": unsupported type "${pdef.type}"`);
    }
    if (pdef.type === "array" && !isObj(pdef.items)) {
      return err(`input_schema property "${pname}": array needs "items"`);
    }
    propNames.add(pname);
  }
  const required = schema.required || [];
  if (!Array.isArray(required)) return err('input_schema.required must be an array');
  for (const r of required) {
    if (!propNames.has(r)) return err(`input_schema.required references unknown property "${r}"`);
  }
  return { ok: true, value: propNames };
}

// Template strings: only {{argname}} placeholders, and only names that are
// declared in the input schema. Everything else is a literal.
function checkTemplate(str, propNames, what) {
  if (typeof str !== "string") return err(`${what} must be a string`);
  if (str.length > 20000) return err(`${what} too long`);
  const refs = [...str.matchAll(/{{\s*([a-zA-Z0-9_][a-zA-Z0-9_-]*)\s*}}/g)];
  for (const m of refs) {
    if (!propNames.has(m[1])) {
      return err(`${what} references undeclared arg "${m[1]}" (only input_schema properties may be used)`);
    }
  }
  // Any other {{...}} (env-ish, nested, malformed) is rejected.
  const stripped = str.replace(/{{\s*[a-zA-Z0-9_][a-zA-Z0-9_-]*\s*}}/g, "");
  if (stripped.includes("{{") || stripped.includes("}}")) {
    return err(`${what} contains an unsupported {{...}} expression (only declared args may be referenced)`);
  }
  return { ok: true, value: str };
}

function fillTemplate(str, args) {
  return str.replace(/{{\s*([a-zA-Z0-9_][a-zA-Z0-9_-]*)\s*}}/g, (_, name) => {
    const v = args[name];
    if (v === undefined || v === null) return "";
    return encodeURIComponent(String(v));
  });
}
// Raw fill (command argv): no URL-encoding.
function fillTemplateRaw(str, args) {
  return str.replace(/{{\s*([a-zA-Z0-9_][a-zA-Z0-9_-]*)\s*}}/g, (_, name) => {
    const v = args[name];
    if (v === undefined || v === null) return "";
    return String(v);
  });
}

function checkOutputMax(v) {
  if (v === undefined) return { ok: true, value: DEFAULT_OUTPUT_LIMIT };
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > HARD_OUTPUT_LIMIT) {
    return err(`output_max_chars must be an integer 1..${HARD_OUTPUT_LIMIT}`);
  }
  return { ok: true, value: v };
}

// ---- action validators (strict allowlists) ----

function checkHttpAction(a, propNames) {
  const allowed = new Set(["type", "method", "url", "headers", "body", "query", "timeout_ms", "output_max_chars"]);
  for (const k of Object.keys(a)) if (!allowed.has(k)) return err(`http action: unknown key "${k}"`);
  if (!HTTP_METHODS.has(a.method)) return err('http action.method must be GET, POST, or PUT');
  if (typeof a.url !== "string" || a.url.length > 2000) return err("http action.url must be a string");
  let u;
  try {
    u = new URL(a.url);
  } catch {
    return err(`http action.url is not a valid URL: ${a.url}`);
  }
  if (u.protocol !== "https:") return err("http action.url must be https (public web only)");
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) return err(`http action.url host "${host}" is not public (localhost/private ranges are forbidden)`);
  if (u.port !== "" && u.port !== "443") return err("http action.url may only use the default https port");

  let query = {};
  if (a.query !== undefined) {
    if (!isObj(a.query)) return err("http action.query must be an object");
    const QUERY_KEY_RE = /^[A-Za-z0-9._-]{1,64}$/; // API param names (e.g. universeIds)
    for (const [k, v] of Object.entries(a.query)) {
      if (!QUERY_KEY_RE.test(k)) return err(`http action.query key "${k}" invalid`);
      const t = checkTemplate(String(v), propNames, `http action.query.${k}`);
      if (!t.ok) return t;
      query[k] = t.value;
    }
  }
  const headers = a.headers !== undefined ? (isObj(a.headers) ? a.headers : err("http action.headers must be an object")) : {};
  if (isObj(a.headers)) {
    for (const [k, v] of Object.entries(a.headers)) {
      if (typeof v !== "string" || v.length > 500) return err(`http header "${k}" must be a short string`);
    }
  }
  let body;
  if (a.body !== undefined) {
    if (a.method === "GET") return err("http action.body is not allowed with GET");
    const t = checkTemplate(String(a.body), propNames, "http action.body");
    if (!t.ok) return t;
    body = t.value;
  }
  const to =
    a.timeout_ms !== undefined
      ? typeof a.timeout_ms === "number" && a.timeout_ms >= 100 && a.timeout_ms <= 60000
        ? a.timeout_ms
        : err("http action.timeout_ms must be 100..60000")
      : DEFAULT_HTTP_TIMEOUT_MS;
  if (!Number.isInteger(to)) return to;
  const out = checkOutputMax(a.output_max_chars);
  if (!out.ok) return out;
  return { ok: true, value: { kind: "http", method: a.method, url: a.url, query, headers, body, timeoutMs: to, outputMax: out.value } };
}

function checkCommandAction(a, propNames, allowedCommands) {
  const allowed = new Set(["type", "command", "args", "output_max_chars"]);
  for (const k of Object.keys(a)) if (!allowed.has(k)) return err(`command action: unknown key "${k}"`);
  if (!allowedCommands.includes(a.command)) {
    return err(`command action: "${a.command}" is not in the allowlist (${allowedCommands.join(", ")})`);
  }
  const args = [];
  if (a.args !== undefined) {
    if (!Array.isArray(a.args) || a.args.length > 32) return err("command action.args must be an array (max 32)");
    for (const v of a.args) {
      if (typeof v !== "string" || v.length > 200) return err("command action.args entries must be strings (max 200)");
      if (FORBIDDEN_ARG_CHARS.test(v)) return err(`command arg "${v}" contains shell metacharacters (not allowed)`);
      const t = checkTemplate(v, propNames, "command arg");
      if (!t.ok) return t;
      args.push(t.value);
    }
  }
  const out = checkOutputMax(a.output_max_chars);
  if (!out.ok) return out;
  return { ok: true, value: { kind: "command", command: a.command, args, outputMax: out.value } };
}

function checkReadFileAction(a) {
  const allowed = new Set(["type", "path", "max_bytes"]);
  for (const k of Object.keys(a)) if (!allowed.has(k)) return err(`read-file action: unknown key "${k}"`);
  if (typeof a.path !== "string" || a.path.length === 0 || a.path.length > 500) return err("read-file action.path must be a string");
  if (path.isAbsolute(a.path) || a.path.startsWith("~")) return err("read-file action.path must be relative to the project root");
  const norm = path.normalize(a.path);
  if (norm === ".." || norm.startsWith(`..${path.sep}`) || norm.split(path.sep).includes("..")) {
    return err("read-file action.path may not traverse above the project root");
  }
  const mb = a.max_bytes !== undefined
    ? typeof a.max_bytes === "number" && Number.isInteger(a.max_bytes) && a.max_bytes >= 1 && a.max_bytes <= MAX_READ_BYTES
      ? a.max_bytes
      : err(`read-file action.max_bytes must be 1..${MAX_READ_BYTES}`)
    : DEFAULT_READ_BYTES;
  if (!Number.isInteger(mb)) return mb;
  return { ok: true, value: { kind: "read-file", path: norm, maxBytes: mb, outputMax: Math.min(DEFAULT_OUTPUT_LIMIT, mb) } };
}

function checkTransformAction(a, propNames) {
  const allowed = new Set(["type", "template", "output_max_chars"]);
  for (const k of Object.keys(a)) if (!allowed.has(k)) return err(`transform action: unknown key "${k}"`);
  const t = checkTemplate(a.template, propNames, "transform action.template");
  if (!t.ok) return t;
  const out = checkOutputMax(a.output_max_chars);
  if (!out.ok) return out;
  return { ok: true, value: { kind: "transform", template: t.value, outputMax: out.value } };
}

// ---- manifest validation ----

export function validateManifest(obj, allowedCommands = ALLOWED_COMMANDS) {
  if (!isObj(obj)) return err("manifest must be a JSON object");
  for (const k of Object.keys(obj)) {
    if (BANNED_TOP_KEYS.test(k)) {
      return err(`plugin manifest contains a code field ("${k}") — plugins are declarative only`);
    }
  }
  const allowed = new Set(["name", "version", "description", "tools"]);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) return err(`unknown manifest key "${k}"`);
  const name = checkName(obj.name, "plugin");
  if (!name.ok) return name;
  if (typeof obj.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(obj.version)) {
    return err('version must be semver-like "1.2.3"');
  }
  const desc = checkDesc(obj.description);
  if (!desc.ok) return desc;
  if (!Array.isArray(obj.tools) || obj.tools.length < 1 || obj.tools.length > MAX_TOOLS) {
    return err(`tools must be an array of 1..${MAX_TOOLS}`);
  }
  const tools = [];
  const seen = new Set();
  for (const t of obj.tools) {
    if (!isObj(t)) return err("each tool must be an object");
    const tAllowed = new Set(["name", "description", "input_schema", "action"]);
    for (const k of Object.keys(t)) {
      if (BANNED_TOP_KEYS.test(k)) return err(`tool contains a code field ("${k}") — plugins are declarative only`);
      if (!tAllowed.has(k)) return err(`tool: unknown key "${k}"`);
    }
    const tn = checkName(t.name, "tool");
    if (!tn.ok) return tn;
    if (seen.has(tn.value)) return err(`duplicate tool name "${tn.value}"`);
    seen.add(tn.value);
    const td = checkDesc(t.description);
    if (!td.ok) return td;
    const sch = checkInputSchema(t.input_schema);
    if (!sch.ok) return err(`tool "${tn.value}": ${sch.error}`);
    const action = t.action;
    if (!isObj(action)) return err(`tool "${tn.value}": action must be an object`);
    if (!ACTION_TYPES.has(action.type)) {
      return err(`tool "${tn.value}": action.type must be one of ${[...ACTION_TYPES].join(", ")}`);
    }
    let av;
    switch (action.type) {
      case "http":
        av = checkHttpAction(action, sch.value);
        break;
      case "command":
        av = checkCommandAction(action, sch.value, allowedCommands);
        break;
      case "read-file":
        av = checkReadFileAction(action);
        break;
      case "transform":
        av = checkTransformAction(action, sch.value);
        break;
    }
    if (!av.ok) return err(`tool "${tn.value}": ${av.error}`);
    const destructive = av.value.kind === "command" || (av.value.kind === "http" && av.value.method !== "GET");
    tools.push({
      name: tn.value,
      description: td.value,
      inputSchema: t.input_schema,
      action: av.value,
      requiresApproval: destructive,
    });
  }
  return { ok: true, manifest: { name: name.value, version: obj.version, description: desc.value, tools } };
}

// Default allowlist; overridable per load call (tests / future config).
const ALLOWED_COMMANDS = ["roforge"];

// ---- execution ----

function capText(text, max, label) {
  const s = String(text);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… truncated (${s.length - max} more chars; ${label} is capped at ${max})`;
}

export function pluginToolExecutor(plugin, tool) {
  return async (args) => {
    const a = tool.action;
    args = isObj(args) ? args : {};
    try {
      if (a.kind === "http") {
        const url = new URL(a.url);
        for (const [k, tmpl] of Object.entries(a.query)) url.searchParams.set(k, fillTemplate(tmpl, args));
        const res = await fetch(url.toString(), {
          method: a.method,
          headers: a.headers,
          body: a.body !== undefined ? fillTemplate(a.body, args) : undefined,
          signal: AbortSignal.timeout(a.timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) return `ERROR: HTTP ${res.status} ${res.statusText} from ${a.url}`;
        return capText(text, a.outputMax, "plugin output");
      }
      if (a.kind === "command") {
        const out = await new Promise((resolve, reject) => {
          execFile(a.command, a.args.map((t) => fillTemplateRaw(t, args)), {
            timeout: 30000,
            maxBuffer: Math.max(a.outputMax * 2, 64 * 1024),
          }, (e, stdout, stderr) => (e ? reject(e) : resolve(stdout)));
        });
        return capText(out, a.outputMax, "plugin output");
      }
      if (a.kind === "read-file") {
        const root = process.cwd();
        const full = path.resolve(root, a.path);
        if (full !== root && !full.startsWith(root + path.sep)) return "ERROR: path escapes the project root";
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return `ERROR: file not found: ${a.path}`;
        const st = fs.statSync(full);
        if (st.size > a.maxBytes) return `ERROR: file too large (${st.size} > ${a.maxBytes} bytes)`;
        return capText(fs.readFileSync(full, "utf8"), a.outputMax, "file output");
      }
      if (a.kind === "transform") {
        // Plain-text output: raw (unencoded) values.
        return capText(fillTemplateRaw(a.template, args), a.outputMax, "plugin output");
      }
    } catch (e) {
      return `ERROR: ${e.message || String(e)}`;
    }
    return "ERROR: unknown action";
  };
}

// ---- discovery + build ----

export function pluginDirs({ cwd, configDirBase }) {
  const dirs = [];
  if (process.env.ROFORGE_PLUGINS_DIR) dirs.push(process.env.ROFORGE_PLUGINS_DIR);
  if (cwd) dirs.push(path.join(cwd, "plugins"));
  if (configDirBase) dirs.push(path.join(configDirBase, "plugins"));
  return [...new Set(dirs)];
}

export function loadPlugins({ cwd, configDirBase, allowedCommands = ALLOWED_COMMANDS } = {}) {
  // Bind the allowlist for this load (validateManifest reads ALLOWED_COMMANDS
  // via the closure below).
  const tools = [];
  const plugins = [];
  const errors = [];
  const seenTool = new Set();
  for (const dir of pluginDirs({ cwd, configDirBase })) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    } catch {
      continue;
    }
    for (const f of entries) {
      const file = path.join(dir, f);
      let raw;
      try {
        raw = fs.readFileSync(file);
      } catch {
        errors.push({ file, error: "unreadable" });
        continue;
      }
      if (raw.length > MAX_MANIFEST_BYTES) {
        errors.push({ file, error: `manifest too large (${raw.length} > ${MAX_MANIFEST_BYTES} bytes)` });
        continue;
      }
      let obj;
      try {
        obj = JSON.parse(raw.toString("utf8"));
      } catch (e) {
        errors.push({ file, error: `invalid JSON: ${e.message}` });
        continue;
      }
      const res = validateManifest(obj, allowedCommands);
      if (!res.ok) {
        errors.push({ file, error: res.error });
        continue;
      }
      const m = res.manifest;
      const dupTools = m.tools.filter((t) => seenTool.has(t.name));
      if (dupTools.length) {
        errors.push({ file, error: `tool name conflict with an already-loaded plugin: ${dupTools.map((t) => t.name).join(", ")}` });
        continue;
      }
      plugins.push({ name: m.name, version: m.version, file, toolCount: m.tools.length });
      for (const t of m.tools) {
        seenTool.add(t.name);
        tools.push({
          name: t.name,
          description: `[plugin:${m.name}] ${t.description}`,
          inputSchema: t.inputSchema,
          tier: "plugin",
          plugin: m.name,
          requiresApproval: t.requiresApproval,
          execute: pluginToolExecutor(m, t),
        });
      }
    }
  }
  return { tools, plugins, errors };
}
