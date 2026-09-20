-- RoForge Obby scaffold — player data (leaderstats + DataStore).
--
-- DataStore requires: the place to have DataStore enabled (File > Game
-- Settings > Security > "Enable Studio Access to API Services"). If it's
-- not enabled this script degrades to in-memory (no crash) and says so
-- in the Output.
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")

local STORE_NAME = "RoForgeObby_v1"
local dataStore = nil

do
	local ok, err = pcall(function()
		dataStore = DataStoreService:GetDataStore(STORE_NAME)
	end)
	if not ok then
		dataStore = nil
		print("[Obby] DataStore unavailable (" .. tostring(err) .. ") — data is in-memory only. Enable API Services in Game Settings > Security for real saves.")
	end
end

local function storeKey(player)
	return "player_" .. player.UserId
end

local function getLeaderstats(player)
	return player:FindFirstChild("leaderstats")
end

local function loadData(player)
	local ls = getLeaderstats(player)
	if not ls or not dataStore then
		return
	end
	local ok, data = pcall(function()
		return dataStore:GetAsync(storeKey(player))
	end)
	if ok and type(data) == "table" then
		local coinsVal = ls:FindFirstChild("Coins")
		local stageVal = ls:FindFirstChild("Stage")
		if coinsVal then
			coinsVal.Value = math.max(0, tonumber(data.coins) or 0)
		end
		if stageVal then
			stageVal.Value = math.max(0, tonumber(data.stage) or 0)
		end
	end
end

local function saveData(player)
	local ls = getLeaderstats(player)
	if not ls or not dataStore then
		return
	end
	local coinsVal = ls:FindFirstChild("Coins")
	local stageVal = ls:FindFirstChild("Stage")
	local coins = coinsVal and coinsVal.Value or 0
	local stage = stageVal and stageVal.Value or 0
	task.spawn(function()
		pcall(function()
			dataStore:UpdateAsync(storeKey(player), function()
				return { coins = coins, stage = stage }
			end)
		end)
	end)
end

Players.PlayerAdded:Connect(function(player)
	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = ls

	local stage = Instance.new("IntValue")
	stage.Name = "Stage"
	stage.Value = 0
	stage.Parent = ls

	ls.Parent = player

	-- small delay so the character and other systems settle
	task.wait(1)
	loadData(player)
end)

Players.PlayerRemoving:Connect(function(player)
	saveData(player)
end)

-- Save on server shutdown too.
game:BindToClose(function()
	for _, player in ipairs(Players:GetPlayers()) do
		saveData(player)
	end
	task.wait(2)
end)
