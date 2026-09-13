# Changelog

All user-facing changes. Dates are the build date, not a public release —
RoForge is pre-1.0.

## 0.3.1 — 2026-09-13

### Fixed (from the first real Windows install)
- **Config: env-var-style keys now work anywhere in `config.json`** —
  `{"bridge": {"OPENROUTER_API_KEY": "…"}}` (or top-level) is imported onto
  the right provider. Previously only the canonical `openrouterKey` field was
  read, so hand-written configs silently showed "no API key found".
- **"No Anthropic API key" dead-end** — with zero keys configured, `auto`
  mode now errors with `No API key found … run roforge login …` instead of
  silently routing to Anthropic; `roforge chat` shows the same friendly error
  (no stack trace).
- **TUI: shell commands get a hint** — typing `roforge login` (or
  `npm`/`node`/`npx`/`git …)` into the TUI now prints "that's a shell
  command — /exit first" instead of being sent to the model.
- **TUI: version banner** now reads from `package.json` (was hard-coded 0.2.0).
- **TUI: `/model <name>`** warns (softly) on unrecognized model names.
- **Windows: `roforge login`** falls back to a visible paste prompt when raw
  terminal input isn't supported (legacy consoles).
- Config path resolves lazily (honors `ROFORGE_CONFIG_DIR` set after import —
  tests + late env).

### Added
- Regression tests: lenient config import, no-key friendly error, explicit
  provider named error, TUI shell guard (63 CLI tests total).

## 0.3.0 — 2026-09-12

### Fixed
- **DEFLATE multi-block streams**: blocks > 65 535 input bytes now emit
  several zlib blocks in one continuous bitstream (zlib only byte-pads the
  *final* block; stored blocks get byte-aligned LEN/NLEN headers). Previously
  every block was byte-padded, which inflated as garbage past the first block.
  Validated byte-exact against Node `zlib` on 12 cases (16 KB → 2.4 MB,
  incompressible 200 KB, mixed dynamic/stored, 65 536-byte edge).
- **Per-block stored fallback**: each block independently picks dynamic vs
  stored by exact bit cost — incompressible chunks inside a big stream no
  longer inflate the archive (200 KB random: 200 026 B vs 200 000 B input;
  half-repetitive half-random 200 KB: 101 184 B).

### Added
- **`forge_import`** (approval-gated): applies a `forge_export` JSON back
  into Studio — recreates the instance tree with properties (Vector3 from
  `{X,Y,Z}` or `"x y z"`, Color3 from `{R,G,B}`, CFrame from string), script
  sources, and attributes. `dry_run=true` previews the node/class count;
  `path` reads the JSON from a plugin-folder file; max 500 nodes per call.
  Closes the export → edit → import loop.
- **`forge_export`** now includes each instance's `Name` (round-trips into
  `forge_import`).
- **`forge_diff`** now reports property-level changes too: `~` lines for
  changed `Name`/`Position`/`Size`/`CFrame`/`Color`/`Anchored`
  (snapshot → now), next to the existing added (+) / removed (−).

### Changed
- Bridge toolset 23 → 24 tools (`forge_*`).

## 0.2.0 — 2026-09-12

### Added
- **Vision on both Studio tiers**: the model sees the 3D viewport via the
  bridge plugin's `forge_viewport` (real PNG, our own encoder + RFC 1951
  DEFLATE compressor), and Studio's built-in MCP screenshot/capture tools are
  auto-detected and their images flow to the model too.
- **Undo-able edits**: `forge_checkpoint` / `forge_undo` / `forge_checkpoints`
  wrap `ChangeHistoryService` — checkpoint before a destructive batch, roll
  back after. `forge_undo` is approval-gated.
- **More Studio tools**: `forge_find` (name/class search), `forge_bulk_create`
  (paste-style multi-create, approval-gated), `forge_snapshot` + `forge_diff`
  (instance-tree diff: what was added/removed), `forge_export` (subtree JSON:
  properties, script sources, attributes).
- **TUI**: streaming Markdown rendering (headings, lists, code fences,
  bold/inline code, blockquotes) drawn line-by-line as tokens arrive;
  `--no-color` / `ROFORGE_NO_COLOR` / `NO_COLOR`; expandable tool output —
  each tool call gets an id, multi-line results show a first line plus
  `(more: /out n)`; `/out [n]` prints full output, `/out` lists recent calls.
- **Windows guard**: the TUI verifies raw terminal mode is available and
  exits with guidance (Windows Terminal / PowerShell 7+) instead of hanging.
- **Multi-provider + free tiers**: Gemini, Groq, OpenRouter joined Anthropic
  and OpenAI. `provider: "auto"` routes free-tier-first
  (gemini → groq → openrouter → anthropic → openai); `ROFORGE_FREE_FIRST=0`
  reverses; `--provider` / `provider:model` pins. `roforge providers` lists
  everything.

### Changed
- Bridge toolset 12 → 23 tools (`forge_*`).
- `tools/call` MCP responses now extract image content blocks instead of
  JSON-stringifying them into text.
- PNG transfer size cut ~23× by real DEFLATE (was stored blocks).

### Packaging
- `cli/package.json` publish-ready: `files`, `keywords`, `engines`
  (Node ≥ 18.17), package-level `cli/README.md`. No runtime dependencies —
  ever.

## 0.1.0 — initial scaffold

- Local-first CLI/TUI agent (Claude-Code-style loop, streaming, approval
  gates, per-turn token/cost footer).
- BYOK providers: Anthropic (SSE streaming, tool use), OpenAI-compatible.
- Studio tiers: built-in MCP server client (loopback, 4s probe) + RoForge
  Bridge plugin (loopback HTTP + token auth) with the original `forge_*`
  toolset, PNG viewport encoder, and from-scratch inflate/deflate work.
- Rojo project tools (`project_tree/read/write/edit/search/run`) + official
  `luau-analyze` integration + web search/fetch + Roblox lookups.
- In-Studio chat plugin (`client/`) and hosted backend (`server/`) as
  secondary surfaces.
- Offline test suites (mock providers incl. vision contract, mock MCP,
  pixel-validated PNG, byte-exact DEFLATE validation) + e2e demo + GitHub
  Actions CI.
