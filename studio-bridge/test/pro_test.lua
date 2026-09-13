-- pro_test.lua — Pro.lua entitlement logic under a stubbed Roblox environment.
-- Run: luau test/pro_test.lua  (no Studio needed)
--
-- The standalone luau CLI has no `game` global (and no cross-chunk global
-- sharing), so the test injects stub services via Pro.setEnv.

local PASS_COUNT = 0
local function check(name, cond)
	if not cond then
		error("FAIL " .. name, 0)
	end
	PASS_COUNT += 1
	print("PASS " .. name)
end

local PASS_ID = 111111
local DEV_ID = 222222
local STUB = {
	ownsPass = true,
	ownsDevProduct = false,
}

local Passes = {}
function Passes:PurchasedProductAsync(_userId, devId)
	if STUB.ownsDevProduct and devId == DEV_ID then
		return { IsPurchased = true, ProductId = devId }
	end
	error("user has not purchased this developer product")
end

local Marketplace = {}
function Marketplace:UserOwnsGamePassAsync(_userId, passId)
	return STUB.ownsPass and passId == PASS_ID
end
Marketplace.Passes = Passes

local Pro = require("../src/Root/Bridge/Pro")
Pro.setEnv({
	getMarketplace = function()
		return Marketplace
	end,
	getUserId = function()
		return 424242
	end,
})

-- ---------------- unconfigured → free ----------------
Pro.configure({ gamePassId = 0, devProductId = 0 })
do
	local s = Pro.status()
	check("unconfigured: configured=false", s.configured == false)
	check("unconfigured: pro=false", s.pro == false)
	check("unconfigured: free export depth", Pro.limit("export_depth") == 6)
	check("unconfigured: free import nodes", Pro.limit("import_nodes") == 500)
	check("unconfigured: free viewport", Pro.limit("viewport_max_width") == 1280 and Pro.limit("viewport_max_height") == 720)
	check("unconfigured: no cloud snapshots", Pro.limit("cloud_snapshots") == false)
end

-- ---------------- pass owned → pro ----------------
Pro.configure({ gamePassId = PASS_ID, devProductId = DEV_ID })
STUB.ownsPass, STUB.ownsDevProduct = true, false
do
	local s = Pro.status()
	check("pass: configured=true", s.configured == true)
	check("pass: passOwned=true", s.passOwned == true)
	check("pass: devProductOwned=false", s.devProductOwned == false)
	check("pass: pro=true", s.pro == true)
	check("pass: userId surfaced", s.userId == 424242)
	check("pass: pro export depth", Pro.limit("export_depth") == 10)
	check("pass: pro import nodes", Pro.limit("import_nodes") == 2500)
	check("pass: pro viewport", Pro.limit("viewport_max_width") == 1920 and Pro.limit("viewport_max_height") == 1080)
	check("pass: cloud snapshots on", Pro.limit("cloud_snapshots") == true)
	check("pass: relay on", Pro.limit("pro_mcp_relay") == true)
end

-- ---------------- cache: flipped flags don't change until reset ----------------
STUB.ownsPass = false
do
	local s = Pro.status()
	check("cache: still pro within refresh window", s.pro == true)
end
Pro.reset()
do
	local s = Pro.status()
	check("after reset: passOwned=false", s.passOwned == false)
	check("after reset: pro=false (neither owned)", s.pro == false)
	check("after reset: back to free limits", Pro.limit("import_nodes") == 500)
end

-- ---------------- dev product owned → pro ----------------
STUB.ownsDevProduct = true
Pro.reset()
do
	local s = Pro.status()
	check("devproduct: devProductOwned=true", s.devProductOwned == true)
	check("devproduct: pro=true via monthly product", s.pro == true)
	check("devproduct: pro limits active", Pro.limit("export_depth") == 10)
end

-- ---------------- wrong ids → not owned ----------------
STUB.ownsPass, STUB.ownsDevProduct = true, true
Pro.configure({ gamePassId = 999, devProductId = 998 })
do
	local s = Pro.status()
	check("wrong ids: passOwned=false", s.passOwned == false)
	check("wrong ids: devProductOwned=false", s.devProductOwned == false)
	check("wrong ids: pro=false", s.pro == false)
end

-- ---------------- report / uiLabel shapes ----------------
Pro.configure({ gamePassId = PASS_ID, devProductId = DEV_ID })
STUB.ownsPass, STUB.ownsDevProduct = true, false
Pro.reset()
do
	local rep = Pro.report()
	check("report: active header", rep:find("RoForge Pro: PRO (active)", 1, true) ~= nil)
	check("report: names the pass id", rep:find("Game Pass " .. PASS_ID .. ": OWNED", 1, true) ~= nil)
	check("report: pro limits listed", rep:find("import 2500 nodes", 1, true) ~= nil)
	check("uiLabel: pro label", Pro.uiLabel():sub(1, 3) == "PRO")
end
STUB.ownsPass, STUB.ownsDevProduct = false, false
Pro.reset()
do
	local rep = Pro.report()
	check("report: free header", rep:find("RoForge Pro: FREE tier", 1, true) ~= nil)
	check("report: unlock hint", rep:find("RoForge HQ experience", 1, true) ~= nil)
	check("uiLabel: free label", Pro.uiLabel() == "Free tier (pass ids set)")
end

-- ---------------- missing services degrade to free (Studio-less env) ----------------
Pro.resetEnv()
Pro.configure({ gamePassId = PASS_ID, devProductId = DEV_ID })
Pro.reset()
do
	local s = Pro.status()
	check("no services: pro=false (graceful)", s.pro == false)
	check("no services: no crash", type(s) == "table")
end

print("DONE " .. PASS_COUNT)
