# Contributing to RoForge

Thanks for helping! RoForge is local-first by design: **zero runtime
dependencies** in the CLI, no backend, and a tiny Luau plugin. Please keep it
that way (no npm installs, no new build steps you can't run offline).

## Requirements

- **Node 20+** (the CLI is plain ESM, zero deps)
- **luau 0.738** + **rojo 7.7.0** binaries for the Studio plugin work
  (CI downloads these; grab the same versions from
  [luau-lang/luau releases](https://github.com/luau-lang/luau/releases/tag/v0.738)
  and [rojo-rbx/rojo releases](https://github.com/rojo-rbx/rojo/releases/tag/v7.7.0))

## Quick check list (what CI runs)

Run from the repo root (each step is a subshell, so order doesn't matter):

```sh
# 1. CLI tests (94 tests: agent loops, providers, bridge, TUI, pro, plugin install)
(cd cli && npm test)

# 2. Offline end-to-end demo
(cd cli && node demo/e2e-demo.mjs)

# 3. Luau syntax gate (no SyntaxError allowed anywhere)
luau-analyze <each .lua in studio-bridge/src, client/src, hq/src>

# 4. Pro entitlement tests (standalone luau, no Roblox)
(cd studio-bridge && node test/validate_pro.mjs ../bin/luau)

# 5. PNG / DEFLATE validators (pixel-verified)
(cd studio-bridge && node test/validate_png.mjs ../bin/luau && node test/validate_deflate.mjs ../bin/luau)

# 6. Rebuild the plugin artifacts (commit the results)
rojo build -o studio-bridge/dist/RoForgeBridge.rbxm studio-bridge/default.project.json
rojo build -o client/dist/RoForge.rbxm client/default.project.json
rojo build -o hq/dist/RoForgeHQ.rbxm hq/default.project.json
```

## Repo map

| Dir | What | License |
|---|---|---|
| `cli/` | the agent: CLI, TUI, providers, bridge, MCP | MIT |
| `studio-bridge/` | the Studio plugin (Luau) + `Pro.lua` entitlement core | MIT |
| `hq/` | the RoForge HQ experience (where Pro is bought) | MIT |
| `client/` | the original in-Studio chat plugin (free, standalone) | MIT |
| `server/` | optional v0.1 hosted backend (not required) | Apache-2.0 |

## Luau gotchas (learned the hard way)

- **No chained colon calls**: `a:b:c(x)` is a *SyntaxError* in Luau.
  `a.b:c(x)` is the valid form (property, then method).
- The standalone `luau` CLI has no `io`, no `load`, no `readfile`, and
  **globals set in the main chunk are invisible to required modules**.
  Anything Roblox-global must come from a module-local, injectable source —
  see `studio-bridge/src/Root/Bridge/Pro.lua` (`Pro.setEnv` / `Pro.resetEnv`)
  for the pattern that keeps Pro testable without Roblox.
- `luau-analyze` will hint `Unknown global 'game'` in plugin code — that's
  expected outside Studio; CI only fails on `SyntaxError`.

## Conventions

- **Approval gates**: any tool that mutates Studio state goes in the
  `DESTRUCTIVE` set in `cli/src/tools/studio.js` (the TUI asks before running
  it). Read-only tools (like `forge_pro`) must NOT be gated.
- **Limits are data**: free vs Pro limits live in one place —
  `Pro.lua` `LIMITS` table. Don't scatter magic numbers across tools.
- **Tests with the real server**: bridge tests spin up a real `BridgeServer`
  on port 0 and a raw-HTTP fake plugin (see `cli/test/bridge.test.js`).
- Commits: imperative subject (`add forge_pro tool`), small diffs, run the
  full check list before pushing.

## Monetization boundary

See [LICENSE-PRO.md](LICENSE-PRO.md) and [docs/MONETIZATION.md](docs/MONETIZATION.md).
The Pro *entitlement check* is MIT (so free builds keep working); closed Pro
feature implementations are marked at the top of their files with a
`RoForge Pro (closed-source component)` comment.

## Issues

Bug reports and feature requests: open an issue (templates provided).
Pricing/Pro licensing questions: label them `pro-license`.
