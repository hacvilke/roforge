-- Viewport — capture the current 3D viewport as a PNG so the local CLI can
-- show it to a vision-capable model.
--
-- Three capture strategies, each pcall-guarded; the first success wins:
--   A. RenderSurfaceTexture of workspace.CurrentCamera → Image:Read() → PngEncoder
--   B. StudioCaptureService:CaptureScreenshot() → GetBuffer() → base64
--   C. descriptive error (the model falls back to forge_screenshot)

local Viewport = {}

-- Both are SIBLING modules (children of the Bridge module).
local Png = require(script.Parent.PngEncoder)
local Pro = require(script.Parent.Pro)

local MIN_W, MIN_H = 256, 240
local DEF_W, DEF_H = 1024, 576
-- Max capture size is a Pro-gated limit: 1280x720 free, 1920x1080 Pro.
local function maxW()
	return Pro.limit("viewport_max_width")
end
local function maxH()
	return Pro.limit("viewport_max_height")
end

local function clampDim(v, lo, hi, def)
	local n = tonumber(v)
	if not n or n ~= math.floor(n) then
		return def
	end
	return math.clamp(n, lo, hi)
end

local function tryRenderSurfaceTexture(w, h)
	local camera = workspace.CurrentCamera
	if not camera then
		return nil, "no current camera"
	end
	local holder = Instance.new("Folder")
	holder.Name = "RoForgeCapture"
	holder.Parent = game:GetService("Lighting")
	local rts = Instance.new("RenderSurfaceTexture")
	rts.Name = "View"
	rts.Width = w
	rts.Height = h
	rts.CanvasSize = Vector2.new(w, h)
	rts.Face = Enum.NormalId.Front
	rts.Parent = holder
	rts.CameraSubject = camera
	local okFocus = pcall(function()
		rts.FocusMode = Enum.CameraFocusMode.Locks
	end)
	if not okFocus then
		-- older Studio builds: try the raw enum index
		pcall(function()
			rts.FocusMode = 1
		end)
	end
	task.wait(0.6) -- let the texture render at least one frame
	local okRead, bytes = pcall(function()
		return rts.Image:Read()
	end)
	holder:Destroy()
	if not okRead or type(bytes) ~= "string" then
		return nil, "Image:Read() failed"
	end
	if #bytes == w * h * 4 then
		return Png.b64encode(Png.encode(w, h, bytes))
	elseif #bytes == w * h * 3 then
		return Png.b64encode(Png.encode(w, h, Png.rgbToRgba(bytes)))
	end
	return nil,
		("unexpected pixel byte length %d (expected %d or %d)"):format(#bytes, w * h * 4, w * h * 3)
end

local PNG_SIG = string.char(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

local function tryStudioCapture(w, h)
	-- StudioCaptureService (added ~0.714) is the current plugin viewport
	-- capture API; DataModel:Screenshot and the old ImageLabel flow are gone.
	local okSvc, svc = pcall(function()
		return game:GetService("StudioCaptureService")
	end)
	if not okSvc or not svc then
		return nil, "StudioCaptureService unavailable"
	end
	local okCan, can = pcall(svc.CanCaptureScreenshot, svc)
	if okCan and can == false then
		pcall(svc.RequestScreenshotPermissionAsync, svc)
	end
	local cap
	local okCap, capRet = pcall(function()
		return svc:CaptureScreenshot({
			Width = w,
			Height = h,
			BufferFormat = Enum.StudioCaptureScreenshotFormat.PNG,
			UICaptureMode = Enum.UICaptureMode.All,
		})
	end)
	if okCap and capRet then
		cap = capRet
	end
	if not cap then
		local okRetry, retryRet = pcall(function()
			return svc:CaptureScreenshot({})
		end)
		if okRetry and retryRet then
			cap = retryRet
		else
			return nil, "CaptureScreenshot failed: " .. tostring(retryRet)
		end
	end
	for _ = 1, 50 do
		local okSt, st = pcall(function()
			return cap.BufferStatus
		end)
		if okSt then
			local okReady, isReady = pcall(function()
				return st == Enum.StudioCaptureBufferStatus.Ready
			end)
			if okReady and isReady then
				break
			end
			local okErr, isErr = pcall(function()
				return st == Enum.StudioCaptureBufferStatus.Error
			end)
			if okErr and isErr then
				local okGe, errs = pcall(cap.GetErrors, cap)
				return nil, "capture error: " .. tostring(okGe and table.concat(errs, "; ") or "unknown")
			end
		end
		task.wait(0.1)
	end
	local okBuf, buf = pcall(cap.GetBuffer, cap)
	if not okBuf or not buf then
		return nil, "GetBuffer failed: " .. tostring(buf)
	end
	local okStr, bytes = pcall(function()
		return buf:ToString()
	end)
	if not okStr or type(bytes) ~= "string" or #bytes < 64 then
		return nil, "could not read the capture buffer"
	end
	if bytes:sub(1, 8) == PNG_SIG then
		return Png.b64encode(bytes)
	end
	local expected = w * h * 4
	if #bytes == expected then
		return Png.b64encode(Png.encode(w, h, bytes))
	end
	return nil, ("unexpected buffer size %d"):format(#bytes)
end

function Viewport.init(_plugin)
end

-- args: {width?, height?}
-- Returns {text, imageBase64, mediaType} on success, or an "ERROR: ..." string
-- on total failure (Bridge normalizes both shapes before posting).
function Viewport.capture(args)
	args = type(args) == "table" and args or {}
	local w = clampDim(args.width, MIN_W, maxW(), DEF_W)
	local h = clampDim(args.height, MIN_H, maxH(), DEF_H)
	local failures = {}

	local okA, b64A, whyA = pcall(tryRenderSurfaceTexture, w, h)
	if okA and b64A then
		return {
			text = ("Viewport captured at %dx%d (RenderSurfaceTexture)."):format(w, h),
			imageBase64 = b64A,
			mediaType = "image/png",
		}
	end
	failures[#failures + 1] = "RenderSurfaceTexture: " .. tostring(okA and whyA or b64A)

	local okB, b64B, whyB = pcall(tryStudioCapture, w, h)
	if okB and b64B then
		return {
			text = ("Viewport captured at %dx%d (CaptureScreenshot)."):format(w, h),
			imageBase64 = b64B,
			mediaType = "image/png",
		}
	end
	failures[#failures + 1] = "StudioCapture: " .. tostring(okB and whyB or b64B)

	return "ERROR: could not capture the viewport. "
		.. table.concat(failures, " | ")
		.. ". Fallback: forge_screenshot saves a file to your computer."
end

return Viewport
