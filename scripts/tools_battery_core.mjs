// Shared tool battery: generate a Luau chunk that boots the plugin under the
// stubbed Studio (studio_harness.lua) and then executes every forge_* tool
// with representative arguments, asserting:
//   - the tool does not raise
//   - the result does not contain a Roblox API crash signature
//     ("is not a valid member", "attempt to call missing", ...)
//   - the result contains the expected success substring
// This is the regression net for the turn-34 class of bugs (hallucinated
// Roblox API members) that the smoke test cannot catch: the smoke only proves
// modules load, it never executes the tools.
import { luaString, luaObj } from "./smoke_core.mjs";

const API_CRASH = [
  "is not a valid member",
  "attempt to call missing",
  "attempt to call a nil value",
  "attempt to index nil",
  "attempt to index a nil value",
  "is not a function",
  "bad argument #",
];

export function makeToolsLua(cfg) {
  const { harnessSrc, sources, graphSpec, steps, label, extraTools } = cfg;
  const sourcesLua = Object.entries(sources)
    .map(([id, src]) => `\t${id} = ${luaString(src)},`)
    .join("\n");
  const spec = luaObj(graphSpec);

  const stepsLua = steps.map((st, i) => {
    const n = i + 1;
    const argsExpr = st.argsLua != null ? st.argsLua : luaObj(st.args ?? {});
    const call = `local ok${n}, r${n} = pcall(runTool, ${luaString(st.tool)}, ${argsExpr})
if not ok${n} then fail(${luaString(st.tool)} .. " raised: " .. tostring(r${n})) end`;
    let check;
    if (st.expectTableWith) {
      const f = st.expectTableWith.field;
      const m = st.expectTableWith.minLen ?? 0;
      check = `if type(r${n}) ~= "table" or type(r${n}.${f}) ~= "string" or #r${n}.${f} < ${m} then
\tfail(${luaString(st.tool)} .. " expected a table with " .. ${luaString(f)} .. " (>= " .. ${m} .. " chars), got: " .. tostring(r${n}))
end
noCrash(${luaString(st.tool)}, r${n})`;
    } else {
      check = `check(${luaString(st.tool)}, r${n}, ${luaString(st.expect)})`;
    }
    return `${call}\n${check}`;
  }).join("\n");

  return `-- generated tool battery (${label})
local function fail(msg)
\tprint("TOOLS FAIL: " .. tostring(msg))
\terror("TOOLS FAIL: " .. tostring(msg), 0)
end

local okH, harness = pcall(loadstring(${luaString(harnessSrc)}, "studio_harness"))
if not okH then fail("harness failed to compile: " .. tostring(harness)) end

local sources = {
${sourcesLua}
}

local env = harness.install()
local HttpService = game:GetService("HttpService")
local graph = harness.buildGraph(${spec})
local loadedMods = {}
local function loadModule(node)
\tlocal id = node.id or node.Name
\tif loadedMods[id] then
\t\treturn loadedMods[id]
\tend
\tlocal src = sources[id]
\tif not src then
\t\tfail("no source for " .. tostring(id))
\tend
\tlocal ok, modOrErr = pcall(function()
\t\tlocal fn = loadstring(src, "@" .. id)
\t\treturn fn(env)
\tend)
\tif not ok then
\t\tfail(id .. " load failed: " .. tostring(modOrErr))
\tend
\tlocal mod = modOrErr
\tloadedMods[id] = mod
\treturn mod
end
local function stringFallbackFn(str)
\tlocal t = string.gsub(string.gsub(string.gsub(str, "%.%.", ""), "^%.", ""), "%.+$", "")
\tt = string.gsub(t, "%.", "/")
\tlocal id = string.gsub(t, "/", ".")
\tlocal src = sources[id]
\tif not src then
\t\tfail("string require: no source for " .. id)
\tend
\tlocal ok, modOrErr = pcall(function()
\t\tlocal fn = loadstring(src, "@" .. id)
\t\treturn fn(env)
\tend)
\tif not ok then
\t\tfail(id .. " load failed: " .. tostring(modOrErr))
\tend
\tlocal mod = modOrErr
\tloadedMods[id] = mod
\treturn mod
end
require = harness.makeRequireHook(loadModule, stringFallbackFn)

script = graph
local okEntry, entryErr = pcall(require, graph)
if not okEntry then fail("entry: " .. tostring(entryErr)) end

local LocalTools = loadModule(${cfg.localToolsNodeLua})
local ExtraTools = ${cfg.extraToolsNodeLua ? `loadModule(${cfg.extraToolsNodeLua})` : "nil"}

local allTools = {}
for _, t in ipairs(LocalTools.all()) do
\tallTools[t.name] = t.run
end
if ExtraTools then
\tfor _, t in ipairs(ExtraTools.all()) do
\t\tallTools[t.name] = t.run
\tend
end

local function resultText(res)
\tif type(res) == "table" then
\t\treturn tostring(res.text or "") .. (res.imageBase64 and (" [image:" .. #res.imageBase64 .. " b64 chars]") or "")
\tend
\treturn tostring(res)
end
local function noCrash(lbl, res)
\tlocal text = resultText(res)
\tfor _, bad in ipairs(${luaObj(API_CRASH)}) do
\t\tif text:find(bad, 1, true) then
\t\t\tfail(lbl .. " API CRASH (bad Roblox API usage): " .. text:sub(1, 400))
\t\tend
\tend
end
local function check(lbl, res, needle)
\tlocal text = resultText(res)
\tnoCrash(lbl, res)
\tif type(res) == "string" and res:find("^ERROR", 1, true) then
\t\tfail(lbl .. " returned ERROR: " .. text:sub(1, 400))
\tend
\tif not text:find(needle, 1, true) then
\t\tfail(lbl .. ": expected '" .. needle .. "' in: " .. text:sub(1, 400))
\tend
end

local function runTool(name, args)
\tlocal fn = allTools[name]
\tif not fn then
\t\tfail("unknown tool: " .. name)
\tend
\treturn fn(args)
end

${stepsLua}

print("TOOLS OK (${label}): " .. ${String(steps.length)} .. " calls executed, no API crashes, all expectations met")
`;
}
