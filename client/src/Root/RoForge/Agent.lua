-- The agent loop: chat <-> model provider <-> tools, until a final answer.
--
-- This loop runs HERE (in Studio) on purpose: Roblox Studio can only make
-- OUTGOING http requests, so the orchestrator belongs on the client. The model
-- API call is made directly by the provider adapter (Providers/*.lua) — the
-- RoForge backend only executes server-side tools (Tools/RemoteTools.lua).

local Agent = {}

local MAX_TOOL_RESULT_CHARS = 12000

local function truncate(s)
	s = tostring(s or "")
	if #s > MAX_TOOL_RESULT_CHARS then
		return s:sub(1, MAX_TOOL_RESULT_CHARS) .. "\n... [truncated]"
	end
	return s
end

--[[
	cfg:        Config table
	provider:   { chat(cfg, system, history, tools) -> result|nil, err }
	              result = { text: string, calls: { { id, name, args } } }
	history:    (in/out) array of:
	              { role="user", text=string }
	              { role="assistant", text=string?, calls=table? }
	              { role="tool", id=string, name=string, result=string }
	system:     system prompt string
	tools:      array of { name, description, input_schema, run(args) -> string }
	onEvent:    function(kind, payload) with kind in
	              "thinking"|"text"|"tool_start"|"tool_end"|"error"|"done"|"aborted"
	shouldStop: function() -> boolean (user pressed Stop)
]]
function Agent.run(cfg, provider, history, system, tools, onEvent, shouldStop)
	local toolByName = {}
	for _, t in ipairs(tools) do
		toolByName[t.name] = t
	end

	for iter = 1, cfg.MaxIterations do
		if shouldStop and shouldStop() then
			onEvent("aborted")
			return
		end
		onEvent("thinking", iter)

		local result, err = provider.chat(cfg, system, history, tools)
		if err then
			onEvent("error", err)
			return
		end

		local text = result.text or ""
		local calls = result.calls or {}

		if text ~= "" then
			onEvent("text", text)
		end

		if #calls == 0 then
			table.insert(history, { role = "assistant", text = text })
			onEvent("done")
			return
		end

		table.insert(history, { role = "assistant", text = (text ~= "" and text or nil), calls = calls })

		for _, call in ipairs(calls) do
			if shouldStop and shouldStop() then
				onEvent("aborted")
				return
			end
			onEvent("tool_start", call)

			local tool = toolByName[call.name]
			local ok, res
			if not tool then
				ok = false
				res = "ERROR: unknown tool '" .. tostring(call.name) .. "'. Do not call it again."
			else
				ok, res = pcall(tool.run, call.args or {})
				if not ok then
					res = "ERROR: " .. tostring(res)
				end
			end

			local resultStr = truncate(res)
			onEvent("tool_end", { id = call.id, name = call.name, result = resultStr })
			table.insert(history, { role = "tool", id = call.id, name = call.name, result = resultStr })
		end
	end

	onEvent(
		"error",
		("Stopped after %d iterations (safety limit). Ask me to continue where I left off, or narrow the task."):format(
			cfg.MaxIterations
		)
	)
end

return Agent
