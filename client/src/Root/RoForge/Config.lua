-- RoForge configuration.
--
-- SECURITY NOTE: the model API key is stored locally on the user's machine via
-- Plugin:SetSetting (Roblox keeps these in the user's own Studio settings on
-- their computer). It is sent ONLY to the model provider, never to the
-- RoForge backend, never to a proxy, and never into URLs or error messages.

local Config = {}

local SETTINGS_KEYS = {
	Provider = "Provider",
	ApiKey = "ApiKey",
	Model = "Model",
	BackendUrl = "BackendUrl",
	SessionToken = "SessionToken",
	MaxIterations = "MaxIterations",
}

local DEFAULTS = {
	Provider = "anthropic", -- "anthropic" | "openai"
	ApiKey = "",
	Model = "", -- empty = provider default (see Providers/*)
	BackendUrl = "http://127.0.0.1:8787",
	SessionToken = "",
	MaxIterations = 10,
}

function Config.load(plugin)
	local cfg = {}

	local function get(key, dflt)
		local ok, val = pcall(function()
			return plugin:GetSetting(SETTINGS_KEYS[key])
		end)
		if ok and val and val ~= "" then
			return val
		end
		return dflt
	end

	cfg.Provider = get("Provider", DEFAULTS.Provider)
	cfg.ApiKey = get("ApiKey", "")
	cfg.Model = get("Model", "")
	cfg.BackendUrl = get("BackendUrl", DEFAULTS.BackendUrl)
	cfg.SessionToken = get("SessionToken", "")
	local iters = tonumber(get("MaxIterations", DEFAULTS.MaxIterations))
	cfg.MaxIterations = math.clamp(iters or 10, 1, 25)
	return cfg
end

function Config.save(plugin, cfg)
	for key, settingName in pairs(SETTINGS_KEYS) do
		local ok, err = pcall(function()
			plugin:SetSetting(settingName, tostring(cfg[key] or ""))
		end)
		if not ok then
			warn(("[RoForge] could not save setting %s: %s"):format(settingName, tostring(err)))
		end
	end
end

function Config.isReady(cfg)
	return cfg.ApiKey ~= nil and cfg.ApiKey ~= ""
end

return Config
