-- Local tools: run entirely inside Studio. No network, no backend.
--
-- These are the "hands" of the agent: inspect the DataModel, read/write
-- scripts, create/delete instances, run diagnostic Luau, take screenshots.
--
-- Every run(args) returns a STRING (success or "ERROR: ..."). The model sees
-- that string as the tool result and adapts.

local Selection = game:GetService("Selection")
local RunService = game:GetService("RunService")
local Pro = require(script.Pro)

local LocalTools = {}

local SCRIPT_CLASSES = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

-- Root services the agent may address by name.
local ROOT_NAMES = {}
do
	local roots = {
		workspace,
		game:GetService("ServerStorage"),
		game:GetService("ServerScriptService"),
		game:GetService("ReplicatedStorage"),
		game:GetService("Lighting"),
		game:GetService("SoundService"),
		game:GetService("StarterGui"),
		game:GetService("StarterPlayer"),
		game:GetService("StarterPack"),
	}
	for _, inst in ipairs(roots) do
		ROOT_NAMES[inst.Name] = inst
	end
end

local function splitPath(pathStr)
	local parts = {}
	for part in string.gmatch(tostring(pathStr or ""), "[^%.]+") do
		table.insert(parts, part)
	end
	return parts
end

-- Resolves "ServerScriptService.Game.Main" to an Instance.
local function resolvePath(pathStr)
	if type(pathStr) ~= "string" or pathStr == "" then
		return nil, "path is required"
	end
	local parts = splitPath(pathStr)
	if #parts == 0 then
		return nil, "path is required"
	end
	local root = ROOT_NAMES[parts[1]]
	if not root then
		local valid = {}
		for name in pairs(ROOT_NAMES) do
			table.insert(valid, name)
		end
		table.sort(valid)
		return nil, "unknown root '" .. parts[1] .. "' (valid roots: " .. table.concat(valid, ", ") .. ")"
	end
	local inst = root
	for i = 2, #parts do
		inst = inst:FindFirstChild(parts[i])
		if not inst then
			return nil, "no child named '" .. parts[i] .. "' under " .. inst:GetFullName()
		end
	end
	return inst
end

local function createMissing(pathStr, finalClass)
	local parts = splitPath(pathStr)
	if #parts < 2 then
		return nil
	end
	local root = ROOT_NAMES[parts[1]]
	if not root then
		return nil
	end
	local inst = root
	for i = 2, #parts do
		local child = inst:FindFirstChild(parts[i])
		if not child then
			local class = if i == #parts then (finalClass or "Script") else "Folder"
			local okNew, newInst = pcall(Instance.new, class)
			if not okNew then
				return nil
			end
			newInst.Name = parts[i]
			newInst.Parent = inst
			child = newInst
		end
		inst = child
	end
	return inst
end

local MAX_NODES = 1500
local function walk(inst, depth, maxDepth, lines, state)
	if state.reached then
		return
	end
	table.insert(lines, string.rep("  ", depth) .. inst.Name .. " [" .. inst.ClassName .. "]")
	state.n = state.n + 1
	if state.n >= MAX_NODES then
		state.reached = true
		table.insert(lines, string.rep("  ", depth + 1) .. "... (truncated at " .. MAX_NODES .. " nodes)")
		return
	end
	if depth < maxDepth then
		for _, child in ipairs(inst:GetChildren()) do
			walk(child, depth + 1, maxDepth, lines, state)
			if state.reached then
				break
			end
		end
	end
end

local function forgeSelected()
	local sel = Selection:Get()
	if #sel == 0 then
		return "Nothing is selected in Studio."
	end
	local out = { ("Selected instances (%d):"):format(#sel) }
	for _, inst in ipairs(sel) do
		table.insert(out, "  - " .. inst:GetFullName() .. " (" .. inst.ClassName .. ")")
	end
	return table.concat(out, "\n")
end

local function forgeTree(args)
	local rootName = tostring(args.root or "workspace")
	local maxDepth = math.clamp(tonumber(args.max_depth) or 3, 1, Pro.limit("export_depth"))
	local root = ROOT_NAMES[rootName]
	if not root then
		return "ERROR: unknown root '" .. rootName .. "'"
	end
	local lines = {}
	walk(root, 0, maxDepth, lines, { n = 0, reached = false })
	return table.concat(lines, "\n")
end

local function forgeRead(args)
	local inst, err = resolvePath(args.path)
	if not inst then
		return "ERROR: " .. err
	end
	if SCRIPT_CLASSES[inst.ClassName] then
		local src = tostring(inst.Source or "")
		if #src > 20000 then
			return ("-- %s (%s, %d chars total, truncated)\n%s\n... [truncated]"):format(
				inst:GetFullName(),
				inst.ClassName,
				#src,
				src:sub(1, 20000)
			)
		end
		return ("-- %s (%s)\n%s"):format(inst:GetFullName(), inst.ClassName, src)
	end
	local out = { inst:GetFullName() .. " [" .. inst.ClassName .. "]" }
	local props = {}
	local propList = inst:GetProperties()
	for _, p in ipairs(propList) do
		local okReq, isRequired = pcall(p.IsRequiredProperty, p)
		if p.Name ~= "Parent" and not (okReq and isRequired) then
			local ok, val = pcall(p.GetValue, p)
			if ok and type(val) ~= "userdata" then
				table.insert(props, "  " .. p.Name .. " = " .. tostring(val))
			end
		end
	end
	table.sort(props)
	if #props > 40 then
		local head = { table.unpack(props, 1, 40) }
		table.insert(head, "  ... (" .. (#props - 40) .. " more properties)")
		props = head
	end
	table.insert(out, table.concat(props, "\n"))
	return table.concat(out, "\n")
end

local function forgeWrite(args)
	local inst, err = resolvePath(args.path)
	if not inst then
		if args.create == false then
			return "ERROR: " .. err
		end
		inst = createMissing(args.path)
		if not inst then
			return "ERROR: could not create " .. tostring(args.path)
		end
	else
		if not SCRIPT_CLASSES[inst.ClassName] then
			return "ERROR: " .. inst:GetFullName() .. " is a " .. inst.ClassName
				.. ", not a script (Script/LocalScript/ModuleScript)"
		end
	end
	if type(args.source) ~= "string" then
		return "ERROR: source (string) is required"
	end
	inst.Source = args.source
	return ("Wrote %d chars of %s to %s"):format(#args.source, inst.ClassName, inst:GetFullName())
end

local function forgeCreate(args)
	local parent, err = resolvePath(args.parent_path)
	if not parent then
		return "ERROR: " .. err
	end
	local class = tostring(args.class_name or "")
	if class == "" then
		return "ERROR: class_name is required"
	end
	local okNew, inst = pcall(Instance.new, class)
	if not okNew then
		return "ERROR: cannot create instance: " .. tostring(inst)
	end
	inst.Name = tostring(args.name or class)
	inst.Parent = parent
	local out = ("Created %s at %s"):format(class, inst:GetFullName())
	local props = args.properties
	if type(props) == "table" then
		local setLines = {}
		for propName, propVal in pairs(props) do
			local okSet, setErr = pcall(function()
				inst[propName] = propVal
			end)
			if okSet then
				table.insert(setLines, "  set " .. propName)
			else
				table.insert(setLines, "  FAILED " .. propName .. ": " .. tostring(setErr))
			end
		end
		if #setLines > 0 then
			out = out .. "\n" .. table.concat(setLines, "\n")
		end
	end
	return out
end

local function forgeDelete(args)
	local inst, err = resolvePath(args.path)
	if not inst then
		return "ERROR: " .. err
	end
	if not inst.Parent then
		return "ERROR: cannot delete a root service"
	end
	local name = inst:GetFullName()
	inst:Destroy()
	return "Destroyed " .. name
end

local function forgeRun(args)
	if type(args.code) ~= "string" or args.code == "" then
		return "ERROR: code (string) is required"
	end
	local okL, first, second = pcall(loadstring, args.code)
	if not okL then
		return "ERROR: loadstring is unavailable in this context: " .. tostring(first)
	end
	if type(first) ~= "function" then
		return "ERROR: compile: " .. tostring(second)
	end
	local rets = table.pack(pcall(first))
	if rets[1] then
		local parts = {}
		for i = 2, rets.n do
			table.insert(parts, tostring(rets[i]))
		end
		if #parts > 0 then
			return "Ran OK | returned: " .. table.concat(parts, ", ")
		end
		return "Ran OK (no return values)"
	else
		return "Ran with error: " .. tostring(rets[2])
	end
end

local function forgeScreenshot(args)
	local name = tostring(args.name or ("roforge_" .. os.time()))
	local ok, err = pcall(function()
		game:Screenshot(name, tonumber(args.width) or 1280, tonumber(args.height) or 720)
	end)
	if not ok then
		return "ERROR: screenshot failed: " .. tostring(err)
	end
	return ("Screenshot saved as '%s.png' on your computer (Studio screenshot folder)."):format(name)
		.. " To make the model actually SEE the viewport, use forge_viewport instead."
end

local function forgeGameInfo()
	local mode = "Edit"
	if RunService:IsRunning() then
		mode = "Play"
	elseif RunService:IsPaused() then
		mode = "Paused"
	end
	local jobId = "unknown"
	pcall(function()
		jobId = job.get("id")
	end)
	return ("Place ID: %d\nJob ID: %s\nStudio mode: %s\nSelected: %d instance(s)\nServer name: %s"):format(
		game.PlaceId,
		tostring(jobId),
		mode,
		#Selection:Get(),
		tostring(game.ServerName)
	)
end

local TOOLS = {
	{
		name = "forge_selected",
		description = "List the instances currently selected in Studio (full path + class).",
		input_schema = { type = "object", properties = {}, additionalProperties = false },
		run = forgeSelected,
	},
	{
		name = "forge_tree",
		description = "Show an indented tree of instances (default root: workspace). Use to discover names before reading or editing.",
		input_schema = {
			type = "object",
			properties = {
				root = {
					type = "string",
					description = "Root service: workspace, ServerStorage, ServerScriptService, ReplicatedStorage, Lighting, SoundService, StarterGui, StarterPlayer, StarterPack. Default workspace.",
				},
				max_depth = { type = "integer", description = "How deep to go (1-6, 1-10 with RoForge Pro). Default 3." },
			},
			additionalProperties = false,
		},
		run = forgeTree,
	},
	{
		name = "forge_read",
		description = "Read a script's source by dotted path (e.g. 'ServerScriptService.Game.Main'), or dump an instance's properties if it is not a script.",
		input_schema = {
			type = "object",
			properties = { path = { type = "string", description = "Dotted instance path" } },
			required = { "path" },
			additionalProperties = false,
		},
		run = forgeRead,
	},
	{
		name = "forge_write",
		description = "Write COMPLETE source to a script by path. Use after forge_read; always send the full new source, never partial edits. Creates the script (and missing Folders) if it does not exist.",
		input_schema = {
			type = "object",
			properties = {
				path = { type = "string", description = "Dotted path ending in the Script/LocalScript/ModuleScript" },
				source = { type = "string", description = "The full new source" },
				create = { type = "boolean", description = "Create missing script/folders if absent. Default true." },
			},
			required = { "path", "source" },
			additionalProperties = false,
		},
		run = forgeWrite,
	},
	{
		name = "forge_create",
		description = "Create an instance under a parent path, optionally setting simple properties.",
		input_schema = {
			type = "object",
			properties = {
				parent_path = { type = "string", description = "Dotted path of the parent" },
				class_name = { type = "string", description = "e.g. Part, Folder, Script, Model, Part" },
				name = { type = "string", description = "Instance name" },
				properties = { type = "object", description = "Simple property values to set, e.g. { Anchored: true }" },
			},
			required = { "parent_path", "class_name" },
			additionalProperties = false,
		},
		run = forgeCreate,
	},
	{
		name = "forge_delete",
		description = "Delete an instance by path. Destructive — use with care.",
		input_schema = {
			type = "object",
			properties = { path = { type = "string" } },
			required = { "path" },
			additionalProperties = false,
		},
		run = forgeDelete,
	},
	{
		name = "forge_run",
		description = "Run a snippet of Luau in Studio and report return values or the error. For tests and diagnostics only — use forge_write for permanent code.",
		input_schema = {
			type = "object",
			properties = { code = { type = "string", description = "Luau code to run" } },
			required = { "code" },
			additionalProperties = false,
		},
		run = forgeRun,
	},
	{
		name = "forge_screenshot",
		description = "Save a screenshot of the 3D viewport to the user's computer.",
		input_schema = {
			type = "object",
			properties = {
				name = { type = "string", description = "File base name" },
				width = { type = "integer" },
				height = { type = "integer" },
			},
			additionalProperties = false,
		},
		run = forgeScreenshot,
	},
	{
		name = "forge_game_info",
		description = "Basic facts about the current place: place id, job id, Studio mode, selection count.",
		input_schema = { type = "object", properties = {}, additionalProperties = false },
		run = forgeGameInfo,
	},
}

function LocalTools.all()
	return TOOLS
end

-- Exported for the bridge-only tools (ExtraTools.lua).
LocalTools.resolvePath = resolvePath

return LocalTools
