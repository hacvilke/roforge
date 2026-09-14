-- RoForge — Studio file-plugin entry point.
--
-- Studio runs this script when the .rbxm is loaded as a file plugin, with
-- the `plugin` global bound to this plugin's Plugin instance. If this model
-- is imported somewhere else (e.g. into a place), there is no `plugin`
-- global and this script is a no-op.

if plugin == nil then
	return
end

local RoForge = require(script:WaitForChild("RoForge"))

local ok, err = xpcall(RoForge.start, function(e)
	-- capture the throw-site stack so failures in Output point at the exact line
	return tostring(e) .. "\n" .. debug.traceback("", 2)
end, plugin)
if not ok then
	warn("[RoForge] failed to start: " .. tostring(err))
end
