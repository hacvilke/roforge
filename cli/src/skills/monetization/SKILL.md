---
name: monetization
description: Roblox monetization — gamepass shops, developer products, pricing, purchase flow. Use when the user asks to sell something, add a gamepass, a shop, premium perks, dev products, or make money.
---

# Monetization playbook

## The three product types (choose the right one)
1. **Gamepass** (one-time, persistent) — best for permanent perks: 2x coins,
   starter gear, skip-to-stage. User owns it forever; `UserOwnsGamePassAsync` is the
   check. The scaffold's ObbyShop is a gamepass kiosk.
2. **Developer Product** (repeatable purchase) — consumables: coin packs, revives.
   Grant on `MarketplaceService.PlayerPurchased`, and ALWAYS grant idempotently
   (track granted transaction ids or use the purchase receipt flow) — Roblox retries
   and double-granting is the classic bug.
3. **Subscriptions** — monthly; only for ongoing content. Rarely the right first choice.

## Gamepass flow (the working pattern, scaffold's ObbyShop)
1. User creates the pass in the Creator Dashboard (Monetize > Passes) → gets a numeric
   PassId. Paste it into `PASS_ID` in `ServerScriptService.ObbyScripts.ObbyShop`.
   Until then the kiosk is a safe no-op (PASS_ID = 0).
2. Kiosk = a part in the world with a ProximityPrompt (HoldDuration ~1,
   ObjectText "Shop"). On Triggered:
```lua
local Market = game:GetService("MarketplaceService")
local ok, owns = pcall(function() return Market:UserOwnsGamePassAsync(player.UserId, PASS_ID) end)
if ok and owns then
    player:SetAttribute("Obby2x", true) -- grant the perk via a player attribute
elseif ok then
    Market:PromptGamePassPurchase(player, PASS_ID) -- opens the buy dialog
else
    prompt.ActionText = "Shop (offline)" -- degrade gracefully
end
```
3. The perk is a **player attribute** (`Obby2x`), not a global — every system that
   cares reads `player:GetAttribute("Obby2x")` (scaffold gameplay multiplies coins).
   Re-check ownership on CharacterAdded in case the user bought elsewhere.

## Pricing guidance (honest)
- First gamepass: 10-25 R$ for a small perk (2x coins), 50-100 R$ for a big one
  (skip to a late stage). One-time, clear value, no dark patterns.
- Dev products: 5-25 R$ packs.
- Do NOT: pay-to-win that breaks free play (players rage-quit), gambling mechanics,
  or anything that violates Roblox ToS (real-money trading, selling accounts/items
  off-platform). A game that's fun free + cheap fair perks is the meta.

## The Pro product (RoForge itself)
RoForge Pro is a one-time 999 R$ gamepass-style entitlement on the developer's account —
local-first features (offline tooling, extended limits). That's the product's own
monetization; in-place game monetization is what THIS skill builds for the user's games.

## Verify
- F5, walk to the kiosk, press the prompt: without the pass it should open the buy
  dialog (in Studio this may no-op if unpublished — expected; the pcall path handles it).
- After owning the pass (or setting the attribute manually in forge_run for testing):
  coins should be 2x, HUD badge should show.
