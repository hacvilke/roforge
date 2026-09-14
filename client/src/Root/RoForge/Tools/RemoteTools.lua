-- Remote tools: executed on the RoForge backend (server-side capabilities
-- like web search and Roblox API lookups that Studio cannot do itself).
--
-- What goes over the wire: session token + tool name + JSON args. That is
-- everything. The model API key is NEVER part of these requests, and chat
-- content is never sent to the backend.

-- Http is a child of the RoForge module (Tools' parent), not of Tools.
local Http = require(script.Parent.Parent.Http)

local RemoteTools = {}

local cache = {
	defs = nil,
	fetchedAt = 0,
}
local REFRESH_SECONDS = 300 -- 5 min

local function baseUrl(cfg)
	local u = tostring(cfg.BackendUrl or "")
	while u:sub(-1) == "/" do
		u = u:sub(1, -2)
	end
	return u
end

-- Returns (toolDefs, err). ToolDefs: { { name, description, input_schema } }
function RemoteTools.getToolDefs(cfg)
	if cache.defs and (os.time() - cache.fetchedAt) < REFRESH_SECONDS then
		return cache.defs, nil
	end
	if cfg.SessionToken == "" then
		return cache.defs, "no session token set (Settings > Backend session token)"
	end
	local resp = Http.getJson(baseUrl(cfg) .. "/v1/tools", {
		["authorization"] = "Bearer " .. cfg.SessionToken,
	})
	if not resp.Success then
		return cache.defs, Http.errorText(resp)
	end
	if resp.StatusCode ~= 200 then
		local msg
		if resp.StatusCode == 401 then
			msg = "backend rejected the session token (401) — log in again"
		elseif resp.StatusCode == 429 then
			msg = "backend rate limited (429) — wait a moment"
		else
			msg = "backend error: " .. Http.errorText(resp)
		end
		return cache.defs, msg
	end
	local data, err = Http.decode(resp.Body)
	if err then
		return cache.defs, err
	end
	cache.defs = data.tools or {}
	cache.fetchedAt = os.time()
	return cache.defs, nil
end

function RemoteTools.refresh(cfg)
	cache.fetchedAt = 0
	return RemoteTools.getToolDefs(cfg)
end

-- Returns the tool result as a string (errors prefixed with "ERROR:").
function RemoteTools.call(cfg, name, args)
	if cfg.SessionToken == "" then
		return "ERROR: no session token set (open the Settings tab)"
	end
	local resp = Http.postJson(
		baseUrl(cfg) .. "/v1/tools/" .. tostring(name),
		{
			["authorization"] = "Bearer " .. cfg.SessionToken,
			["content-type"] = "application/json",
		},
		{ args = args or {} }
	)
	if not resp.Success then
		return "ERROR: " .. Http.errorText(resp)
	end
	if resp.StatusCode == 429 then
		return "ERROR: backend rate limit hit — wait a minute and retry."
	end
	if resp.StatusCode ~= 200 then
		return "ERROR: backend returned HTTP " .. tostring(resp.StatusCode)
	end
	local data, err = Http.decode(resp.Body)
	if err then
		return "ERROR: " .. err
	end
	if data.ok then
		return tostring(data.result)
	end
	return "ERROR: " .. tostring(data.error or "unknown backend error")
end

return RemoteTools
