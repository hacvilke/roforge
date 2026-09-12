-- Thin HttpService wrapper. ALL outgoing HTTP goes through here so that:
--   * failures produce readable, actionable messages
--   * credentials can never leak into error text (we control what is shown)

local HttpService = game:GetService("HttpService")

local Http = {}

local function shortSnippet(body)
	local s = tostring(body or "")
	return s:sub(1, 400)
end

-- opts: HttpService RequestAsync options. Returns a response table that always
-- has: Success, StatusCode, StatusMessage, Headers, Body, and (on failure)
-- ErrorMessage.
function Http.request(opts)
	local ok, resp = pcall(function()
		return HttpService:RequestAsync(opts)
	end)
	if not ok then
		return {
			Success = false,
			StatusCode = 0,
			StatusMessage = "request failed",
			Headers = {},
			Body = "",
			ErrorMessage = tostring(resp),
		}
	end
	return resp
end

function Http.postJson(url, headers, tableBody)
	local encoded = "null"
	pcall(function()
		encoded = HttpService:JSONEncode(tableBody)
	end)
	return Http.request({
		Url = url,
		Method = "POST",
		Headers = headers,
		Body = encoded,
	})
end

function Http.getJson(url, headers)
	return Http.request({
		Url = url,
		Method = "GET",
		Headers = headers,
	})
end

-- Returns (data, nil) on success or (nil, errorMessage).
function Http.decode(body)
	local ok, data = pcall(HttpService.JSONDecode, HttpService, tostring(body or ""))
	if ok and type(data) == "table" then
		return data, nil
	end
	return nil, "invalid JSON in response"
end

function Http.errorText(resp)
	if resp.ErrorMessage and (resp.StatusCode == nil or resp.StatusCode == 0) then
		return ("network error: %s  (In Studio: Game Settings > Security > enable 'Allow HTTP Requests')"):format(
			tostring(resp.ErrorMessage)
		)
	end
	local code = resp.StatusCode or 0
	return ("HTTP %d: %s"):format(code, shortSnippet(resp.Body))
end

return Http
