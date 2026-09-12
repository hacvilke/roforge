-- Standalone test for PngEncoder (run: /tmp/luau png_test.lua).
-- Emits the base64 of a small RGBA image on stdout for Node to validate.
local Png = require("../src/Root/Bridge/PngEncoder")

-- 4x2 gradient: pixel(x,y) = (x*40, y*128, (x+y)*60, 255)
local W, H = 4, 2
local rgba = {}
for y = 0, H - 1 do
	for x = 0, W - 1 do
		rgba[#rgba + 1] = string.char((x * 40) % 256, (y * 128) % 256, ((x + y) * 60) % 256, 255)
	end
end
local png = Png.encode(W, H, table.concat(rgba))

-- edge-case sizes through the same encoder (1x1, and a 3-byte-remainder image for b64)
local one = Png.encode(1, 1, string.char(9, 8, 7, 255))
assert(#one > 40, "1x1 png too small")

print("SIZE " .. #png)
print(Png.b64encode(png))
print("ONE " .. #one)
print(Png.b64encode(one))
