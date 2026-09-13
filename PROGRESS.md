# RoForge — Build Progress (continuation log)

User directive: build everything, maximum effort per turn, continue from where
this file says when told "continue". Local-first CLI/TUI is the primary
surface (Claude-Code-style, BYOK, zero backend); the in-Studio plugin
(`client/`) and hosted backend (`server/`) are secondary/optional.

## DONE — Turn 3 (vision + more Studio tools + CI + packaging)

### 🚩 Vision: the model can now SEE the Studio viewport
- [x] **`Viewport.lua`** (`studio-bridge/src/Root/Bridge/`): 3-strategy capture,
      each pcall-guarded, first success wins —
      (A) `RenderSurfaceTexture` of `workspace.CurrentCamera` in a temp Folder
      (`FocusMode = Locks` when supported; raw-enum fallback) → `Image:Read()`
      → accept w·h·4 or w·h·3 → `PngEncoder`;
      (B) `ImageLabel:CaptureScreenshot()` → path → `plugin:ReadFile(path)`
      (PNG signature-checked);
      (C) descriptive `ERROR: …` that tells the model to fall back to
      `forge_screenshot`. Sizes: default 1024×576, clamped 256–1280 × 240–720.
- [x] **`PngEncoder.lua`**: pure-Luau RGBA8 PNG encoder + base64. Stored
      (uncompressed) zlib blocks, CRC32 + Adler-32, big-endian chunk writer.
      **No Roblox globals and no bitwise operators** (byte XOR via a
      comparison-built 256×256 table; shifts via division) so it runs on every
      Studio version and the standalone `luau` CLI. ~1.5s to encode max size;
      ~3.1MB base64 at 1024×576.
- [x] **Pixel-validated** `studio-bridge/test/png_test.lua` +
      `validate_png.mjs` (Node): signature, chunk order, per-chunk CRC via
      `zlib.crc32`, `inflateSync`, and pixel-by-pixel asserts on a 4×2 gradient
      and a 1×1 image → prints `PNG ENCODER: VALID`.
      (Bug caught & fixed: "bit set" test was `a >= s` — wrong; now
      `math.floor(a / s) % 2`.)
- [x] **`forge_viewport`** tool end-to-end: plugin returns
      `{text, imageBase64, mediaType}`; bridge normalizes table results;
      `BridgeServer` body cap raised 4MB→16MB; `bridgeTools` execute returns
      `{text, image}`; agent history item gains `image:{base64, mediaType}`
      (text truncation unchanged); **Anthropic** tool_result `content` becomes
      `[{type:"image", source:{type:"base64", media_type, data}}, {type:"text"}]`;
      **OpenAI** gets the tool message plus a follow-up **user** message with
      `image_url` data URI.

### More Studio tools (bridge-only `ExtraTools.lua`, 6 new `forge_*`)
- [x] `forge_get_property` / `forge_set_property`✱ (single property by path;
      `serializeValue` for Vector3/CFrame/Color3/… via ToHumanReadableString;
      string→number/bool coercion on set; reports before → after)
- [x] `forge_get_attributes` / `forge_set_attribute`✱ (sorted attribute dump;
      string/number/boolean only)
- [x] `forge_select` (multi-path selection with per-path warnings)
- [x] `LocalTools.resolvePath` exported in the **bridge copy only** (client/
      untouched). ✱ = approval-gated in the CLI.
- [x] `forge_screenshot` note updated (points to `forge_viewport` for vision).

### Tests — 31/31 CLI (was 24), 21/21 server
- [x] `test/vision.test.js`: Anthropic `renderHistory` image → content array;
      plain result stays string; OpenAI `renderHistory` → tool msg + user
      `image_url` msg (and no extra msg without image); bridge tools register
      15 with correct approval gates + execute shapes; **full agent loop** with
      a recording mock proving the image block reaches the 2nd Anthropic
      request body.
- [x] `test/bridge.test.js`: 6.6MB structured result round-trips (past the old
      4MB cap).

### CI — `.github/workflows/ci.yml`
- [x] **server**: `npm test` (Node 20).
- [x] **cli**: `npm test` + `node demo/e2e-demo.mjs`.
- [x] **studio-plugins**: pinned Luau **0.738** (`luau-ubuntu.zip`) + Rojo
      **7.7.0** from GitHub releases; PNG encoder pixel-validated via
      standalone `luau`; `luau-analyze` per-file with a **SyntaxError-only**
      gate (Roblox globals are expected unknowns outside Studio); `rojo build`
      of both `studio-bridge` and `client` projects.

### Packaging & TUI
- [x] `scripts/install-plugin.mjs`: copies `dist/*.rbxm` into the OS plugins
      folder (win `%LOCALAPPDATA%\Roblox\Plugins`, darwin
      `~/Documents/Roblox/Plugins`, linux `~/.local/share/Roblox/Plugins`);
      `--list` prints the target dir. Wired as `npm run install-plugin`
      (and `:client`) in `cli/package.json` (+ `demo` script).
- [x] TUI **`/save [path]`**: `Session.transcript()` renders the conversation
      (messages, tool calls, tool results; images noted, not inlined) as
      Markdown → `roforge-transcript-<timestamp>.md` or a custom path. In
      `/help`.
- [x] `cli` npm packaging fields already correct (bin `roforge`, zero deps,
      MIT); scripts added.

### Docs
- [x] README (vision headline, installer in quick start, 31 tests, layout +
      status), docs/CLI.md (`/save`, approval list, vision workflow, CI note),
      docs/BRIDGE.md (image contract + capture strategies + 15-tool table).

## Research findings (Turn 3)
- Luau standalone `luau` (0.738 toolchain in `/tmp`): **no `dofile`, no `io`,
  no `-e`**; `require` paths must start with `./`, `../`, or `@` and resolve
  **relative to the requiring script's directory** (so `test/png_test.lua`
  uses `require("../src/Root/Bridge/PngEncoder")`).
- That `luau` binary **lacks bitwise operators** (`~`, `>>`) → PngEncoder was
  written bitwise-free; also maximally portable across Studio versions.
- `create.roblox.com` docs are JS shells (fetch yields nothing) — Roblox API
  property names stay pcall-guarded + runtime shape-checked.
- Rojo 7.7.0 build syntax: `rojo build -o out.rbxm project.json` (positional
  output is **not** supported).

## DONE — Turn 4 (real DEFLATE — PNG transfers cut 23×)

### 🚩 `Deflate.lua` — a from-scratch RFC 1951 compressor in pure Luau
- [x] `studio-bridge/src/Root/Bridge/Deflate.lua`: **LZ77** (32K window,
      3-byte rolling hash, chain limit 32, match 3–258, GOOD_MATCH=64 early
      stop, in-match re-indexing) → **single dynamic-Huffman block** (canonical
      codes, 15-bit bound enforced by iterative frequency rescaling) → **zlib
      wrapper** (header + Adler-32 over the original bytes). **Stored-block
      fallback** when incompressible or on any internal error (pcall-guarded).
- [x] No Roblox globals, no bitwise operators (bit writer is pure integer
      arithmetic), runs on every Studio version and the standalone `luau` CLI.
- [x] **`PngEncoder` now emits real DEFLATE** in IDAT (kept stored fallback in
      Deflate itself). Dual-env require: `script.Deflate` in Roblox,
      `require("./Deflate")` under the CLI.

### Validation — byte-exact against Node's zlib
- [x] `test/deflate_test.lua` (10 cases: 16KB repeat, 100KB all-256-bytes,
      200KB pseudo-random, 2.36MB 1024×576 gradient, tiny/empty/degenerate,
      132KB long-run across the 32K window, 10KB skewed cycle) +
      `test/validate_deflate.mjs`: `inflateSync` byte-exact round trip for all,
      stored fallback for incompressible, compression asserted for the 5
      compressible cases → **`DEFLATE: VALID (10 cases byte-exact, 5
      compression-checked)`**.
- [x] Numbers: 2,359,296B → **102,629B (4.3%)** in ~1.3s; 132,770B long runs →
      155B; 16,000B repeat → 74B; 102,400B uniform → 725B.
- [x] `validate_png.mjs` still `PNG ENCODER: VALID` (chunks, CRCs, zlib,
      pixels). **1024×576 viewport PNG: 2,360,120B → 103,060B (b64
      3,146,828 → 137,416 — 23× smaller), ~1.9s.**

### Wire-format bugs found & fixed (bit-level forensics vs zlib 1.3 sources)
1. BTYPE must be emitted as bits `1,0,1` (value 5 in 3 bits), not 2.
2. Stored-size comparison must include the 5-byte-per-block header overhead.
3. Canonical Huffman depth starts at 0 (root), not 1.
4. `DIST_INFO`: distance→code table was off by one (`DIST_BASE[code+1]`).
5. **Huffman CODES are transmitted MSB-first** (bit-reversed canonical
   integers) while every other multi-bit field (BFINAL/BTYPE/HLIT/HDIST/HCLEN,
   3-bit BL lengths, RLE extras) is LSB-first — the single biggest one.
6. Zero-run RLE: code 17 covers 3–10 (3 extras), code 18 covers 11–138
   (7 extras) — was using 17 up to 17.
7. **HCLEN is 4 bits** (RFC §3.2.7; values 4–19 → 0–15), not 3.
8. **Code-length-code lengths fit 3 bits (0–7)** → the BL tree is built with a
   7-bit bound (rescale handles it), plus a ≥2-symbols guard because zlib
   rejects an incomplete CODES table.

### Green across the board
- [x] `luau-analyze`: no SyntaxError (only expected Roblox-global noise + two
      benign `#data` false positives on string args).
- [x] Rojo rebuild: `studio-bridge/dist/RoForgeBridge.rbxm` **25,506B**
      (was 17,929), `client/dist/RoForge.rbxm` 22,773B (unchanged code).
- [x] CLI tests **31/31**, server tests **21/21**.

## DONE — Turn 5 (multi-provider: Gemini + OpenRouter + Groq, free-tier auto-routing)

User ask: "does provider support gemini and openrouter groq and auto config to
route free tiers from gemini openrouter etc" → yes, now implemented.

### 🚩 Five providers, one `roforge`, $0 to start
- [x] **`providers/gemini.js`**: native Generative Language API —
      `:streamGenerateContent?alt=sse` streaming, `systemInstruction`,
      `functionDeclarations` tools, `functionResponse` + `inlineData` vision
      (tool images go to the model), `usageMetadata`, stop-reason mapping.
      Consecutive tool results merge into one user turn (Gemini requires
      role alternation).
- [x] **`providers/openrouter.js`** + **`providers/groq.js`**: both are
      OpenAI-compatible → thin adapters over the existing OpenAI SSE client
      with per-provider key/base (`openrouterBaseUrl`, `groqBaseUrl`). Any
      OpenAI-compatible endpoint works.
- [x] **`config.js` provider registry + auto-routing**: `provider: "auto"`
      (new default) picks the first configured key **free tiers first**:
      gemini → groq → openrouter → anthropic → openai, and uses that
      provider's free model. `freeFirst: false` / `ROFORGE_FREE_FIRST=0`
      reverses. Explicit provider always wins. `provider:model` refs
      (`--model gemini:gemini-2.5-flash`, TUI `/model gemini:gemini-2.5-flash`)
      pin provider+model (first colon = provider prefix; OpenRouter models
      with `:` in the name work).
- [x] **Free-tier models** (verified vs 2026 sources): Gemini `gemini-2.5-flash`
      (~1,500 req/day, no card), Groq `llama-3.3-70b-versatile` (~1,000 req/day),
      OpenRouter `qwen/qwen3-coder:free` (`:free` family; `openrouter/free`
      also exists as an auto-free router).
- [x] **CLI surface**: `roforge providers` (table: keys set, active provider,
      free-tier model per provider), `roforge login --provider <p>` for all
      five (key hints per provider), `--provider <p>` flag on chat/TUI,
      config key-masking for all `*Key` fields, TUI banner + `/model` show
      provider + free-tier tag, no-key hint lists the free options.
- [x] Pricing table: free models 0/0 (cost footer shows `≈ $0.0000`).

### Tests — 45/45 CLI (was 31), 21/21 server, e2e demo OK
- [x] `test/providers.test.js` (14): Gemini mock SSE — text+functionCall
      round trip, usage, stop reason, request-body shape (x-goog-api-key,
      systemInstruction, functionDeclarations), consecutive-tool merge,
      image → inlineData, missing-key error; OpenRouter/Groq key+base routing
      via captured mock requests; auto-routing order (free-first, paid-first,
      explicit-provider, provider:model pin + fallback without key, no keys),
      `parseModelRef` edge cases.
- [x] `mock-server.js`: `startMockGemini()` (state-machine SSE) + OpenAI mock
      now captures `lastRequest` {url, headers, body}.
- [x] **Live integration**: `roforge chat -m ping` with only `GEMINI_API_KEY`
      set + `geminiBaseUrl` → auto-routes to Gemini `gemini-2.5-flash`,
      full agent loop (tool call + final answer), `$0.0000` cost, exit 0.
      (Lesson: integration harness must use async spawn — `execFileSync`
      blocks the mock server's event loop → deadlock.)

### Docs
- [x] `docs/CLI.md`: providers + free-tier table, auto-routing section, new
      config example (5 keys, base URLs, `freeFirst`), env var list.
- [x] README: architecture diagram (5 endpoints), quick start with the free
      path, `providers` command, 45 tests, status refreshed.

## DONE — Turn 6 (MCP-tier vision, ChangeHistoryService undo, TUI polish)

All three Turn-6 priorities are implemented, tested, and documented.

### 1. Vision on the MCP tier
- `mcp.js callTool` now **extracts image content** from MCP responses:
  `content[].type === "image"` (`{data: b64, mimeType}`) and `resource.blob`
  blobs are lifted into `{text, isError, image:{base64, mediaType}}` instead
  of being `JSON.stringify`'d into the text. Text blocks and unknown blocks
  are still joined into `text`.
- `studio.js mcpTools`: wrapped `studio_*` tools now return the **structured
  `{text, image}`** result (so an MCP screenshot flows into the same vision
  contract as `forge_viewport`). Capture tools are **detected by
  name/description** (`screenshot`, `capture`, `render`, `image`,
  `viewport`) and get the description suffix *"Returns an image the model can
  actually SEE (vision)."*. Exported `looksLikeCapture` +
  `mcpCaptureNames`.
- `tools/index.js buildTools` returns `mcpCapture` (list of capture tool
  names) → `session.js` adds a system-prompt line listing which `studio_*`
  capture tools are available.
- `mock-server.js startMockMcp` gained a 3rd tool `capture_screenshot` that
  returns a 1×1 red PNG as an `image` content block (the vision-contract
  fixture).
- New `test/vision-mcp.test.js` (5 tests): callTool image extraction;
  capture description + structured result; `looksLikeCapture` heuristics;
  **full agent loop** proving the MCP-tier image rides the same
  `tool_result` → `image` contract into the Anthropic request body; and the
  3 new bridge checkpoint/undo tools + their approval gates.
- **MCP image contract note:** the image is base64 `data` + `mimeType`;
  resource-blob path also handled. This is the same shape the bridge uses, so
  `runAgent`'s existing vision handling (history `image` field →
  `toProvider`) works with no agent changes.

### 2. ChangeHistoryService undo wrappers (bridge)
- `ExtraTools.lua`: `forge_checkpoint {name}`, `forge_undo {to?}`,
  `forge_checkpoints`. All pcall-guarded (missing API → clean `ERROR:`
  string). `forge_checkpoint` calls `ChangeHistoryService:SetChangePoint`
  (native named point) **and** records name→index in a module table;
  `forge_undo` jumps via `SetChangeHistoryIndex` (to a checkpoint, or one
  step back); `forge_checkpoints` lists name/index/steps-back + current.
- Auto-registered by `Bridge.lua refreshTools()` (no Bridge.lua edit needed).
- `studio.js`: 3 new bridge tool names/descriptions/schemas (bridge tool
  count **15 → 18**); `forge_undo` added to the destructive/approval set.
- Pattern: checkpoint → batch of gated edits → `forge_undo` if it goes wrong.
- luau-analyze clean (Roblox-global noise only, as always).

### 3. TUI polish
- `ansi.js`: colors now checked **at call time** via `colorEnabled()` —
  respects `--no-color` argv flag, `ROFORGE_NO_COLOR=1`, and standard
  `NO_COLOR=1`. Default stays colored. Verified live: `--no-color` strips
  all ESC codes; without it they're present.
- NEW `src/tui/markdown.js`: streaming `MarkdownStream` (push/finish) —
  renders **line-by-line as tokens arrive** (safe mid-stream), keeps code
  fence state across deltas, flushes an unclosed fence on `finish()`.
  Supports headings, bullets, numbered lists, bold, inline code, fences
  (dimmed + indented), blockquotes, horizontal rules.
- `tui.js`: assistant text routed through `MarkdownStream` (one per segment);
  `_flushMd()` on tool start / assistant done / new turn so fence state never
  leaks and trailing lines always render. `session.js` now forwards
  `onAssistantDone` to the ui.
- `bin/roforge.js` help documents `--no-color` + env vars.
- **Deferred (Turn 7):** per-tool expandable output + Windows VT100 check.
- New `test/tui.test.js` (6 tests): markdown headings/bold/inline-code,
  bullets+numbered, fence state across deltas + unclosed-fence flush,
  blockquote/rule, and `--no-color`/env ANSI stripping (with argv/env
  cleanup in `t.after`).

### Verification (all green)
- CLI `node --test cli/test/` → **56/56** (was 45; +5 vision-mcp, +6 tui).
  Updated `mcp.test.js` (toolCount 2→3, structured `{text}` result) and
  `vision.test.js` (bridge tool count 15→18).
- Server `node --test server/test/` → **21/21**.
- `node cli/demo/e2e-demo.mjs` → **E2E OK** (agent loop vs mock MCP + mock
  model).
- Live: `roforge --no-color providers` (no ESC) vs `roforge providers`
  (colored).
- `luau-analyze` on `studio-bridge/src` clean (Roblox-global noise only).
- Docs: `README.md` (vision-on-both-tiers + undo bullets, 56 tests,
  Status), `docs/BRIDGE.md` (18-tool table + undo pattern + MCP-vision
  section), `docs/CLI.md` (markdown streaming, `--no-color`, MCP-vision +
  undo note, 56 tests).

## DONE — Turn 7 (Studio toolkit: find/bulk/diff/export + TUI expandable output + npm prep)

### 1. Five new bridge tools (bridge toolset 18 → 23)
All in `ExtraTools.lua`, all pcall-guarded, auto-registered by
`Bridge.lua refreshTools()`. Reuse `LocalTools.resolvePath` + the existing
`coerceValue`/creation patterns.
- **`forge_find {pattern?, class_name?, limit?}`** — case-insensitive name
  substring and/or exact ClassName over `game:GetDescendants()`, returns full
  paths (default 50, max 200, truncation noted). `IsDescendantOf(game)`
  guards against instances destroyed mid-iteration.
- **`forge_bulk_create {items[]}`** — paste-style multi-create:
  `{path, class_name, name?, properties?}` × up to 200, per-item
  created/FAILED lines, summary first, output capped at 50 lines. **Approval
  gated.**
- **`forge_snapshot {name?}`** — captures path→ClassName tree; ring buffer of
  the last 10 snapshots (module state, same as checkpoints).
- **`forge_diff {name?}`** — snapshot (named, or most recent) vs now: sorted
  `+added` / `-removed` lists (50 each, "...and N more").
- **`forge_export {path?, depth?}`** — subtree → JSON via
  `HttpService:JSONEncode`: scalar props whitelist (Position/Size/Color/
  Anchored/...), `CFrame:ToHumanReadableString()`, script `Source` truncated
  to 400 chars, attributes (scalar only), nested `Children` (depth 1–6,
  default 3), whole JSON truncated at 200KB with guidance.
- CLI side: names/descriptions/schemas in `studio.js`, `forge_bulk_create`
  added to the destructive set. Tests: count assertions 18→23
  (`vision.test.js`, `vision-mcp.test.js`) + a new registration/gate/schema
  test.

### 2. TUI finish
- **Expandable tool output**: every tool call is numbered
  (`⚙ [7] tool(args)`); multi-line/long results show the first line +
  `(more: /out 7)`; **`/out [n]`** prints full output, **`/out`** lists the
  last 10 (line counts); last 30 kept in memory. New test drives
  `onToolStart/onToolEnd/_slash` through a fake out-stream and asserts ids,
  hints, and full-output rendering.
- **Windows guard**: `TUI.start()` probes `setRawMode(true/false)` on win32
  before committing; on a legacy console it exits with a pointer to Windows
  Terminal / PowerShell 7+ or `roforge chat` one-shot (avoids a hung/broken
  TUI). Full VT100 verification still needs a real Windows box — noted.

### 3. npm publish prep
- `cli/package.json`: `files` (bin/src/demo/README), `keywords`,
  `engines` (≥18.17), zero runtime deps. **`repository`/`homepage`/`bugs`
  deliberately left empty** — the user sets their real GitHub URL before
  `npm publish` (noted in `cli/README.md`).
- New `cli/README.md` (package-level: install, free tiers, Studio
  connection, feature list).
- New root `CHANGELOG.md` (0.1.0 scaffold + 0.2.0 cumulative).
- `npm pack --dry-run`: **24 files, 37.1kB packed, 123kB unpacked** — tests
  excluded, nothing extra.
- Root README quick start now leads with `npm i -g roforge-cli`.

### Verification (all green)
- CLI `node --test cli/test/` → **58/58** (was 56; +1 bridge
  find/bulk/snapshot/diff/export registration test, +1 TUI `/out` test).
- Server **21/21** · e2e demo **OK** · `luau-analyze` clean (no SyntaxError;
  one `LocalUnused` fixed) · `rojo build` clean (.rbxm packs) ·
  `npm pack --dry-run` clean.
- Docs: `docs/BRIDGE.md` (23-tool table + big-places workflow section),
  `docs/CLI.md` (`/out` + Windows bullets), `README.md` (feature bullets,
  npm install, 58 tests, Status).

## DONE — Turn 8 (Deflate multi-block FIXED + forge_import + property diffs)

### 1. DEFLATE multi-block — root cause found and fixed (the long bug)
Inputs > 65 535 bytes were being rejected by real zlib inflaters
("invalid stored block lengths") whenever more than one block was emitted.
Root cause, confirmed against zlib v1.3 source (`trees.c::_tr_flush_block`)
and the Node streaming API: **zlib byte-pads ONLY the final block**
(`if (last) bi_windup(s)`); between non-final blocks the bitstream is
continuous — the next block's 3 header bits start immediately after the
previous block's EOB bits, mid-byte if needed (`inflate.c` TYPEDO never
BYTEBITS()s between blocks). Our old code byte-padded every block; inflate
read the padding zeros as `BFINAL=0 BTYPE=00` (a fake stored block) and
misread LEN/NLEN.
- Rewrote the encoder as **plan/emit**: `planDynamic(data)` does all the math
  (LZ77 → frequencies → canonical lengths/codes → RLE → code-length tree →
  exact bit total) and returns a plan; `emitDynamic(plan, bfinal, bw)` writes
  the bits; `emitStored(len, chunk, bfinal, bw)` writes a stored block
  (3 header bits, **pad to byte boundary**, then LEN/NLEN + raw bytes —
  stored LEN/NLEN must be byte-aligned because inflate BYTEBITS()s after the
  3 header bits); `storedBits(n) = n*8 + 40`.
- One **shared bitwriter** for the whole stream; wind-up only on flush.
- Per-block adaptive choice: `plan.bits < storedBits(chunkLen)` → dynamic,
  else stored — so incompressible chunks inside a big stream stay raw.
- Deleted the byte-level `storedBlock` helper and the `_multi` debug fn.
- **Validation**: `test/validate_deflate.mjs` now 12/12 byte-exact vs Node
  zlib (A repetitive 16KB, B uniform 102KB, C incompressible 200KB, D
  2.36MB gradient, E1–E4 degenerate, F window-boundary runs 132KB, G skewed
  10KB, **H mixed 200KB dynamic+stored, H2 65536B edge**).
- Debug detour worth remembering: a homemade Lua→base64 helper in a scratch
  script had a `string.sub(start, otherEnd)` range bug that mangled rem==2
  outputs — looked like encoder corruption for an hour; `deflate_test.lua`'s
  own b64 (used by the validator) was always correct.

### 2. `forge_import` — export → edit → import loop closes
- New tool in `ExtraTools.lua` (**approval-gated**, 24th bridge tool):
  `{json?, path?, parent?, name?, dry_run?}`. `path` reads a plugin-folder
  file via pcall'd `readfile`. JSON decoded with `HttpService:JSONDecode`
  (pcall). Recursively `Instance.new(node.ClassName)` (pcall per node,
  failures reported and skipped, not fatal), sets Name, then properties
  (tables coerced: `{X,Y,Z}`→Vector3, `{R,G,B}`→Color3.fromRGB; strings
  auto-parse — exported CFrame/Vector3/Color3 human-readable strings are
  accepted natively; CFrame string→`CFrame.new` pcall), then scalar
  attributes, then parents last, then recurses `Children`.
- Caps: 500 nodes per call (counted pre-flight), 10 failed-prop names,
  20 error lines. `dry_run=true` returns node count + class histogram
  without touching the DataModel.
- `forge_export` now includes `Name` on every node (was missing — imports
  would name everything after ClassName).
- CLI: registered in `studio.js` (names/descriptions/schemas + destructive
  set); `vision.test.js` + `vision-mcp.test.js` counts 23→24 and new
  gate/schema assertions.

### 3. Property-level diffs in `forge_snapshot`/`forge_diff`
- `captureTree` now stores `{cls, props}` where props = `Name` +
  Position/Size/CFrame/Color/Anchored (pcall'd, human-readable strings;
  kept small on purpose so big places stay fast).
- `forge_diff` adds `~ path: Prop  (old → new)` lines (sorted, 50 cap)
  alongside `+added` / `−removed`; header counts all three.

### 4. Docs
- `docs/BRIDGE.md`: 24-tool table (+`forge_import` row, `forge_diff`/
  `forge_export` descriptions updated).
- `CHANGELOG.md`: 0.3.0 entry (multi-block fix, per-block stored, import,
  Name export, property diffs; 23→24).

### Verification (all green)
- CLI `node --test cli/test/` → **58/58** · server **21/21** · e2e demo
  **OK** · deflate **12/12 byte-exact** (incl. 200KB multi-block mixed) ·
  `luau-analyze` no SyntaxError · `rojo build` → `/tmp/bridge-t8.rbxm`.

## DONE — Turn 9 (GitHub repo + npm publish + monetization plan)

- **Public repo**: `https://github.com/hacvilke/roforge` (main, MIT,
  prebuilt `.rbxm`, repo URLs in `package.json`). GitHub Actions CI green
  (cli 58 + e2e, server 21, studio plugins: PNG pixel-validated + DEFLATE
  12/12 + analyze + rojo). CI fixes: rojo tag `v7.7.0`; luau binary needs
  an absolute path (relative path resolved against the wrong cwd).
- **npm published**: `roforge-cli@0.3.0` on **npmjs** (npm account `mrciv`;
  fine-grained token with 2FA-bypass required — classic tokens 403).
  Smoke-tested: clean `npm i roforge-cli` → `roforge --help` boots. Also on
  **GitHub Packages** as `@hacvilke/roforge-cli@0.3.0`.
- **`docs/MONETIZATION.md`**: open-core plan — free MIT core forever;
  "RoForge HQ" experience hosts a Pro Game Pass (~499 R$) + monthly dev
  product (~199 R$), 70/30 split, DevEx cashout; pro gate =
  `MarketplaceService:UserOwnsGamePassAsync` + separate closed-source
  module (zero pro code in the open repo); premium Toolbox plugin for
  passive payouts; Stripe team plans later.

## NEXT — Turn 10 (when user says "continue")

Priority order:
1. **Pro pass-gate scaffolding (no Roblox account needed)**:
   `ProGamePassId`/`ProDevProductId` in bridge Settings + ownership check +
   `forge_pro` status tool + `roforge pro` CLI subcommand. Live the moment
   the user pastes the real pass ids.
2. **Deflate speed tuning (optional)**: chain-length/window tuning for the
   slow CLI path (2.36MB took ~1.3s); consider `GOOD_MATCH` raise for
   repetitive viewport frames.
3. **Team features (optional, hosted)**: point `server/` at the new tool
   contract for shared managed instances.
4. **More tools (if requested)**: camera/frame capture options, instance
   rename/move utilities, `forge_import` from a hosted URL (needs backend
   file endpoint).

## Invariants (do not break on any turn)

- The model API key is sent ONLY to the model provider. Never to any server,
  URL, log, or error string.
- Bridge stays loopback-only with token auth; MCP stays local.
- Tools return strings **or** `{text, imageBase64, mediaType}`; errors are
  `ERROR: ...` strings the model adapts to.
- CLI + server stay zero npm dependencies.
- Client/bridge Luau must stay `luau-analyze` clean (SyntaxError gate) and
  `rojo build` clean.
- Keep `PROGRESS.md` updated at the end of every turn.

## Environment notes (this sandbox)

- Node v20 (global fetch, node:test).
- `/tmp/luau`, `/tmp/luau-analyze`, `/tmp/luau-compile`, `/tmp/luau-ast`
  (official Luau release binaries — see Turn 3 research: standalone `luau`
  limits above). `/tmp/rojo` (Rojo 7.7.0). Re-download if the sandbox resets.
- Roblox Studio itself is NOT available here — Studio-side verification is
  analyzer + Rojo build + careful review; first live Studio session may
  surface UI/protocol tweaks (RenderSurfaceTexture `FocusMode`/`Image:Read`
  shapes are pcall-guarded for exactly this reason).
