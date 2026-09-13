-- RoForge Bridge — Studio file-plugin entry point.
--
-- Studio runs this script when the .rbxm is loaded as a file plugin, with
-- the `plugin` global bound to this plugin's Plugin instance. If this model
-- is imported somewhere else (e.g. into a place), there is no `plugin`
-- global and this script is a no-op.

if plugin == nil then
	return
end

local Bridge = require(script:WaitForChild("Bridge"))

local ok, err = pcall(Bridge.start, plugin)
if not ok then
	warn("[RoForge Bridge] failed to start: " .. tostring(err))
end
