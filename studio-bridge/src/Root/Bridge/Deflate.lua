-- Deflate — pure-Luau DEFLATE (RFC 1951) compressor.
-- No Roblox globals, no bitwise operators (works in every Studio version and
-- the standalone `luau` CLI).
--
-- Produces dynamic-Huffman blocks with LZ77 matches (32K window), wrapped in
-- a zlib stream. Input over 65535 bytes is split into 64KiB blocks and each
-- block independently chooses dynamic vs stored (whichever is smaller), so
-- compressible regions deflate while incompressible ones are stored. Input at
-- or below 65535 bytes keeps the single-block path; stored is also the
-- fallback on any internal error.
-- Validated byte-exact against Node's zlib in test/deflate_test.lua.

local Deflate = {}

local MAX_BITS = 15
local MAX_MATCH = 258
local MIN_MATCH = 3
local WINDOW = 32768
local HASH_SIZE = 65536
local CHAIN_LIMIT = 32
local GOOD_MATCH = 64 -- stop walking the chain once the match is this good

-- ---------------- RFC 1951 code tables ----------------

-- length codes 257..285 → base length + extra bits
local LEN_BASE = {
	3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99,
	115, 131, 163, 195, 227, 258,
}
local LEN_EXTRA = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 }

-- distance codes 0..29 → base distance + extra bits
local DIST_BASE = {
	1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
	1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
}
local DIST_EXTRA = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 }

-- code length codes are emitted in this order
local BL_ORDER = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 }

-- precomputed lookups: length 3..258 → {code, extraBits}; dist 1..32768 → {code, extraBits}
local LEN_INFO = {}
do
	local code, base = 0, LEN_BASE[1]
	for L = 3, MAX_MATCH do
		while L >= (LEN_BASE[code + 2] or 1000) do
			code = code + 1
			base = LEN_BASE[code + 1]
		end
		LEN_INFO[L] = { code + 257, L - base }
	end
end
local DIST_INFO = {}
do
	-- largest code whose base is ≤ d (bases are 1-indexed: code c → DIST_BASE[c+1])
	for d = 1, WINDOW do
		local code = 29
		while code > 0 and DIST_BASE[code + 1] > d do
			code = code - 1
		end
		DIST_INFO[d] = { code, d - DIST_BASE[code + 1] }
	end
end

-- ---------------- Huffman machinery (canonical, arithmetic-only) ----------------

-- Build canonical code lengths from frequencies (sym 0..symCount-1).
-- Enforces the 15-bit limit by iteratively rescaling frequencies (min 1 for
-- any symbol that occurs). Returns { [sym] = length }.
local function buildLengths(freq, symCount, maxBits)
	maxBits = maxBits or MAX_BITS
	local function construct(f)
		local nodes = {}
		for s = 0, symCount - 1 do
			if f[s] and f[s] > 0 then
				nodes[#nodes + 1] = { f = f[s], sym = s }
			end
		end
		local n = #nodes
		if n == 0 then
			-- defensive: give symbol 0 a length-1 code
			return { [0] = 1 }
		elseif n == 1 then
			return { [nodes[1].sym] = 1 }
		end
		while #nodes > 1 do
			local i1 = 1
			for i = 2, #nodes do
				if nodes[i].f < nodes[i1].f then
					i1 = i
				end
			end
			local a = nodes[i1]
			table.remove(nodes, i1)
			local i2 = 1
			for i = 2, #nodes do
				if nodes[i].f < nodes[i2].f then
					i2 = i
				end
			end
			local b = nodes[i2]
			table.remove(nodes, i2)
			nodes[#nodes + 1] = { f = a.f + b.f, a = a, b = b }
		end
		local lengths = {}
		-- root sits at depth 0; its children are the length-1 codewords
		local stack = { { nodes[1], 0 } }
		while #stack > 0 do
			local entry = table.remove(stack)
			local node, depth = entry[1], entry[2]
			if node.sym ~= nil then
				lengths[node.sym] = depth
			else
				stack[#stack + 1] = { node.a, depth + 1 }
				stack[#stack + 1] = { node.b, depth + 1 }
			end
		end
		return lengths
	end

	local lengths = construct(freq)
	local maxLen = 0
	for _, l in pairs(lengths) do
		if l > maxLen then
			maxLen = l
		end
	end
	local guard = 0
	while maxLen > maxBits and guard < 32 do
		guard = guard + 1
		-- halve, but never zero a symbol that actually occurs
		for s = 0, symCount - 1 do
			if freq[s] and freq[s] > 0 then
				freq[s] = math.max(1, math.floor(freq[s] / 2))
			end
		end
		lengths = construct(freq)
		maxLen = 0
		for _, l in pairs(lengths) do
			if l > maxLen then
				maxLen = l
			end
		end
	end
	return lengths
end

-- Canonical code values from lengths.
--
-- IMPORTANT wire-format subtlety: the canonical code INTEGER is transmitted
-- MSB-first on the wire (first bit sent = code's MSB), while all other
-- multi-bit fields (BFINAL/BTYPE/HLIT/HCLEN/RLE extras) are LSB-first.
-- The bit writer appends LSB-first, so we store the bit-reversed code value:
-- emitting reverseBits(code, len) LSB-first produces code MSB-first.
local function reverseBits(c, len)
	local r = 0
	for i = 1, len do
		r = r * 2 + (c % 2)
		c = math.floor(c / 2)
	end
	return r
end

local function canonicalCodes(lengths, symCount)
	local byLen = {}
	for s = 0, symCount - 1 do
		local l = lengths[s]
		if l and l > 0 then
			byLen[l] = byLen[l] or {}
			byLen[l][#byLen[l] + 1] = s
		end
	end
	local codes = {}
	local code = 0
	for l = 1, MAX_BITS do
		local syms = byLen[l]
		if syms then
			for _, s in ipairs(syms) do
				codes[s] = reverseBits(code, l)
				code = code + 1
			end
		end
		code = code * 2
	end
	return codes
end

-- ---------------- bit writer (LSB-first, arithmetic-only) ----------------

local function makeBitWriter()
	local buf = 0
	local cnt = 0
	local out = {}
	return {
		emit = function(code, len)
			buf = buf + code * (2 ^ cnt)
			cnt = cnt + len
			while cnt >= 8 do
				out[#out + 1] = string.char(buf % 256)
				buf = math.floor(buf / 256)
				cnt = cnt - 8
			end
		end,
		pad = function()
			-- emit zero bits until byte-aligned (needed before stored-block
			-- LEN/NLEN: inflate BYTEBITS()s after the 3 header bits)
			local r = cnt % 8
			if r ~= 0 then
				cnt = cnt + (8 - r)
				while cnt >= 8 do
					out[#out + 1] = string.char(buf % 256)
					buf = math.floor(buf / 256)
					cnt = cnt - 8
				end
			end
		end,
		flush = function()
			if cnt > 0 then
				out[#out + 1] = string.char(buf % 256)
				buf = 0
				cnt = 0
			end
			return table.concat(out)
		end,
	}
end

-- ---------------- LZ77 ----------------

-- Returns alternating tokens: [lit, 0] | [lenCode, dist*300 + (len-3)]
-- (the second slot packs both distance and exact length: extra bits for the
-- length code need the exact length, which the code alone doesn't carry)
local function lz77(data)
	local n = #data
	local tokens = table.create(n)
	local head = table.create(HASH_SIZE)
	local prev = table.create(math.min(n, WINDOW))
	local t = 0

	local i = 1
	while i <= n - MIN_MATCH + 1 do
		local a = data:byte(i)
		local b = data:byte(i + 1)
		local c = data:byte(i + 2)
		local h = (a * 6559 + b * 257 + c) % HASH_SIZE

		local bestLen, bestDist = 0, 0
		local cand = head[h]
		local hops = 0
		while cand and cand >= i - WINDOW and hops < CHAIN_LIMIT do
			if data:byte(cand) == a and data:byte(cand + 1) == b and data:byte(cand + 2) == c then
				local maxl = math.min(MAX_MATCH, n - i + 1)
				local l = 3
				while l < maxl and data:byte(i + l) == data:byte(cand + l) do
					l = l + 1
				end
				if l > bestLen then
					bestLen = l
					bestDist = i - cand
					if l >= MAX_MATCH or l >= GOOD_MATCH then
						break
					end
				end
			end
			cand = prev[cand]
			hops = hops + 1
		end

		if bestLen >= MIN_MATCH then
			local info = LEN_INFO[bestLen]
			t = t + 1
			tokens[t] = info[1]
			t = t + 1
			tokens[t] = bestDist * 300 + (bestLen - 3)
			-- index every position inside the match so future matches can anchor there
			local j = i
			local jEnd = i + bestLen - 2
			while j <= jEnd do
				if j + 2 <= n then
					local hj =
						(data:byte(j) * 6559 + data:byte(j + 1) * 257 + data:byte(j + 2)) % HASH_SIZE
					prev[j] = head[hj]
					head[hj] = j
				end
				j = j + 1
			end
			i = i + bestLen
		else
			t = t + 1
			tokens[t] = a
			t = t + 1
			tokens[t] = 0
			prev[i] = head[h]
			head[h] = i
			i = i + 1
		end
	end
	while i <= n do
		t = t + 1
		tokens[t] = data:byte(i)
		t = t + 1
		tokens[t] = 0
		i = i + 1
	end
	return tokens
end

-- ---------------- RLE of code lengths (codes 0-18) ----------------

local function emitZeroRun(run, out)
	while run > 0 do
		if run >= 11 then
			-- code 18 repeats zero 11-138 times (7 extra bits)
			local take = math.min(run, 138)
			out[#out + 1] = { 18, take - 11 }
			run = run - take
		elseif run >= 3 then
			-- code 17 repeats zero 3-10 times (3 extra bits)
			out[#out + 1] = { 17, run - 3 }
			run = 0
		else
			for _ = 1, run do
				out[#out + 1] = { 0, 0 }
			end
			run = 0
		end
	end
end

local function rleLengths(lens)
	local out = {}
	local i = 1
	local n = #lens
	while i <= n do
		local v = lens[i]
		if v == 0 then
			local j = i
			while j <= n and lens[j] == 0 do
				j = j + 1
			end
			emitZeroRun(j - i, out)
			i = j
		else
			local j = i
			while j <= n and lens[j] == v do
				j = j + 1
			end
			local run = j - i
			if run >= 6 then
				out[#out + 1] = { v, 0 }
				local rest = run - 1
				while rest >= 3 do
					local r = math.min(rest, 6)
					out[#out + 1] = { 16, r - 3 }
					rest = rest - r
				end
				for _ = 1, rest do
					out[#out + 1] = { v, 0 }
				end
			else
				for _ = 1, run do
					out[#out + 1] = { v, 0 }
				end
			end
			i = j
		end
	end
	return out
end

-- ---------------- dynamic block encoder (plan/emit) ----------------
-- plan: all math for one dynamic block (no bit emission)
local function planDynamic(data)
	local tokens = lz77(data)
	local n = #tokens

	-- pass 1: frequencies
	local freqLit = {}
	local freqDist = {}
	for i = 1, n, 2 do
		local sym = tokens[i]
		if sym < 256 then
			freqLit[sym] = (freqLit[sym] or 0) + 1
		else
			freqLit[sym] = (freqLit[sym] or 0) + 1 -- length code (257-285)
			local d = math.floor(tokens[i + 1] / 300)
			local di = DIST_INFO[d][1]
			freqDist[di] = (freqDist[di] or 0) + 1
		end
	end
	freqLit[256] = (freqLit[256] or 0) + 1 -- EOB
	if not next(freqDist) then
		freqDist[0] = 1 -- distance tree must be non-empty
	end

	local lenLit = buildLengths(freqLit, 286)
	local lenDist = buildLengths(freqDist, 30)
	local codeLit = canonicalCodes(lenLit, 286)
	local codeDist = canonicalCodes(lenDist, 30)

	-- combined code-length array (286 lit + 30 dist) → RLE → code-length tree
	local lens = {}
	for s2 = 0, 285 do
		lens[#lens + 1] = lenLit[s2] or 0
	end
	for s2 = 0, 29 do
		lens[#lens + 1] = lenDist[s2] or 0
	end
	local rle = rleLengths(lens)
	local freqBl = {}
	for _, e in ipairs(rle) do
		freqBl[e[1]] = (freqBl[e[1]] or 0) + 1
	end
	-- the BL header carries each code length in 3 bits (RFC 1951 §3.2.7), so
	-- code-length codes may only get lengths 1-7 (rescale keeps it within that)
	local lenBl = buildLengths(freqBl, 19, 7)
	-- zlib rejects an incomplete CODES table; a single-symbol BL tree is
	-- incomplete, so make sure at least two symbols exist
	local nSym = 0
	for _ in pairs(freqBl) do
		nSym = nSym + 1
	end
	if nSym < 2 then
		local add = freqBl[0] and 1 or 0
		freqBl[add] = (freqBl[add] or 0) + 1
		lenBl = buildLengths(freqBl, 19, 7)
	end
	local codeBl = canonicalCodes(lenBl, 19)

	-- how many code-length symbols the header carries
	local blLens = {}
	for _, s3 in ipairs(BL_ORDER) do
		blLens[#blLens + 1] = lenBl[s3] or 0
	end
	local hc = 19
	while hc > 4 and blLens[hc] == 0 do
		hc = hc - 1
	end

	-- exact bit cost (used to pick dynamic vs stored per block)
	local rleBits = 0
	for _, e in ipairs(rle) do
		rleBits = rleBits + (lenBl[e[1]] or 0)
		if e[1] == 16 then
			rleBits = rleBits + 2
		elseif e[1] == 17 then
			rleBits = rleBits + 3
		elseif e[1] == 18 then
			rleBits = rleBits + 7
		end
	end
	local dataBits = 0
	for i = 1, n, 2 do
		local sym = tokens[i]
		dataBits = dataBits + (lenLit[sym] or 0)
		if sym >= 257 then
			local packed = tokens[i + 1]
			local d = math.floor(packed / 300)
			local codeIdx = sym - 256
			local di = DIST_INFO[d]
			dataBits = dataBits + LEN_EXTRA[codeIdx] + (lenDist[di[1]] or 0) + DIST_EXTRA[di[1] + 1]
		end
	end
	dataBits = dataBits + (lenLit[256] or 0) -- EOB
	local totalBits = 3 + 5 + 5 + 4 + (hc - 4) * 3 + rleBits + dataBits

	return {
		tokens = tokens,
		lenLit = lenLit,
		codeLit = codeLit,
		lenDist = lenDist,
		codeDist = codeDist,
		rle = rle,
		lenBl = lenBl,
		codeBl = codeBl,
		hc = hc,
		bits = totalBits,
	}
end

-- write the planned block's bits into bw (shared across blocks — zlib does
-- NOT byte-align between non-final dynamic blocks; the bitstream is
-- continuous, so the next block's header starts right after the EOB bits)
local function emitDynamic(plan, bfinal, bw)
	-- block header: BFINAL (0/1), BTYPE=10 (dynamic).
	-- bit order: BFINAL, then BTYPE LSB→MSB → final=5, non-final=4 in 3 bits
	bw.emit((bfinal and 1 or 0) + 4, 3)
	bw.emit(29, 5) -- HLIT: 286 - 257
	bw.emit(29, 5) -- HDIST: 30 - 1
	local blLens = {}
	for i = 1, plan.hc do
		blLens[i] = plan.lenBl[BL_ORDER[i]] or 0
	end
	bw.emit(plan.hc - 4, 4) -- HCLEN: 4 bits (RFC 1951 §3.2.7; 4-19 code-length symbols)
	for i = 1, plan.hc do
		bw.emit(blLens[i], 3)
	end
	for _, e in ipairs(plan.rle) do
		local sym, extra = e[1], e[2]
		local blLen = plan.lenBl[sym] or 0
		bw.emit(plan.codeBl[sym] or 0, blLen)
		-- RLE extra bits: code 16 → 2, code 17 → 3, code 18 → 7
		local extraBits = if sym == 16 then 2 elseif sym == 17 then 3 elseif sym == 18 then 7 else 0
		if extraBits > 0 then
			bw.emit(extra > 0 and extra or 0, extraBits)
		end
	end
	local n = #plan.tokens
	for i = 1, n, 2 do
		local sym = plan.tokens[i]
		local litLen = plan.lenLit[sym] or 0
		bw.emit(plan.codeLit[sym] or 0, litLen)
		if sym >= 257 then
			local packed = plan.tokens[i + 1]
			local d = math.floor(packed / 300)
			local matchLen = packed % 300 + 3
			local codeIdx = sym - 256 -- 1..29
			local lenBits = matchLen - LEN_BASE[codeIdx]
			bw.emit(lenBits, LEN_EXTRA[codeIdx])
			local di = DIST_INFO[d]
			bw.emit(plan.codeDist[di[1]] or 0, plan.lenDist[di[1]] or 0)
			bw.emit(di[2], DIST_EXTRA[di[1] + 1])
		end
	end
	-- EOB
	bw.emit(plan.codeLit[256] or 0, plan.lenLit[256] or 0)
end

-- one stored block emitted as bits (stored blocks ARE byte-aligned: 3 header
-- bits + 5 pad + LEN + NLEN + raw bytes)
local function emitStored(chunkLen, chunk, bfinal, bw)
	bw.emit(bfinal and 1 or 0, 3) -- BFINAL + BTYPE=00 (2 zero bits)
	bw.pad() -- zero bits to the next byte boundary (inflate BYTEBITS()s here)
	bw.emit(chunkLen, 16) -- LEN (LSB-first)
	bw.emit(65535 - chunkLen, 16) -- NLEN
	for i = 1, chunkLen do
		bw.emit(chunk:byte(i), 8)
	end
end

-- a stored block costs its raw bytes plus the 5-byte header (40 bits)
local function storedBits(n)
	return n * 8 + 40
end

-- ---------------- zlib wrapper + stored fallback ----------------

local function adler32(data)
	local a, b = 1, 0
	for i = 1, #data do
		a = (a + data:byte(i)) % 65521
		b = (b + a) % 65521
	end
	return b * 65536 + a
end

local function be32(n)
	return string.char(
		math.floor(n / 16777216) % 256,
		math.floor(n / 65536) % 256,
		math.floor(n / 256) % 256,
		n % 256
	)
end

-- the Adler-32 check is over the UNCOMPRESSED data (RFC 1950)
local function zlibWrap(deflateStream, originalData)
	local out = { string.char(0x78, 0x01), deflateStream, be32(adler32(originalData)) }
	return table.concat(out)
end

-- stored (uncompressed) zlib stream — the guaranteed-valid fallback
local function zlibStore(raw)
	local out = { string.char(0x78, 0x01) }
	local pos, total = 1, #raw
	while true do
		local n = math.min(65535, total - pos + 1)
		local isFinal = (pos + n - 1 >= total) and 1 or 0
		local nlen = 65535 - n
		out[#out + 1] =
			string.char(isFinal, n % 256, math.floor(n / 256) % 256, nlen % 256, math.floor(nlen / 256) % 256)
			.. raw:sub(pos, pos + n - 1)
		pos = pos + n
		if pos > total then
			break
		end
	end
	out[#out + 1] = be32(adler32(raw))
	return table.concat(out)
end

-- one stored block for a raw chunk (≤ 65535 bytes); layout matches
function Deflate.deflate(data)
	local n = #data
	if n <= 65535 then
		local ok, plan = pcall(planDynamic, data)
		if ok and plan.bits < storedBits(n) then
			local bw = makeBitWriter()
			emitDynamic(plan, true, bw)
			return zlibWrap(bw.flush(), data)
		end
		return zlibStore(data)
	end
	local bw = makeBitWriter()
	local pos = 1
	while pos <= n do
		local chunkLen = math.min(65535, n - pos + 1)
		local chunk = data:sub(pos, pos + chunkLen - 1)
		local bfinal = (pos + chunkLen - 1) >= n
		local ok, plan = pcall(planDynamic, chunk)
		if ok and plan.bits < storedBits(chunkLen) then
			emitDynamic(plan, bfinal, bw)
		else
			emitStored(chunkLen, chunk, bfinal, bw)
		end
		pos = pos + chunkLen
	end
	return zlibWrap(bw.flush(), data)
end

-- zlib(data) — alias
function Deflate.zlib(data)
	return Deflate.deflate(data)
end

-- debug introspection (used by test tooling; not on the hot path)
Deflate._debug = function(data)
	local tokens = lz77(data)
	local n = #tokens
	local freqLit = {}
	local freqDist = {}
	for i = 1, n, 2 do
		local sym = tokens[i]
		freqLit[sym] = (freqLit[sym] or 0) + 1
		if sym >= 257 then
			local d = math.floor(tokens[i + 1] / 300)
			local di = DIST_INFO[d][1]
			freqDist[di] = (freqDist[di] or 0) + 1
		end
	end
	freqLit[256] = (freqLit[256] or 0) + 1
	if not next(freqDist) then freqDist[0] = 1 end
	local lenLit = buildLengths(freqLit, 286)
	local lenDist = buildLengths(freqDist, 30)
	local codeLit = canonicalCodes(lenLit, 286)
	local lens = {}
	for s2 = 0, 285 do lens[#lens + 1] = lenLit[s2] or 0 end
	for s2 = 0, 29 do lens[#lens + 1] = lenDist[s2] or 0 end
	local rle = rleLengths(lens)
	local freqBl = {}
	for _, e in ipairs(rle) do freqBl[e[1]] = (freqBl[e[1]] or 0) + 1 end
	local lenBl = buildLengths(freqBl, 19, 7)
	local codeBl = canonicalCodes(lenBl, 19)
	return { tokens = tokens, lenLit = lenLit, lenDist = lenDist, rle = rle, lenBl = lenBl, codeBl = codeBl, codeLit = codeLit }
end
return Deflate
