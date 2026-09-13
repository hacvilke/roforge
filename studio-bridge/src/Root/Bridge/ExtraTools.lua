-- Extra bridge tools: vision capture, fine-grained property/attribute
-- access, and selection. Bridge-only (the client/ LocalTools copy keeps the
-- original toolset for the in-Studio chat).

local Viewport = require(script.Viewport)
local LocalTools = require(script.LocalTools)
local Pro = require(script.Pro)
local Selection = game:GetService("Selection")

local ExtraTools = {}

local function serializeValue(v)
	local t = type(v)
	if t == "string" then
		return v
	elseif t == "number" or t == "boolean" then
		return tostring(v)
	elseif t == "userdata" then
		local okHR, hr = pcall(function()
			return v:ToHumanReadableString()
		end)
		if okHR and type(hr) == "string" then
			return hr
		end
		local okT, ts = pcall(function()
			return tostring(v)
		end)
		if okT and type(ts) == "string" then
			return ts
		end
	end
	return tostring(v)
end

local function coerceValue(v)
	if type(v) == "string" then
		local n = tonumber(v)
		if n then
			return n
		end
		if v == "true" then
			return true
		end
		if v == "false" then
			return false
		end
	end
	return v
end

local function forgeViewport(args)
	return Viewport.capture(args)
end

local function forgeGetProperty(args)
	local inst, err = LocalTools.resolvePath(args.path)
	if not inst then
		return "ERROR: " .. err
	end
	local prop = tostring(args.property or "")
	if prop == "" then
		return "ERROR: property is required"
	end
	local ok, val = pcall(function()
		return inst[prop]
	end)
	if not ok then
		return "ERROR: no property named '" .. prop .. "' on " .. inst:GetFullName()
	end
	return ("property '%s' on %s = %s"):format(prop, inst:GetFullName(), serializeValue(val))
end

local function forgeSetProperty(args)
	local inst, err = LocalTools.resolvePath(args.path)
	if not inst then
		return "ERROR: " .. err
	end
	local prop = tostring(args.property or "")
	if prop == "" then
		return "ERROR: property is required"
	end
	local before = ""
	pcall(function()
		before = serializeValue(inst[prop])
	end)
	local ok, setErr = pcall(function()
		inst[prop] = coerceValue(args.value)
	end)
	if not ok then
		return "ERROR: cannot set property '" .. prop .. "' on " .. inst:GetFullName() .. ": " .. tostring(setErr)
	end
	local after = ""
	pcall(function()
		after = serializeValue(inst[prop])
	end)
	return ("Set '%s' on %s: %s -> %s"):format(prop, inst:GetFullName(), before, after)
end

local function forgeGetAttributes(args)
	local inst, err = LocalTools.resolvePath(args.path)
	if not inst then
		return "ERROR: " .. err
	end
	local ok, attrs = pcall(function()
		return inst:GetAttributes()
	end)
	if not ok or type(attrs) ~= "table" then
		return "ERROR: could not read attributes on " .. inst:GetFullName()
	end
	local names = {}
	for n in pairs(attrs) do
		table.insert(names, n)
	end
	table.sort(names)
	if #names == 0 then
		return ("No attributes on %s"):format(inst:GetFullName())
	end
	local out = { ("Attributes on %s (%d):"):format(inst:GetFullName(), #names) }
	for _, n in ipairs(names) do
		table.insert(out, "  " .. n .. " = " .. serializeValue(attrs[n]))
	end
	return table.concat(out, "\n")
end

local function forgeSetAttribute(args)
	local inst, err = LocalTools.resolvePath(args.path)
	if not inst then
		return "ERROR: " .. err
	end
	local name = tostring(args.name or "")
	if name == "" then
		return "ERROR: name is required"
	end
	local value = coerceValue(args.value)
	local t = type(value)
	if t ~= "string" and t ~= "number" and t ~= "boolean" then
		return "ERROR: attribute values must be a string, number, or boolean"
	end
	local ok, setErr = pcall(function()
		inst:SetAttribute(name, value)
	end)
	if not ok then
		return "ERROR: SetAttribute failed on " .. inst:GetFullName() .. ": " .. tostring(setErr)
	end
	return ("Set attribute '%s' = %s on %s"):format(name, tostring(value), inst:GetFullName())
end

local function forgeSelect(args)
	local paths = args.paths
	if type(paths) ~= "table" or #paths == 0 then
		return "ERROR: paths (array of dotted paths) is required"
	end
	local sel = {}
	local errs = {}
	for _, p in ipairs(paths) do
		local inst, err = LocalTools.resolvePath(tostring(p))
		if inst then
			table.insert(sel, inst)
		else
			table.insert(errs, tostring(err))
		end
	end
	if #sel == 0 then
		return "ERROR: could not resolve any path: " .. table.concat(errs, " | ")
	end
	local okSet, setErr = pcall(function()
		Selection:Set(sel)
	end)
	if not okSet then
		return "ERROR: Selection:Set failed: " .. tostring(setErr)
	end
	local out = ("Selected %d instance(s)"):format(#sel)
	for _, inst in ipairs(sel) do
		out = out .. "\n  - " .. inst:GetFullName() .. " (" .. inst.ClassName .. ")"
	end
	if #errs > 0 then
		out = out .. "\nwarnings: " .. table.concat(errs, " | ")
	end
	return out
end

-- ---------------- ChangeHistoryService (undo/redo) wrappers ----------------
-- Studio's ChangeHistoryService lets us name points in the undo history and
-- jump back to them — so a batch of destructive tool calls can be rolled
-- back as a unit (the built-in MCP does the same for its writes).
local ChangeHistory = game:GetService("ChangeHistoryService")
local checkpoints = {} -- name -> change-history index (insertion order kept)
local cpOrder = {}

local function cpIndex()
	local ok, i = pcall(function()
		return ChangeHistory:ChangeHistoryIndex()
	end)
	return ok and i or nil
end

local function forgeCheckpoint(args)
	local name = tostring(args.name or "checkpoint")
	local idx = cpIndex()
	if not idx then
		return "ERROR: ChangeHistoryService:ChangeHistoryIndex() unavailable"
	end
	local ok, err = pcall(function()
		ChangeHistory:SetChangePoint(name)
	end)
	if not ok then
		return "ERROR: SetChangePoint failed: " .. tostring(err)
	end
	checkpoints[name] = idx
	local exists = false
	for _, n in ipairs(cpOrder) do
		if n == name then
			exists = true
			break
		end
	end
	if not exists then
		cpOrder[#cpOrder + 1] = name
	end
	return ("checkpoint '%s' set at change-history index %d (also marked natively)"):format(name, idx)
end

local function forgeUndo(args)
	local to = args.to and tostring(args.to) or nil
	local cur = cpIndex()
	if not cur then
		return "ERROR: ChangeHistoryService:ChangeHistoryIndex() unavailable"
	end
	local target
	if to then
		target = checkpoints[to]
		if not target then
			local names = {}
			for _, n in ipairs(cpOrder) do
				names[#names + 1] = n
			end
			return "ERROR: no checkpoint named '" .. to .. "'" .. (#names > 0 and (" (available: " .. table.concat(names, ", ") .. ")") or "")
		end
	else
		target = cur - 1
	end
	if target >= cur then
		return ("already at or before index %d (current %d) — nothing to undo"):format(target, cur)
	end
	local ok, err = pcall(function()
		ChangeHistory:SetChangeHistoryIndex(target)
	end)
	if not ok then
		return "ERROR: SetChangeHistoryIndex(" .. target .. ") failed: " .. tostring(err)
	end
	local what = to and ("checkpoint '" .. to .. "'") or "one step"
	return ("undid back to index %d (%s); current index is now %d"):format(target, what, target)
end

local function forgeCheckpoints()
	local cur = cpIndex()
	if not cur then
		return "ERROR: ChangeHistoryService:ChangeHistoryIndex() unavailable"
	end
	local lines = { ("current change-history index: %d"):format(cur) }
	for _, n in ipairs(cpOrder) do
		lines[#lines + 1] = ("  %s  (index %d, %d steps back)"):format(n, checkpoints[n], cur - checkpoints[n])
	end
	if #cpOrder == 0 then
		lines[#lines + 1] = "  (no checkpoints yet — use forge_checkpoint first)"
	end
	return table.concat(lines, "\n")
end

-- ---------------- discovery / bulk / diff / export ----------------

local HttpService = game:GetService("HttpService")

local function forgeFind(args)
	local pattern = args.pattern and tostring(args.pattern) or ""
	local class = args.class_name and tostring(args.class_name) or ""
	if pattern == "" and class == "" then
		return "ERROR: provide pattern (name substring) and/or class_name"
	end
	local limit = math.min(math.max(tonumber(args.limit) or 50, 1), 200)
	local patLow = pattern:lower()
	local results = {}
	for _, inst in ipairs(game:GetDescendants()) do
		local okAlive, alive = pcall(function()
			return inst:IsDescendantOf(game)
		end)
		if okAlive and alive then
			if pattern ~= "" and not inst.Name:lower():find(patLow, 1, true) then
				-- no match
			elseif class ~= "" and inst.ClassName ~= class then
				-- no match
			else
				results[#results + 1] = inst:GetFullName()
				if #results >= limit then
					break
				end
			end
		end
	end
	if #results == 0 then
		return ("no instances matched (pattern='%s', class='%s')"):format(pattern, class)
	end
	local head = ("found %d instance(s)%s\n"):format(#results, #results >= limit and " (truncated)" or "")
	local lines = { head }
	for _, p2 in ipairs(results) do
		lines[#lines + 1] = "  " .. p2
	end
	return table.concat(lines, "\n")
end

local function forgeBulkCreate(args)
	local items = args.items
	if type(items) ~= "table" or #items == 0 then
		return "ERROR: items[] is required (array of {path, class_name, name?, properties?})"
	end
	if #items > 200 then
		return "ERROR: at most 200 items per call"
	end
	local created, failed = 0, 0
	local lines = {}
	for i, item in ipairs(items) do
		local parent, err = LocalTools.resolvePath(tostring(item.path or ""))
		if not parent then
			failed = failed + 1
			lines[#lines + 1] = ("[%d] FAILED parent: %s"):format(i, err)
		else
			local okNew, inst = pcall(Instance.new, tostring(item.class_name or ""))
			if not okNew then
				failed = failed + 1
				lines[#lines + 1] = ("[%d] FAILED create: %s"):format(i, tostring(inst))
			else
				inst.Name = tostring(item.name or item.class_name)
				inst.Parent = parent
				created = created + 1
				local line = ("[%d] created %s at %s"):format(i, inst.ClassName, inst:GetFullName())
				local props = item.properties
				if type(props) == "table" then
					local bad = {}
					for propName, propVal in pairs(props) do
						local okSet = pcall(function()
							inst[propName] = coerceValue(propVal)
						end)
						if not okSet then
							bad[#bad + 1] = propName
						end
					end
					if #bad > 0 then
						line = line .. " (FAILED props: " .. table.concat(bad, ", ") .. ")"
					end
				end
				lines[#lines + 1] = line
			end
		end
	end
	local out = ("bulk create: %d created, %d failed of %d\n"):format(created, failed, #items)
	local shown = lines
	if #lines > 50 then
		shown = {}
		for i = 1, 50 do
			shown[i] = lines[i]
		end
		shown[#shown + 1] = ("... and %d more lines"):format(#lines - 50)
	end
	return out .. table.concat(shown, "\n")
end

local snapshots = {}
local snapOrder = {}

-- Properties tracked for `~ changed` lines in forge_diff (fingerprint only;
-- kept deliberately small so capturing stays fast in big places)
local DIFF_PROPS = { "Position", "Size", "CFrame", "Color", "Anchored" }

local function captureTree()
	local tree = {}
	local count = 0
	for _, inst in ipairs(game:GetDescendants()) do
		local props = {}
		if inst.Name then
			props.Name = inst.Name
		end
		for _, prop in ipairs(DIFF_PROPS) do
			local ok, val = pcall(function()
				return inst[prop]
			end)
			if ok then
				local t = type(val)
				if t == "number" or t == "boolean" or t == "string" then
					props[prop] = tostring(val)
				elseif t == "userdata" then
					local okHR, hr = pcall(function()
						return val:ToHumanReadableString()
					end)
					if okHR and type(hr) == "string" then
						props[prop] = hr
					end
				end
			end
		end
		tree[inst:GetFullName()] = { cls = inst.ClassName, props = props }
		count = count + 1
	end
	return tree, count
end

local function forgeSnapshot(args)
	local name = args.name and tostring(args.name) or ("snap_" .. tostring(#snapOrder + 1))
	local tree, count = captureTree()
	snapshots[name] = tree
	local exists = false
	for _, n in ipairs(snapOrder) do
		if n == name then
			exists = true
			break
		end
	end
	if not exists then
		snapOrder[#snapOrder + 1] = name
	end
	while #snapOrder > 10 do
		local oldName = table.remove(snapOrder, 1)
		snapshots[oldName] = nil
	end
	return ("snapshot '%s' captured (%d instances; %d stored)"):format(name, count, #snapOrder)
end

local function forgeDiff(args)
	local name = args.name and tostring(args.name) or nil
	local snap
	if name then
		snap = snapshots[name]
		if not snap then
			local names = {}
			for _, n in ipairs(snapOrder) do
				names[#names + 1] = n
			end
			return "ERROR: no snapshot named '" .. name .. "'" .. (#names > 0 and (" (available: " .. table.concat(names, ", ") .. ")") or "")
		end
	else
		if #snapOrder == 0 then
			return "ERROR: no snapshots yet — call forge_snapshot first"
		end
		name = snapOrder[#snapOrder]
		snap = snapshots[name]
	end
	local now = captureTree()
	local added, removed, changed = {}, {}, {}
	for path, entry in pairs(now) do
		local prev = snap[path]
		if not prev then
			added[#added + 1] = path .. " (" .. entry.cls .. ")"
		elseif type(prev) == "table" and prev.props and entry.props then
			local keys = {}
			for k in pairs(prev.props) do
				keys[k] = true
			end
			for k in pairs(entry.props) do
				keys[k] = true
			end
			local names = {}
			for k in pairs(keys) do
				names[#names + 1] = k
			end
			table.sort(names)
			for _, k in ipairs(names) do
				local a, b2 = prev.props[k], entry.props[k]
				if a ~= b2 then
					changed[#changed + 1] = path .. ": " .. k .. "  (" .. tostring(a) .. " → " .. tostring(b2) .. ")"
				end
			end
		end
	end
	for path, entry in pairs(snap) do
		if not now[path] then
			removed[#removed + 1] = path .. " (" .. (type(entry) == "table" and entry.cls or tostring(entry)) .. ")"
		end
	end
	table.sort(added)
	table.sort(removed)
	table.sort(changed)
	local lines = {
		("diff vs snapshot '%s': %d added, %d removed, %d changed"):format(name, #added, #removed, #changed),
	}
	local function block(label, arr)
		for i = 1, math.min(#arr, 50) do
			lines[#lines + 1] = ("  %s %s"):format(label, arr[i])
		end
		if #arr > 50 then
			lines[#lines + 1] = ("  ... and %d more"):format(#arr - 50)
		end
	end
	if #added > 0 then
		block("+", added)
	end
	if #removed > 0 then
		block("-", removed)
	end
	if #changed > 0 then
		block("~", changed)
	end
	if #added == 0 and #removed == 0 and #changed == 0 then
		lines[#lines + 1] = "  (no changes to the instance tree)"
	end
	return table.concat(lines, "\n")
end

local EXPORT_PROPS = {
	"Position", "Size", "Color", "Anchored", "Transparency", "CanCollide",
	"Mass", "Visible", "Enabled", "Active", "BodyHeight", "WalkSpeed", "JumpPower",
}

local function exportNode(inst, depth, maxDepth)
	local node = { ClassName = inst.ClassName, Name = inst.Name }
	for _, prop in ipairs(EXPORT_PROPS) do
		local ok, val = pcall(function()
			return inst[prop]
		end)
		if ok and (type(val) == "number" or type(val) == "boolean" or type(val) == "string") then
			node[prop] = val
		end
	end
	local okCF, cf = pcall(function()
		return inst.CFrame and inst.CFrame:ToHumanReadableString() or nil
	end)
	if okCF and cf then
		node.CFrame = cf
	end
	if inst:IsA("Script") or inst:IsA("LocalScript") or inst:IsA("ModuleScript") then
		local src = tostring(inst.Source or "")
		node.Source = src:sub(1, 400) .. (#src > 400 and "...[truncated]" or "")
	end
	local okAttrs, attrs = pcall(function()
		return inst:GetAttributes()
	end)
	if okAttrs and attrs and next(attrs) then
		local a = {}
		for k, v in pairs(attrs) do
			if type(v) == "string" or type(v) == "number" or type(v) == "boolean" then
				a[k] = v
			end
		end
		if next(a) then
			node.Attributes = a
		end
	end
	if depth < maxDepth then
		local children = {}
		for _, child in ipairs(inst:GetChildren()) do
			children[#children + 1] = exportNode(child, depth + 1, maxDepth)
		end
		if #children > 0 then
			node.Children = children
		end
	end
	return node
end

local function forgeExport(args)
	local rootName = args.path and tostring(args.path) or "workspace"
	local inst, err = LocalTools.resolvePath(rootName)
	if not inst then
		return "ERROR: " .. err
	end
	local depth = math.min(math.max(tonumber(args.depth) or 3, 1), Pro.limit("export_depth"))
	local ok, json = pcall(function()
		return HttpService:JSONEncode(exportNode(inst, 1, depth))
	end)
	if not ok then
		return "ERROR: export failed: " .. tostring(json)
	end
	if #json > 200000 then
		return json:sub(1, 200000) .. "\n...[truncated — narrow the path or lower depth]"
	end
	return json
end

-- ---------------- forge_import ----------------
-- Re-applies a forge_export JSON: creates the instance tree, sets properties
-- (with Vector3/Color3/CFrame coercion) and attributes under a parent.

local function importMaxNodes()
	return Pro.limit("import_nodes")
end

local function importNodeCount(node)
	local n = 1
	local kids = type(node) == "table" and node.Children or nil
	if type(kids) == "table" then
		for _, c in ipairs(kids) do
			n = n + importNodeCount(c)
		end
	end
	return n
end

local function importValue(propName, val)
	-- tables are AI-friendly vector forms: {X,Y,Z} / {R,G,B}
	if type(val) == "table" then
		if val.X ~= nil or val.Y ~= nil or val.Z ~= nil then
			return Vector3.new(tonumber(val.X) or 0, tonumber(val.Y) or 0, tonumber(val.Z) or 0)
		end
		if val.R ~= nil or val.G ~= nil or val.B ~= nil then
			return Color3.fromRGB(tonumber(val.R) or 0, tonumber(val.G) or 0, tonumber(val.B) or 0)
		end
		return val
	end
	-- exported userdata comes back as human-readable strings; most Roblox
	-- properties parse those natively (Vector3 "0 1 2", Color3, CFrame, Enums)
	return val
end

local function importNode(node, parent, stats, pathPrefix)
	if type(node) ~= "table" or type(node.ClassName) ~= "string" then
		stats.errors = stats.errors + 1
		stats.errorLines[#stats.errorLines + 1] = pathPrefix .. ": missing ClassName — skipped"
		return nil
	end
	local className = node.ClassName
	local okNew, inst = pcall(Instance.new, className)
	if not okNew then
		stats.errors = stats.errors + 1
		stats.errorLines[#stats.errorLines + 1] = pathPrefix .. ": Instance.new(" .. className .. ") failed — skipped"
		return nil
	end
	local rootName = type(node.Name) == "string" and node.Name or className
	if stats.renameRoot then
		rootName = stats.renameRoot
	end
	inst.Name = rootName
	stats.nodes = stats.nodes + 1
	stats.classes[className] = (stats.classes[className] or 0) + 1
	-- properties (everything except structural keys)
	for propName, raw in pairs(node) do
		if propName ~= "ClassName" and propName ~= "Name" and propName ~= "Children" and propName ~= "Attributes" then
			local val = importValue(propName, raw)
			if type(val) == "string" and propName == "CFrame" then
				local okCF, cf = pcall(CFrame.new, val)
				if okCF then
					val = cf
				end
			end
			local okSet = pcall(function()
				inst[propName] = val
			end)
			if not okSet then
				stats.failedProps = stats.failedProps + 1
				if #stats.failedPropNames < 10 then
					stats.failedPropNames[#stats.failedPropNames + 1] = inst:GetFullName() .. "." .. propName
				end
			end
		end
	end
	local attrs = node.Attributes
	if type(attrs) == "table" then
		for k, v in pairs(attrs) do
			if type(v) == "string" or type(v) == "number" or type(v) == "boolean" then
				pcall(function()
					inst:SetAttribute(k, v)
				end)
			end
		end
	end
	-- parent last so the subtree can be built without half-set instances
	inst.Parent = parent
	local kids = node.Children
	if type(kids) == "table" then
		for i, c in ipairs(kids) do
			local childPrefix = pathPrefix .. "/" .. rootName .. "child" .. i
			importNode(c, inst, stats, childPrefix)
		end
	end
	return inst
end

local function forgeImport(args)
	local jsonText
	if args.json then
		jsonText = tostring(args.json)
	elseif args.path then
		local okRead, text = pcall(function()
			return readfile(tostring(args.path))
		end)
		if not okRead then
			return "ERROR: cannot read file '" .. tostring(args.path) .. "' (plugins can read files from the plugin folder): " .. tostring(text)
		end
		jsonText = text
	else
		return "ERROR: pass json (export text) or path (file in the plugin folder)"
	end
	if jsonText == "" then
		return "ERROR: empty json"
	end
	local okDecode, root = pcall(function()
		return HttpService:JSONDecode(jsonText)
	end)
	if not okDecode then
		return "ERROR: JSON decode failed: " .. tostring(root)
	end
	local nodeCount = importNodeCount(root)
	local maxNodes = importMaxNodes()
	if nodeCount > maxNodes then
		return ("ERROR: export has %d nodes; max %d per import%s — split it up (lower depth or narrower path)"):format(
			nodeCount,
			maxNodes,
			Pro.isPro() and "" or " (free tier; RoForge Pro raises this to 2500)"
		)
	end
	local parentPath = tostring(args.parent or "workspace")
	local parent, err = LocalTools.resolvePath(parentPath)
	if not parent then
		return "ERROR: parent not found: " .. err
	end
	if args.dry_run then
		local classes = {}
		local function collect(n)
			if type(n) == "table" then
				classes[n.ClassName] = (classes[n.ClassName] or 0) + 1
				if type(n.Children) == "table" then
					for _, c in ipairs(n.Children) do
						collect(c)
					end
				end
			end
		end
		collect(root)
		local parts = {}
		local names = {}
		for c in pairs(classes) do
			names[#names + 1] = c
		end
		table.sort(names)
		for _, c in ipairs(names) do
			parts[#parts + 1] = c .. " x" .. classes[c]
		end
		return ("dry run: would import %d node(s) under %s — %s\nto import for real, call forge_import again with dry_run=false"):format(
			nodeCount,
			parent:GetFullName(),
			table.concat(parts, ", ")
		)
	end
	local stats = {
		nodes = 0,
		errors = 0,
		failedProps = 0,
		classes = {},
		errorLines = {},
		failedPropNames = {},
		renameRoot = args.name and tostring(args.name) or nil,
	}
	local okRoot, rootInst = pcall(importNode, root, parent, stats, "root")
	if not okRoot then
		return "ERROR: import failed: " .. tostring(rootInst)
	end
	local head = ("imported %d node(s) under %s"):format(stats.nodes, parent:GetFullName())
	if stats.errors > 0 then
		head = head .. (" (%d node(s) skipped)"):format(stats.errors)
	end
	if stats.failedProps > 0 then
		head = head .. (" (%d property set(s) failed: %s)"):format(stats.failedProps, table.concat(stats.failedPropNames, ", "))
	end
	local out = { head }
	for i = 1, math.min(#stats.errorLines, 20) do
		out[#out + 1] = "  ! " .. stats.errorLines[i]
	end
	if #stats.errorLines > 20 then
		out[#out + 1] = "  ... and " .. (#stats.errorLines - 20) .. " more errors"
	end
	if rootInst then
		out[#out + 1] = "root: " .. rootInst:GetFullName()
	end
	return table.concat(out, "\n")
end

-- ---------------- forge_pro ----------------
-- Reports the current RoForge Pro entitlement (Free/Pro, which pass, and the
-- active limits/features). The agent calls this to know what the user can do.
local function forgePro(_args)
	return Pro.report()
end

local TOOLS = {
	{
		name = "forge_viewport",
		description =
			"Capture the Studio 3D viewport as a PNG and return it as an IMAGE the model can see (vision). "
			.. "Use to visually inspect the scene: layout, part placement, colors, lighting, or to check how a "
			.. "change looks before finishing.",
		input_schema = {
			type = "object",
			properties = {
				width = { type = "integer", description = "256-1280. Default 1024." },
				height = { type = "integer", description = "240-720. Default 576." },
			},
			additionalProperties = false,
		},
		run = forgeViewport,
	},
	{
		name = "forge_get_property",
		description = "Read a single property of an instance in Studio by dotted path (e.g. path='workspace.Part', property='Anchored').",
		input_schema = {
			type = "object",
			properties = {
				path = { type = "string", description = "Dotted instance path" },
				property = { type = "string", description = "Property name" },
			},
			required = { "path", "property" },
			additionalProperties = false,
		},
		run = forgeGetProperty,
	},
	{
		name = "forge_set_property",
		description = "Set a single property of an instance in Studio. The value is sent as a string; numbers and booleans are coerced. Destructive.",
		input_schema = {
			type = "object",
			properties = {
				path = { type = "string", description = "Dotted instance path" },
				property = { type = "string", description = "Property name" },
				value = { type = "string", description = "New value" },
			},
			required = { "path", "property", "value" },
			additionalProperties = false,
		},
		run = forgeSetProperty,
	},
	{
		name = "forge_get_attributes",
		description = "List all attributes (name = value) on an instance in Studio.",
		input_schema = {
			type = "object",
			properties = { path = { type = "string", description = "Dotted instance path" } },
			required = { "path" },
			additionalProperties = false,
		},
		run = forgeGetAttributes,
	},
	{
		name = "forge_set_attribute",
		description = "Set a string/number/boolean attribute on an instance in Studio. Destructive.",
		input_schema = {
			type = "object",
			properties = {
				path = { type = "string", description = "Dotted instance path" },
				name = { type = "string", description = "Attribute name" },
				value = { type = "string", description = "New value" },
			},
			required = { "path", "name", "value" },
			additionalProperties = false,
		},
		run = forgeSetAttribute,
	},
	{
		name = "forge_select",
		description = "Set the Studio selection to the given instance paths (selects in the user's editor).",
		input_schema = {
			type = "object",
			properties = {
				paths = { type = "array", items = { type = "string" }, description = "Dotted instance paths to select" },
			},
			required = { "paths" },
			additionalProperties = false,
		},
		run = forgeSelect,
	},
	{
		name = "forge_checkpoint",
		description = "Mark the current Studio state as a named checkpoint in the undo history (e.g. before a batch of edits). Cheap; call it right before destructive work.",
		input_schema = {
			type = "object",
			properties = {
				name = { type = "string", description = "Checkpoint label, e.g. 'before-car-tweaks'" },
			},
			required = { "name" },
			additionalProperties = false,
		},
		run = forgeCheckpoint,
	},
	{
		name = "forge_undo",
		description = "Undo Studio changes: pass to='name' to roll back to a named forge_checkpoint, or omit to undo one step. Destructive — use after forge_checkpoint when something goes wrong.",
		input_schema = {
			type = "object",
			properties = {
				to = { type = "string", description = "Checkpoint name to roll back to (omit to undo one step)" },
			},
			additionalProperties = false,
		},
		run = forgeUndo,
	},
	{
		name = "forge_checkpoints",
		description = "List recorded checkpoints (name, index, steps back) and the current change-history index.",
		input_schema = {
			type = "object",
			properties = {},
			additionalProperties = false,
		},
		run = forgeCheckpoints,
	},
	{
		name = "forge_find",
		description = "Find instances in Studio by name substring (pattern) and/or ClassName (class_name). Returns up to `limit` full paths (default 50, max 200).",
		input_schema = {
			type = "object",
			properties = {
				pattern = { type = "string", description = "Name substring, case-insensitive" },
				class_name = { type = "string", description = "Exact ClassName, e.g. Part, Script, MeshPart" },
				limit = { type = "integer", description = "Max results, 1-200. Default 50." },
			},
			additionalProperties = false,
		},
		run = forgeFind,
	},
	{
		name = "forge_bulk_create",
		description = "Create many instances in one call (paste-style): items[] of {path: parent path, class_name, name?, properties?}. Each item is created under its parent. Destructive.",
		input_schema = {
			type = "object",
			properties = {
				items = {
					type = "array",
					items = {
						type = "object",
						properties = {
							path = { type = "string", description = "Parent dotted path" },
							class_name = { type = "string", description = "Instance class, e.g. Part, BillboardGui" },
							name = { type = "string", description = "Instance name (default: class_name)" },
							properties = { type = "object", description = "Optional properties to set (string/number/bool values)" },
						},
						required = { "path", "class_name" },
						additionalProperties = false,
					},
					description = "Instances to create (max 200)",
				},
			},
			required = { "items" },
			additionalProperties = false,
		},
		run = forgeBulkCreate,
	},
	{
		name = "forge_snapshot",
		description = "Capture the current instance tree (path -> class) under a name, so forge_diff can show what changed later. Keeps the last 10 snapshots.",
		input_schema = {
			type = "object",
			properties = {
				name = { type = "string", description = "Snapshot label (default: auto)" },
			},
			additionalProperties = false,
		},
		run = forgeSnapshot,
	},
	{
		name = "forge_diff",
		description = "Compare a snapshot to the current instance tree: lists added (+) and removed (-) instances. Omit name to diff the most recent snapshot.",
		input_schema = {
			type = "object",
			properties = {
				name = { type = "string", description = "Snapshot name to diff against (default: most recent)" },
			},
			additionalProperties = false,
		},
		run = forgeDiff,
	},
	{
		name = "forge_export",
		description =
			"Export a subtree of the DataModel as JSON: instance properties (position/size/color/etc.), script sources (truncated), and attributes. Defaults to workspace, depth 3 (max 6; 10 with RoForge Pro).",
		input_schema = {
			type = "object",
			properties = {
				path = { type = "string", description = "Dotted path of the subtree root (default: workspace)" },
				depth = { type = "integer", description = "Tree depth 1-6 (1-10 with RoForge Pro). Default 3." },
			},
			additionalProperties = false,
		},
		run = forgeExport,
	},
	{
		name = "forge_import",
		description =
			"Apply a forge_export JSON back into Studio: recreates the instance tree (properties, script sources, "
			.. "attributes) under a parent path. Pass the export text as json, or a plugin-folder file as path. "
			.. "dry_run=true only reports what would be created. Destructive — max 500 nodes per call (2500 with RoForge Pro).",
		input_schema = {
			type = "object",
			properties = {
				json = { type = "string", description = "The export JSON text" },
				path = { type = "string", description = "File (in the plugin folder) containing the export JSON" },
				parent = { type = "string", description = "Dotted path of the parent to import under (default: workspace)" },
				name = { type = "string", description = "Rename the root instance (optional)" },
				dry_run = { type = "boolean", description = "Only report what would be created" },
			},
			additionalProperties = false,
		},
		run = forgeImport,
	},
	{
		name = "forge_pro",
		description =
			"Report the current RoForge Pro entitlement: Free or Pro, which pass/product the Studio user owns, "
			.. "and the active limits (export depth, import nodes, viewport) + Pro features. "
			.. "Call this to know whether the user has Pro before promising Pro-only work.",
		input_schema = {
			type = "object",
			properties = {},
			additionalProperties = false,
		},
		run = forgePro,
	},
}

function ExtraTools.all()
	return TOOLS
end

return ExtraTools
