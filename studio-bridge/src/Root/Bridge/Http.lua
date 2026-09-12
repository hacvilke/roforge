-- Minimal HttpService wrapper for the bridge loop.
local HttpService = game:GetService("HttpService")

local Http = {}

function Http.request(method, url, headers, body)
	local ok, resp = pcall(function()
		return HttpService:RequestAsync({
			Url = url,
			Method = method,
			Headers = headers,
			Body = body,
		})
	end)
	if not ok then
		return nil, tostring(resp)
	end
	return resp
end

function Http.json(body)
	local ok, data = pcall(HttpService.JSONDecode, HttpService, tostring(body or ""))
	if ok and type(data) == "table" then
		return data
	end
	return nil
end

function Http.encode(table)
	local ok, out = pcall(HttpService.JSONEncode, HttpService, table)
	if ok then
		return out
	end
	return "{}"
end

return Http
