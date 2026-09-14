# Changelog

All user-facing changes. Dates are the build date, not a public release —
RoForge is pre-1.0.

## 0.3.18 — 2026-09-14

### Fixed
- **`Save & connect` / `Save settings` crashed (`string.trim`)**: Luau has
  no `string.trim` — both plugins now use a local `trim()` helper. This was
  why pasting the bridge token did nothing (the save handler died before
  storing it, so the CLI kept rejecting the empty token with HTTP 401) and
  why the client chat stayed dead after entering an API key.
- **Bridge status now shows the real reason when not connected**:
  network errors, `HTTP 401 — token mismatch`, and an explicit
  "enable Game Settings > Security > Allow HTTP Requests" hint (the
  loopback HTTP the bridge uses is blocked by Studio until that place
  setting is on).

### Improved
- Bridge dock hint text: what to paste, that the Pro id fields stay blank
  unless you published the RoForge Pro pass, and the HTTP-requests
  setting.

### CI
- New static checker (`check_luau_api.mjs`) fails the build on string
  methods that don't exist in Luau (`trim`, `split`, `startsWith`, ...) —
  the "hallucinated JS method" bug class is now guarded.

## 0.3.17 — 2026-09-14

### Fixed
- **Toolbar button click crashed (`Visible` on dock)**:
  `DockWidgetPluginGui` has no `Visible` property — show/hide is controlled
  by `Enabled`. The toggle handlers in both plugins now use `Enabled` only.
  (Plugins already started and printed their ready lines; only the
  button-click handler was affected.)

## 0.3.16 — 2026-09-14

### Fixed
- **Toolbar button dead after click (`ClickableWhenOff`)**: that property
  does not exist on `PluginToolbarButton` — a hallucination on our side.
  Replaced with the real `ClickableWhenViewportHidden` in both plugins.
  Because the crash happened before the button's click handler was attached,
  this is also why the button appeared but did nothing.
- The smoke-test harness now enforces the **real** `PluginToolbarButton`
  property set (`ClickableWhenViewportHidden`, `Enabled`, `Icon`), so
  invented property names can never ship again.

## 0.3.15 — 2026-09-14

### Fixed
- **"Argument 3 missing or nil" at plugin startup (both plugins)**: the
  traceback pointed at `toolbar:CreateButton(label, tooltip)`. Recent Studio
  builds use the signature `CreateButton(buttonId, tooltip, iconname, text)`
  where the icon argument is required. Plugins now call the full
  `(id, tooltip, icon, text)` form (empty icon = text-only button, matching
  the documented Icon fallback) and fall back to the classic 2-argument form
  on older builds. If neither works the plugin still starts — the dock is
  the primary UI — and Output explains where to re-open it.

## 0.3.14 — 2026-09-14

### Fixed
- **Plugin startup crash on `UIPadding`**: we set `PadTop/PadBottom/...`,
  but the real property names are `PaddingTop/PaddingBottom/...`. Fixed in
  both plugins; the smoke tests now reject unknown property names per class.
- **Toolbar name collision**: both plugins created a toolbar named
  "RoForge". The bridge's toolbar is now "RoForge Bridge".

### Improved
- Plugin startup failures now include the **exact file and line** in the
  Output warning (xpcall + debug.traceback), so any remaining startup issue
  is diagnosable in one log paste.

## 0.3.13 — 2026-09-14

### Fixed
- **Plugins failed to start in Studio** with "BackgroundColor3 is not a
  valid member of DockWidgetPluginGui" (bridge) and a follow-on startup
  error (client): the dock widget had a background color set on it, but
  `DockWidgetPluginGui` has no such property. The dock's root Frame paints
  the background instead.
- New **plugin smoke tests** (CI + local): each plugin's full `start()`
  now runs under a stubbed Studio that replicates the engine's strict
  property and argument checks, so this bug class is caught before ship.

## 0.3.12 — 2026-09-13

### Fixed
- **Plugins now actually load in Studio.** Eight `require` calls in the
  bridge and two in the client referenced sibling modules as if they were
  children (`require(script.Pro)` from `LocalTools` instead of
  `require(script.Parent.Pro)`, etc.). Studio errored at load time with
  "Pro is not a valid member of ModuleScript …" and the plugins never
  started. All 10 paths fixed and verified against the built tree.
- New CI gate: `scripts/check_plugin_requires.mjs` resolves every
  `script.*` require against the real Instance tree and fails the build
  on any broken level — this bug class can no longer ship.

### Added
- `roforge install-plugin [bridge|client] --name <file>` — install a
  plugin under a different filename. Studio remembers a declined
  first-run prompt per filename, so a fresh name re-triggers the prompt.
- `install-plugin` help now documents the `client` argument.

## 0.3.11 — 2026-09-13

### Changed
- **Plugins now ship in the classic XML format** (same `.rbxm`
filename, classic XML inside). Modern Studio reads both formats, but
older Studio builds can only read the classic one — this makes the
plugins work on any Studio version. If Studio showed a one-time prompt
about the plugin and it was declined, the new file content re-triggers
the prompt.

## 0.3.10 — 2026-09-13

### Fixed
- **0.3.9 npm package shipped stale plugin dists.** `cli/dist/` (the
copy bundled into the npm package, used first by `roforge
install-plugin`) had not been synced with the 0.3.9 rebuild, so npm
installs still received the broken plugins. `cli/dist` is now synced
with the rebuilt `studio-bridge/dist` and `client/dist`.

## 0.3.9 — 2026-09-13

### Fixed
- **Studio file plugins now actually load.** The bundled `RoForgeBridge.rbxm`
  and `RoForge.rbxm` had no executable script at the model root (everything
  was `ModuleScript`s), so Studio silently loaded them and did nothing — no
  toolbar button, no dock, and the plugin was missing from the Plugin
  Manager. Both plugins now ship a proper entry
  (`src/Root/init.server.luau`, matching Rojo's own plugin template) that
  runs at plugin load time, guarded by the `plugin` global so importing the
  model into a place is a no-op.
- **Rebuilt with Rojo 7.7.0 conventions.** Rojo 7.x treats a lone `X.json`
  next to `X.lua` as a separate JSON module, so the old `X.json` sidecars
  were injecting 16+ junk instances into the model. They're gone; module
  roots now use the `init.lua` convention (e.g. `Bridge/init.lua`), which
  Rojo merges into a single `ModuleScript` with its siblings as children —
  the tree the Lua `require`s already expect.
- Rebuilt `studio-bridge/dist/RoForgeBridge.rbxm` (10 instances),
  `client/dist/RoForge.rbxm` (13 instances), and re-verified
  `hq/dist/RoForgeHQ.rbxm`.

## 0.3.8 — 2026-09-13

### Fixed
- **`roforge install-plugin` paste-in comment:** copying a doc line with its
  trailing `:: comment` (cmd.exe passes `::` as an argument) used to fail
  with a cryptic `unknown plugin: ::`. The CLI now detects the pasted
  comment/arrow and prints exactly what to run instead.

## 0.3.7 — 2026-09-13

### Security hardening (massive battery — 51 new checks, all green)
- **`cli/test/security.test.js`** (29 tests) + 2 allowlist tests: the
  security/production gate for the network surface, plugin surface, config
  store, and offline behavior.
- **Plugin SSRF guards (real gaps found & fixed):**
  - redirect-following was an SSRF hole — a 302 to a private address is now
    refused; redirects are manual, ≤3 hops, and **every hop re-validates**
    against the public-host guard;
  - host check is now fail-closed: IPv4 numerics (decimal/octal/shorthand,
    normalized by the URL parser) and all non-public IPv6 forms
    (`[::1]`, link-local, ULA, IPv4-mapped) are rejected;
  - response bodies are **capped at 1 MiB** while streaming (a hostile
    public host can't stream gigabytes into memory);
  - header values with CRLF/control characters rejected at load time;
  - `read-file` now resolves symlinks (`fs.realpathSync`) and re-checks
    project-root containment — a link pointing outside is refused;
  - backslash paths (`..\win\path`) count as traversal on every platform.
- **Bridge server:** constant-time token comparison
  (`crypto.timingSafeEqual`); loopback bind, 16 MB result cap, job-id
  traversal patterns, oversized bodies, and malformed JSON all covered by
  live-HTTP tests.
- **Config store:** API-key file now written `0600` in a `0700` dir (was
  umask-dependent); `deepMerge` refuses `__proto__`/`constructor`/`prototype`
  keys; corrupt config degrades to `{}`.
- **Supply chain:** both npm packages have **zero runtime dependencies**
  (verified) — nothing to audit, nothing to be compromised through.
- **Closed Pro module** (private repo): hardened against a poisoned
  `RoForgeProStore` — `restore` type-checks the record and pcall-guards the
  rebuild (a hand-edited/malicious entry returns a clean "corrupt snapshot",
  never a throw); `listSnapshots`/`listShared` type-guard records. 9 new
  adversarial checks → **57/57**.

### Added — LRM as an AI addon
- `plugins.allowedCommands` config (default `["roforge"]`, sanitized) wired
  through `buildTools` — extend it to run other binaries from plugins while
  keeping every guarantee (no shell, approval gate, caps).
- `cli/examples/plugins/lrm-status.json` — read-only
  [`lrm`](https://github.com/hacvilke/lrm) tools (`lrm_repo_status`,
  `lrm_repo_log`, `lrm_repo_peers`) so the agent can see P2P VCS state;
  docs section in `docs/PLUGINS.md`.

### Tests
- CLI **145/145** (51 new security/allowlist checks), server 21/21, Pro
  60/60, PNG + DEFLATE valid, analyze clean (both repos), e2e OK, closed
  suite 57/57.

## 0.3.6 — 2026-09-13

### Added — Pro feature seams (open repo stays MIT; features live in the closed module)
- **Four new bridge tools (29 `forge_*` total):** `forge_pro_features`
  (read-only status of the closed component), `forge_cloud_snapshot`,
  `forge_cloud_restore` (approval-gated), `forge_team_share` (approval-gated).
  Free users / absent module get a clean "Pro component not installed" or
  "requires the RoForge Pro pass" message — nothing errors.
- **New MIT `ProModuleLoader`** (`studio-bridge/src/Root/Bridge/`): finds the
  closed `RoForgeProModule` ModuleScript (bundled in the plugin for Pro builds,
  or in `ReplicatedStorage` for in-place installs), validates its 11-function
  contract, caches the result. Contains zero Pro logic — the open repo never
  ships feature implementations.
- **The closed Pro module now exists** in the private companion repo
  `hacvilke/roforge-pro`: cloud snapshots (serialize → list → restore →
  delete), team workspaces (share/list place & checkpoint refs), hosted MCP
  relay (status/send). Local-first (in-place `RoForgeProStore` in
  ReplicatedStorage), optional `backendUrl` mirror. **The pass id goes in the
  module's SETTINGS block** (or via `configure()` from the plugin).

### Added — strict declarative plugin system (CLI)
- **JSON-only plugins** in `<project>/plugins/*.json` and
  `~/.roforge/plugins/*.json` (plus `ROFORGE_PLUGINS_DIR`). No code fields —
  the validator is a strict allowlist at every depth, so a plugin cannot
  contain malicious intent by construction.
- Four actions: `http` (public https only — localhost/private hosts rejected
  at load time), `command` (allowlist: `roforge`; argv array, no shell),
  `read-file` (project-root-relative, size-capped), `transform` (placeholder
  fill). No env/key injection — the only substitution is `{{arg}}` for
  declared input args.
- Guarantees: mutating actions (POST/PUT, command) always approval-gated;
  outputs capped (default 8,000 chars, hard 64 KB); rejections listed in the
  TUI status line and the agent's system prompt.
- Two working examples in `cli/examples/plugins/` and `docs/PLUGINS.md`.
  Wired into `buildTools` as a third tier; `cfg.plugins.enabled = false`
  disables it.

### Fixed
- Open `Pro.lua` `_devProductOwned` now handles all three real API shapes
  (boolean, `{ IsPurchased = … }`, error) — previously "the call succeeded"
  counted as owned. The stub in `pro_test.lua` covers the table + boolean
  shapes; the closed suite covers all three.

### Tests
- CLI 114/114 (20 new plugin-system tests), Pro suite 60/60 (25 new
  loader checks: absent/present/non-Pro/bad-module/runtime-error),
  server 21/21, PNG + DEFLATE valid, analyze gate clean, e2e demo OK.
- Closed suite (private repo): 48/48.

## 0.3.5 — 2026-09-13

### Changed — Pro is now a single one-time pass
- **One product instead of two**: RoForge Pro is the **999 R$ one-time game
  pass** only. The "Pro month" repeatable dev product is retired (Roblox has
  no real subscriptions — a repeatable product is just a re-purchase, and
  one-time lowers the barrier for a dev tool).
- HQ storefront is now a single "Get RoForge Pro" button; docs, README,
  wiki, and the plugin's "Unlock Pro" hint all say one-time only.
- **The dev-product entitlement path stays in the code** (`ProDevProductId`
  in the plugin dock, `MarketplaceService` check in `Pro.lua`) — a future
  team/subscription product re-enables with zero code change.
- Rebuilt `RoForgeBridge.rbxm` (updated hint) + `RoForgeHQ.rbxm` (single
  button); npm bundle re-synced.

### Tests
- All green: CLI 94/94, Pro 35/35, analyze gate, e2e demo.

## 0.3.4 — 2026-09-13

### Added — "where do I get the plugin?" is now a one-liner
- **`roforge install-plugin [bridge|client]`** — copies the built `.rbxm`
  straight into your OS Roblox Studio plugins folder (Windows:
  `%LOCALAPPDATA%\Roblox\Plugins`, macOS: `~/Documents/Roblox/Plugins`,
  Linux: `~/.local/share/Roblox/Plugins`). `--list` shows the target dir.
- **The plugin now ships inside the npm package** (`cli/dist/*.rbxm`), so
  `npm i -g roforge-cli && roforge install-plugin` works with no git clone
  and no rojo. A test keeps the bundled `.rbxm` byte-identical to the repo
  build.

### Fixed
- **TUI now shows the bridge token** while waiting for Studio (the `/studio`
  line and the startup banner) — previously only `roforge studio` printed it,
  so TUI users had no token to paste into the plugin dock.
- **The agent no longer invents connection steps** — the system prompt now
  tells it the exact install path and that the RoForge Bridge plugin is *not*
  in the Roblox Toolbox (it's installed from the bundled `.rbxm`).
- Help / README / docs: "not in the Toolbox" spelled out in every place that
  explains connecting Studio.

### Tests
- 8 new tests (plugin install: per-OS target dirs, source resolution, copy
  behavior, npm↔repo parity, TUI token visibility) — CLI total **94/94**.

## 0.3.3 — 2026-09-13

### Added — RoForge Pro pass-gate (open-core monetization, no account needed)
- **`Pro.lua` entitlement core** (`studio-bridge`): one place defines the
  free/Pro limits and feature flags. Ownership is checked inside Studio via
  `MarketplaceService` (game pass + re-purchasable monthly dev product),
  cached 60s, graceful when the services are unavailable.
- **Free → Pro limit raises, enforced in the plugin**: export depth 6→10,
  import 500→2500 nodes, viewport 1280×720→1920×1080. Pro-only feature flags
  (cloud snapshots, team workspaces, hosted MCP relay) are wired but off
  until their closed-source components ship (see `LICENSE-PRO.md`).
- **`forge_pro` tool** (25th `forge_*`, read-only, no approval gate): reports
  Free/Pro, which pass the Studio user owns, and the active limits.
- **Bridge dock**: FREE/PRO badge + **Pro Game Pass ID** / **Pro Dev Product
  ID** fields (persisted in plugin Settings) — paste your ids once and
  ownership checks just work.
- **`roforge pro` CLI command**: prints the live license status. Attaches to
  a running `roforge studio` bridge (new authenticated enqueue/job-status
  endpoints on the bridge) or starts a short-lived one.
- **`hq/` starter place**: the RoForge HQ experience — a tiny storefront
  (one-time pass + monthly dev product buttons) with a step-by-step README
  for creating the 499 R$ pass and 199 R$/month product in the Creator
  Dashboard. Builds to `hq/dist/RoForgeHQ.rbxm`.
- **Repo polish**: `LICENSE-PRO.md` (open-core boundary), `CONTRIBUTING.md`,
  GitHub issue templates, README Pro section + layout, `ROFORGE_BRIDGE_TOKEN`
  env override, CI Pro validation step.
- **Tests**: 35-check Luau Pro suite (`validate_pro.mjs`, runs in CI under
  standalone luau) + 6 new CLI tests for the attach path — CLI total is now
  86/86.

## 0.3.2 — 2026-09-14

### Fixed
- **Free default model was dead** — the shipped free slug (`qwen/qwen3-coder:free`)
  was retired from OpenRouter's free tier, so a fresh install with only a free
  OpenRouter key hit a 404. New default: `nvidia/nemotron-3-super-120b-a12b:free`,
  verified live (public models API + real tool-calling request). A comment in
  `config.js` documents the free-tier churn and where to find live slugs.
- **Flaky first request could kill a turn** — OpenAI-compatible requests
  (OpenAI + OpenRouter) now use a 60s per-attempt timeout with one automatic
  retry on network-level failures (`UND_ERR_CONNECT_TIMEOUT`, DNS, EPIPE…).
  Ctrl+C aborts are never retried.
- **Retired free slug 404s** now say exactly what happened and what to do:
  the paid replacement slug (parsed from OpenRouter's body) plus the
  `?max_price=0` list for live free models.

### Added — flicker-free TUI ("live region")
The terminal UI now renders the active assistant block as a **LiveRegion**:
a small bottom block that is rewritten in place (one write per frame, no
intermediate clears) while everything committed above it stays put — the
same framebuffer/differ idea behind Claude Code's TUI, sized to preserve the
terminal scrollback instead of owning the whole screen.
- Streaming markdown updates in place; the growing partial line is rewritten
  without touching committed lines.
- Status line (spinner + step label + cost) lives on the region's last row
  and updates without scrolling.
- Tool cards, approvals, and results commit to history as they happen; each
  assistant segment gets its own `RoForge>` header.
- Terminal resize erases and re-renders the region (no stale-width artifacts).
- Piped/non-TTY output keeps the legacy append rendering (auto-detected).
- Correctness is pinned by a fake-terminal test suite (screen grid + cursor +
  scroll simulation): in-place rewrite, scroll-at-screen-bottom invariant,
  release/commit, sameLine header, resize erase, word-aware styled wrapping
  incl. hard-broken long words — plus an end-to-end TUI turn test and a
  real-PTY smoke driver (`cli/scratch/pty-smoke.mjs`).

### Changed
- Markdown renderer now emits styled segments (heading bold, bullets cyan,
  numbered dim, quotes dim, inline code cyan, **bold** bold); the legacy
  string output is generated from the same segments, so piped output looks
  identical.
- Config tests assert the free model via `PROVIDERS.openrouter.freeModel`
  instead of pinning a slug (free tier churns).

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
