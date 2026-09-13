# RoForge

**A local Claude-Code-style AI agent for Roblox Studio.** Runs on your machine,
talks to Roblox Studio, uses **your own API key** (BYOK), and has **zero backend**
in the core — free of subscriptions, free of credit meters, free of middlemen.

```
┌─────────────────────────── your machine ───────────────────────────┐
│                                                                    │
│  roforge (CLI/TUI)          Roblox Studio                          │
│  ┌──────────────────┐       ┌──────────────────────────────────┐  │
│  │ streaming agent  │  MCP  │  built-in MCP server (beta)      │  │
│  │ loop (Luau-aware)├──────►│  …or the RoForge Bridge plugin   │  │
│  │                  │       │  (forge_* tools, polling)        │  │
│  │ project tools    │       └──────────────────────────────────┘  │
│  │  read/edit/run   │                                             │
│  │ web + roblox API │                                             │
│  └────────┬─────────                                             │
└───────────┼────────────────────────────────────────────────────────┘
            │  direct HTTPS (your key)
            ▼
  api.anthropic.com · api.openai.com · generativelanguage.googleapis.com
  api.groq.com · openrouter.ai   (auto-routed, free tiers first)
```

Your key goes **only** to the model provider. Everything else — Studio
traffic, project files, web search — stays on your machine.

## What it does

- **Edits your Rojo project like Claude Code edits a repo**: `project_tree`,
  `project_read`, `project_write`, `project_edit`, `project_search`,
  `project_run` (rojo builds, tests), `luau_analyze` — with approval gates on
  destructive actions.
- **Sees the viewport (vision)**: `forge_viewport` captures the Studio 3D
  viewport as a real PNG and shows it to a vision-capable model — ask "does
  that part look centered?" and it will actually look. (Bridge plugin;
  Studio's built-in MCP screenshots reach the model too.)
- **Edits are undoable**: `forge_checkpoint` marks the Studio undo history
  before a destructive batch and `forge_undo` rolls it back — so the agent
  can make changes without breaking your place. (`ChangeHistoryService`.)
- **Drives live Studio**: read the DataModel, read/write scripts,
  create/delete instances, run Luau, inspect/set individual properties and
  attributes, control the selection, screenshots, **find instances**
  (name/class), **bulk-create** a whole structure in one approval,
  **snapshot/diff the hierarchy** (what changed), and **export subtrees as
  JSON** — via **Studio's built-in MCP server** (beta, official) or the
  **RoForge Bridge plugin** (our fallback).
- **Knows Roblox**: web search, URL fetch, Roblox game/user lookups — all
  local, no backend.
- **Streams**: real token streaming in the terminal (the in-Studio plugin
  couldn't — that's why the brain moved to a local process).
- **Shows its work**: every tool call is printed with its result; per-turn
  token + estimated cost footer.

## Quick start

Requirements: **Node.js ≥ 18.17** (no npm dependencies).

```bash
npm i -g roforge-cli               # install (or: git clone this repo → cd cli)
roforge login --provider gemini    # or groq / openrouter / anthropic / openai
roforge                            # interactive TUI in your project directory
```

> **Install options:** published on **GitHub Packages** as
> `@hacvilke/roforge-cli` (any GitHub token with `read:packages` works):
> ```bash
> npm config set @hacvilke:registry https://npm.pkg.github.com
> echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc
> npm i -g @hacvilke/roforge-cli
> ```
> or simply clone the repo and run `node cli/bin/roforge.js`. The `roforge-cli`
> npmjs package is publish-ready (24-file, dependency-free tarball).

**No paid API yet?** The free tiers work out of the box: a free Gemini key
(aistudio.google.com, ~1,500 req/day, no card), Groq (console.groq.com), or an
OpenRouter `:free` model. `provider: "auto"` (default) picks the first key you
have — free tiers first — at $0 cost. `roforge providers` shows what's set.


One-shot:

```bash
node bin/roforge.js chat -m "Summarize this project and list the scripts that talk to HttpService"
```

Connecting Studio (pick one):

1. **Built-in MCP (recommended).** Studio → File → Studio Settings → Beta
   Features → enable **MCP Server** (listens on `localhost:3004`). RoForge
   detects it automatically — `/studio` in the TUI shows the status.
2. **RoForge Bridge plugin.** Build, install, then paste the token:
   ```bash
   cd studio-bridge && rojo build -o dist/RoForgeBridge.rbxm   # already built in dist/
   node scripts/install-plugin.mjs bridge   # copies dist into your OS plugins folder
   # …or Studio: File → Plug-ins → Manage → install dist/RoForgeBridge.rbxm
   node cli/bin/roforge.js studio   # keeps the bridge running, prints the token
   # in Studio: RoForge Bridge → paste token → Save & connect
   ```

Commands: `roforge` (TUI) · `chat -m "…"` · `studio` · `tools` ·
`login --provider <p>` · `providers` · `analyze <file…>` ·
`config [set k v]` · `version`. Full usage: `docs/CLI.md`.

## Repository layout

```
cli/           MIT — the local agent (Node, zero deps)
  bin/roforge.js          CLI entry (TUI / chat / studio / tools / login / analyze)
  src/providers/          anthropic · openai · gemini · groq · openrouter (SSE) adapters
  src/mcp.js              MCP Streamable-HTTP client (talks to Studio's server)
  src/bridge/             local loopback bridge server (polling protocol)
  src/tools/              web, roblox, project, studio tool factories
  src/agent.js            the agent loop
  src/tui/                terminal UI (ANSI, zero deps)
  test/                   58 tests incl. full agent loop + provider routing + vision on both tiers
  demo/e2e-demo.mjs       offline end-to-end demo
studio-bridge/ MIT — thin Studio plugin (Luau) that polls the bridge
  src/Root/Bridge/        Bridge loop, LocalTools, ExtraTools, Viewport, PngEncoder
  test/                   PNG encoder validation (pixel-verified under `luau`)
client/        MIT — (v0.1) full in-Studio chat plugin, still works standalone
server/        Apache-2.0 — (v0.1) optional hosted tool backend, not required
scripts/       install-plugin.mjs (copies a built .rbxm into your OS plugins folder)
docs/          architecture, CLI, bridge protocol, tool spec, security
.github/       CI: node tests + e2e demo + PNG validate + luau-analyze + rojo builds
```

## Why local-first (and what that buys you)

- **Free core**: no backend to run or pay for; the only cost is your model usage.
- **Private**: chat, key, and project files never touch any third party.
- **Streaming**: a local process has real HTTP/SSE; the in-Studio plugin could only do whole-response requests.
- **Portable**: `roforge` works in a repo (Rojo project) with no Studio open,
  and gains Studio superpowers when Studio is.

The old in-Studio plugin (`client/`) and the hosted backend (`server/`) still
work as standalone modes — the local CLI is now the primary surface.

## Status

MVP complete and tested: 58/58 CLI tests (incl. full agent loops against mock
providers **and the vision image contract**), 21/21 backend tests,
pixel-validated PNG encoder with a from-scratch **RFC 1951 DEFLATE**
compressor (1024×576 viewport → 103KB, 23× smaller than stored blocks),
5 model providers with **free-tier auto-routing** (Gemini / Groq / OpenRouter
/ Anthropic / OpenAI — `roforge providers`), Luau analyzer-clean plugins,
Rojo-built `.rbxm` artifacts, offline e2e demo, GitHub Actions CI.
Latest: viewport vision on **both** tiers (bridge `forge_viewport` and
Studio's MCP screenshots — the model actually sees Studio), `ChangeHistoryService`
undo checkpoints, find/bulk-create/snapshot/diff/export/import Studio tools
(24 `forge_*` total — `forge_import` re-applies an export JSON),
**multi-block DEFLATE** (streams > 64 KB now inflate byte-exact, with
per-block dynamic/stored choice), property-level `forge_diff`,
streaming Markdown + expandable tool output (`/out`) in the TUI, real deflate,
multi-provider + free tiers, and a publish-ready `roforge-cli` npm package
(`npm pack` clean, zero deps). Next: npm publish (set your repo URL),
Deflate speed tuning, team features. See `PROGRESS.md`.

## License

`cli/`, `studio-bridge/`, `client/` — MIT · `server/` — Apache-2.0
