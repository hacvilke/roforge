-- PngEncoder — pure-Luau PNG encoder (RGB/RGBA8) + base64.
-- No Roblox globals, no bitwise operators → runs on every Studio version and
-- in the standalone `luau` CLI (unit-tested in test/png_test.lua).
--
-- IDAT is a real DEFLATE stream (Deflate.lua: LZ77 + dynamic Huffman, with a
-- stored-block fallback for incompressible data). A 1024x576 RGBA viewport
-- typically lands ~500KB–1.2MB raw → well under provider image limits.

local PngEncoder = {}

local Deflate
do
	-- `script` exists in Roblox; the standalone luau CLI resolves by relative path
	local ok, mod = pcall(function()
		return require(script.Deflate)
	end)
	if ok and mod then
		Deflate = mod
	else
		Deflate = require("./Deflate")
	end
end

-- ---------------- byte XOR table (comparison-based, no bit ops) ----------------
local XOR8 = {}
do
	for a = 0, 255 do
		XOR8[a] = {}
		for b = 0, 255 do
			local r, s = 0, 128
			while s > 0 do
				if (math.floor(a / s) % 2) ~= (math.floor(b / s) % 2) then
					r = r + s
				end
				s = math.floor(s / 2)
			end
			XOR8[a][b] = r
		end
	end
end

local function xor32(a, b)
	local r = XOR8[a % 256][b % 256]
	local a1 = math.floor(a / 256)
	local b1 = math.floor(b / 256)
	r = r + 256 * XOR8[a1 % 256][b1 % 256]
	local a2 = math.floor(a1 / 256)
	local b2 = math.floor(b1 / 256)
	r = r + 65536 * XOR8[a2 % 256][b2 % 256]
	return r + 16777216 * XOR8[math.floor(a2 / 256)][math.floor(b2 / 256)]
end

-- ---------------- CRC32 (poly 0xEDB88320, reflected) ----------------
local CRC_TABLE = {}
do
	for n = 0, 255 do
		local c = n
		for _ = 1, 8 do
			if c % 2 == 1 then
				c = xor32(0xEDB88320, math.floor(c / 2))
			else
				c = math.floor(c / 2)
			end
		end
		CRC_TABLE[n] = c
	end
end

local function crc32(data)
	local crc = 0xFFFFFFFF
	for i = 1, #data do
		crc = xor32(CRC_TABLE[XOR8[crc % 256][data:byte(i)]], math.floor(crc / 256))
	end
	return xor32(crc, 0xFFFFFFFF)
end

PngEncoder._crc32 = crc32 -- exported for unit tests
PngEncoder._xor32 = xor32 -- exported for unit tests

local function be32(n)
	return string.char(
		math.floor(n / 16777216) % 256,
		math.floor(n / 65536) % 256,
		math.floor(n / 256) % 256,
		n % 256
	)
end

local function chunk(ctype, cdata)
	return be32(#cdata) .. ctype .. cdata .. be32(crc32(ctype .. cdata))
end

--[[
	encode(width, height, rgba) -> png string
	rgba: byte string, length exactly width*height*4 (RGBA, row-major).
]]
function PngEncoder.encode(width, height, rgba)
	assert(width >= 1 and height >= 1, "width/height must be >= 1")
	assert(#rgba == width * height * 4, "rgba byte length mismatch")

	local rowLen = width * 4
	local rows = table.create(height)
	for y = 0, height - 1 do
		local off = y * rowLen
		rows[y + 1] = "\0" .. rgba:sub(off + 1, off + rowLen)
	end
	local raw = table.concat(rows)

	local ihdr = be32(width) .. be32(height) .. string.char(8, 6, 0, 0, 0)
	return table.concat({
		string.char(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
		chunk("IHDR", ihdr),
		chunk("IDAT", Deflate.deflate(raw)),
		chunk("IEND", ""),
	})
end

-- RGB (w*h*3) → RGBA (w*h*4)
function PngEncoder.rgbToRgba(rgb)
	local n = #rgb
	local out = table.create(n + math.floor(n / 3))
	for i = 1, n, 3 do
		local r, g, b = rgb:byte(i, i + 2)
		out[#out + 1] = string.char(r, g, b, 255)
	end
	return table.concat(out)
end

-- ---------------- base64 ----------------
local B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function PngEncoder.b64encode(data)
	local out = table.create(math.ceil(#data / 3) * 4)
	local n = #data
	for i = 1, n - 2, 3 do
		local a, b, c = data:byte(i, i + 2)
		local v = a * 65536 + b * 256 + c
		out[#out + 1] =
			B64CHARS:sub(math.floor(v / 262144) % 64 + 1, math.floor(v / 262144) % 64 + 1)
			.. B64CHARS:sub(math.floor(v / 4096) % 64 + 1, math.floor(v / 4096) % 64 + 1)
			.. B64CHARS:sub(math.floor(v / 64) % 64 + 1, math.floor(v / 64) % 64 + 1)
			.. B64CHARS:sub(v % 64 + 1, v % 64 + 1)
	end
	local rem = n % 3
	if rem == 1 then
		local v = data:byte(n) * 65536
		out[#out + 1] =
			B64CHARS:sub(math.floor(v / 262144) % 64 + 1, math.floor(v / 262144) % 64 + 1)
			.. B64CHARS:sub(math.floor(v / 4096) % 64 + 1, math.floor(v / 4096) % 64 + 1)
			.. "=="
	elseif rem == 2 then
		local a, b = data:byte(n - 1, n)
		local v = a * 65536 + b * 256
		out[#out + 1] =
			B64CHARS:sub(math.floor(v / 262144) % 64 + 1, math.floor(v / 262144) % 64 + 1)
			.. B64CHARS:sub(math.floor(v / 4096) % 64 + 1, math.floor(v / 4096) % 64 + 1)
			.. B64CHARS:sub(math.floor(v / 64) % 64 + 1, math.floor(v / 64) % 64 + 1)
			.. "="
	end
	return table.concat(out)
end

return PngEncoder
