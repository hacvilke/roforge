-- Dock UI: two tabs (Chat / Settings), a chat log, and a settings form.
-- The UI is intentionally dumb: it renders events and forwards user input to
-- the hooks passed in from RoForge.lua (which owns the agent loop).

local UI = {}

local builder = require(script.UiBuilder)
local mk, COLORS, FONT = builder.mk, builder.COLORS, builder.FONT

function UI.init(dock, hooks)
	-- NOTE: DockWidgetPluginGui has no BackgroundColor3 — the Root Frame
	-- created below paints the widget background instead.

	local root = mk("Frame", {
		Name = "Root",
		BackgroundColor3 = COLORS.Bg,
		BorderSizePixel = 0,
		Size = UDim2.fromScale(1, 1),
		Parent = dock,
	})

	-- ---------------- tabs ----------------
	local tabs = mk("Frame", {
		Name = "Tabs",
		BackgroundColor3 = COLORS.Bg,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 32),
		Position = UDim2.fromScale(0, 0),
		Parent = root,
	})
	local content = mk("Frame", {
		Name = "Content",
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 1, -32),
		Position = UDim2.new(0, 0, 0, 32),
		Parent = root,
	})

	local chatFrame
	local settingsFrame
	local statusLabel
	local tabButtons = {}

	local function setTab(which)
		chatFrame.Visible = which == "chat"
		settingsFrame.Visible = which == "settings"
		for name, btn in pairs(tabButtons) do
			btn.BackgroundColor3 = if name == which then COLORS.Accent else COLORS.Panel
			btn.TextColor3 = if name == which then Color3.new(1, 1, 1) else COLORS.Dim
		end
	end

	-- ---------------- chat tab ----------------
	chatFrame = mk("Frame", {
		Name = "Chat",
		BackgroundTransparency = 1,
		Size = UDim2.fromScale(1, 1),
		Parent = content,
	})

	local logScroll = mk("ScrollingFrame", {
		Name = "Log",
		BackgroundColor3 = COLORS.Bg,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 1, -64),
		Position = UDim2.fromScale(0, 0),
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		ScrollBarThickness = 6,
		Parent = chatFrame,
	})
	mk("UIListLayout", {
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
		Parent = logScroll,
	})
	local order = 0

	local function scrollBottom()
		task.defer(function()
			logScroll.CanvasPosition = Vector2.new(0, math.huge)
		end)
	end

	local function addBubble(kind, text)
		local bg, fg, prefix
		if kind == "user" then
			bg, fg, prefix = COLORS.UserBubble, COLORS.Text, "You"
		elseif kind == "assistant" then
			bg, fg, prefix = COLORS.Panel, COLORS.Text, "RoForge"
		elseif kind == "tool" then
			bg, fg, prefix = COLORS.ToolBubble, COLORS.Dim, "tool"
		elseif kind == "error" then
			bg, fg, prefix = COLORS.ToolBubble, COLORS.Error, "error"
		else
			bg, fg, prefix = COLORS.Panel, COLORS.Dim, "note"
		end

		order = order + 1
		local bubble = mk("Frame", {
			BackgroundColor3 = bg,
			BorderSizePixel = 0,
			Size = UDim2.new(1, -8, 0, 0),
			LayoutOrder = order,
			Parent = logScroll,
		})
		mk("UICorner", { CornerRadius = UDim.new(0, 8), Parent = bubble })
		mk("UIPadding", {
			PadTop = UDim.new(0, 5),
			PadBottom = UDim.new(0, 5),
			PadLeft = UDim.new(0, 8),
			PadRight = UDim.new(0, 8),
			Parent = bubble,
		})
		local label = mk("TextLabel", {
			BackgroundTransparency = 1,
			Font = FONT,
			TextSize = 13,
			TextWrapped = true,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextYAlignment = Enum.TextYAlignment.Top,
			TextColor3 = fg,
			Size = UDim2.fromScale(1, 1),
			Parent = bubble,
		})
		label.Text = prefix .. ": " .. tostring(text)
		task.defer(function()
			bubble.Size = UDim2.new(1, -8, 0, math.ceil(label.TextBounds.Y) + 12)
			scrollBottom()
		end)
	end

	-- input bar
	local inputBar = mk("Frame", {
		Name = "InputBar",
		BackgroundColor3 = COLORS.Panel,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 46),
		Position = UDim2.new(0, 0, 1, -46),
		Parent = chatFrame,
	})
	local input = mk("TextBox", {
		Name = "Input",
		BackgroundColor3 = COLORS.Bg,
		BorderColor3 = COLORS.Border,
		BorderMode = Enum.BorderMode.Inset,
		Font = FONT,
		PlaceholderColor3 = COLORS.Dim,
		PlaceholderText = "Ask RoForge to do something in this place…",
		Size = UDim2.new(1, -86, 1, -10),
		Position = UDim2.new(0, 5, 0, 5),
		Text = "",
		TextColor3 = COLORS.Text,
		TextSize = 13,
		ClearTextOnFocus = false,
		MultiLine = false,
		Parent = inputBar,
	})
	mk("UICorner", { CornerRadius = UDim.new(0, 6), Parent = input })

	local sendButton = mk("TextButton", {
		Name = "Send",
		BackgroundColor3 = COLORS.Accent,
		Font = FONT,
		Text = "Send",
		TextColor3 = Color3.new(1, 1, 1),
		TextSize = 13,
		Size = UDim2.new(0, 56, 1, -10),
		Position = UDim2.new(1, -62, 0, 5),
		Parent = inputBar,
	})
	mk("UICorner", { CornerRadius = UDim.new(0, 6), Parent = sendButton })

	statusLabel = mk("TextLabel", {
		Name = "Status",
		BackgroundTransparency = 1,
		Font = FONT,
		Text = "",
		TextColor3 = COLORS.Dim,
		TextSize = 11,
		TextXAlignment = Enum.TextXAlignment.Left,
		Size = UDim2.new(1, -10, 0, 16),
		Position = UDim2.new(0, 5, 1, -62),
		Parent = chatFrame,
	})

	local function doSend()
		local text = (input.Text or ""):match("^%s*(.-)%s*$")
		if text == "" then
			return
		end
		if hooks.busy and hooks.busy() then
			return
		end
		input.Text = ""
		addBubble("user", text)
		hooks.onSend(text)
	end

	sendButton.MouseButton1Click:Connect(doSend)
	input.FocusLost:Connect(function(focusLostReason)
		if focusLostReason == Enum.UserInputType.Enter then
			doSend()
		end
	end)

	-- ---------------- settings tab ----------------
	settingsFrame = mk("Frame", {
		Name = "Settings",
		BackgroundTransparency = 1,
		Size = UDim2.fromScale(1, 1),
		Parent = content,
	})
	local settingsScroll = mk("ScrollingFrame", {
		BackgroundColor3 = COLORS.Bg,
		BorderSizePixel = 0,
		Size = UDim2.fromScale(1, 1),
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
		Parent = settingsFrame,
	})

	local form = mk("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, -16, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		Position = UDim2.new(0, 8, 0, 8),
		Parent = settingsScroll,
	})
	mk("UIListLayout", {
		Padding = UDim.new(0, 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
		Parent = form,
	})

	local rows = {}
	local rowOrder = 0

	local function addRow(labelText, value, placeholder)
		rowOrder = rowOrder + 1
		mk("TextLabel", {
			BackgroundTransparency = 1,
			Font = FONT,
			TextSize = 12,
			TextColor3 = COLORS.Dim,
			TextXAlignment = Enum.TextXAlignment.Left,
			Text = labelText,
			Size = UDim2.new(1, 0, 0, 16),
			LayoutOrder = rowOrder * 2 - 1,
			Parent = form,
		})
		local box = mk("TextBox", {
			BackgroundColor3 = COLORS.Panel,
			BorderSizePixel = 0,
			Font = FONT,
			TextSize = 12,
			TextColor3 = COLORS.Text,
			PlaceholderColor3 = COLORS.Dim,
			PlaceholderText = placeholder or "",
			Size = UDim2.new(1, 0, 0, 28),
			LayoutOrder = rowOrder * 2,
			Parent = form,
		})
		box.Text = tostring(value or "")
		mk("UICorner", { CornerRadius = UDim.new(0, 6), Parent = box })
		table.insert(rows, box)
		return box
	end

	local function addButton(label, color, onClick)
		rowOrder = rowOrder + 1
		local btn = mk("TextButton", {
			BackgroundColor3 = color or COLORS.Accent,
			BorderSizePixel = 0,
			Font = FONT,
			TextSize = 13,
			Text = label,
			TextColor3 = Color3.new(1, 1, 1),
			Size = UDim2.new(1, 0, 0, 30),
			LayoutOrder = rowOrder,
			Parent = form,
		})
		mk("UICorner", { CornerRadius = UDim.new(0, 6), Parent = btn })
		btn.MouseButton1Click:Connect(onClick)
		return btn
	end

	local cfg0 = hooks.getConfig()
	addRow("Model provider  (anthropic | openai)", cfg0.Provider)
	addRow("Model  (blank = provider default)", cfg0.Model, "claude-sonnet-4-5 / gpt-4.1 / …")
	addRow("Model API key  (stays on this machine)", cfg0.ApiKey, "sk-ant-… / sk-…")
	addRow("RoForge backend URL", cfg0.BackendUrl, "http://127.0.0.1:8787")
	addRow("Backend session token  (POST /v1/auth/login)", cfg0.SessionToken, "rf1.…")
	addRow("Max tool iterations  (1-25)", tostring(cfg0.MaxIterations))

	addButton("Save settings", COLORS.Accent, function()
		local cfg = table.clone(cfg0)
		cfg.Provider = (rows[1].Text or ""):lower():trim()
		if cfg.Provider ~= "openai" then
			cfg.Provider = "anthropic"
		end
		cfg.Model = (rows[2].Text or ""):trim()
		cfg.ApiKey = (rows[3].Text or ""):trim()
		cfg.BackendUrl = (rows[4].Text or ""):trim()
		cfg.SessionToken = (rows[5].Text or ""):trim()
		local iters = tonumber(rows[6].Text)
		cfg.MaxIterations = math.clamp(iters or 10, 1, 25)
		hooks.onConfigSaved(cfg)
		statusLabel.Text = "Settings saved."
	end)

	addButton("Test backend", COLORS.Dim, function()
		statusLabel.Text = "Testing backend…"
		task.spawn(function()
			-- Http is a child of the RoForge module (UI's parent), not two levels up.
			local Http = require(script.Parent.Http)
			local url = (rows[4].Text or ""):trim()
			while url:sub(-1) == "/" do
				url = url:sub(1, -2)
			end
			local resp = Http.request({ Url = url .. "/health", Method = "GET" })
			if resp.Success and resp.StatusCode == 200 then
				statusLabel.Text = "Backend OK: " .. tostring(resp.Body):sub(1, 90)
			else
				statusLabel.Text = "Backend unreachable: " .. Http.errorText(resp)
			end
		end)
	end)

	addButton("Refresh tools", COLORS.Dim, function()
		statusLabel.Text = "Refreshing tools…"
		task.spawn(function()
			local RemoteTools = require(script.Parent.Tools.RemoteTools)
			local cfg = table.clone(cfg0)
			cfg.BackendUrl = (rows[4].Text or ""):trim()
			cfg.SessionToken = (rows[5].Text or ""):trim()
			local defs, err = RemoteTools.refresh(cfg)
			if err then
				statusLabel.Text = "Tools: " .. tostring(err)
			else
				statusLabel.Text = ("Tools: %d remote tools loaded."):format(#defs)
			end
		end)
	end)

	addButton("Clear chat", COLORS.Border, function()
		for _, child in ipairs(logScroll:GetChildren()) do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		statusLabel.Text = "Chat cleared."
	end)

	-- ---------------- tab buttons ----------------
	local function makeTab(name, label, posX, offset)
		local btn = mk("TextButton", {
			BackgroundColor3 = COLORS.Panel,
			BorderSizePixel = 0,
			Font = FONT,
			TextSize = 13,
			TextColor3 = COLORS.Dim,
			Text = label,
			Size = UDim2.new(0.5, -5, 1, -6),
			Position = UDim2.new(posX, offset, 0, 3),
			Parent = tabs,
		})
		mk("UICorner", { CornerRadius = UDim.new(0, 6), Parent = btn })
		btn.MouseButton1Click:Connect(function()
			setTab(name)
		end)
		tabButtons[name] = btn
		return btn
	end
	makeTab("chat", "  Chat", 0, 4)
	makeTab("settings", "  Settings", 0.5, 1)

	-- ---------------- public api ----------------
	local api = {
		addAssistant = function(text)
			addBubble("assistant", text)
		end,
		addToolStart = function(name, args)
			local argsStr = "…"
			local HttpService = game:GetService("HttpService")
			pcall(function()
				argsStr = HttpService:JSONEncode(args or {})
			end)
			addBubble("tool", ("call  %s(%s)"):format(name, argsStr:sub(1, 120)))
		end,
		addToolResult = function(name, result)
			local s = tostring(result or "")
			if #s > 400 then
				s = s:sub(1, 400) .. " …"
			end
			addBubble("tool", ("result " .. name .. ": " .. s):gsub("\n", " | "))
		end,
		addError = function(text)
			addBubble("error", text)
		end,
		setStatus = function(text)
			statusLabel.Text = tostring(text or "")
		end,
		setBusy = function(busy)
			sendButton.BackgroundColor3 = if busy then COLORS.Border else COLORS.Accent
			sendButton.Active = not busy
		end,
	}

	setTab("chat")
	addBubble(
		"note",
		"RoForge ready. Your model API key is used ONLY for direct calls to the model provider — it is never sent to the RoForge backend."
	)
	return api
end

return UI
