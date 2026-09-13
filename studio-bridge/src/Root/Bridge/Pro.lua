-- Pro.lua — RoForge Pro entitlement (the open-core gate).
--
-- This is the ONLY Pro-awareness in the open plugin: it reads two pass ids
-- (created for the "RoForge HQ" experience), checks the current Studio
-- user's ownership via MarketplaceService, and exposes per-feature limits.
--
-- What's open vs. closed:
--   • OPEN (this file + the limit wiring): ownership check, raised limits
--     (export depth, import nodes, viewport size), the forge_pro status
--     tool, and the "Free tier" notices.
--   • CLOSED (Pro builds only, separate asset — see LICENSE-PRO.md): the
--     implementations of cloud snapshots, team workspaces, and the hosted
--     Pro MCP relay. This repo contains zero Pro implementation code.
--
-- All Roblox globals are touched lazily inside pcall, so the module loads
-- (and is testable) outside Studio.

local Pro = {}

local REFRESH_SECONDS = 60

-- Per-feature limits, Free vs Pro. Booleans are "feature available" flags;
-- numbers are caps enforced by the tools.
local FREE_LIMITS = {
	export_depth = 6,
	import_nodes = 500,
	viewport_max_width = 1280,
	viewport_max_height = 720,
	cloud_snapshots = false,
	team_workspaces = false,
	pro_mcp_relay = false,
}

local PRO_LIMITS = {
	export_depth = 10,
	import_nodes = 2500,
	viewport_max_width = 1920,
	viewport_max_height = 1080,
	cloud_snapshots = true,
	team_workspaces = true,
	pro_mcp_relay = true,
}

local state = {
	gamePassId = 0,
	devProductId = 0,
	userId = nil,
	passOwned = false,
	devProductOwned = false,
	checkedAt = 0,
}

-- Service access goes through an env table so the module is testable outside
-- Studio (the standalone luau CLI has no `game` and no shared globals). In
-- Studio the defaults are the real services, touched lazily inside pcall.
local defaultEnv = {
	getMarketplace = function()
		return game:GetService("MarketplaceService")
	end,
	getUserId = function()
		return game.Players.LocalPlayer.UserId
	end,
}
local env = defaultEnv

-- Test hook: replace either accessor (the other keeps its default).
function Pro.setEnv(newEnv)
	if type(newEnv) ~= "table" then
		return
	end
	env = {}
	env.getMarketplace = newEnv.getMarketplace or defaultEnv.getMarketplace
	env.getUserId = newEnv.getUserId or defaultEnv.getUserId
end

function Pro.resetEnv()
	env = defaultEnv
end

-- ids as numbers; 0 means "not configured"
function Pro.configure(opts)
	opts = type(opts) == "table" and opts or {}
	state.gamePassId = math.max(0, math.floor(tonumber(opts.gamePassId) or 0))
	state.devProductId = math.max(0, math.floor(tonumber(opts.devProductId) or 0))
	state.checkedAt = 0 -- ids changed — force a re-check
end

function Pro.gamePassId()
	return state.gamePassId
end

function Pro.devProductId()
	return state.devProductId
end

function Pro.isConfigured()
	return state.gamePassId > 0 or state.devProductId > 0
end

local function localUserId()
	local ok, id = pcall(env.getUserId)
	if ok and type(id) == "number" then
		return id
	end
	return nil
end

local function marketplace()
	local ok, ms = pcall(env.getMarketplace)
	if ok and ms then
		return ms
	end
	return nil
end

function Pro._passOwned()
	if state.gamePassId <= 0 then
		return false
	end
	local ms = marketplace()
	local userId = localUserId()
	if not ms or not userId then
		return false
	end
	local ok, owns = pcall(function()
		return ms:UserOwnsGamePassAsync(userId, state.gamePassId)
	end)
	return ok and owns == true
end

function Pro._devProductOwned()
	if state.devProductId <= 0 then
		return false
	end
	local ms = marketplace()
	local userId = localUserId()
	if not ms or not userId then
		return false
	end
	-- Passes is a property on MarketplaceService; PurchasedProductAsync
	-- errors for users who never bought the product.
	local ok = pcall(function()
		return ms.Passes:PurchasedProductAsync(userId, state.devProductId)
	end)
	return ok
end

local function summary()
	return {
		pro = Pro.isConfigured() and (state.passOwned or state.devProductOwned) or false,
		passOwned = state.passOwned,
		devProductOwned = state.devProductOwned,
		userId = state.userId,
		gamePassId = state.gamePassId,
		devProductId = state.devProductId,
		configured = Pro.isConfigured(),
	}
end

-- Current entitlement. Ownership is re-checked at most once per minute.
function Pro.status()
	local now = os.clock()
	if not (state.checkedAt > 0 and now - state.checkedAt < REFRESH_SECONDS) then
		state.userId = localUserId()
		state.passOwned = Pro._passOwned()
		state.devProductOwned = Pro._devProductOwned()
		state.checkedAt = now
	end
	return summary()
end

function Pro.isPro()
	return Pro.status().pro
end

function Pro.limits()
	return Pro.isPro() and PRO_LIMITS or FREE_LIMITS
end

function Pro.limit(key)
	local t = Pro.limits()
	if t[key] ~= nil then
		return t[key]
	end
	return FREE_LIMITS[key]
end

-- Short label for the dock widget ("PRO — game pass" / "Free tier" …).
function Pro.uiLabel()
	local s = Pro.status()
	if s.pro then
		if s.passOwned then
			return "PRO — game pass"
		end
		return "PRO — monthly product"
	end
	if s.configured then
		return "Free tier (pass ids set)"
	end
	return "Free tier (no pass ids set)"
end

-- Multi-line status report (the forge_pro tool result).
function Pro.report()
	local s = Pro.status()
	local L = Pro.limits()
	local lines = {}
	table.insert(lines, s.pro and "RoForge Pro: PRO (active)" or "RoForge Pro: FREE tier")
	if s.userId then
		table.insert(lines, ("Studio user: %d"):format(s.userId))
	end
	if s.configured then
		if s.gamePassId > 0 then
			table.insert(lines, ("Game Pass %d: %s"):format(s.gamePassId, s.passOwned and "OWNED" or "not owned"))
		end
		if s.devProductId > 0 then
			table.insert(
				lines,
				("Developer Product %d: %s"):format(s.devProductId, s.devProductOwned and "OWNED (monthly)" or "not owned")
			)
		end
	else
		table.insert(
			lines,
			"No pass ids configured — set ProGamePassId / ProDevProductId in the RoForge Bridge plugin settings "
				.. "(create both for the RoForge HQ experience in the Creator Dashboard)."
		)
	end
	table.insert(
		lines,
		"limits: export depth "
			.. L.export_depth
			.. " · import "
			.. L.import_nodes
			.. " nodes · viewport up to "
			.. L.viewport_max_width
			.. "x"
			.. L.viewport_max_height
	)
	table.insert(
		lines,
		"pro features: cloud snapshots="
			.. tostring(L.cloud_snapshots)
			.. " team workspaces="
			.. tostring(L.team_workspaces)
			.. " hosted MCP relay="
			.. tostring(L.pro_mcp_relay)
	)
	if not s.pro then
		table.insert(
			lines,
			"Unlock Pro: play the RoForge HQ experience and purchase the 'RoForge Pro' game pass (one-time) "
				.. "or 'Pro month' (monthly, repeatable)."
		)
	end
	return table.concat(lines, "\n")
end

-- Test hook: drop the ownership cache.
function Pro.reset()
	state.checkedAt = 0
	state.passOwned = false
	state.devProductOwned = false
end

return Pro
