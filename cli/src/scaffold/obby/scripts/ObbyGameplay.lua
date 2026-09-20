-- RoForge Obby scaffold — gameplay: coins, checkpoints, kill bricks,
-- moving platforms, respawn-at-checkpoint.
--
-- Parts are tagged with attributes (set in the scene):
--   CoinValue       number  — coin value
--   CheckpointStage number  — checkpoint pad stage number
--   KillBrick       true    — kills the player on touch
--   MoveRange       number  — moving platform half-range (studs)
--   MoveSpeed       number  — moving platform speed (studs/s)
local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local obby = workspace:WaitForChild("Obby")

local function findTagged(attr)
	local out = {}
	for _, inst in ipairs(obby:GetDescendants()) do
		if inst:IsA("BasePart") and inst:GetAttribute(attr) ~= nil then
			table.insert(out, inst)
		end
	end
	return out
end

local function characterOf(other)
	return other:FindFirstChildWhichIsA("Model")
end

local function playerOf(character)
	return Players:GetPlayerFromCharacter(character)
end

-- -------------------------------------------------------------- coins ----
local COIN_RESPAWN_SECONDS = 10

for _, coin in ipairs(findTagged("CoinValue")) do
	local value = tonumber(coin:GetAttribute("CoinValue")) or 10
	local props = {
		CFrame = coin.CFrame,
		Size = coin.Size,
		Color = coin.Color,
		Material = coin.Material,
	}
	coin.Touched:Connect(function(other)
		local character = characterOf(other)
		if not character then
			return
		end
		local player = playerOf(character)
		if not player then
			return
		end
		local ls = player:FindFirstChild("leaderstats")
		local coinsVal = ls and ls:FindFirstChild("Coins")
		if not coinsVal then
			return
		end
		local mult = player:GetAttribute("Obby2x") and 2 or 1
		coinsVal.Value = coinsVal.Value + value * mult
		local coinName = coin.Name
		coin:Destroy()
		task.delay(COIN_RESPAWN_SECONDS, function()
			local clone = Instance.new("Part")
			for k, v in pairs(props) do
				clone[k] = v
			end
			clone.Name = coinName
			clone.Anchored = true
			clone.CanCollide = false
			clone:SetAttribute("CoinValue", value)
			clone.Parent = obby
		end)
	end)
end

-- --------------------------------------------------------- checkpoints ----
for _, pad in ipairs(findTagged("CheckpointStage")) do
	local stage = tonumber(pad:GetAttribute("CheckpointStage")) or 1
	pad.Touched:Connect(function(other)
		local character = characterOf(other)
		if not character then
			return
		end
		local player = playerOf(character)
		if not player then
			return
		end
		player:SetAttribute("ObbyCheckpoint", pad:GetFullName())
		local ls = player:FindFirstChild("leaderstats")
		local stageVal = ls and ls:FindFirstChild("Stage")
		if stageVal then
			stageVal.Value = math.max(stageVal.Value, stage)
		end
	end)
end

-- ----------------------------------------------------------- kill bricks --
for _, brick in ipairs(findTagged("KillBrick")) do
	brick.Touched:Connect(function(other)
		local character = characterOf(other)
		if not character then
			return
		end
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid:TakeDamage(math.huge)
		end
	end)
end

-- ------------------------------------------------------ moving platforms --
for _, part in ipairs(findTagged("MoveRange")) do
	local range = tonumber(part:GetAttribute("MoveRange")) or 4
	local speed = tonumber(part:GetAttribute("MoveSpeed")) or 2
	local duration = range / math.max(speed, 0.1)
	local tweenInfo = TweenInfo.new(duration, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut)

	local function step(dir)
		local target = part.CFrame * CFrame.new(range * dir, 0, 0)
		local tween = TweenService:Create(part, tweenInfo, { CFrame = target })
		tween:Play()
		tween.Completed:Wait()
		task.spawn(step, -dir)
	end

	task.spawn(step, 1)
end

-- ------------------------------------------------- respawn at checkpoint --
local function onCharacterAdded(player, character)
	local cfName = player:GetAttribute("ObbyCheckpoint")
	if not cfName then
		return
	end
	local parts = string.split(cfName, ".")
	local target = obby
	for i = 2, #parts do
		target = target and target:FindFirstChild(parts[i])
		if not target then
			return
		end
	end
	if not (target and target:IsA("BasePart")) then
		return
	end
	task.wait(1)
	local hrp = character:FindFirstChildOfClass("HumanoidRootPart")
	if hrp then
		hrp.CFrame = target.CFrame + Vector3.new(0, 2.5, 0)
	end
end

for _, player in ipairs(Players:GetPlayers()) do
	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
end

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
end)
