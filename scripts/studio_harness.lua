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
	return { _t = "Color3", r = r / 255, g = g / 255, b = b / 255 }
end
function C3.new(r, g, b)
	checkNums({ r, g, b }, 3)
	return { _t = "Color3", r = r, g = g, b = b }
end

local UDimT = {}
function UDimT.new(scale, offset)
	checkNums({ scale, offset }, 2)
	return { _t = "UDim", s = scale, o = offset }
end
function UDimT.fromScale(s)
	if s == nil then missingArg(1) end
	return { _t = "UDim", s = s, o = 0 }
end
function UDimT.fromOffset(o)
	if o == nil then missingArg(1) end
	return { _t = "UDim", s = 0, o = o }
end

local UDim2T = {}
function UDim2T.new(sx, ox, sy, oy)
	checkNums({ sx, ox, sy, oy }, 4)
	return { _t = "UDim2", sx = sx, ox = ox, sy = sy, oy = oy }
end
function UDim2T.fromScale(x, y)
	checkNums({ x, y }, 2)
	return { _t = "UDim2", sx = x, ox = 0, sy = y, oy = 0 }
end
function UDim2T.fromOffset(x, y)
	checkNums({ x, y }, 2)
	return { _t = "UDim2", sx = 0, ox = x, sy = 0, oy = y }
end

local V2T = {}
function V2T.new(x, y)
	checkNums({ x, y }, 2)
	return { _t = "Vector2", x = x, y = y }
end
local V3T = {}
function V3T.new(x, y, z)
	checkNums({ x, y, z }, 3)
	return { _t = "Vector3", x = x, y = y, z = z }
end
local FAKE_PNG = string.char(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
	.. string.rep(string.char(0), 96)

local CFT = {}
function CFT.new(...)
	local a = table.pack(...)
	if a.n >= 3 then
		checkNums(a, 3)
	elseif a.n < 1 then
		missingArg(1)
	end
	return setmetatable({}, {
		__index = function(_, k)
			if k == "ToHumanReadableString" then
				return function()
					return "0 0 0 | 1 0 0 | 0 1 0 | 0 0 1"
				end
			end
			return nil
		end,
	})
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

-- Strict per-class property whitelists (Studio rejects unknown props with
-- "<prop> is not a valid member of <class>"). Classes the plugins don't use
-- stay permissive.
local function mergeProps(...)
	local out = {}
	for _, tbl in ipairs({...}) do
		for k, v in pairs(tbl) do
			out[k] = v
		end
	end
	return out
end

local FRAME_PROPS = {
	Name = true, BackgroundColor3 = true, BackgroundTransparency = true,
	BorderSizePixel = true, BorderColor3 = true, Size = true, Position = true,
	Visible = true, LayoutOrder = true, AutomaticSize = true, ZIndex = true,
}
local TEXT_PROPS = {
	Text = true, TextColor3 = true, TextSize = true, Font = true,
	TextWrapped = true, TextXAlignment = true, TextYAlignment = true,
	TextTruncate = true, RichText = true, PlaceholderText = true,
	PlaceholderColor3 = true,
}
local STRICT_PROPS = {
	DockWidgetPluginGui = {
		-- real API: Title, Enabled (show/hide), InitialDockState — NO Visible prop
		Name = true, Title = true, Enabled = true, InitialDockState = true,
	},
	PluginToolbarButton = {
		-- real API: ClickableWhenViewportHidden, Enabled, Icon (+ Instance props)
		Name = true, ClickableWhenViewportHidden = true,
		Enabled = true, Icon = true,
	},
	PluginToolbar = { Name = true },
	Frame = FRAME_PROPS,
	ScrollingFrame = mergeProps(FRAME_PROPS, {
		CanvasSize = true, CanvasPosition = true, AutomaticCanvasSize = true,
		ScrollingDirection = true, ScrollBarThickness = true,
	}),
	TextLabel = mergeProps(FRAME_PROPS, TEXT_PROPS),
	TextBox = mergeProps(FRAME_PROPS, TEXT_PROPS, {
		ClearTextOnFocus = true, MultiLine = true, BorderMode = true,
	}),
	TextButton = mergeProps(FRAME_PROPS, TEXT_PROPS, {
		Active = true, ButtonSize = true,
	}),
	UICorner = { Name = true, CornerRadius = true },
	UIPadding = {
		Name = true, PaddingTop = true, PaddingBottom = true,
		PaddingLeft = true, PaddingRight = true,
	},
	UIListLayout = {
		Name = true, Padding = true, SortOrder = true, FillDirection = true,
		VerticalAlignment = true, HorizontalAlignment = true,
	},
}

-- property TYPE checks (Studio rejects wrong-typed values)
local PROP_TYPES = {
	-- NOTE: class-dependent types (Part.Size = Vector3, Frame.Size = UDim2,
	-- RenderSurfaceTexture.CanvasSize = Vector2) are intentionally NOT here —
	-- a global map cannot express per-class types.
	Padding = "UDim", CornerRadius = "UDim",
	PaddingTop = "UDim", PaddingBottom = "UDim",
	PaddingLeft = "UDim", PaddingRight = "UDim",
	BackgroundColor3 = "Color3", BorderColor3 = "Color3",
	TextColor3 = "Color3", PlaceholderColor3 = "Color3",
}

local KNOWN_EVENTS = {
	Click = true, Click2 = true, MouseButton1Click = true, FocusLost = true,
	Activated = true, Deactivated = true, Changed = true, ChildAdded = true,
	ChildRemoved = true, LayoutOrderChanged = true, TextChanged = true,
}

local function describeType(v)
	if type(v) == "table" then
		local t = rawget(v, "_t")
		if t then
			return t
		end
	end
	return type(v)
end

local created = {}
local dockGuis = {}

local function makeInstance(class, name)
	local inst = { ClassName = class, _children = {}, _props = {} }
	table.insert(created, inst)
	if class == "PluginToolbarButton" then
		rawset(inst._props, "SetActive", function(self, active)
			rawset(inst._props, "Active", active)
		end)
	end
	if class == "TextLabel" or class == "TextBox" then
		rawset(inst._props, "TextBounds", { X = 100, Y = 16 })
	end
	if class == "RenderSurfaceTexture" then
		rawset(inst._props, "Image", {
			Read = function()
				local w = rawget(inst._props, "Width") or 1024
				local h = rawget(inst._props, "Height") or 576
				return string.rep("\0", w * h * 4)
			end,
		})
	end
	inst = setmetatable(inst, {
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
			if k == "FindFirstChildOfClass" then
				return function(self, cls)
					for _, c in pairs(self._children) do
						if c.ClassName == cls then
							return c
						end
					end
					return nil
				end
			end
			if k == "FindFirstChildWhichIsA" then
				return function(self, cls)
					for _, c in pairs(self._children) do
						if c.ClassName == cls then
							return c
						end
					end
					return nil
				end
			end
			if k == "GetDescendants" then
				return function(self)
					local out = {}
					local function walk(inst)
						for _, c in pairs(inst._children) do
							table.insert(out, c)
							walk(c)
						end
					end
					walk(self)
					return out
				end
			end
			if k == "IsDescendantOf" then
				return function(self, other)
					local pp = rawget(self, "_parent")
					while pp do
						if pp == other then
							return true
						end
						pp = rawget(pp, "_parent")
					end
					return false
				end
			end
			if k == "SetAttribute" then
				return function(self, name, value)
					rawset(self, "_attrs", rawget(self, "_attrs") or {})
					rawset(self._attrs, name, value)
				end
			end
			if k == "GetAttributes" then
				return function(self)
					return rawget(self, "_attrs") or {}
				end
			end
			if k == "GetProperties" then
				return function(self)
					local out = {}
					for prop, v in pairs(t._props) do
						if type(v) ~= "function" and prop ~= "Parent" then
							table.insert(out, {
								Name = prop,
								GetValue = function()
									return rawget(t._props, prop)
								end,
								IsRequiredProperty = function()
									return false
								end,
							})
						end
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
			if k == "Name" then
				-- renaming must update the parent's child map, like real Roblox.
				-- Name lives in _props (never a raw field) so every write reaches
				-- this handler — raw-field writes bypass __newindex.
				local pp = rawget(t, "_parent")
				local oldName = rawget(t._props, "Name")
				rawset(t._props, "Name", v)
				if pp and pp._children then
					pp._children[oldName] = nil
					pp._children[v] = t
				end
				return
			end
			if STRICT_PROPS[class] and not STRICT_PROPS[class][k] then
				error(string.format('%s is not a valid member of %s "%s"', k, class, t.Name), 0)
			end
			local expected = PROP_TYPES[k]
			if expected and describeType(v) ~= expected then
				if expected == "UDim" then
					error(string.format('Unable to cast %s to UDim', describeType(v)), 0)
				end
				error(string.format('Expected %s, got %s', expected, describeType(v)), 0)
			end
			rawset(t._props, k, v)
		end,
	})
	-- Name goes through the handler: stored in _props, parent map kept in sync
	inst.Name = name or class
	return inst
end

local InstT = {}
-- Instantiable classes (Instance.new rejects anything else in real Roblox —
-- e.g. "Invalid class name: BasePart"). Mirrors that so the test harness
-- catches bad class names the way Studio would.
local CREATABLE = {
	Script = true, LocalScript = true, ModuleScript = true, Folder = true, Model = true,
	Part = true, MeshPart = true, Truss = true, CornerWedge = true, SpherePart = true,
	CylinderPart = true, WedgePart = true, FileMesh = true, UnionOperation = true,
	SubtractionOperation = true,
	Tool = true, Handle = true, Humanoid = true, CharacterMesh = true, VehicleSeat = true,
	SpawnLocation = true, ForceField = true, WorldRoot = true, TeleportPad = true,
	Weld = true, Motor6D = true, HingeConstraint = true, LinearMotor = true,
	BallSocketConstraint = true, SpringArm = true,
	BodyMover = true, BodyForce = true, BodyGyro = true, BodyPosition = true,
	Decal = true, ParticleEmitter = true, Sparkles = true, Trail = true, Fire = true,
	Beam = true, Smoke = true, Attachment = true, Path = true, SurfaceGui = true,
	PointLight = true, Spotlight = true, SurfaceLight = true, Omnilight = true,
	RectAreaLight = true,
	ScreenGui = true, BillboardGui = true, Frame = true, TextLabel = true,
	TextButton = true, TextBox = true, ImageLabel = true, ImageButton = true,
	ViewportFrame = true, CanvasGroup = true, ScrollingFrame = true,
	UIGridLayout = true, UIListLayout = true, UIPadding = true, UIStroke = true,
	UICorner = true, UISizeConstraint = true, UIScale = true,
	UIAspectRatioConstraint = true, UICanvasFrame = true,
	RemoteEvent = true, RemoteFunction = true, Sound = true, Music = true,
	RenderSurfaceTexture = true, Camera = true,
}

function InstT.new(class, parent)
	if class == nil then
		missingArg(1)
	end
	if type(class) ~= "string" or not CREATABLE[class] then
		error("Invalid class name: " .. tostring(class), 0)
	end
	local inst = makeInstance(class)
	if parent then
		inst.Parent = parent
	end
	return inst
end

-- ---------------------------------------------------------------- game -----

-- Minimal JSON codec for the smoke/tools tests (the plugin tools route their
-- JSON through HttpService). Strings, numbers, booleans, nil, arrays, objects.
local function jsonDecode(text)
	local pos = 1
	local function err(msg)
		error(("json: %s (at %d)"):format(msg, pos), 0)
	end
	local function ws()
		while pos <= #text do
			local c = text:sub(pos, pos)
			if c == " " or c == "\t" or c == "\n" or c == "\r" then
				pos = pos + 1
			else
				break
			end
		end
	end
	local parseValue
	local function parseString()
		pos = pos + 1
		local out = {}
		while pos <= #text do
			local c = text:sub(pos, pos)
			if c == '"' then
				pos = pos + 1
				return table.concat(out)
			elseif c == "\\" then
				local e = text:sub(pos + 1, pos + 1)
				if e == "n" then
					table.insert(out, "\n")
				elseif e == "t" then
					table.insert(out, "\t")
				elseif e == "r" then
					table.insert(out, "\r")
				elseif e == '"' then
					table.insert(out, '"')
				elseif e == "\\" then
					table.insert(out, "\\")
				elseif e == "/" then
					table.insert(out, "/")
				elseif e == "b" then
					table.insert(out, "\b")
				elseif e == "f" then
					table.insert(out, "\f")
				elseif e == "u" then
					local hex = text:sub(pos + 2, pos + 5)
					local n = tonumber(hex, 16)
					if n and n < 256 then
						table.insert(out, string.char(n))
					end
					pos = pos + 4
				else
					table.insert(out, e)
				end
				pos = pos + 2
			else
				table.insert(out, c)
				pos = pos + 1
			end
		end
		err("unterminated string")
	end
	parseValue = function()
		ws()
		if pos > #text then
			err("unexpected end of input")
		end
		local c = text:sub(pos, pos)
		if c == '"' then
			return parseString()
		elseif c == "{" then
			pos = pos + 1
			local obj = {}
			ws()
			if text:sub(pos, pos) == "}" then
				pos = pos + 1
				return obj
			end
			while true do
				ws()
				if text:sub(pos, pos) ~= '"' then
					err("expected object key string")
				end
				local k = parseString()
				ws()
				if text:sub(pos, pos) ~= ":" then
					err("expected ':'")
				end
				pos = pos + 1
				obj[k] = parseValue()
				ws()
				local d = text:sub(pos, pos)
				if d == "," then
					pos = pos + 1
				elseif d == "}" then
					pos = pos + 1
					return obj
				else
					err("expected ',' or '}'")
				end
			end
		elseif c == "[" then
			pos = pos + 1
			local arr = {}
			ws()
			if text:sub(pos, pos) == "]" then
				pos = pos + 1
				return arr
			end
			while true do
				arr[#arr + 1] = parseValue()
				ws()
				local d = text:sub(pos, pos)
				if d == "," then
					pos = pos + 1
				elseif d == "]" then
					pos = pos + 1
					return arr
				else
					err("expected ',' or ']'")
				end
			end
		elseif c == "t" then
			if text:sub(pos, pos + 3) == "true" then
				pos = pos + 4
				return true
			end
			err("invalid literal")
		elseif c == "f" then
			if text:sub(pos, pos + 4) == "false" then
				pos = pos + 5
				return false
			end
			err("invalid literal")
		elseif c == "n" then
			if text:sub(pos, pos + 3) == "null" then
				pos = pos + 4
				return nil
			end
			err("invalid literal")
		else
			local startp = pos
			while pos <= #text do
				local d = text:sub(pos, pos)
				if d:match("[%d%-%.eE]") then
					pos = pos + 1
				else
					break
				end
			end
			local num = tonumber(text:sub(startp, pos - 1))
			if not num then
				err("invalid value")
			end
			return num
		end
	end
	local v = parseValue()
	ws()
	return v
end

local function jsonEncode(v)
	local function enc(v2)
		local t = type(v2)
		if t == "string" then
			return '"' .. v2:gsub("[%c\"]", "\\%0") .. '"'
		elseif t == "number" then
			return tostring(v2)
		elseif t == "boolean" then
			return v2 and "true" or "false"
		elseif t == "nil" then
			return "null"
		elseif t == "table" then
			local isArr = true
			local n = 0
			for k in pairs(v2) do
				n = n + 1
				if k ~= n then
					isArr = false
					break
				end
			end
			if isArr then
				local parts = {}
				for i = 1, n do
					parts[i] = enc(v2[i])
				end
				return "[" .. table.concat(parts, ",") .. "]"
			end
			local parts = {}
			for k, val in pairs(v2) do
				if type(val) ~= "function" then
					parts[#parts + 1] = '"' .. tostring(k):gsub("[%c\"]", "\\%0") .. '":' .. enc(val)
				end
			end
			return "{" .. table.concat(parts, ",") .. "}"
		end
		return "null"
	end
	return enc(v)
end

local services = {}
local changeHistoryIndex = 10
local function getService(name, fallback)
	-- called both as game:GetService("X") (self arrives as `name`) and
	-- getService("X")
	if type(name) ~= "string" then
		name = fallback
	end
	if type(name) ~= "string" then
		name = "Unknown"
	end
	-- services are real instances (they carry Name/ClassName like in Studio),
	-- with the few methods the plugins use attached as properties
	if not services[name] and name == "Selection" then
		local inst = makeInstance(name)
		local sel = {}
		inst._props.Set = function(_, instances)
			if type(instances) == "table" then
				sel = instances
			end
		end
		inst._props.Get = function()
			return sel
		end
		services[name] = inst
		return inst
	end
	if not services[name] and name == "StudioCaptureService" then
		local inst = makeInstance(name)
		local props = inst._props
		props.CanCaptureScreenshot = function()
			return true
		end
		props.RequestScreenshotPermissionAsync = function()
			return true
		end
		props.CaptureScreenshot = function()
			return {
				BufferStatus = EnumT.StudioCaptureBufferStatus.Ready,
				GetBuffer = function()
					return {
						ToString = function()
							return FAKE_PNG
						end,
					}
				end,
				GetErrors = function()
					return {}
				end,
			}
		end
		services[name] = inst
		return inst
	end
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
			return jsonEncode(t)
		end
		props.JSONDecode = function(_, text)
			local ok, v = pcall(jsonDecode, tostring(text))
			if not ok then
				error(tostring(v), 0)
			end
			return v
		end
		props.Get = function()
			return {}
		end
		props.Set = function()
		end
		props.IsRunning = function()
			return false
		end
		props.IsStudio = function()
			return true
		end
		props.IsStepped = function()
			return false
		end
		props.SetChangePoint = function()
		end
		props.ChangeHistoryIndex = function()
			return changeHistoryIndex
		end
		props.SetChangeHistoryIndex = function(_, i)
			changeHistoryIndex = math.floor(tonumber(i) or changeHistoryIndex)
		end
		services[name] = inst
	end
	return services[name]
end

local gameT
local workspaceInst
gameT = setmetatable({
	PlaceId = 0,
	Name = "Place1",
}, {
	__index = function(_, k)
		if k == "GetService" then
			return getService
		end
		if k == "GetDescendants" then
			return function()
				local out = {}
				if not workspaceInst then
					workspaceInst = makeInstance("Workspace")
					rawset(workspaceInst._props, "CurrentCamera", makeInstance("Camera"))
				end
				table.insert(out, workspaceInst)
				local function walk(inst)
					for _, c in pairs(inst._children or {}) do
						table.insert(out, c)
						walk(c)
					end
				end
				walk(workspaceInst)
				for _, svc in pairs(services) do
					table.insert(out, svc)
				end
				return out
			end
		end
		if k == "Workspace" or k == "workspace" then
			if not workspaceInst then
				workspaceInst = makeInstance("Workspace")
				rawset(workspaceInst._props, "CurrentCamera", makeInstance("Camera"))
			end
			return workspaceInst
		end
		return nil
	end,
})

-- ------------------------------------------------------------- plugin ------

local pluginT = {}
function pluginT:ReadFile(path)
	return FAKE_PNG
end
function pluginT:WriteFile(path, data)
	env = env or {}
	env.writtenFiles = env.writtenFiles or {}
	env.writtenFiles[path] = data
end
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
	return gui
end
function pluginT:CreateToolbar(name)
	local bar = makeInstance("PluginToolbar", name or "Toolbar")
	rawset(bar._props, "CreateButton", function(self, buttonId, tooltip, iconname, text)
		-- real spec (robloxapi): CreateButton(buttonId, tooltip, iconname, text = nil)
		if buttonId == nil then missingArg(1) end
		if tooltip == nil then missingArg(2) end
		local visible = if text ~= nil then text else buttonId
		local btn = makeInstance("PluginToolbarButton", visible)
		rawset(btn._props, "ToolTip", tooltip)
		rawset(btn._props, "Icon", if iconname ~= nil then iconname else "")
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
		writtenFiles = {},
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
