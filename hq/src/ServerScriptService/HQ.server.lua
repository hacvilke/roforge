-- RoForge HQ — server side.
--
-- This experience is the purchase destination for RoForge Pro. It does NOT
-- check ownership here (that happens in the RoForge Bridge plugin via
-- MarketplaceService). Its job is to be a small, publishable place that the
-- Game Pass / Developer Product attach to, and to welcome visitors.
local Players = game:GetService("Players")

local function onPlayerAdded(player)
	player:WaitForChild("PlayerGui")
	-- A plain-text welcome that works in any Roblox build.
	task.spawn(function()
		-- No heavy assets; keep the place tiny so it publishes fast.
		player:BreakJointsOnDeath()
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
-- Handle players who were already in (script reload while playing).
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

print("RoForge HQ server running.")
