-- Viewport — capture the current 3D viewport as a PNG so the local CLI can
-- show it to a vision-capable model.
--
-- Three capture strategies, each pcall-guarded; the first success wins:
--   A. RenderSurfaceTexture of workspace.CurrentCamera → Image:Read() → PngEncoder
--   B. ImageLabel:CaptureScreenshot() → plugin:ReadFile(path) → base64
--   C. descriptive error (the model falls back to forge_screenshot)

local Viewport = {}

local Png = require(script.PngEncoder)
local Pro = require(script.Pro)

local MIN_W, MIN_H = 256, 240
local DEF_W, DEF_H = 1024, 576
-- Max capture size is a Pro-gated limit: 1280x720 free, 1920x1080 Pro.
local function maxW()
	return Pro.limit("viewport_max_width")
end
local function maxH()
	return Pro.limit("viewport_max_height")
end

local pluginRef = nil

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

local function tryImageLabel()
	if not pluginRef then
		return nil, "no plugin reference"
	end
	local okPath, path = pcall(function()
		local il = Instance.new("ImageLabel")
		local p = il:CaptureScreenshot()
		il:Destroy()
		return p
	end)
	if not okPath or type(path) ~= "string" or path == "" then
		return nil, "CaptureScreenshot failed"
	end
	local okBytes, bytes = pcall(function()
		return pluginRef:ReadFile(path)
	end)
	if not okBytes or type(bytes) ~= "string" or #bytes < 64 then
		return nil, "ReadFile failed"
	end
	if bytes:sub(1, 8) ~= PNG_SIG then
		return nil, "screenshot is not a PNG"
	end
	return Png.b64encode(bytes)
end

function Viewport.init(plugin)
	pluginRef = plugin
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

	local okB, b64B, whyB = pcall(tryImageLabel)
	if okB and b64B then
		return {
			text = ("Viewport captured at %dx%d (CaptureScreenshot)."):format(w, h),
			imageBase64 = b64B,
			mediaType = "image/png",
		}
	end
	failures[#failures + 1] = "ImageLabel: " .. tostring(okB and whyB or b64B)

	return "ERROR: could not capture the viewport. "
		.. table.concat(failures, " | ")
		.. ". Fallback: forge_screenshot saves a file to your computer."
end

return Viewport
