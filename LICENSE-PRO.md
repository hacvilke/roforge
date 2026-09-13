# RoForge Pro License (Pro components)

RoForge is **open source under the MIT License** (see [`LICENSE`](LICENSE)) —
the agent, the Studio bridge, all 29 bridge tools, the Pro *entitlement
check*, and the Pro *seams* (`ProModuleLoader` + the four `forge_*` Pro
tools) included.

**RoForge Pro components** are the parts that gate behind the paid unlock and
are **not** part of the MIT-licensed source in this repository: the *feature
implementations* (cloud snapshots, team workspaces, hosted MCP relay) live in
the private companion repository **`hacvilke/roforge-pro`**. The open plugin
loads them through the MIT `ProModuleLoader` when the closed
`RoForgeProModule` ModuleScript is installed; without it, the Pro tools
degrade to a clean "not installed" result. The closed module is only enabled
when your Studio session owns the RoForge Pro game pass (one-time).

## What this means for you

- **Using RoForge (free):** you get the full MIT-licensed agent with free-tier
  limits (export depth 6, 500-node imports, 1280×720 viewport). No account,
  no license terms beyond MIT.
- **Using RoForge Pro:** purchasing the one-time game pass in the
  **RoForge HQ** experience grants you a *user* right to use the Pro
  feature implementations. That right is personal, non-transferable, and
  terminates if you refund the purchase. It does **not** grant you the Pro
  source code.
- **Developers:** you may build on the MIT-licensed code freely. The Pro
  feature *seams* (limits, flags, the `forge_pro` status tool) are MIT so
  your builds keep working; the closed Pro implementations are simply
  inactive for non-Pro sessions.

## Open-core boundary (how to tell)

This repository contains **only MIT code**. The closed Pro implementation is
never pushed here; it ships from the private companion repo as a built
ModuleScript (`ProModule.rbxm`). If a file in this repo is ever marked at its
top with:

```lua
-- RoForge Pro (closed-source component) — see LICENSE-PRO.md
```

that file is a Pro component and its terms are this document. Treat the
companion repo's `pro/` directory the same way.

## Questions / licensing your org

Open an issue with the label `pro-license`, or contact the maintainer
(@hacvilke). Enterprise/team licensing terms are available on request.
