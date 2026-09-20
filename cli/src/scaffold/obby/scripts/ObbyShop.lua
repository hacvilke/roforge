-- RoForge Obby scaffold — shop: a gamepass ("Obby Pass": 2x coins) bought
-- at a kiosk part via ProximityPrompt.
--
-- SETUP: create the gamepass in Roblox Creator (Economy > Passes), then
-- paste its id into PASS_ID below. While PASS_ID is 0 the kiosk works but
-- the pass is never owned (no purchase attempted) — safe default.
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

local PASS_ID = 0 -- TODO: set to your gamepass id
local PASS_NAME = "Obby Pass (2x coins)"

local obby = workspace:WaitForChild("Obby")
local kiosk = obby:FindFirstChild("ShopKiosk")

if not kiosk then
	print("[Obby] Shop: no ShopKiosk part found in workspace.Obby — shop disabled.")
	return
end

local function ownsPass(player)
	if PASS_ID == 0 then
		return false
	end
	local ok, owned = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, PASS_ID)
	end)
	return ok and owned
end

local prompt = Instance.new("ProximityPrompt")
prompt.ActionText = "Buy " .. PASS_NAME
prompt.ObjectText = "Shop Kiosk"
prompt.HoldDuration = 1
prompt.MaxActivationDistance = 8
prompt.KeyboardEnabled = true
prompt.MouseEnabled = true
prompt.Parent = kiosk

prompt.Triggered:Connect(function(player)
	if ownsPass(player) then
		player:SetAttribute("Obby2x", true)
		print(("[Obby] %s already owns the pass — 2x coins active."):format(player.Name))
		return
	end
	if PASS_ID == 0 then
		print("[Obby] Shop: set PASS_ID in ObbyShop.lua to enable purchases.")
		return
	end
	local ok, err = pcall(function()
		MarketplaceService:PromptGamePassPurchase(player, PASS_ID)
	end)
	if not ok then
		print("[Obby] Shop: purchase prompt failed: " .. tostring(err))
	end
end)

-- Keep ownership in sync (players may buy in a later session).
for _, player in ipairs(Players:GetPlayers()) do
	if ownsPass(player) then
		player:SetAttribute("Obby2x", true)
	end
end

Players.PlayerAdded:Connect(function(player)
	task.spawn(function()
		if ownsPass(player) then
			player:SetAttribute("Obby2x", true)
		end
	end)
end)
