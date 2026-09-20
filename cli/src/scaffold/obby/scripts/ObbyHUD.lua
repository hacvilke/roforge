-- RoForge Obby scaffold — HUD (LocalScript in StarterPlayerScripts):
-- coins + stage readout, updated from leaderstats.
local Players = game:GetService("Players")
local player = Players.LocalPlayer

local gui = Instance.new("ScreenGui")
gui.Name = "ObbyHUD"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = false
gui.Parent = player:WaitForChild("PlayerGui")

local coinsLabel = Instance.new("TextLabel")
coinsLabel.Name = "Coins"
coinsLabel.Size = UDim2.fromScale(0, 1)
coinsLabel.Position = UDim2.fromScale(0, 0)
coinsLabel.AnchorPoint = Vector2.new(0, 0)
coinsLabel.BackgroundTransparency = 0.4
coinsLabel.BackgroundColor3 = Color3.fromRGB(20, 20, 28)
coinsLabel.TextColor3 = Color3.fromRGB(255, 215, 64)
coinsLabel.Font = Enum.Font.GothamBold
coinsLabel.TextSize = 20
coinsLabel.TextXAlignment = Enum.TextXAlignment.Left
coinsLabel.Text = "Coins: 0"
coinsLabel.TextScaled = false
coinsLabel.Parent = gui

local stageLabel = Instance.new("TextLabel")
stageLabel.Name = "Stage"
stageLabel.Size = UDim2.fromScale(0, 1)
stageLabel.Position = UDim2.fromScale(1, 0)
stageLabel.AnchorPoint = Vector2.new(1, 0)
stageLabel.BackgroundTransparency = 0.4
stageLabel.BackgroundColor3 = Color3.fromRGB(20, 20, 28)
stageLabel.TextColor3 = Color3.fromRGB(120, 255, 140)
stageLabel.Font = Enum.Font.GothamBold
stageLabel.TextSize = 20
stageLabel.TextXAlignment = Enum.TextXAlignment.Right
stageLabel.Text = "Stage: 0"
stageLabel.Parent = gui

local doubleLabel = Instance.new("TextLabel")
doubleLabel.Name = "PassBadge"
doubleLabel.Size = UDim2.fromScale(0, 0.06)
doubleLabel.Position = UDim2.fromScale(1, 0.05)
doubleLabel.AnchorPoint = Vector2.new(1, 0)
doubleLabel.BackgroundTransparency = 0.2
doubleLabel.BackgroundColor3 = Color3.fromRGB(60, 40, 140)
doubleLabel.TextColor3 = Color3.fromRGB(200, 180, 255)
doubleLabel.Font = Enum.Font.GothamBold
doubleLabel.TextSize = 16
doubleLabel.TextXAlignment = Enum.TextXAlignment.Right
doubleLabel.Visible = false
doubleLabel.Text = "PASS: 2x coins"
doubleLabel.Parent = gui

local function refresh()
	local ls = player:FindFirstChild("leaderstats")
	if ls then
		local coins = ls:FindFirstChild("Coins")
		local stage = ls:FindFirstChild("Stage")
		if coins then
			coinsLabel.Text = "Coins: " .. coins.Value
		end
		if stage then
			stageLabel.Text = "Stage: " .. stage.Value
		end
	end
	doubleLabel.Visible = player:GetAttribute("Obby2x") == true
end

refresh()
task.spawn(function()
	while true do
		refresh()
		task.wait(0.5)
	end
end)
