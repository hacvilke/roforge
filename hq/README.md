# RoForge HQ — starter place

The RoForge Pro experience: a tiny, publishable place where users buy the
**RoForge Pro** game pass (one-time, ~999 R$). Owning it unlocks Pro limits
in the RoForge Bridge plugin — Studio checks ownership itself via
`MarketplaceService`, so no code ships with your purchase.

```
hq/
├── default.project.json      rojo project
└── src/
    ├── ServerScriptService/HQ.server.lua
    └── StarterPlayer/StarterPlayerScripts/HQ.client.lua
```

## 1. Create the experience (Creator Dashboard)

1. Roblox → **Create** → **Experience** → name it `RoForge HQ`
   (exact name helps users find it; any name works).
2. Open it in Studio.
3. Drop the two scripts in (or build the rojo project):
   - `HQ.server.lua` → `ServerScriptService`
   - `HQ.client.lua` → `StarterPlayerScripts`
4. **Publish to Roblox** (F9 / File → Publish).

Or, if you have [rojo](https://rojo.space):

```sh
rojo build -o RoForgeHQ.rbxm default.project.json
# then in a fresh place: File → Import → RoForgeHQ.rbxm → Publish
```

## 2. Create the product (Creator Dashboard → your experience)

| Product | Type | Price | Notes |
|---|---|---|---|
| **RoForge Pro** | Game Pass | **999 R$** | one-time; "yours forever" |

- **Creator Dashboard → Experience → Passes & Products → +** → *Game Pass*.
  After creation you get an **ID** — note it down.

> The old "Pro month" developer product is retired. The plugin's
> `Pro Dev Product ID` field still works (for a future team/subscription
> product), but the HQ sells only the one-time pass.

## 3. Wire the ID (two places)

1. **HQ storefront** — `HQ.client.lua`, top of file:
   ```lua
   local PRO_GAME_PASS_ID = 123456789        -- your game pass id
   ```
   With an ID of `0` the button shows instructions instead of the purchase
   dialog (safe before you've created the pass).

2. **RoForge Bridge plugin** — in Studio, open the plugin dock and set:
   - `Pro Game Pass ID` → your game pass id
   - click **Save**

The plugin now reports Free/Pro in its dock and answers `forge_pro`
(`roforge pro` on the CLI) with the live entitlement.

## Pricing

One-time 999 R$ → ~699 R$ to you after Roblox's 30% cut → ~$2.66 via DevEx
(≈ $0.0038/R$, 18+, 50k R$ min cash-out). See
[../docs/MONETIZATION.md](../docs/MONETIZATION.md).
