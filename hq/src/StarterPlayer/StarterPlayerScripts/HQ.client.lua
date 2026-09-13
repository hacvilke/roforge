-- RoForge HQ — client side: a tiny in-experience storefront.
--
-- After you create the Game Pass / Developer Product in the Creator Dashboard,
-- paste their IDs below (see README.md). With an ID of 0 the buttons show
-- instructions instead of opening a purchase dialog, so the place still works
-- before anything is created.
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

local PRO_GAME_PASS_ID = 0 -- e.g. 123456789 — from Creator Dashboard
local PRO_MONTH_DEV_PRODUCT_ID = 0 -- e.g. 987654321 — from Creator Dashboard

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local function make(className, props, children)
	local inst = Instance.new(className)
	for k, v in pairs(props) do
		inst[k] = v
	end
	for _, child in ipairs(children or {}) do
		child.Parent = inst
	end
	return inst
end

local function makeLabel(className, text, size, parent)
	return make(className, {
		Text = text,
		Font = Enum.Font.GothamMedium,
		TextColor3 = Color3.fromRGB(240, 240, 245),
		TextSize = size,
		TextWrapped = true,
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 1, 0),
		Parent = parent,
	}, nil)
end

local gui = make("ScreenGui", {
	Name = "HQGui",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = playerGui,
}, nil)

local panel = make("Frame", {
	Name = "Panel",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(0.5, 0, 0.5, -40),
	Size = UDim2.new(0, 420, 0, 300),
	BackgroundTransparency = 1,
	Parent = gui,
}, nil)

makeLabel("TextLabel", "RoForge HQ", 28, panel)

make("TextLabel", {
	Text = "This experience powers RoForge Pro, the one-time (or monthly) unlock for the RoForge Studio agent.\n\nBelow: purchase the pass, then paste nothing anywhere — your Studio session detects it automatically.",
	Font = Enum.Font.Gotham,
	TextColor3 = Color3.fromRGB(190, 190, 200),
	TextSize = 15,
	TextWrapped = true,
	BackgroundTransparency = 1,
	Size = UDim2.new(1, 0, 1, 0),
	Position = UDim2.new(0, 0, 0.14, 0),
	Parent = panel,
}, nil)

local function makeButton(yOffset, title, subtitle, passId, isPass)
	local btn = make("TextButton", {
		Name = title,
		Font = Enum.Font.GothamBold,
		TextColor3 = Color3.fromRGB(20, 20, 26),
		TextSize = 17,
		Text = title,
		Size = UDim2.new(1, 0, 0, 44),
		Position = UDim2.new(0, 0, yOffset, 0),
		BackgroundColor3 = Color3.fromRGB(168, 85, 247), -- purple = Pro
		BackgroundTransparency = 0,
		AutoButtonColor = true,
		Parent = panel,
	}, nil)
	make("TextLabel", {
		Text = subtitle,
		Font = Enum.Font.Gotham,
		TextColor3 = Color3.fromRGB(40, 35, 55),
		TextSize = 12,
		BackgroundTransparency = 1,
		Position = UDim2.new(0, 0, 0.55, 0),
		Size = UDim2.new(1, 0, 0.5, 0),
		Parent = btn,
	}, nil)

	btn.MouseButton1Click:Connect(function()
		if passId <= 0 then
			btn.Text = "Pass not created yet — see README"
			task.delay(3, function()
				btn.Text = title
			end)
			return
		end
		local ok, err = pcall(function()
			if isPass then
				MarketplaceService:PromptGamePassPurchase(player, passId, true)
			else
				MarketplaceService:PromptProductPurchase(player, passId, true)
			end
		end)
		if not ok then
			btn.Text = "Purchase failed — try the experience page"
			task.delay(3, function()
				btn.Text = title
			end)
		end
	end)
	return btn
end

makeButton(0.52, "Get RoForge Pro (one-time)", "Game Pass — yours forever, repeatable in Studio", PRO_GAME_PASS_ID, true)
makeButton(0.68, "Pro month (repeatable)", "Developer Product — 1 month of Pro, renews by repurchase", PRO_MONTH_DEV_PRODUCT_ID, false)

make("TextLabel", {
	Text = "Already own Pro? RoForge Studio detects it automatically. Check any time: `roforge pro`.",
	Font = Enum.Font.Gotham,
	TextColor3 = Color3.fromRGB(140, 140, 150),
	TextSize = 13,
	BackgroundTransparency = 1,
	Position = UDim2.new(0, 0, 0.85, 0),
	Size = UDim2.new(1, 0, 0.15, 0),
	Parent = panel,
}, nil)
