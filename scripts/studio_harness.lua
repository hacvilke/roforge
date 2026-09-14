-- Stubbed-Studio environment for plugin smoke tests (standalone luau CLI).
--
-- Faithfully emulates the DataModel APIs the plugins touch at startup, with
-- STRICT checks where Studio is strict:
--   * setting a property that does not exist on a class → error
--     "<prop> is not a valid member of <class>"  (Studio's exact message)
--   * constructors with missing arguments → error
--     "Argument N missing or nil"  (Studio's exact message)
--
-- Everything else is permissive so the smoke test focuses on real bug classes
-- instead of maintaining a complete property table.

local M = {}

local function missingArg(n)
	error(string.format("Argument %d missing or nil", n), 0)
end

local function checkNums(args, n)
	for i = 1, n do
		if args[i] == nil then
			missingArg(i)
		end
	end
end

-- ---------------------------------------------------------- constructors ---

local C3 = {}
function C3.fromRGB(r, g, b)
	checkNums({ r, g, b }, 3)
	return { r = r / 255, g = g / 255, b = b / 255 }
end
function C3.new(r, g, b)
	checkNums({ r, g, b }, 3)
	return { r = r, g = g, b = b }
end

local UDimT = {}
function UDimT.new(scale, offset)
	checkNums({ scale, offset }, 2)
	return { s = scale, o = offset }
end
function UDimT.fromScale(s)
	if s == nil then missingArg(1) end
	return { s = s, o = 0 }
end
function UDimT.fromOffset(o)
	if o == nil then missingArg(1) end
	return { s = 0, o = o }
end

local UDim2T = {}
function UDim2T.new(sx, ox, sy, oy)
	checkNums({ sx, ox, sy, oy }, 4)
	return { sx = sx, ox = ox, sy = sy, oy = oy }
end
function UDim2T.fromScale(x, y)
	checkNums({ x, y }, 2)
	return { sx = x, ox = 0, sy = y, oy = 0 }
end
function UDim2T.fromOffset(x, y)
	checkNums({ x, y }, 2)
	return { sx = 0, ox = x, sy = 0, oy = y }
end

local V2T = {}
function V2T.new(x, y)
	checkNums({ x, y }, 2)
	return { x = x, y = y }
end
local V3T = {}
function V3T.new(x, y, z)
	checkNums({ x, y, z }, 3)
	return { x = x, y = y, z = z }
end
local CFT = {}
function CFT.new(...)
	local a = table.pack(...)
	if a.n >= 3 then
		checkNums(a, 3)
	elseif a.n < 1 then
		missingArg(1)
	end
	return {}
end

local DWPInfoT = {}
function DWPInfoT.new(...)
	local a = table.pack(...)
	checkNums(a, 7)
	return a
end

-- ----------------------------------------------------------------- Enum ---

local enumItems = {}
local EnumT = setmetatable({}, {
	__index = function(_, a)
		return setmetatable({}, {
			__index = function(_, b)
				local key = tostring(a) .. "." .. tostring(b)
				if not enumItems[key] then
					enumItems[key] = setmetatable({ _name = key }, {
						__tostring = function()
							return key
						end,
					})
				end
				return enumItems[key]
			end,
		})
	end,
})

-- ---------------------------------------------------------------- signal ---

local function newSignal()
	return {
		Connect = function()
			return function() end
		end,
		Once = function()
			return function() end
		end,
		Disconnect = function() end,
		Fire = function() end,
	}
end

-- -------------------------------------------------------------- instances ---

-- Strict property whitelist: these classes caused real bugs when given props
-- that do not exist on them. Everything else is permissive.
local STRICT_PROPS = {
	DockWidgetPluginGui = {
		Name = true, Title = true, Enabled = true, Visible = true,
		InitialDockState = true, Resizable = true, ZIndexBehavior = true,
	},
	PluginToolbarButton = {
		Name = true, Label = true, ToolTip = true, Active = true,
		ClickableWhenOff = true, Visible = true,
	},
	PluginToolbar = {
		Name = true,
	},
}

local KNOWN_EVENTS = {
	Click = true, Click2 = true, MouseButton1Click = true, FocusLost = true,
	Activated = true, Changed = true, ChildAdded = true, ChildRemoved = true,
	LayoutOrderChanged = true,
}

local created = {}
local dockGuis = {}

local function makeInstance(class, name)
	local inst = { ClassName = class, Name = name or class, _children = {}, _props = {} }
	table.insert(created, inst)
	if class == "PluginToolbarButton" then
		rawset(inst._props, "SetActive", function(self, active)
			rawset(inst._props, "Active", active)
		end)
	end
	if class == "TextLabel" or class == "TextBox" then
		rawset(inst._props, "TextBounds", { X = 100, Y = 16 })
	end
	return setmetatable(inst, {
		__index = function(t, k)
			if k == "Parent" then
				return rawget(t, "_parent")
			end
			if k == "WaitForChild" then
				return function(self, n)
					return self._children[n]
				end
			end
			if k == "FindFirstChild" then
				return function(self, n)
					return self._children[n]
				end
			end
			if k == "GetChildren" then
				return function(self)
					local out = {}
					for _, c in pairs(self._children) do
						table.insert(out, c)
					end
					return out
				end
			end
			if k == "GetFullName" then
				return function(self)
					local parts = { self.Name }
					local p = rawget(self, "_parent")
					while p do
						table.insert(parts, 1, p.Name)
						p = rawget(p, "_parent")
					end
					return table.concat(parts, ".")
				end
			end
			if k == "IsA" then
				return function(self, cls)
					return self.ClassName == cls
				end
			end
			if k == "Destroy" then
				return function(self)
					rawset(self, "_destroyed", true)
				end
			end
			if k == "GetPropertyChangedSignal" then
				return function()
					return newSignal()
				end
			end
			if t._props[k] ~= nil then
				return t._props[k]
			end
			if KNOWN_EVENTS[k] then
				t._props[k] = newSignal()
				return t._props[k]
			end
			return nil
		end,
		__newindex = function(t, k, v)
			if k == "Parent" then
				rawset(t, "_parent", v)
				if v and v._children then
					v._children[t.Name] = t
				end
				return
			end
			if STRICT_PROPS[class] and not STRICT_PROPS[class][k] then
				error(string.format('%s is not a valid member of %s "%s"', k, class, t.Name), 0)
			end
			rawset(t._props, k, v)
		end,
	})
end

local InstT = {}
function InstT.new(class, parent)
	if class == nil then
		missingArg(1)
	end
	local inst = makeInstance(class)
	if parent then
		inst.Parent = parent
	end
	return inst
end

-- ---------------------------------------------------------------- game -----

local services = {}
local function getService(name)
	-- services are real instances (they carry Name/ClassName like in Studio),
	-- with the few methods the plugins use attached as properties
	if not services[name] then
		local inst = makeInstance(name)
		local props = inst._props
		props.GetAsync = function()
			error("http stub: not reachable in smoke test", 0)
		end
		props.Request = function()
			return { Success = false, StatusCode = 0, Body = "smoke stub" }
		end
		props.JSONEncode = function(_, t)
			return tostring(t)
		end
		props.JSONDecode = function()
			return {}
		end
		props.Get = function()
			return {}
		end
		props.IsRunning = function()
			return false
		end
		props.IsPaused = function()
			return false
		end
		props.IsStepped = function()
			return false
		end
		services[name] = inst
	end
	return services[name]
end

local gameT
local workspaceInst
gameT = setmetatable({
	PlaceId = 0,
	ServerName = "smoke",
}, {
	__index = function(_, k)
		if k == "GetService" then
			return getService
		end
		if k == "Workspace" or k == "workspace" then
			if not workspaceInst then
				workspaceInst = makeInstance("Workspace")
			end
			return workspaceInst
		end
		return nil
	end,
})

-- ------------------------------------------------------------- plugin ------

local pluginT = {}
function pluginT:GetSetting(key)
	return pluginT._settings and pluginT._settings[key] or nil
end
function pluginT:SetSetting(key, value)
	plugin._settings = plugin._settings or {}
	plugin._settings[key] = value
end
function pluginT:CreateDockWidgetPluginGui(id, info)
	if id == nil then missingArg(1) end
	if info == nil then missingArg(2) end
	local gui = makeInstance("DockWidgetPluginGui", id)
	dockGuis[id] = gui
	rawset(gui._props, "Enabled", true)
	rawset(gui._props, "Visible", true)
	return gui
end
function pluginT:CreateToolbar(name)
	local bar = makeInstance("PluginToolbar", name or "Toolbar")
	rawset(bar._props, "CreateButton", function(self, label, tooltip)
		if label == nil then missingArg(1) end
		local btn = makeInstance("PluginToolbarButton", label)
		rawset(btn._props, "ToolTip", tooltip)
		table.insert(bar._children, btn)
		return btn
	end)
	return bar
end

-- ---------------------------------------------------------------- task ----

local taskT = {
	spawn = function(_)
		-- async work (polling loops) is intentionally NOT run in the smoke test
	end,
	defer = function(fn)
		fn()
	end,
	wait = function()
		error("task.wait outside task.spawn — not supported in smoke test", 0)
	end,
}

-- ---------------------------------------------------------------- env ------

local env

function M.install()
	env = {
		created = created,
		dockGuis = dockGuis,
		prints = {},
		warns = {},
		plugin = plugin,
	}
	pluginT._settings = {}

	plugin = pluginT
	game = gameT
	workspace = gameT.Workspace -- via __index
	Instance = InstT
	Color3 = C3
	UDim = UDimT
	UDim2 = UDim2T
	Vector2 = V2T
	Vector3 = V3T
	CFrame = CFT
	DockWidgetPluginGuiInfo = DWPInfoT
	Enum = EnumT
	task = taskT
	print = function(...)
		local parts = {}
		for i = 1, select("#", ...) do
			table.insert(parts, tostring(select(i, ...)))
		end
		table.insert(env.prints, table.concat(parts, "\t"))
	end
	warn = function(...)
		local parts = {}
		for i = 1, select("#", ...) do
			table.insert(parts, tostring(select(i, ...)))
		end
		table.insert(env.warns, table.concat(parts, "\t"))
	end
	return env
end

-- Build a node graph mirroring the plugin's Instance tree, from a nested spec:
--   M.buildGraph({ Name = "RoForgeBridge", path = "../src/Root/init.server",
--                  children = {
--                    { Name = "Bridge", path = "../src/Root/Bridge/init",
--                      children = { { Name = "Pro", path = "../src/Root/Bridge/Pro" } } } } })
-- Folders have no `path` (they are not require-able).
function M.buildGraph(spec)
	local node = { Name = spec.Name, id = spec.id or spec.Name, _children = {} }
	for _, childSpec in ipairs(spec.children or {}) do
		local child = M.buildGraph(childSpec)
		rawset(child, "_parent", node)
		node._children[child.Name] = child
	end
	return setmetatable(node, {
		__index = function(t, k)
			if k == "Parent" then
				return rawget(t, "_parent")
			end
			if k == "WaitForChild" then
				return function(self, n)
					return self._children[n]
				end
			end
			if k == "FindFirstChild" then
				return function(self, n)
					return self._children[n]
				end
			end
			if k == "GetChildren" then
				return function(self)
					local out = {}
					for _, c in pairs(self._children) do
						table.insert(out, c)
					end
					return out
				end
			end
			return t._children[k]
		end,
	})
end

-- Replace the global require() so that require(node) runs the module the node
-- represents, with `script` bound to that node while it loads (exactly what
-- Studio does per-module).
--
--   loader(node)          -> module table (called once per node, memoized)
--   stringFallback(str)   -> module table for relative string requires that
--                            standalone Luau can't resolve (e.g. "./Deflate"),
--                            or nil.
-- Returns the replacement require() function. NOTE: the caller must assign it
-- to the global `require` from the MAIN chunk — in the standalone Luau CLI,
-- `require` is only reassignable from the main chunk, not from loadstring'd
-- chunks.
function M.makeRequireHook(loader, stringFallback)
	local loaded = {}
	local function hook(arg)
		if type(arg) == "string" then
			local mod = stringFallback and stringFallback(arg)
			if mod == nil then
				error("smoke harness: unexpected string require: " .. arg, 0)
			end
			return mod
		end
		if loaded[arg] then
			return loaded[arg]
		end
		if rawget(arg, "id") == nil then
			error("smoke harness: require() called on a node without an id: "
				.. tostring(arg.Name or "?"), 0)
		end
		local prev = script
		script = arg
		local ok, mod = pcall(loader, arg)
		script = prev
		if not ok then
			error(mod, 0)
		end
		loaded[arg] = mod
		return mod
	end
	return hook
end

return M
