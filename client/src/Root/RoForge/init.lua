-- RoForge — open-core AI agent for Roblox Studio.
--
-- Data flow (see docs/ARCHITECTURE.md):
--   chat + tool schemas ──direct──► model provider   (your API key, your machine)
--   server-side tools   ──REST───► RoForge backend  (session token only)
--   local tools                  run here, in Studio
--
-- The model API key NEVER goes to the backend, a proxy, or any third party.

local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")

local Config = require(script.Config)
local Agent = require(script.Agent)
local LocalTools = require(script.Tools.LocalTools)
local RemoteTools = require(script.Tools.RemoteTools)
local Anthropic = require(script.Providers.Anthropic)
local OpenAI = require(script.Providers.OpenAI)
local UI = require(script.UI)

local RoForge = {}

local state = nil
local ui = nil

local MAX_HISTORY_ITEMS = 40

local function getProvider(cfg)
	if cfg.Provider == "openai" then
		return OpenAI
	end
	return Anthropic
end

local function buildToolList(cfg)
	local tools = {}
	local localTools = LocalTools.all()
	for _, t in ipairs(localTools) do
		table.insert(tools, t)
	end
	local remoteDefs, err = RemoteTools.getToolDefs(cfg)
	if err then
		warn("[RoForge] remote tools unavailable: " .. err)
	else
		for _, def in ipairs(remoteDefs) do
			local duplicate = false
			for _, lt in ipairs(localTools) do
				if lt.name == def.name then
					duplicate = true
					break
				end
			end
			if not duplicate then
				table.insert(tools, {
					name = def.name,
					description = def.description,
					input_schema = def.input_schema,
					run = function(args)
						return RemoteTools.call(cfg, def.name, args)
					end,
				})
			end
		end
	end
	return tools
end

local function safeReplacement(s)
	return tostring(s):gsub("%%", "%%%%")
end

local function systemPrompt(tools)
	local sel = {}
	for _, inst in ipairs(Selection:Get()) do
		table.insert(sel, inst:GetFullName())
	end
	local names = {}
	for _, t in ipairs(tools) do
		table.insert(names, t.name)
	end
	local jobId = "unknown"
	pcall(function()
		jobId = job.get("id")
	end)
	local mode = "Edit"
	if RunService:IsRunning() then
		mode = "Play"
	elseif RunService:IsPaused() then
		mode = "Paused"
	end

	local prompt = [[
You are RoForge, an AI agent working directly inside Roblox Studio on the user's current place.

How you work:
- You have tools. USE THEM instead of guessing: inspect with forge_selected / forge_tree / forge_read before changing anything.
- To modify a script: forge_read it first, then forge_write with the COMPLETE new source. Never send partial edits or diffs.
- After forge_write or forge_create, verify the result with forge_read.
- If a tool returns ERROR, read the message and adapt. Never repeat the exact same failing call.
- Use forge_run for quick tests and diagnostics; use forge_write for permanent code.
- Answer concisely. Show code only when the user asks or when you just wrote it.
- Prefer current Luau idioms (task.*, string methods, continue) and current Roblox APIs.

Current context:
- Place ID: PLACEID
- Job ID: JOBID
- Studio mode: MODE
- Selected: SELECTED

Available tools: TOOLS
]]

	return (prompt
		:gsub("PLACEID", safeReplacement(game.PlaceId))
		:gsub("JOBID", safeReplacement(jobId))
		:gsub("MODE", safeReplacement(mode))
		:gsub("SELECTED", safeReplacement(if #sel > 0 then table.concat(sel, ", ") else "nothing"))
		:gsub("TOOLS", safeReplacement(table.concat(names, ", "))))
end

-- Providers require the conversation to start with a user message.
local function trimHistory(history, maxItems)
	while #history > maxItems do
		table.remove(history, 1)
	end
	if history[1] and history[1].role ~= "user" then
		table.insert(history, 1, {
			role = "user",
			text = "(Earlier conversation was trimmed to fit the context window.)",
		})
	end
end

local function handleSend(text)
	if state.Busy then
		ui.setStatus("Still working — wait for it to finish (or it will stop at the safety limit).")
		return
	end
	if not Config.isReady(state.Config) then
		ui.addError("Set your model API key in the Settings tab first (provider + key).")
		return
	end

	table.insert(state.History, { role = "user", text = text })
	trimHistory(state.History, MAX_HISTORY_ITEMS)
	state.Busy = true
	state.StopFlag = false
	ui.setBusy(true)
	ui.setStatus("Thinking…")

	task.spawn(function()
		local cfg = state.Config
		local provider = getProvider(cfg)

		local okTools, tools = pcall(buildToolList, cfg)
		if not okTools then
			ui.addError("Could not build the tool list: " .. tostring(tools))
			state.Busy = false
			ui.setBusy(false)
			ui.setStatus("error")
			return
		end
		local okPrompt, system = pcall(systemPrompt, tools)
		if not okPrompt then
			ui.addError("Could not build the system prompt: " .. tostring(system))
			state.Busy = false
			ui.setBusy(false)
			ui.setStatus("error")
			return
		end

		Agent.run(
			cfg,
			provider,
			state.History,
			system,
			tools,
			function(kind, payload)
				if kind == "thinking" then
					ui.setStatus(("Thinking… (step %d)"):format(payload))
				elseif kind == "text" then
					ui.addAssistant(payload)
					ui.setStatus("")
				elseif kind == "tool_start" then
					ui.addToolStart(payload.name, payload.args)
					ui.setStatus(("Running %s…"):format(tostring(payload.name)))
				elseif kind == "tool_end" then
					ui.addToolResult(payload.name, payload.result)
				elseif kind == "error" then
					ui.addError(tostring(payload))
					ui.setStatus("error")
				elseif kind == "done" then
					ui.setStatus("done")
				elseif kind == "aborted" then
					ui.addError("Stopped by user.")
					ui.setStatus("stopped")
				end
			end,
			function()
				return state.StopFlag
			end
		)

		state.Busy = false
		ui.setBusy(false)
	end)
end

function RoForge.start(plugin)
	state = {
		Config = Config.load(plugin),
		History = {},
		StopFlag = false,
		Busy = false,
	}

	local widgetInfo = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Right, -- where it docks when opened
		false, -- initiallyEnabled
		false, -- initiallyEnabledInPlay
		360, -- defaultWidth
		460, -- defaultHeight
		300, -- minWidth
		360 -- minHeight
	)
	local dock = plugin:CreateDockWidgetPluginGui("RoForge", widgetInfo)
	dock.Name = "RoForge"
	dock.Title = "RoForge AI"

	local toolbar = plugin:CreateToolbar("RoForge")
	local toggle = toolbar:CreateButton("RoForge", "Open or close the RoForge chat")
	toggle.ClickableWhenOff = true
	toggle:SetActive(true)
	toggle.Click:Connect(function()
		local visible = not dock.Visible
		dock.Enabled = visible
		dock.Visible = visible
		toggle:SetActive(visible)
	end)

	ui = UI.init(dock, {
		getConfig = function()
			return state.Config
		end,
		busy = function()
			return state.Busy
		end,
		onSend = handleSend,
		onConfigSaved = function(newCfg)
			state.Config = newCfg
			Config.save(plugin, newCfg)
		end,
	})

	print("[RoForge] started. Use the 'RoForge' toolbar button to open the chat.")
end

return RoForge
