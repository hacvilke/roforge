# RoForge Pro License (Pro components)

RoForge is **open source under the MIT License** (see [`LICENSE`](LICENSE)) —
the agent, the Studio bridge, all 25 bridge tools, and the Pro *entitlement
check* included.

**RoForge Pro components** are the parts that gate behind the paid unlock and
are **not** part of the MIT-licensed source in this repository. Today that
means the *feature implementations* flagged `Pro.feature` in
`studio-bridge/src/Root/Bridge/Pro.lua` (cloud snapshots, team workspaces,
hosted MCP relay). Those implementations, when distributed, are provided
under a **separate, closed-source commercial license** and are only enabled
when your Studio session owns the RoForge Pro game pass or the Pro month
developer product.

## What this means for you

- **Using RoForge (free):** you get the full MIT-licensed agent with free-tier
  limits (export depth 6, 500-node imports, 1280×720 viewport). No account,
  no license terms beyond MIT.
- **Using RoForge Pro:** purchasing the game pass or monthly dev product in
  the **RoForge HQ** experience grants you a *user* right to use the Pro
  feature implementations. That right is personal, non-transferable, and
  terminates if you refund the purchase. It does **not** grant you the Pro
  source code.
- **Developers:** you may build on the MIT-licensed code freely. The Pro
  feature *seams* (limits, flags, the `forge_pro` status tool) are MIT so
  your builds keep working; the closed Pro implementations are simply
  inactive for non-Pro sessions.

## Open-core boundary (how to tell)

A file is MIT unless it is explicitly marked at its top with:

```lua
-- RoForge Pro (closed-source component) — see LICENSE-PRO.md
```

If you see that marker, the file is a Pro component and its terms are this
document. Everything else in this repo is MIT.

## Questions / licensing your org

Open an issue with the label `pro-license`, or contact the maintainer
(@hacvilke). Enterprise/team licensing terms are available on request.
