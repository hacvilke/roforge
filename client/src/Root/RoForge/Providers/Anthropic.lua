-- Anthropic Messages API adapter.
-- Direct call from Studio: the x-api-key header goes straight to
-- api.anthropic.com. It never touches the RoForge backend or any proxy.

local Http = require(script.Parent.Parent.Http)

local Anthropic = {}

Anthropic.name = "anthropic"
Anthropic.defaultModel = "claude-sonnet-4-5" -- edit in Settings to use a newer model id

-- Internal history -> Anthropic messages (tool results merge into user turns).
local function renderHistory(history)
	local msgs = {}
	for _, item in ipairs(history) do
		if item.role == "user" then
			table.insert(msgs, { role = "user", content = item.text })
		elseif item.role == "assistant" then
			local blocks = {}
			if item.text ~= nil and item.text ~= "" then
				table.insert(blocks, { type = "text", text = item.text })
			end
			if item.calls then
				for _, call in ipairs(item.calls) do
					table.insert(blocks, {
						type = "tool_use",
						id = call.id,
						name = call.name,
						input = call.args or {},
					})
				end
			end
			if #blocks > 0 then
				table.insert(msgs, { role = "assistant", content = blocks })
			end
		else -- role == "tool"
			local block = {
				type = "tool_result",
				tool_use_id = item.id,
				content = item.result,
			}
			local last = msgs[#msgs]
			if last and last.role == "user" and type(last.content) == "table" then
				table.insert(last.content, block)
			else
				table.insert(msgs, { role = "user", content = { block } })
			end
		end
	end
	return msgs
end

local function renderTools(tools)
	local out = {}
	for _, t in ipairs(tools) do
		table.insert(out, {
			name = t.name,
			description = t.description,
			input_schema = t.input_schema,
		})
	end
	return out
end

function Anthropic.chat(cfg, system, history, tools)
	local model = (cfg.Model and cfg.Model ~= "") and cfg.Model or Anthropic.defaultModel
	local headers = {
		["x-api-key"] = cfg.ApiKey,
		["anthropic-version"] = "2023-06-01",
		["content-type"] = "application/json",
	}
	local body = {
		model = model,
		max_tokens = 4096,
		messages = renderHistory(history),
	}
	if system and system ~= "" then
		body.system = system
	end
	if tools and #tools > 0 then
		body.tools = renderTools(tools)
	end

	local resp = Http.postJson("https://api.anthropic.com/v1/messages", headers, body)
	if not resp.Success or (resp.StatusCode and resp.StatusCode >= 400) then
		return nil, Http.errorText(resp)
	end
	local data, err = Http.decode(resp.Body)
	if err then
		return nil, err
	end

	local text = ""
	local calls = {}
	for _, block in ipairs(data.content or {}) do
		if block.type == "text" then
			text = text .. tostring(block.text or "")
		elseif block.type == "tool_use" then
			table.insert(calls, { id = block.id, name = block.name, args = block.input or {} })
		end
	end
	return { text = text, calls = calls }, nil
end

return Anthropic
