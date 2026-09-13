# RoForge Pro — monetization

RoForge has one paid product: **RoForge Pro**, a Robux unlock. Everything
else in the repo — the CLI, the bridge plugin, all 25 `forge_*` tools, the
HQ starter place — is MIT, free, and stays that way.

## What Pro is

A **game pass** (one-time) or a **monthly developer product** (repeatable),
sold inside the **RoForge HQ** experience — Robux passes and products must
live in an experience, which is why the HQ exists. Owning either makes your
Studio session Pro. The purchase is a normal Roblox transaction; there is no
account with the maintainer, no separate checkout.

| Product | Type | Price |
|---|---|---|
| RoForge Pro | Game Pass | 499 R$ (one-time) |
| Pro month | Developer Product | 199 R$ (repeatable — Roblox has no subscriptions, so the monthly option is a re-purchase) |

Roblox takes 30%: 499 R$ → ~349 R$ → ~$1.33 via DevEx (≈ $0.0038/R$,
18+, 50k R$ minimum cash-out). Playing the HQ experience while subscribed to
Premium also generates the standard Premium payouts.

## What Pro changes

The free tier is complete — full agent, all tools, $0 to run with free-tier
model keys. Pro changes limits and enables the Pro components:

| | Free | Pro |
|---|---|---|
| Export depth (`forge_export` / `forge_tree`) | 6 | 10 |
| Import size (`forge_import`) | 500 nodes | 2,500 nodes |
| Viewport capture | up to 1280×720 | up to 1920×1080 |
| Cloud snapshots · team workspaces · hosted MCP relay | — | enabled |

The limit differences are enforced in the open plugin
(`Pro.lua` → `Pro.limit()`). The three Pro features are closed-source
components (marked `RoForge Pro (closed-source component)` when shipped —
terms in `LICENSE-PRO.md`); until they ship, their flags are off and Pro =
raised limits. The entitlement check itself is MIT in either case.

## How the check works

- The plugin dock stores two ids — **Pro Game Pass ID** / **Pro Dev Product
  ID** — in its Settings (persisted with the plugin).
- `studio-bridge/src/Root/Bridge/Pro.lua` checks ownership with
  `MarketplaceService` (game pass + `Passes:PurchasedProductAsync` for the
  dev product), cached 60s. `Pro.isPro()` and `Pro.report()` feed the dock's
  FREE/PRO badge and the `forge_pro` tool.
- The CLI only renders the report: `roforge pro`.

## Setup (one-time, on the Roblox account)

1. Publish the **RoForge HQ** experience from the `hq/` starter place
   (`hq/README.md` walks through it).
2. Creator Dashboard → Passes & Products: create the **499 R$ game pass** and
   the **199 R$ dev product** (re-purchasable) → paste both ids into the
   plugin dock and into the HQ storefront
   (`hq/src/StarterPlayer/StarterPlayerScripts/HQ.client.lua`).
3. Publish the bridge plugin (File → Publish to Roblox as a Plugin).
4. Enable DevEx (Creator Dashboard → Payments) to cash out at 50k R$.
5. Optional: make the Toolbox copy of the plugin **premium-only** — Premium
   subscribers who use the asset generate passive payouts.

## Beyond Robux

Team/studio plans (Stripe billing on the hosted backend) are the only
planned addition outside Robux, and only if teams ask for them. The npm
package stays free regardless.
