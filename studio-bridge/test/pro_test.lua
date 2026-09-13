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
-- Stub covers two real-world API shapes: owned → table {IsPurchased=true};
-- not owned → boolean false (the real API returns false, it does not error).
-- Pro.lua handles a third shape (error) as well.
function Passes:PurchasedProductAsync(_userId, devId)
	if STUB.ownsDevProduct and devId == DEV_ID then
		return { IsPurchased = true, ProductId = devId }
	end
	return false
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

-- ================= ProModuleLoader (the closed-module seam) =================
local ProModuleLoader = require("../src/Root/Bridge/ProModuleLoader")

local function fakeInstance(class, name, children)
	local inst = {
		_class = class,
		Name = name,
		_children = children or {},
	}
	function inst:IsA(c)
		return c == class or c == "Instance"
	end
	function inst:FindFirstChild(n)
		for _, ch in ipairs(self._children) do
			if ch.Name == n then
				return ch
			end
		end
		return nil
	end
	return inst
end

local function fakeProModule(overrides)
	local m = {
		configureCalled = nil,
		isProResult = true,
		snapshots = {},
		shared = {},
	}
	function m.configure(opts)
		m.configureCalled = opts
		return { ok = true }
	end
	function m.isPro()
		return m.isProResult
	end
	function m.report()
		return {
			header = "RoForge Pro (module) — " .. (m.isProResult and "PRO" or "FREE"),
			snapshots = #m.snapshots,
		}
	end
	function m.snapshot(_parent, name)
		local key = name or "auto"
		m.snapshots[key] = true
		return { ok = true, name = key, nodes = 7 }
	end
	function m.listSnapshots()
		local names = {}
		for k in pairs(m.snapshots) do
			table.insert(names, k)
		end
		return { snapshots = names }
	end
	function m.restore(name, _parent)
		if m.snapshots[name] then
			return { ok = true, restored = true }
		end
		return { ok = false, error = "no such snapshot: " .. tostring(name) }
	end
	function m.deleteSnapshot(name)
		m.snapshots[name] = nil
		return { ok = true }
	end
	function m.share(label, ref)
		m.shared[label] = ref
		return { ok = true, label = label, ref = ref }
	end
	function m.listShared()
		local out = {}
		for k, v in pairs(m.shared) do
			table.insert(out, { label = k, ref = v })
		end
		return { shared = out }
	end
	function m.relayStatus()
		return { configured = false }
	end
	function m.relaySend(_payload)
		return { ok = false, error = "relay not configured" }
	end
	for k, v in pairs(overrides or {}) do
		m[k] = v
	end
	return m
end

-- (1) module absent → clean "not installed" everywhere, no crash
do
	ProModuleLoader._reset()
	ProModuleLoader.setEnv({
		getPlugin = function()
			return fakeInstance("Plugin", "RoForge Bridge", {})
		end,
		getReplicatedStorage = function()
			return fakeInstance("ReplicatedStorage", "ReplicatedStorage", {})
		end,
	})
	local mod, err = ProModuleLoader.load()
	check("loader: absent -> nil", mod == nil)
	check("loader: absent reason", err == "not installed")
	check("loader: absent -> isPro false", ProModuleLoader.isPro() == false)
	local snap = ProModuleLoader.snapshot(nil, "x")
	check("loader: snapshot absent -> ok=false", snap.ok == false)
	check("loader: snapshot absent message", tostring(snap.error):find("not installed") ~= nil)
	local feats = ProModuleLoader.features()
	check("loader: features installed=false", feats.installed == false)
	local bad = fakeInstance("Folder", "RoForgeProModule")
	ProModuleLoader._reset()
	ProModuleLoader.setEnv({
		getPlugin = function()
			return fakeInstance("Plugin", "RoForge Bridge", { bad })
		end,
		getReplicatedStorage = function()
			return fakeInstance("ReplicatedStorage", "ReplicatedStorage", {})
		end,
		_moduleRequire = function()
			error("should not be called")
		end,
	})
	local mod2, err2 = ProModuleLoader.load()
	-- non-ModuleScript instance is skipped → still "not installed"
	check("loader: non-ModuleScript skipped", mod2 == nil and err2 == "not installed")
end

-- (2) module present + user Pro → delegates and passes through
do
	local fake = fakeProModule()
	local moduleInst = fakeInstance("ModuleScript", "RoForgeProModule")
	ProModuleLoader._reset()
	ProModuleLoader.setEnv({
		getPlugin = function()
			return fakeInstance("Plugin", "RoForge Bridge", {})
		end,
		getReplicatedStorage = function()
			return fakeInstance("ReplicatedStorage", "ReplicatedStorage", { moduleInst })
		end,
		_moduleRequire = function(inst)
			check("loader: require got the module instance", inst == moduleInst)
			return fake
		end,
	})
	local mod, err = ProModuleLoader.load()
	check("loader: present -> module table", type(mod) == "table" and err == nil)
	check("loader: present -> isPro true", ProModuleLoader.isPro() == true)
	local cfg = ProModuleLoader.configure({ gamePassId = PASS_ID })
	check("loader: configure passthrough", cfg.ok == true and fake.configureCalled ~= nil)
	local snap = ProModuleLoader.snapshot(nil, "level1")
	check("loader: snapshot ok", snap.ok == true and snap.nodes == 7)
	local rest = ProModuleLoader.restore("level1")
	check("loader: restore ok", rest.ok == true and rest.restored == true)
	local restMissing = ProModuleLoader.restore("nope")
	check("loader: restore missing -> ok=false", restMissing.ok == false)
	local shared = ProModuleLoader.share("cp", "place:1")
	check("loader: share ok", shared.ok == true and shared.ref == "place:1")
	local feats = ProModuleLoader.features()
	check("loader: features installed=true", feats.installed == true and feats.isPro == true)
	check("loader: features list", feats.features.cloud_snapshots == true)
	-- cache: second load returns the same table without re-requiring
	local calls = 0
	ProModuleLoader.setEnv({
		_moduleRequire = function()
			calls += 1
			return fake
		end,
	})
	local modAgain = ProModuleLoader.load()
	check("loader: cached (no re-require)", modAgain == mod and calls == 0)
end

-- (3) module present but user NOT Pro → feature calls refused cleanly
do
	local fake = fakeProModule({ isProResult = false })
	local moduleInst = fakeInstance("ModuleScript", "RoForgeProModule")
	ProModuleLoader._reset()
	ProModuleLoader.setEnv({
		getPlugin = function()
			return fakeInstance("Plugin", "RoForge Bridge", {})
		end,
		getReplicatedStorage = function()
			return fakeInstance("ReplicatedStorage", "ReplicatedStorage", { moduleInst })
		end,
		_moduleRequire = function()
			return fake
		end,
	})
	check("loader: non-pro -> isPro false", ProModuleLoader.isPro() == false)
	local snap = ProModuleLoader.snapshot(nil, "x")
	check("loader: non-pro snapshot refused", snap.ok == false and tostring(snap.error):find("Pro pass") ~= nil)
	local rest = ProModuleLoader.restore("x")
	check("loader: non-pro restore refused", rest.ok == false)
	local shared = ProModuleLoader.share("a", "b")
	check("loader: non-pro share refused", shared.ok == false)
end

-- (4) bad module (missing contract method) → clean version-mismatch error
do
	local broken = fakeProModule()
	broken.listSnapshots = nil
	local moduleInst = fakeInstance("ModuleScript", "RoForgeProModule")
	ProModuleLoader._reset()
	ProModuleLoader.setEnv({
		getPlugin = function()
			return fakeInstance("Plugin", "RoForge Bridge", {})
		end,
		getReplicatedStorage = function()
			return fakeInstance("ReplicatedStorage", "ReplicatedStorage", { moduleInst })
		end,
		_moduleRequire = function()
			return broken
		end,
	})
	local mod, err = ProModuleLoader.load()
	check("loader: bad module rejected", mod == nil)
	check("loader: bad module names missing fn", tostring(err):find("listSnapshots") ~= nil)
end

-- (5) module errors at runtime → {ok=false, error=...}, never a thrown error
do
	local throwing = fakeProModule()
	throwing.snapshot = function()
		error("boom")
	end
	local moduleInst = fakeInstance("ModuleScript", "RoForgeProModule")
	ProModuleLoader._reset()
	ProModuleLoader.setEnv({
		getPlugin = function()
			return fakeInstance("Plugin", "RoForge Bridge", {})
		end,
		getReplicatedStorage = function()
			return fakeInstance("ReplicatedStorage", "ReplicatedStorage", { moduleInst })
		end,
		_moduleRequire = function()
			return throwing
		end,
	})
	local snap = ProModuleLoader.snapshot(nil, "x")
	check("loader: runtime error contained", snap.ok == false and tostring(snap.error):find("boom") ~= nil)
	ProModuleLoader._reset()
	ProModuleLoader._resetEnv()
end

print("DONE " .. PASS_COUNT)
