-- RoForge Bridge — the Studio half of RoForge.
--
-- All intelligence lives in the local `roforge` CLI on this machine. This
-- plugin only:
--   1. heartbeats/polls the local bridge (http://127.0.0.1:8790) for jobs
--   2. executes local tools (LocalTools.lua) inside Studio
--   3. posts the results back
--
-- No API keys, no model traffic, loopback HTTP only. Run `roforge` (or
-- `roforge studio`) in your terminal to start the other side.

local Http = require(script.Http)
local LocalTools = require(script.LocalTools)
local ExtraTools = require(script.ExtraTools)
local Viewport = require(script.Viewport)

local Bridge = {}

local Settings = {
	Url = "http://127.0.0.1:8790",
	Token = "",
}

local state = {
	Running = false,
	Connected = false,
	LastTool = nil,
	LastResultOk = nil,
	JobCount = 0,
}

local toolByName = {}

local function refreshTools()
	toolByName = {}
	for _, t in ipairs(LocalTools.all()) do
		toolByName[t.name] = t.run
	end
	for _, t in ipairs(ExtraTools.all()) do
		toolByName[t.name] = t.run
	end
end

local function apiPath(p)
	local u = Settings.Url
	while u:sub(-1) == "/" do
		u = u:sub(1, -2)
	end
	return u .. p
end

local function authHeaders()
	return { authorization = "Bearer " .. Settings.Token }
end

local function ping()
	local resp = Http.request("GET", apiPath("/v1/bridge/ping"), authHeaders())
	if not resp or resp.StatusCode ~= 200 then
		if state.Connected then
			state.Connected = false
		end
		return false
	end
	state.Connected = true
	return true
end

local function pollJob()
	local resp = Http.request("GET", apiPath("/v1/bridge/jobs"), authHeaders())
	if not resp or resp.StatusCode ~= 200 then
		return nil
	end
	local data = Http.json(resp.Body)
	if not data or type(data.jobs) ~= "table" or #data.jobs == 0 then
		return nil
	end
	return data.jobs[1]
end

local function postResult(job, result)
	local resp, err = Http.request(
		"POST",
		apiPath("/v1/bridge/jobs/" .. tostring(job.id) .. "/result"),
		{
			authorization = "Bearer " .. Settings.Token,
			["content-type"] = "application/json",
		},
		Http.encode({ result = result })
	)
	if not resp or resp.StatusCode ~= 200 then
		warn(("[RoForge Bridge] could not post result for " .. tostring(job.id) .. ": " .. tostring(err or resp.StatusCode)))
	end
end

-- A tool run returns either a plain string or a structured table
-- {text, imageBase64?, mediaType?} (vision capture). Normalize to one of
-- those two shapes and expose helpers for the status UI.
local function normalizeResult(res)
	if type(res) == "table" then
		return {
			text = tostring(res.text or ""),
			imageBase64 = res.imageBase64,
			mediaType = res.mediaType,
		}
	end
	return tostring(res)
end

local function resultText(result)
	if type(result) == "table" then
		return result.text or ""
	end
	return result
end

local function isErrorResult(result)
	local t = resultText(result)
	return type(t) == "string" and t:sub(1, 5):upper() == "ERROR"
end

local function handleJob(job)
	local run = toolByName[job.tool]
	local result
	if not run then
		result = "ERROR: unknown tool '" .. tostring(job.tool) .. "'"
	else
		local ok, res = pcall(run, job.args or {})
		if not ok then
			result = "ERROR: " .. tostring(res)
		else
			result = normalizeResult(res)
		end
	end
	state.JobCount += 1
	state.LastTool = job.tool
	state.LastResultOk = not isErrorResult(result)
	postResult(job, result)
end

local function runLoop()
	refreshTools()
	while state.Running do
		if ping() then
			local job = pollJob()
			if job then
				handleJob(job)
			end
			task.wait(1)
		else
			task.wait(3)
		end
	end
end

local statusLabel
local lastToolLabel
local jobCountLabel
local urlBox
local tokenBox

local function updateStatusUi()
	if not statusLabel then
		return
	end
	if state.Connected then
		statusLabel.Text = "● Connected to roforge"
		statusLabel.TextColor3 = Color3.fromRGB(90, 200, 140)
	else
		statusLabel.Text = "○ Waiting for roforge CLI…"
		statusLabel.TextColor3 = Color3.fromRGB(150, 156, 168)
	end
	if lastToolLabel then
		lastToolLabel.Text = state.LastTool and ("last job: " .. state.LastTool) or "no jobs yet"
	end
	if jobCountLabel then
		jobCountLabel.Text = ("jobs executed: %d"):format(state.JobCount)
	end
end

function Bridge.start(plugin)
	-- settings
	local ok, url = pcall(function()
		return plugin:GetSetting("Url")
	end)
	if ok and url and url ~= "" then
		Settings.Url = url
	end
	local okToken, token = pcall(function()
		return plugin:GetSetting("Token")
	end)
	if okToken and token then
		Settings.Token = token
	end

	-- give the vision capture access to plugin:ReadFile (CaptureScreenshot)
	Viewport.init(plugin)

	-- dock UI
	local widgetInfo = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Right,
		false,
		false,
		320,
		240,
		280,
		180
	)
	local dock = plugin:CreateDockWidgetPluginGui("RoForgeBridge", widgetInfo)
	dock.Name = "RoForgeBridge"
	dock.Title = "RoForge Bridge"
	dock.BackgroundColor3 = Color3.fromRGB(24, 26, 31)

	local mk = function(class, props)
		local inst = Instance.new(class)
		for k, v in pairs(props) do
			inst[k] = v
		end
		return inst
	end
	local root = mk("Frame", {
		Name = "Root",
		BackgroundColor3 = Color3.fromRGB(24, 26, 31),
		BorderSizePixel = 0,
		Size = UDim2.fromScale(1, 1),
		Parent = dock,
	})
	mk("UIListLayout", {
		Padding = UDim.new(0, 6),
		Parent = root,
	})
	mk("UIPadding", {
		PadTop = UDim.new(0, 8),
		PadBottom = UDim.new(0, 8),
		PadLeft = UDim.new(0, 8),
		PadRight = UDim.new(0, 8),
		Parent = root,
	})

	statusLabel = mk("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		TextSize = 14,
		Text = "○ Waiting for roforge CLI…",
		TextColor3 = Color3.fromRGB(150, 156, 168),
		Size = UDim2.new(1, 0, 0, 20),
		Parent = root,
	})
	lastToolLabel = mk("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		Text = "no jobs yet",
		TextColor3 = Color3.fromRGB(120, 126, 138),
		Size = UDim2.new(1, 0, 0, 16),
		Parent = root,
	})
	jobCountLabel = mk("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		Text = "jobs executed: 0",
		TextColor3 = Color3.fromRGB(120, 126, 138),
		Size = UDim2.new(1, 0, 0, 16),
		Parent = root,
	})
	local hint = mk("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextWrapped = true,
		Text = "Run `roforge` in your terminal.\nPaste the bridge token from `roforge studio` below.",
		TextColor3 = Color3.fromRGB(150, 156, 168),
		Size = UDim2.new(1, 0, 0, 32),
		Parent = root,
	})
	hint.TextXAlignment = Enum.TextXAlignment.Left

	urlBox = mk("TextBox", {
		BackgroundColor3 = Color3.fromRGB(32, 35, 42),
		BorderSizePixel = 0,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = Color3.fromRGB(230, 232, 238),
		PlaceholderText = "Bridge URL",
		PlaceholderColor3 = Color3.fromRGB(120, 126, 138),
		Size = UDim2.new(1, 0, 0, 26),
		Text = Settings.Url,
		Parent = root,
	})
	tokenBox = mk("TextBox", {
		BackgroundColor3 = Color3.fromRGB(32, 35, 42),
		BorderSizePixel = 0,
		Font = Enum.Font.Gotham,
		TextSize = 12,
		TextColor3 = Color3.fromRGB(230, 232, 238),
		PlaceholderText = "Bridge token (from `roforge studio`)",
		PlaceholderColor3 = Color3.fromRGB(120, 126, 138),
		Size = UDim2.new(1, 0, 0, 26),
		Text = Settings.Token,
		Parent = root,
	})
	local saveBtn = mk("TextButton", {
		BackgroundColor3 = Color3.fromRGB(88, 166, 255),
		BorderSizePixel = 0,
		Font = Enum.Font.GothamMedium,
		TextSize = 13,
		Text = "Save & connect",
		TextColor3 = Color3.new(1, 1, 1),
		Size = UDim2.new(1, 0, 0, 28),
		Parent = root,
	})
	saveBtn.MouseButton1Click:Connect(function()
		Settings.Url = (urlBox.Text or ""):trim()
		Settings.Token = (tokenBox.Text or ""):trim()
		pcall(function()
			plugin:SetSetting("Url", Settings.Url)
		end)
		pcall(function()
			plugin:SetSetting("Token", Settings.Token)
		end)
		updateStatusUi()
	end)

	-- toolbar
	local toolbar = plugin:CreateToolbar("RoForge")
	local toggle = toolbar:CreateButton("Bridge", "Open or close the RoForge Bridge status")
	toggle.ClickableWhenOff = true
	toggle:SetActive(true)
	toggle.Click:Connect(function()
		local visible = not dock.Visible
		dock.Enabled = visible
		dock.Visible = visible
		toggle:SetActive(visible)
	end)

	-- start the loop
	state.Running = true
	task.spawn(runLoop)
	task.spawn(function()
		while state.Running do
			updateStatusUi()
			task.wait(1)
		end
	end)

	print("[RoForge Bridge] ready — run `roforge` in your terminal to connect.")
end

return Bridge
