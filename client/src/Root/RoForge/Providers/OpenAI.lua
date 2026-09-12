-- OpenAI Chat Completions API adapter (tools / function calling).
-- Direct call from Studio: the Authorization header goes straight to
-- api.openai.com. It never touches the RoForge backend or any proxy.

local HttpService = game:GetService("HttpService")
local Http = require(script.Parent.Parent.Http)

local OpenAI = {}

OpenAI.name = "openai"
OpenAI.defaultModel = "gpt-4.1" -- edit in Settings to use a newer model id

local function renderHistory(history)
	local msgs = {}
	for _, item in ipairs(history) do
		if item.role == "user" then
			table.insert(msgs, { role = "user", content = item.text })
		elseif item.role == "assistant" then
			local msg = { role = "assistant", content = item.text or "" }
			if item.calls and #item.calls > 0 then
				local toolCalls = {}
				for _, call in ipairs(item.calls) do
					local argsJson = "{}"
					pcall(function()
						argsJson = HttpService:JSONEncode(call.args or {})
					end)
					table.insert(toolCalls, {
						id = call.id,
						type = "function",
						["function"] = {
							name = call.name,
							arguments = argsJson,
						},
					})
				end
				msg.tool_calls = toolCalls
			end
			table.insert(msgs, msg)
		else -- role == "tool"
			table.insert(msgs, {
				role = "tool",
				tool_call_id = item.id,
				content = item.result,
			})
		end
	end
	return msgs
end

local function renderTools(tools)
	local out = {}
	for _, t in ipairs(tools) do
		table.insert(out, {
			type = "function",
			["function"] = {
				name = t.name,
				description = t.description,
				parameters = t.input_schema,
			},
		})
	end
	return out
end

function OpenAI.chat(cfg, system, history, tools)
	local model = (cfg.Model and cfg.Model ~= "") and cfg.Model or OpenAI.defaultModel
	local headers = {
		["Authorization"] = "Bearer " .. cfg.ApiKey,
		["content-type"] = "application/json",
	}
	local msgs = renderHistory(history)
	if system and system ~= "" then
		table.insert(msgs, 1, { role = "system", content = system })
	end
	local body = {
		model = model,
		messages = msgs,
	}
	if tools and #tools > 0 then
		body.tools = renderTools(tools)
	end

	local resp = Http.postJson("https://api.openai.com/v1/chat/completions", headers, body)
	if not resp.Success or (resp.StatusCode and resp.StatusCode >= 400) then
		return nil, Http.errorText(resp)
	end
	local data, err = Http.decode(resp.Body)
	if err then
		return nil, err
	end

	local choice = (data.choices or {})[1]
	local msg = (choice and choice.message) or {}
	local text = if type(msg.content) == "string" then msg.content else ""

	local calls = {}
	for _, tc in ipairs(msg.tool_calls or {}) do
		local fn = tc["function"] or {}
		local args = {}
		pcall(function()
			local decoded = HttpService:JSONDecode(tostring(fn.arguments or "{}"))
			if type(decoded) == "table" then
				args = decoded
			end
		end)
		table.insert(calls, { id = tc.id, name = fn.name, args = args })
	end
	return { text = text, calls = calls }, nil
end

return OpenAI
