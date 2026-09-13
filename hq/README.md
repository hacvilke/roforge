# RoForge HQ — starter place

The RoForge Pro experience: a tiny, publishable place where users buy the
**RoForge Pro** game pass (one-time) or **Pro month** (repeatable dev product).
Buying either unlocks Pro limits in the RoForge Bridge plugin — Studio checks
ownership itself via `MarketplaceService`, so no code ships with your purchase.

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

## 2. Create the products (Creator Dashboard → your experience)

| Product | Type | Price | Notes |
|---|---|---|---|
| **RoForge Pro** | Game Pass | **499 R$** | one-time; "Yours forever" |
| **Pro month** | Developer Product | **199 R$** | repeatable; shown as "Pro month" |

- Game Pass: **Creator Dashboard → Experience → Passes & Products → +**
  → *Game Pass*. After creation you get an **ID** — note it down.
- Dev Product: same screen → *Developer Product*, tick **Enable Dev Product
  as Re-Purchasable** (that's what makes "monthly" work: each repurchase
  extends Pro for one more month).

## 3. Wire the IDs (two places)

1. **HQ storefront** — `HQ.client.lua`, top of file:
   ```lua
   local PRO_GAME_PASS_ID = 123456789        -- your game pass id
   local PRO_MONTH_DEV_PRODUCT_ID = 987654321 -- your dev product id
   ```
   With an ID of `0` the buttons show instructions instead of the purchase
   dialog (safe before you've created the products).

2. **RoForge Bridge plugin** — in Studio, open the plugin dock and set:
   - `Pro Game Pass ID` → your game pass id
   - `Pro Dev Product ID` → your dev product id
   - click **Save**

The plugin now reports Free/Pro in its dock and answers `forge_pro`
(`roforge pro` on the CLI) with the live entitlement.

## Pricing rationale

See [../docs/MONETIZATION.md](../docs/MONETIZATION.md) — 499 R$ one-time
(≈ 349 R$ ≈ $1.33 in DevEx after Roblox's 30% cut) or 199 R$/month for
users who don't want to commit; both feed the same Pro gate.
