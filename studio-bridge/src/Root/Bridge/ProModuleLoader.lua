-- ProModuleLoader.lua — open-source seam to the closed Pro module.
--
-- This file (MIT) does NOT implement any Pro features. It only looks for the
-- closed Pro ModuleScript in its documented locations, validates that it
-- implements the expected contract, and hands it to callers. When the module
-- is absent, callers get a clean "not installed" result — the open plugin
-- never crashes and never exposes Pro internals.
--
-- Search order (first match wins):
--   1. plugin:FindFirstChild("RoForgeProModule")        — Pro build (module
--      bundled inside the plugin by hacvilke)
--   2. ReplicatedStorage:FindFirstChild("RoForgeProModule") — in-place install
--
-- The closed module lives in the private companion repo (hacvilke/roforge-pro)
-- and must expose the contract below. `configure` may pass ids/settings
-- through; the module also works from its own SETTINGS block.

local REQUIRED = {
	"configure",
	"isPro",
	"report",
	"snapshot",
	"listSnapshots",
	"restore",
	"deleteSnapshot",
	"share",
	"listShared",
	"relayStatus",
	"relaySend",
}

local ProModuleLoader = {}

-- Injected environment (standalone-luau tests override these).
local env = {
	getPlugin = function()
		local ok, parent = pcall(function()
			if script ~= nil then
				return script.Parent
			end
		end)
		if ok and parent and parent:IsA("Plugin") then
			return parent
		end
	end,
	getReplicatedStorage = function()
		local ok, rs = pcall(function()
			return game:GetService("ReplicatedStorage")
		end)
		if ok and rs then
			return rs
		end
	end,
	_moduleRequire = require,
}

function ProModuleLoader.setEnv(overrides)
	for k, v in pairs(overrides or {}) do
		env[k] = v
	end
end

function ProModuleLoader._resetEnv()
	local ok, parent = pcall(function()
		if script ~= nil then
			return script.Parent
		end
	end)
	env.getPlugin = function()
		if ok and parent and parent:IsA("Plugin") then
			return parent
		end
	end
	env.getReplicatedStorage = function()
		local okRs, rs = pcall(function()
			return game:GetService("ReplicatedStorage")
		end)
		if okRs and rs then
			return rs
		end
	end
	env._moduleRequire = require
	ProModuleLoader._reset()
end

local cached = nil -- validated module table, or false = "looked, not found"

local function candidates()
	local list = {}
	local plugin = env.getPlugin and env.getPlugin() or nil
	if plugin then
		local bundled = plugin:FindFirstChild("RoForgeProModule")
		if bundled then
			table.insert(list, bundled)
		end
	end
	local replicated = env.getReplicatedStorage and env.getReplicatedStorage() or nil
	if replicated then
		local inPlace = replicated:FindFirstChild("RoForgeProModule")
		if inPlace then
			table.insert(list, inPlace)
		end
	end
	return list
end

-- Returns the module table, or nil + reason. Never errors.
function ProModuleLoader.load()
	if cached == false then
		return nil, "not installed"
	end
	if cached ~= nil then
		return cached
	end

	local found = nil
	for _, inst in ipairs(candidates()) do
		if inst:IsA("ModuleScript") then
			found = inst
			break
		end
	end
	if not found then
		cached = false
		return nil, "not installed"
	end

	local ok, mod = pcall(env._moduleRequire, found)
	if not ok then
		cached = false
		return nil, "failed to load: " .. tostring(mod)
	end
	if type(mod) ~= "table" then
		cached = false
		return nil, "bad module: did not return a table"
	end
	for _, fn in ipairs(REQUIRED) do
		if type(mod[fn]) ~= "function" then
			cached = false
			return nil, "bad module: missing " .. fn .. " (version mismatch?)"
		end
	end
	cached = mod
	return mod
end

-- True when the Pro module is installed AND the user is Pro.
function ProModuleLoader.isPro()
	local mod, _ = ProModuleLoader.load()
	if not mod then
		return false
	end
	local ok, is = pcall(mod.isPro)
	return ok and is == true
end

-- Call a contract method, converting module errors to {ok=false,error=...}.
local function call(mod, fn, ...)
	local args = { ... }
	local ok, result = pcall(function()
		return mod[fn](table.unpack(args, 1, #args))
	end)
	if not ok then
		return { ok = false, error = tostring(result) }
	end
	if type(result) == "table" and result.ok == nil then
		-- Contract: every call returns {ok=...}. Be lenient with a plain
		-- value by wrapping it.
		return { ok = true, result = result }
	end
	return result
end

-- Status of the closed component. Read-only.
function ProModuleLoader.features()
	local mod, err = ProModuleLoader.load()
	if not mod then
		return { installed = false, error = err, features = {} }
	end
	local report = call(mod, "report")
	return {
		installed = true,
		isPro = ProModuleLoader.isPro(),
		report = report,
		features = {
			cloud_snapshots = true,
			team_workspaces = true,
			hosted_mcp_relay = true,
		},
	}
end

function ProModuleLoader.configure(opts)
	local mod, err = ProModuleLoader.load()
	if not mod then
		return { ok = false, error = "Pro component not installed (" .. err .. ")" }
	end
	return call(mod, "configure", opts)
end

-- parent: resolved Instance (nil = workspace). Path resolution stays in
-- ExtraTools (LocalTools.resolvePath) so this loader has no DataModel deps.
function ProModuleLoader.snapshot(parent, name)
	local mod, err = ProModuleLoader.load()
	if not mod then
		return { ok = false, error = "Pro component not installed (" .. err .. ")" }
	end
	if not ProModuleLoader.isPro() then
		return { ok = false, error = "cloud snapshots require the RoForge Pro pass" }
	end
	return call(mod, "snapshot", parent or workspace, name)
end

function ProModuleLoader.restore(name, parent)
	local mod, err = ProModuleLoader.load()
	if not mod then
		return { ok = false, error = "Pro component not installed (" .. err .. ")" }
	end
	if not ProModuleLoader.isPro() then
		return { ok = false, error = "cloud restore requires the RoForge Pro pass" }
	end
	return call(mod, "restore", name, parent or workspace)
end

function ProModuleLoader.share(label, ref)
	local mod, err = ProModuleLoader.load()
	if not mod then
		return { ok = false, error = "Pro component not installed (" .. err .. ")" }
	end
	if not ProModuleLoader.isPro() then
		return { ok = false, error = "team workspaces require the RoForge Pro pass" }
	end
	return call(mod, "share", label, ref)
end

-- Test hook: clear the load cache.
function ProModuleLoader._reset()
	cached = nil
end

return ProModuleLoader
