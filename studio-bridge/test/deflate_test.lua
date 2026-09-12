-- Emits deterministic test cases for the Deflate module; the Node harness
-- (validate_deflate.mjs) inflates each stream with zlib and compares bytes.
--
-- Output lines:
--   CASE <name> <origlen> <b64zlib> <b64orig>
--   TIME <name> <seconds>

local Deflate = require("../src/Root/Bridge/Deflate")

local function b64(data)
	local chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	local out = {}
	local n = #data
	for i = 1, n - 2, 3 do
		local a, b, c = data:byte(i, i + 2)
		local v = a * 65536 + b * 256 + c
		out[#out + 1] =
			chars:sub(math.floor(v / 262144) % 64 + 1, math.floor(v / 262144) % 64 + 1)
			.. chars:sub(math.floor(v / 4096) % 64 + 1, math.floor(v / 4096) % 64 + 1)
			.. chars:sub(math.floor(v / 64) % 64 + 1, math.floor(v / 64) % 64 + 1)
			.. chars:sub(v % 64 + 1, v % 64 + 1)
	end
	local rem = n % 3
	if rem == 1 then
		local v = data:byte(n) * 65536
		out[#out + 1] =
			chars:sub(math.floor(v / 262144) % 64 + 1, math.floor(v / 262144) % 64 + 1)
			.. chars:sub(math.floor(v / 4096) % 64 + 1, math.floor(v / 4096) % 64 + 1)
			.. "=="
	elseif rem == 2 then
		local a, b = data:byte(n - 1, n)
		local v = a * 65536 + b * 256
		out[#out + 1] =
			chars:sub(math.floor(v / 262144) % 64 + 1, math.floor(v / 262144) % 64 + 1)
			.. chars:sub(math.floor(v / 4096) % 64 + 1, math.floor(v / 4096) % 64 + 1)
			.. chars:sub(math.floor(v / 64) % 64 + 1, math.floor(v / 64) % 64 + 1)
			.. "="
	end
	return table.concat(out)
end

local function runCase(name, data)
	local t0 = os.clock()
	local stream = Deflate.deflate(data)
	local secs = os.clock() - t0
	print(("CASE %s %d %s %s"):format(name, #data, b64(stream), b64(data)))
	print(("TIME %s %.3f"):format(name, secs))
end

local CHUNK = 8192

-- build `n` bytes from byteFn(i) in chunks (avoids one giant string concat)
local function build(n, byteFn)
	local out = table.create(math.ceil(n / CHUNK))
	local chunk = table.create(CHUNK)
	for i = 1, n do
		chunk[#chunk + 1] = string.char(byteFn(i))
		if #chunk == CHUNK then
			out[#out + 1] = table.concat(chunk)
			chunk = table.create(CHUNK)
		end
	end
	if #chunk > 0 then
		out[#out + 1] = table.concat(chunk)
	end
	return table.concat(out)
end

-- A: repetitive (long matches)
runCase("A", string.rep("Hello, RoForge! ", 1000))

-- B: all 256 byte values, 400 rounds (uniform distribution, weak matches)
runCase("B", string.rep(build(256, function(i)
	return i - 1
end), 400))

-- C: 200KB pseudo-random (incompressible → stored fallback is fine)
do
	local k = 12345
	runCase("C", build(200000, function()
		k = (k * 1103 + 17) % 2147483647
		return k % 256
	end))
end

-- D: 1024x576 RGBA gradient (screenshot-like, very compressible)
runCase("D", build(1024 * 576 * 4, function(i)
	local p = math.floor((i - 1) / 4)
	local ch = (i - 1) % 4
	local x = p % 1024
	local y = math.floor(p / 1024) % 576
	if ch == 0 then
		return (x * 40) % 256
	elseif ch == 1 then
		return (y * 128) % 256
	elseif ch == 2 then
		return ((x + y) * 60) % 256
	end
	return 255
end))

-- E1..E4: tiny / degenerate
runCase("E1", "ab")
runCase("E2", "a")
runCase("E3", "")
runCase("E4", string.rep(string.char(7), 10))

-- F: long runs across the 32K window boundary
runCase("F", string.rep(string.char(65), 32770) .. string.rep(string.char(66), 100000))

-- G: skewed cycle distribution (entropy coding)
runCase("G", build(10000, function(i)
	return 255 - ((i * 11) % 256)
end))

-- H: multi-block mixed — 100KB highly repetitive, then 100KB pseudo-random.
-- Exercises per-block adaptive choice: dynamic blocks on the first half,
-- stored blocks on the second (total must still compress).
do
	local k = 987654
	runCase("H", build(100000, function(i)
		return (i * 7) % 256
	end) .. build(100000, function()
		k = (k * 1103 + 17) % 2147483647
		return k % 256
	end))
end

-- H2: just past the single-block limit (65536) — forces 2 blocks, 2nd = 1 byte
runCase("H2", string.rep("x", 65536))

print("DONE")
